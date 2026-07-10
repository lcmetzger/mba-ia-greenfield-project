import { readFileSync } from 'fs';
import { join } from 'path';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import queueConfig from '../src/config/queue.config';
import storageConfig from '../src/config/storage.config';
import { MailService } from '../src/mail/mail.service';
import { VIDEO_PROCESSING_QUEUE } from '../src/queue/queue.constants';
import {
  cleanAllTables,
  createTestDataSource,
} from '../src/test/create-test-data-source';
import { clearBucket } from '../src/test/minio';
import { User } from '../src/users/entities/user.entity';
import { VideoProcessingModule } from '../src/video-processing/video-processing.module';
import { Video } from '../src/videos/entities/video.entity';

const VIDEOS_BUCKET = process.env.STORAGE_BUCKET_VIDEOS ?? 'streamtube-videos';
const THUMBNAILS_BUCKET =
  process.env.STORAGE_BUCKET_THUMBNAILS ?? 'streamtube-thumbnails';
const FIXTURE_PATH = join(
  __dirname,
  '..',
  'src',
  'test',
  'fixtures',
  'sample-video.mp4',
);

interface LoginResponseBody {
  access_token: string;
}

interface InitiateUploadResponseBody {
  id: string;
  short_code: string;
  upload_id: string;
  status: string;
}

interface VideoDetailResponseBody {
  id: string;
  status: string;
  duration_seconds: string | null;
}

function binaryParser(
  res: NodeJS.EventEmitter,
  callback: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('waitFor timed out');
}

describe('Videos lifecycle (e2e, real worker)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;
  let videoQueue: Queue<{ videoId: string }>;
  let workerModule: TestingModule;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
    videoQueue = moduleFixture.get<Queue<{ videoId: string }>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );

    // Boots the real worker in-process (same VideoProcessingModule the
    // video-worker container runs) so the job enqueued by POST .../complete
    // is genuinely consumed — real ffmpeg, real MinIO, real Postgres.
    const workerDataSource = createTestDataSource([User, Channel, Video]);
    workerModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, queueConfig],
        }),
        TypeOrmModule.forRoot(workerDataSource.options),
        VideoProcessingModule,
      ],
    }).compile();
    await workerModule.init();
  });

  afterAll(async () => {
    await workerModule.close();
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await clearBucket(VIDEOS_BUCKET);
    await clearBucket(THUMBNAILS_BUCKET);
    throttlerStorage.storage.clear();
    await videoQueue.drain(true);
  });

  async function captureConfirmationToken(
    email: string,
    password = 'password123',
  ): Promise<string> {
    const authService = app.get(AuthService);
    const mailServiceInstance = (
      authService as unknown as { mailService: MailService }
    ).mailService;
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce(
        (_email: string, _name: string, token: string) => {
          capturedToken = token;
          return Promise.resolve();
        },
      );
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    return capturedToken;
  }

  async function registerConfirmAndLogin(
    email: string,
    password = 'password123',
  ): Promise<string> {
    const token = await captureConfirmationToken(email, password);
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    return (res.body as LoginResponseBody).access_token;
  }

  it('uploads a real video, processes it with the real worker, and serves stream + download', async () => {
    const accessToken = await registerConfirmAndLogin('lifecycle@example.com');
    const fileBuffer = readFileSync(FIXTURE_PATH);

    const initResponse = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Full lifecycle video',
        content_type: 'video/mp4',
        size_bytes: fileBuffer.length,
        original_filename: 'sample-video.mp4',
      });
    expect(initResponse.status).toBe(201);
    const { id, short_code } = initResponse.body as InitiateUploadResponseBody;

    const partsResponse = await request(app.getHttpServer())
      .post(`/videos/${id}/upload-parts`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ part_numbers: [1] });
    const { url } = (
      partsResponse.body as { parts: { part_number: number; url: string }[] }
    ).parts[0];
    const putResponse = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(fileBuffer),
    });
    const etag = putResponse.headers.get('etag') as string;

    const completeResponse = await request(app.getHttpServer())
      .post(`/videos/${id}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ parts: [{ part_number: 1, etag }] });
    expect(completeResponse.status).toBe(200);
    expect((completeResponse.body as { status: string }).status).toBe(
      'processing',
    );

    await waitFor(async () => {
      const detail = await request(app.getHttpServer())
        .get(`/videos/${id}`)
        .set('Authorization', `Bearer ${accessToken}`);
      return (detail.body as VideoDetailResponseBody).status === 'ready';
    }, 20000);

    const detailResponse = await request(app.getHttpServer())
      .get(`/videos/${id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    const detail = detailResponse.body as VideoDetailResponseBody;
    expect(detail.status).toBe('ready');
    expect(Number(detail.duration_seconds)).toBeCloseTo(2, 0);

    const streamResponse = await request(app.getHttpServer())
      .get(`/videos/${short_code}/stream`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Range', 'bytes=0-9')
      .buffer(true)
      .parse(binaryParser);
    expect(streamResponse.status).toBe(206);
    expect((streamResponse.body as Buffer).length).toBe(10);

    const downloadResponse = await request(app.getHttpServer())
      .get(`/videos/${short_code}/download`)
      .set('Authorization', `Bearer ${accessToken}`)
      .buffer(true)
      .parse(binaryParser);
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers['content-disposition']).toContain(
      'attachment',
    );
    expect((downloadResponse.body as Buffer).length).toBe(fileBuffer.length);
  }, 40000);
});
