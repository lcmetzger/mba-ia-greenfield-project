import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { clearBucket } from '../src/test/minio';

const VIDEOS_BUCKET = process.env.STORAGE_BUCKET_VIDEOS ?? 'streamtube-videos';

interface LoginResponseBody {
  access_token: string;
}

interface InitiateUploadResponseBody {
  id: string;
  short_code: string;
  upload_id: string;
  status: string;
}

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let throttlerStorage: ThrottlerStorageService;

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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await clearBucket(VIDEOS_BUCKET);
    throttlerStorage.storage.clear();
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

  describe('POST /videos', () => {
    it('creates a draft video and returns 201 with id, short_code, upload_id', async () => {
      const accessToken = await registerConfirmAndLogin('uploader@example.com');

      const response = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'My first video',
          content_type: 'video/mp4',
          size_bytes: 1024,
          original_filename: 'video.mp4',
        });

      const body = response.body as InitiateUploadResponseBody;
      expect(response.status).toBe(201);
      expect(body.id).toBeDefined();
      expect(body.short_code).toHaveLength(12);
      expect(body.upload_id).toBeDefined();
      expect(body.status).toBe('draft');
    });

    it('rejects with 400 FILE_TOO_LARGE when size_bytes exceeds the 10GB limit', async () => {
      const accessToken = await registerConfirmAndLogin('bigfile@example.com');

      const response = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Too big',
          content_type: 'video/mp4',
          size_bytes: 10 * 1024 * 1024 * 1024 + 1,
          original_filename: 'video.mp4',
        });

      const body = response.body as ErrorResponseBody;
      expect(response.status).toBe(400);
      expect(body.error).toBe('FILE_TOO_LARGE');
    });

    it('rejects with 401 when no Authorization header is sent', async () => {
      const response = await request(app.getHttpServer()).post('/videos').send({
        title: 'No auth',
        content_type: 'video/mp4',
        size_bytes: 1024,
        original_filename: 'video.mp4',
      });

      expect(response.status).toBe(401);
    });

    it('rejects with 400 validation error when required fields are missing', async () => {
      const accessToken = await registerConfirmAndLogin(
        'missingfields@example.com',
      );

      const response = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Missing fields' });

      expect(response.status).toBe(400);
    });
  });
});
