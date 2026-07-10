import { readFileSync } from 'fs';
import { join } from 'path';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import {
  VIDEO_PROCESS_JOB,
  VIDEO_PROCESSING_QUEUE,
} from '../queue/queue.constants';
import { buildVideoKey } from '../storage/storage.keys';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { clearBucket, objectExists } from '../test/minio';
import { User } from '../users/entities/user.entity';
import { VideoStatus } from '../videos/entities/video-status.enum';
import { Video } from '../videos/entities/video.entity';
import { VideoProcessingModule } from './video-processing.module';

const VIDEOS_BUCKET = process.env.STORAGE_BUCKET_VIDEOS ?? 'streamtube-videos';
const THUMBNAILS_BUCKET =
  process.env.STORAGE_BUCKET_THUMBNAILS ?? 'streamtube-thumbnails';
const FIXTURE_PATH = join(
  __dirname,
  '..',
  'test',
  'fixtures',
  'sample-video.mp4',
);

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('waitFor timed out');
}

describe('VideoProcessingProcessor (integration)', () => {
  let dataSource: DataSource;
  let videoQueue: Queue<{ videoId: string }>;
  let storageService: StorageService;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let channelId: string;

  beforeAll(async () => {
    const testDataSource = createTestDataSource([User, Channel, Video]);
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, queueConfig],
        }),
        TypeOrmModule.forRoot(testDataSource.options),
        VideoProcessingModule,
      ],
    }).compile();
    await module.init();

    dataSource = module.get(DataSource);
    videoQueue = module.get<Queue<{ videoId: string }>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
    storageService = module.get(StorageService);
    videoRepository = dataSource.getRepository(Video);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
  });

  afterAll(async () => {
    await videoQueue.close();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await clearBucket(VIDEOS_BUCKET);
    await clearBucket(THUMBNAILS_BUCKET);
    await videoQueue.drain(true);

    const user = await userRepository.save(
      userRepository.create({
        email: 'worker-owner@example.com',
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Owner',
        nickname: 'workerowner',
        user_id: user.id,
      }),
    );
    channelId = channel.id;
  });

  it('processes a real video: extracts metadata, uploads a thumbnail, and marks it ready', async () => {
    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channelId,
        title: 'Worker video',
        short_code: 'workercode01',
        status: VideoStatus.PROCESSING,
        storage_key: buildVideoKey('worker-video-1'),
      }),
    );

    const fileBuffer = readFileSync(FIXTURE_PATH);
    await storageService.putObject(
      VIDEOS_BUCKET,
      video.storage_key,
      fileBuffer,
      'video/mp4',
    );

    await videoQueue.add(
      VIDEO_PROCESS_JOB,
      { videoId: video.id },
      { attempts: 1 },
    );

    await waitFor(async () => {
      const current = await videoRepository.findOneBy({ id: video.id });
      return current?.status === VideoStatus.READY;
    }, 20000);

    const processed = await videoRepository.findOneByOrFail({ id: video.id });
    expect(processed.status).toBe(VideoStatus.READY);
    expect(Number(processed.duration_seconds)).toBeCloseTo(2, 0);
    expect(processed.thumbnail_key).toBeTruthy();
    expect(processed.processed_at).toBeTruthy();
    expect(
      await objectExists(THUMBNAILS_BUCKET, processed.thumbnail_key as string),
    ).toBe(true);
  }, 25000);

  it('marks the video as error only after exhausting all retry attempts', async () => {
    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channelId,
        title: 'Failing video',
        short_code: 'workercode02',
        status: VideoStatus.PROCESSING,
        storage_key: 'videos/does-not-exist/original',
      }),
    );

    await videoQueue.add(
      VIDEO_PROCESS_JOB,
      { videoId: video.id },
      { attempts: 2, backoff: { type: 'fixed', delay: 100 } },
    );

    await waitFor(async () => {
      const current = await videoRepository.findOneBy({ id: video.id });
      return current?.status === VideoStatus.ERROR;
    }, 20000);

    const failed = await videoRepository.findOneByOrFail({ id: video.id });
    expect(failed.status).toBe(VideoStatus.ERROR);
    expect(failed.error_message).toBeTruthy();
  }, 25000);
});
