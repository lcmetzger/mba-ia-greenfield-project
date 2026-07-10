import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { Repository } from 'typeorm';
import type storageConfig from '../config/storage.config';
import {
  ChannelNotFoundException,
  FileTooLargeException,
  UploadCompletionFailedException,
  UploadInitiationFailedException,
  VideoNotDraftException,
  VideoNotErrorException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import type { ChannelsService } from '../channels/channels.service';
import type { StorageService } from '../storage/storage.service';
import { VideoStatus } from './entities/video-status.enum';
import type { Video } from './entities/video.entity';
import { VideosService } from './videos.service';

function makeConfig(): ConfigType<typeof storageConfig> {
  return {
    endpoint: 'http://minio:9000',
    region: 'us-east-1',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    videosBucket: 'streamtube-videos',
    thumbnailsBucket: 'streamtube-thumbnails',
  };
}

function makeService(
  videoRepository: Partial<Record<'create' | 'save' | 'findOne', jest.Mock>>,
  channelsService: Partial<Record<'findByUserId', jest.Mock>>,
  storageService: Partial<
    Record<
      | 'createMultipartUpload'
      | 'presignUploadPart'
      | 'completeMultipartUpload'
      | 'headObject',
      jest.Mock
    >
  >,
  videoQueue: Partial<Record<'add', jest.Mock>> = { add: jest.fn() },
): VideosService {
  return new VideosService(
    videoRepository as unknown as Repository<Video>,
    channelsService as unknown as ChannelsService,
    storageService as unknown as StorageService,
    makeConfig(),
    videoQueue as unknown as Queue,
  );
}

const baseDto = {
  title: 'My video',
  content_type: 'video/mp4',
  size_bytes: 1000,
  original_filename: 'video.mp4',
};

describe('VideosService', () => {
  describe('initiateUpload', () => {
    it('throws FileTooLargeException when size_bytes exceeds 10GB', async () => {
      const videoRepository = { create: jest.fn(), save: jest.fn() };
      const channelsService = { findByUserId: jest.fn() };
      const storageService = { createMultipartUpload: jest.fn() };
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
      );

      await expect(
        service.initiateUpload('user-id', {
          ...baseDto,
          size_bytes: 10 * 1024 * 1024 * 1024 + 1,
        }),
      ).rejects.toThrow(FileTooLargeException);
      expect(channelsService.findByUserId).not.toHaveBeenCalled();
    });

    it('throws ChannelNotFoundException when the user has no channel', async () => {
      const videoRepository = { create: jest.fn(), save: jest.fn() };
      const channelsService = {
        findByUserId: jest.fn().mockResolvedValue(null),
      };
      const storageService = { createMultipartUpload: jest.fn() };
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
      );

      await expect(service.initiateUpload('user-id', baseDto)).rejects.toThrow(
        ChannelNotFoundException,
      );
    });

    it('creates a draft video and initiates a multipart upload', async () => {
      const draft = { id: 'video-id', short_code: 'shortcode001' } as Video;
      const videoRepository = {
        create: jest.fn().mockReturnValue(draft),
        save: jest.fn().mockResolvedValue(draft),
      };
      const channelsService = {
        findByUserId: jest.fn().mockResolvedValue({ id: 'channel-id' }),
      };
      const storageService = {
        createMultipartUpload: jest.fn().mockResolvedValue('upload-id'),
      };
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
      );

      const result = await service.initiateUpload('user-id', baseDto);

      expect(videoRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: 'channel-id',
          status: VideoStatus.DRAFT,
        }),
      );
      expect(storageService.createMultipartUpload).toHaveBeenCalledWith(
        'streamtube-videos',
        'videos/video-id/original',
        'video/mp4',
      );
      expect(result.storage_key).toBe('videos/video-id/original');
      expect(result.upload_id).toBe('upload-id');
    });

    it('throws UploadInitiationFailedException when the storage call fails', async () => {
      const draft = { id: 'video-id', short_code: 'shortcode001' } as Video;
      const videoRepository = {
        create: jest.fn().mockReturnValue(draft),
        save: jest.fn().mockResolvedValue(draft),
      };
      const channelsService = {
        findByUserId: jest.fn().mockResolvedValue({ id: 'channel-id' }),
      };
      const storageService = {
        createMultipartUpload: jest.fn().mockRejectedValue(new Error('boom')),
      };
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
      );

      await expect(service.initiateUpload('user-id', baseDto)).rejects.toThrow(
        UploadInitiationFailedException,
      );
    });
  });

  describe('getUploadPartUrls', () => {
    const draftVideo = {
      id: 'video-id',
      channel_id: 'channel-id',
      status: VideoStatus.DRAFT,
      storage_key: 'videos/video-id/original',
      upload_id: 'upload-id',
    } as Video;

    it('throws ChannelNotFoundException when the user has no channel', async () => {
      const videoRepository = { findOne: jest.fn() };
      const channelsService = {
        findByUserId: jest.fn().mockResolvedValue(null),
      };
      const storageService = { presignUploadPart: jest.fn() };
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
      );

      await expect(
        service.getUploadPartUrls('user-id', 'video-id', [1]),
      ).rejects.toThrow(ChannelNotFoundException);
    });

    it('throws VideoNotFoundException when the video does not exist', async () => {
      const videoRepository = { findOne: jest.fn().mockResolvedValue(null) };
      const channelsService = {
        findByUserId: jest.fn().mockResolvedValue({ id: 'channel-id' }),
      };
      const storageService = { presignUploadPart: jest.fn() };
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
      );

      await expect(
        service.getUploadPartUrls('user-id', 'video-id', [1]),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('throws VideoNotFoundException when the video belongs to another channel', async () => {
      const videoRepository = {
        findOne: jest
          .fn()
          .mockResolvedValue({ ...draftVideo, channel_id: 'other-channel' }),
      };
      const channelsService = {
        findByUserId: jest.fn().mockResolvedValue({ id: 'channel-id' }),
      };
      const storageService = { presignUploadPart: jest.fn() };
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
      );

      await expect(
        service.getUploadPartUrls('user-id', 'video-id', [1]),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('throws VideoNotDraftException when the video is not in draft status', async () => {
      const videoRepository = {
        findOne: jest
          .fn()
          .mockResolvedValue({ ...draftVideo, status: VideoStatus.READY }),
      };
      const channelsService = {
        findByUserId: jest.fn().mockResolvedValue({ id: 'channel-id' }),
      };
      const storageService = { presignUploadPart: jest.fn() };
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
      );

      await expect(
        service.getUploadPartUrls('user-id', 'video-id', [1]),
      ).rejects.toThrow(VideoNotDraftException);
    });

    it('returns one presigned url per requested part number', async () => {
      const videoRepository = {
        findOne: jest.fn().mockResolvedValue(draftVideo),
      };
      const channelsService = {
        findByUserId: jest.fn().mockResolvedValue({ id: 'channel-id' }),
      };
      const storageService = {
        presignUploadPart: jest
          .fn()
          .mockImplementation((_b, _k, _u, partNumber: number) =>
            Promise.resolve(`https://minio/part-${partNumber}`),
          ),
      };
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
      );

      const result = await service.getUploadPartUrls(
        'user-id',
        'video-id',
        [1, 2],
      );

      expect(result).toEqual([
        { part_number: 1, url: 'https://minio/part-1' },
        { part_number: 2, url: 'https://minio/part-2' },
      ]);
      expect(storageService.presignUploadPart).toHaveBeenCalledWith(
        'streamtube-videos',
        'videos/video-id/original',
        'upload-id',
        1,
      );
    });
  });

  describe('completeUpload', () => {
    const draftVideo = {
      id: 'video-id',
      channel_id: 'channel-id',
      status: VideoStatus.DRAFT,
      storage_key: 'videos/video-id/original',
      upload_id: 'upload-id',
    } as Video;
    const parts = [{ part_number: 1, etag: 'etag-1' }];

    it('throws VideoNotDraftException when the video is not in draft status', async () => {
      const videoRepository = {
        findOne: jest
          .fn()
          .mockResolvedValue({ ...draftVideo, status: VideoStatus.READY }),
      };
      const channelsService = {
        findByUserId: jest.fn().mockResolvedValue({ id: 'channel-id' }),
      };
      const storageService = {
        completeMultipartUpload: jest.fn(),
        headObject: jest.fn(),
      };
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
      );

      await expect(
        service.completeUpload('user-id', 'video-id', parts),
      ).rejects.toThrow(VideoNotDraftException);
    });

    it('throws UploadCompletionFailedException when the storage call fails', async () => {
      const videoRepository = {
        findOne: jest.fn().mockResolvedValue(draftVideo),
      };
      const channelsService = {
        findByUserId: jest.fn().mockResolvedValue({ id: 'channel-id' }),
      };
      const storageService = {
        completeMultipartUpload: jest.fn().mockRejectedValue(new Error('boom')),
        headObject: jest.fn(),
      };
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
      );

      await expect(
        service.completeUpload('user-id', 'video-id', parts),
      ).rejects.toThrow(UploadCompletionFailedException);
    });

    it('completes the upload, transitions to processing, and enqueues the job', async () => {
      const videoRepository = {
        findOne: jest.fn().mockResolvedValue(draftVideo),
        save: jest.fn().mockImplementation((v: Video) => Promise.resolve(v)),
      };
      const channelsService = {
        findByUserId: jest.fn().mockResolvedValue({ id: 'channel-id' }),
      };
      const storageService = {
        completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
        headObject: jest.fn().mockResolvedValue({ ContentLength: 1024 }),
      };
      const videoQueue = { add: jest.fn().mockResolvedValue(undefined) };
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
        videoQueue,
      );

      const result = await service.completeUpload('user-id', 'video-id', parts);

      expect(storageService.completeMultipartUpload).toHaveBeenCalledWith(
        'streamtube-videos',
        'videos/video-id/original',
        'upload-id',
        [{ partNumber: 1, etag: 'etag-1' }],
      );
      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(videoQueue.add).toHaveBeenCalledWith(
        'process-video',
        { videoId: 'video-id' },
        expect.objectContaining({ attempts: 3 }),
      );
    });
  });

  describe('reprocess', () => {
    const errorVideo = {
      id: 'video-id',
      channel_id: 'channel-id',
      status: VideoStatus.ERROR,
      error_message: 'ffmpeg exploded',
    } as Video;

    it('throws VideoNotErrorException when the video is not in error status', async () => {
      const videoRepository = {
        findOne: jest
          .fn()
          .mockResolvedValue({ ...errorVideo, status: VideoStatus.READY }),
      };
      const channelsService = {
        findByUserId: jest.fn().mockResolvedValue({ id: 'channel-id' }),
      };
      const storageService = {};
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
      );

      await expect(service.reprocess('user-id', 'video-id')).rejects.toThrow(
        VideoNotErrorException,
      );
    });

    it('throws VideoNotFoundException when the video belongs to another channel', async () => {
      const videoRepository = {
        findOne: jest
          .fn()
          .mockResolvedValue({ ...errorVideo, channel_id: 'other-channel' }),
      };
      const channelsService = {
        findByUserId: jest.fn().mockResolvedValue({ id: 'channel-id' }),
      };
      const storageService = {};
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
      );

      await expect(service.reprocess('user-id', 'video-id')).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('resets to processing, clears error_message, and re-enqueues the job', async () => {
      const videoRepository = {
        findOne: jest.fn().mockResolvedValue(errorVideo),
        save: jest.fn().mockImplementation((v: Video) => Promise.resolve(v)),
      };
      const channelsService = {
        findByUserId: jest.fn().mockResolvedValue({ id: 'channel-id' }),
      };
      const storageService = {};
      const videoQueue = { add: jest.fn().mockResolvedValue(undefined) };
      const service = makeService(
        videoRepository,
        channelsService,
        storageService,
        videoQueue,
      );

      const result = await service.reprocess('user-id', 'video-id');

      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(result.error_message).toBeNull();
      expect(videoQueue.add).toHaveBeenCalledWith(
        'process-video',
        { videoId: 'video-id' },
        expect.objectContaining({ attempts: 3 }),
      );
    });
  });
});
