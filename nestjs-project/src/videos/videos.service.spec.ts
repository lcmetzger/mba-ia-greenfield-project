import type { ConfigType } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type storageConfig from '../config/storage.config';
import {
  ChannelNotFoundException,
  FileTooLargeException,
  UploadInitiationFailedException,
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
  videoRepository: Partial<Record<'create' | 'save', jest.Mock>>,
  channelsService: Partial<Record<'findByUserId', jest.Mock>>,
  storageService: Partial<Record<'createMultipartUpload', jest.Mock>>,
): VideosService {
  return new VideosService(
    videoRepository as unknown as Repository<Video>,
    channelsService as unknown as ChannelsService,
    storageService as unknown as StorageService,
    makeConfig(),
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
});
