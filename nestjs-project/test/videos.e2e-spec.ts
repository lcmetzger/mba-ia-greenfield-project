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

function binaryParser(
  res: NodeJS.EventEmitter,
  callback: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

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

  describe('POST /videos/:id/upload-parts', () => {
    async function initiateVideo(accessToken: string): Promise<string> {
      const response = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Video for parts',
          content_type: 'video/mp4',
          size_bytes: 1024,
          original_filename: 'video.mp4',
        });
      return (response.body as InitiateUploadResponseBody).id;
    }

    it('returns one presigned url per requested part number', async () => {
      const accessToken = await registerConfirmAndLogin('parts@example.com');
      const videoId = await initiateVideo(accessToken);

      const response = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload-parts`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ part_numbers: [1, 2] });

      expect(response.status).toBe(200);
      const body = response.body as {
        parts: { part_number: number; url: string }[];
      };
      expect(body.parts).toHaveLength(2);
      expect(body.parts[0].part_number).toBe(1);
      expect(body.parts[0].url).toContain('http');
    });

    it('returns 404 when the video belongs to another user', async () => {
      const ownerToken = await registerConfirmAndLogin('owner@example.com');
      const videoId = await initiateVideo(ownerToken);
      const intruderToken = await registerConfirmAndLogin(
        'intruder@example.com',
      );

      const response = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload-parts`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({ part_numbers: [1] });

      const body = response.body as ErrorResponseBody;
      expect(response.status).toBe(404);
      expect(body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('returns 400 when part_numbers is empty', async () => {
      const accessToken = await registerConfirmAndLogin(
        'emptyparts@example.com',
      );
      const videoId = await initiateVideo(accessToken);

      const response = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload-parts`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ part_numbers: [] });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /videos/:id/complete', () => {
    async function initiateVideo(accessToken: string): Promise<string> {
      const response = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Video for complete',
          content_type: 'text/plain',
          size_bytes: 16,
          original_filename: 'video.txt',
        });
      return (response.body as InitiateUploadResponseBody).id;
    }

    async function uploadSinglePart(
      accessToken: string,
      videoId: string,
    ): Promise<string> {
      const partsResponse = await request(app.getHttpServer())
        .post(`/videos/${videoId}/upload-parts`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ part_numbers: [1] });
      const { url } = (
        partsResponse.body as { parts: { part_number: number; url: string }[] }
      ).parts[0];
      const putResponse = await fetch(url, {
        method: 'PUT',
        body: Buffer.from('hello streamtube'),
      });
      return putResponse.headers.get('etag') as string;
    }

    it('completes the upload and transitions the video to processing', async () => {
      const accessToken = await registerConfirmAndLogin('complete@example.com');
      const videoId = await initiateVideo(accessToken);
      const etag = await uploadSinglePart(accessToken, videoId);

      const response = await request(app.getHttpServer())
        .post(`/videos/${videoId}/complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ part_number: 1, etag }] });

      expect(response.status).toBe(200);
      const body = response.body as { id: string; status: string };
      expect(body.id).toBe(videoId);
      expect(body.status).toBe('processing');
    });

    it('returns 409 when the video is not in draft status', async () => {
      const accessToken = await registerConfirmAndLogin('notdraft@example.com');
      const videoId = await initiateVideo(accessToken);
      const etag = await uploadSinglePart(accessToken, videoId);
      await request(app.getHttpServer())
        .post(`/videos/${videoId}/complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ part_number: 1, etag }] });

      const response = await request(app.getHttpServer())
        .post(`/videos/${videoId}/complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ part_number: 1, etag }] });

      const body = response.body as ErrorResponseBody;
      expect(response.status).toBe(409);
      expect(body.error).toBe('VIDEO_NOT_DRAFT');
    });

    it('returns 404 when the video belongs to another user', async () => {
      const ownerToken = await registerConfirmAndLogin(
        'complete-owner@example.com',
      );
      const videoId = await initiateVideo(ownerToken);
      const etag = await uploadSinglePart(ownerToken, videoId);
      const intruderToken = await registerConfirmAndLogin(
        'complete-intruder@example.com',
      );

      const response = await request(app.getHttpServer())
        .post(`/videos/${videoId}/complete`)
        .set('Authorization', `Bearer ${intruderToken}`)
        .send({ parts: [{ part_number: 1, etag }] });

      const body = response.body as ErrorResponseBody;
      expect(response.status).toBe(404);
      expect(body.error).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('GET /videos', () => {
    async function initiateVideo(
      accessToken: string,
      title: string,
    ): Promise<string> {
      const response = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title,
          content_type: 'video/mp4',
          size_bytes: 1024,
          original_filename: 'video.mp4',
        });
      return (response.body as InitiateUploadResponseBody).id;
    }

    it("returns only the authenticated user's channel videos", async () => {
      const ownerAToken = await registerConfirmAndLogin('list-a@example.com');
      const ownerBToken = await registerConfirmAndLogin('list-b@example.com');
      await initiateVideo(ownerAToken, 'A1');
      await initiateVideo(ownerAToken, 'A2');
      await initiateVideo(ownerBToken, 'B1');

      const response = await request(app.getHttpServer())
        .get('/videos')
        .set('Authorization', `Bearer ${ownerAToken}`);

      expect(response.status).toBe(200);
      const body = response.body as {
        items: { id: string; title: string; status: string }[];
      };
      expect(body.items).toHaveLength(2);
      expect(body.items.map((item) => item.title).sort()).toEqual(['A1', 'A2']);
    });

    it('rejects with 401 when no Authorization header is sent', async () => {
      const response = await request(app.getHttpServer()).get('/videos');
      expect(response.status).toBe(401);
    });
  });

  describe('GET /videos/:id', () => {
    async function initiateVideo(accessToken: string): Promise<string> {
      const response = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Video for detail',
          content_type: 'video/mp4',
          size_bytes: 1024,
          original_filename: 'video.mp4',
        });
      return (response.body as InitiateUploadResponseBody).id;
    }

    it("returns 200 with the video's fields for the owner", async () => {
      const accessToken = await registerConfirmAndLogin('detail@example.com');
      const videoId = await initiateVideo(accessToken);

      const response = await request(app.getHttpServer())
        .get(`/videos/${videoId}`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      const body = response.body as {
        id: string;
        title: string;
        status: string;
      };
      expect(body.id).toBe(videoId);
      expect(body.title).toBe('Video for detail');
      expect(body.status).toBe('draft');
    });

    it('returns 404 when the video belongs to another user', async () => {
      const ownerToken = await registerConfirmAndLogin(
        'detail-owner@example.com',
      );
      const videoId = await initiateVideo(ownerToken);
      const intruderToken = await registerConfirmAndLogin(
        'detail-intruder@example.com',
      );

      const response = await request(app.getHttpServer())
        .get(`/videos/${videoId}`)
        .set('Authorization', `Bearer ${intruderToken}`);

      const body = response.body as ErrorResponseBody;
      expect(response.status).toBe(404);
      expect(body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('returns 404 when the video does not exist', async () => {
      const accessToken = await registerConfirmAndLogin(
        'detail-missing@example.com',
      );

      const response = await request(app.getHttpServer())
        .get('/videos/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`);

      const body = response.body as ErrorResponseBody;
      expect(response.status).toBe(404);
      expect(body.error).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('GET /videos/:shortCode/stream', () => {
    async function initiateAndMarkReady(
      accessToken: string,
      body: Buffer,
    ): Promise<{ videoId: string; shortCode: string }> {
      const initResponse = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Streamable video',
          content_type: 'video/mp4',
          size_bytes: body.length,
          original_filename: 'video.mp4',
        });
      const { id, short_code } =
        initResponse.body as InitiateUploadResponseBody;

      const partsResponse = await request(app.getHttpServer())
        .post(`/videos/${id}/upload-parts`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ part_numbers: [1] });
      const { url } = (
        partsResponse.body as { parts: { part_number: number; url: string }[] }
      ).parts[0];
      const putResponse = await fetch(url, {
        method: 'PUT',
        body: new Uint8Array(body),
      });
      const etag = putResponse.headers.get('etag') as string;

      await request(app.getHttpServer())
        .post(`/videos/${id}/complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ part_number: 1, etag }] });

      // No worker runs against this e2e app instance — flip status directly
      // to simulate what SI-03.9's worker does once processing succeeds.
      await dataSource.query(
        `UPDATE videos SET status = 'ready' WHERE id = $1`,
        [id],
      );

      return { videoId: id, shortCode: short_code };
    }

    it('returns 200 with the full body when no Range header is sent', async () => {
      const accessToken = await registerConfirmAndLogin(
        'stream-full@example.com',
      );
      const body = Buffer.from('hello streamtube video bytes');
      const { shortCode } = await initiateAndMarkReady(accessToken, body);

      const response = await request(app.getHttpServer())
        .get(`/videos/${shortCode}/stream`)
        .set('Authorization', `Bearer ${accessToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(response.status).toBe(200);
      expect((response.body as Buffer).toString()).toBe(body.toString());
    });

    it('returns 206 with the requested byte range when Range header is sent', async () => {
      const accessToken = await registerConfirmAndLogin(
        'stream-range@example.com',
      );
      const body = Buffer.from('0123456789');
      const { shortCode } = await initiateAndMarkReady(accessToken, body);

      const response = await request(app.getHttpServer())
        .get(`/videos/${shortCode}/stream`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Range', 'bytes=2-5')
        .buffer(true)
        .parse(binaryParser);

      expect(response.status).toBe(206);
      expect(response.headers['content-range']).toContain('bytes 2-5');
      expect((response.body as Buffer).toString()).toBe('2345');
    });

    it('returns 403 VIDEO_NOT_OWNED when the video belongs to another user', async () => {
      const ownerToken = await registerConfirmAndLogin(
        'stream-owner@example.com',
      );
      const { shortCode } = await initiateAndMarkReady(
        ownerToken,
        Buffer.from('owner only bytes'),
      );
      const intruderToken = await registerConfirmAndLogin(
        'stream-intruder@example.com',
      );

      const response = await request(app.getHttpServer())
        .get(`/videos/${shortCode}/stream`)
        .set('Authorization', `Bearer ${intruderToken}`);

      const errBody = response.body as ErrorResponseBody;
      expect(response.status).toBe(403);
      expect(errBody.error).toBe('VIDEO_NOT_OWNED');
    });

    it('returns 409 VIDEO_NOT_READY when the video is still processing', async () => {
      const accessToken = await registerConfirmAndLogin(
        'stream-notready@example.com',
      );
      const initResponse = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Not ready',
          content_type: 'video/mp4',
          size_bytes: 1024,
          original_filename: 'video.mp4',
        });
      const { short_code } = initResponse.body as InitiateUploadResponseBody;

      const response = await request(app.getHttpServer())
        .get(`/videos/${short_code}/stream`)
        .set('Authorization', `Bearer ${accessToken}`);

      const errBody = response.body as ErrorResponseBody;
      expect(response.status).toBe(409);
      expect(errBody.error).toBe('VIDEO_NOT_READY');
    });

    it('returns 404 VIDEO_NOT_FOUND when the shortCode does not exist', async () => {
      const accessToken = await registerConfirmAndLogin(
        'stream-missing@example.com',
      );

      const response = await request(app.getHttpServer())
        .get('/videos/doesnotexist1/stream')
        .set('Authorization', `Bearer ${accessToken}`);

      const errBody = response.body as ErrorResponseBody;
      expect(response.status).toBe(404);
      expect(errBody.error).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('GET /videos/:shortCode/download', () => {
    async function initiateAndMarkReady(
      accessToken: string,
      body: Buffer,
      title = 'Downloadable video',
    ): Promise<{ videoId: string; shortCode: string }> {
      const initResponse = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title,
          content_type: 'video/mp4',
          size_bytes: body.length,
          original_filename: 'video.mp4',
        });
      const { id, short_code } =
        initResponse.body as InitiateUploadResponseBody;

      const partsResponse = await request(app.getHttpServer())
        .post(`/videos/${id}/upload-parts`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ part_numbers: [1] });
      const { url } = (
        partsResponse.body as { parts: { part_number: number; url: string }[] }
      ).parts[0];
      const putResponse = await fetch(url, {
        method: 'PUT',
        body: new Uint8Array(body),
      });
      const etag = putResponse.headers.get('etag') as string;

      await request(app.getHttpServer())
        .post(`/videos/${id}/complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parts: [{ part_number: 1, etag }] });

      await dataSource.query(
        `UPDATE videos SET status = 'ready' WHERE id = $1`,
        [id],
      );

      return { videoId: id, shortCode: short_code };
    }

    it('returns 200 with Content-Disposition: attachment containing the video title', async () => {
      const accessToken = await registerConfirmAndLogin(
        'download-full@example.com',
      );
      const body = Buffer.from('hello streamtube video bytes');
      const { shortCode } = await initiateAndMarkReady(
        accessToken,
        body,
        'My Great Video!',
      );

      const response = await request(app.getHttpServer())
        .get(`/videos/${shortCode}/download`)
        .set('Authorization', `Bearer ${accessToken}`)
        .buffer(true)
        .parse(binaryParser);

      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain(
        'My_Great_Video',
      );
      expect((response.body as Buffer).toString()).toBe(body.toString());
    });

    it('returns 403 VIDEO_NOT_OWNED when the video belongs to another user', async () => {
      const ownerToken = await registerConfirmAndLogin(
        'download-owner@example.com',
      );
      const { shortCode } = await initiateAndMarkReady(
        ownerToken,
        Buffer.from('owner only bytes'),
      );
      const intruderToken = await registerConfirmAndLogin(
        'download-intruder@example.com',
      );

      const response = await request(app.getHttpServer())
        .get(`/videos/${shortCode}/download`)
        .set('Authorization', `Bearer ${intruderToken}`);

      const errBody = response.body as ErrorResponseBody;
      expect(response.status).toBe(403);
      expect(errBody.error).toBe('VIDEO_NOT_OWNED');
    });

    it('returns 409 VIDEO_NOT_READY when the video is still processing', async () => {
      const accessToken = await registerConfirmAndLogin(
        'download-notready@example.com',
      );
      const initResponse = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Not ready',
          content_type: 'video/mp4',
          size_bytes: 1024,
          original_filename: 'video.mp4',
        });
      const { short_code } = initResponse.body as InitiateUploadResponseBody;

      const response = await request(app.getHttpServer())
        .get(`/videos/${short_code}/download`)
        .set('Authorization', `Bearer ${accessToken}`);

      const errBody = response.body as ErrorResponseBody;
      expect(response.status).toBe(409);
      expect(errBody.error).toBe('VIDEO_NOT_READY');
    });

    it('returns 404 VIDEO_NOT_FOUND when the shortCode does not exist', async () => {
      const accessToken = await registerConfirmAndLogin(
        'download-missing@example.com',
      );

      const response = await request(app.getHttpServer())
        .get('/videos/doesnotexist2/download')
        .set('Authorization', `Bearer ${accessToken}`);

      const errBody = response.body as ErrorResponseBody;
      expect(response.status).toBe(404);
      expect(errBody.error).toBe('VIDEO_NOT_FOUND');
    });
  });
});
