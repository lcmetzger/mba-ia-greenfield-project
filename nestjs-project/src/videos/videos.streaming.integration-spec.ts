import { PassThrough } from 'stream';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import { DataSource, Repository } from 'typeorm';
import type { JwtPayload } from '../auth/auth.types';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { buildVideoKey } from '../storage/storage.keys';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { clearBucket } from '../test/minio';
import { User } from '../users/entities/user.entity';
import { VideoStatus } from './entities/video-status.enum';
import { Video } from './entities/video.entity';
import { VideosController } from './videos.controller';
import { VideosModule } from './videos.module';

const VIDEOS_BUCKET = process.env.STORAGE_BUCKET_VIDEOS ?? 'streamtube-videos';

class FakeResponse extends PassThrough {
  statusCode = 0;
  headers: Record<string, string> = {};

  writeHead(status: number, headers: Record<string, string>): this {
    this.statusCode = status;
    this.headers = headers;
    return this;
  }
}

describe('VideosController streaming (integration)', () => {
  let dataSource: DataSource;
  let controller: VideosController;
  let storageService: StorageService;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;

  beforeAll(async () => {
    const testDataSource = createTestDataSource([User, Channel, Video]);
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, queueConfig],
        }),
        TypeOrmModule.forRoot(testDataSource.options),
        VideosModule,
      ],
    }).compile();

    dataSource = module.get(DataSource);
    controller = module.get(VideosController);
    storageService = module.get(StorageService);
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await clearBucket(VIDEOS_BUCKET);
  });

  async function createReadyVideo(
    body: Buffer,
    shortCode: string,
  ): Promise<{ user: JwtPayload; video: Video }> {
    const user = await userRepository.save(
      userRepository.create({
        email: `${shortCode}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Streamer',
        nickname: shortCode,
        user_id: user.id,
      }),
    );
    const storageKey = buildVideoKey(`stream-${shortCode}`);
    await storageService.putObject(
      VIDEOS_BUCKET,
      storageKey,
      body,
      'video/mp4',
    );
    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Stream me',
        short_code: shortCode,
        status: VideoStatus.READY,
        storage_key: storageKey,
        content_type: 'video/mp4',
      }),
    );

    return { user: { sub: user.id, email: user.email }, video };
  }

  it('streams the full body with 200 when no Range header is sent', async () => {
    const body = Buffer.from('0123456789');
    const { user, video } = await createReadyVideo(body, 'streamcode01');
    const req = { headers: {} } as Request;
    const res = new FakeResponse();
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));

    await controller.stream(
      user,
      video.short_code,
      req,
      res as unknown as Response,
    );

    expect(res.statusCode).toBe(200);
    expect(Buffer.concat(chunks).toString()).toBe('0123456789');
  });

  it('streams only the requested byte range with 206 when Range header is sent', async () => {
    const body = Buffer.from('0123456789');
    const { user, video } = await createReadyVideo(body, 'streamcode02');
    const req = { headers: { range: 'bytes=2-5' } } as unknown as Request;
    const res = new FakeResponse();
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));

    await controller.stream(
      user,
      video.short_code,
      req,
      res as unknown as Response,
    );

    expect(res.statusCode).toBe(206);
    expect(res.headers['Content-Range']).toContain('bytes 2-5');
    expect(Buffer.concat(chunks).toString()).toBe('2345');
  });
});
