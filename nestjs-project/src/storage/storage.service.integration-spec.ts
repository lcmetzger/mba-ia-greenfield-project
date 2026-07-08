import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { clearBucket, objectExists } from '../test/minio';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const TEST_BUCKET = process.env.STORAGE_BUCKET_VIDEOS ?? 'streamtube-videos';

describe('StorageService (integration)', () => {
  let storageService: StorageService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();

    storageService = module.get(StorageService);
  });

  beforeEach(async () => {
    await clearBucket(TEST_BUCKET);
  });

  it('completes a single-part multipart upload end-to-end against real object storage', async () => {
    const key = 'videos/test-storage-service/original';
    const body = Buffer.from('hello streamtube');

    const uploadId = await storageService.createMultipartUpload(
      TEST_BUCKET,
      key,
      'text/plain',
    );
    expect(uploadId).toBeTruthy();

    const url = await storageService.presignUploadPart(
      TEST_BUCKET,
      key,
      uploadId,
      1,
    );
    const putResponse = await fetch(url, { method: 'PUT', body });
    expect(putResponse.ok).toBe(true);
    const etag = putResponse.headers.get('etag');
    expect(etag).toBeTruthy();

    await storageService.completeMultipartUpload(TEST_BUCKET, key, uploadId, [
      { partNumber: 1, etag: etag as string },
    ]);

    expect(await objectExists(TEST_BUCKET, key)).toBe(true);

    const head = await storageService.headObject(TEST_BUCKET, key);
    expect(head.ContentLength).toBe(body.length);
  });

  it('getObjectStream with a Range header returns only the requested byte range', async () => {
    const key = 'videos/test-storage-service/ranged';
    const body = Buffer.from('0123456789');

    const uploadId = await storageService.createMultipartUpload(
      TEST_BUCKET,
      key,
      'text/plain',
    );
    const url = await storageService.presignUploadPart(
      TEST_BUCKET,
      key,
      uploadId,
      1,
    );
    const putResponse = await fetch(url, { method: 'PUT', body });
    const etag = putResponse.headers.get('etag');
    await storageService.completeMultipartUpload(TEST_BUCKET, key, uploadId, [
      { partNumber: 1, etag: etag as string },
    ]);

    const ranged = await storageService.getObjectStream(
      TEST_BUCKET,
      key,
      'bytes=0-3',
    );
    expect(ranged.ContentRange).toContain('bytes 0-3');

    const chunks: Buffer[] = [];
    for await (const chunk of ranged.Body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString()).toBe('0123');
  });

  it('putObject uploads a thumbnail-style object directly (no multipart)', async () => {
    const key = 'thumbnails/test-storage-service/thumbnail.jpg';
    const body = Buffer.from('fake-jpg-bytes');

    await storageService.putObject(TEST_BUCKET, key, body, 'image/jpeg');

    expect(await objectExists(TEST_BUCKET, key)).toBe(true);
  });
});
