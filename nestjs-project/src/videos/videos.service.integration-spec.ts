import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { VIDEO_PROCESSING_QUEUE } from '../queue/queue.constants';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { clearBucket } from '../test/minio';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, Video];
const VIDEOS_BUCKET = process.env.STORAGE_BUCKET_VIDEOS ?? 'streamtube-videos';

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let videosService: VideosService;
  let storageService: StorageService;
  let videoQueue: Queue<{ videoId: string }>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let user: User;

  beforeAll(async () => {
    const testDataSource = createTestDataSource(ALL_ENTITIES);
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

    videosService = module.get(VideosService);
    storageService = module.get(StorageService);
    videoQueue = module.get<Queue<{ videoId: string }>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
    dataSource = module.get(DataSource);
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
    await videoQueue.drain(true);

    user = await userRepository.save(
      userRepository.create({
        email: 'video-owner@example.com',
        password: 'hashed',
      }),
    );
    await channelRepository.save(
      channelRepository.create({
        name: 'Owner',
        nickname: 'videoowner',
        user_id: user.id,
      }),
    );
  });

  it('creates a draft video and a real multipart upload on the object storage', async () => {
    const video = await videosService.initiateUpload(user.id, {
      title: 'Integration video',
      content_type: 'video/mp4',
      size_bytes: 2048,
      original_filename: 'video.mp4',
    });

    expect(video.status).toBe('draft');
    expect(video.upload_id).toBeTruthy();
    expect(video.storage_key).toBe(`videos/${video.id}/original`);
  });

  it('throws ChannelNotFoundException for a user without a channel', async () => {
    const orphanUser = await userRepository.save(
      userRepository.create({
        email: 'no-channel@example.com',
        password: 'hashed',
      }),
    );

    await expect(
      videosService.initiateUpload(orphanUser.id, {
        title: 'Video',
        content_type: 'video/mp4',
        size_bytes: 100,
        original_filename: 'video.mp4',
      }),
    ).rejects.toThrow('No channel associated');
  });

  describe('completeUpload', () => {
    it('completes a real multipart upload, transitions to processing, and enqueues a real job', async () => {
      const draft = await videosService.initiateUpload(user.id, {
        title: 'Complete-upload integration video',
        content_type: 'text/plain',
        size_bytes: 16,
        original_filename: 'video.txt',
      });

      const url = await storageService.presignUploadPart(
        VIDEOS_BUCKET,
        draft.storage_key,
        draft.upload_id as string,
        1,
      );
      const putResponse = await fetch(url, {
        method: 'PUT',
        body: Buffer.from('hello streamtube'),
      });
      const etag = putResponse.headers.get('etag') as string;

      const completed = await videosService.completeUpload(user.id, draft.id, [
        { part_number: 1, etag },
      ]);

      expect(completed.status).toBe('processing');

      const waitingJobs = await videoQueue.getJobs(['waiting', 'active']);
      expect(waitingJobs.some((job) => job.data.videoId === draft.id)).toBe(
        true,
      );
    });
  });
});
