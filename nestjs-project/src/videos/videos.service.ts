import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import storageConfig from '../config/storage.config';
import {
  ChannelNotFoundException,
  FileTooLargeException,
  UploadInitiationFailedException,
  VideoNotDraftException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import { buildVideoKey } from '../storage/storage.keys';
import { StorageService } from '../storage/storage.service';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { VideoStatus } from './entities/video-status.enum';
import { Video } from './entities/video.entity';
import { generateShortCode } from './short-code.util';

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024 * 1024;

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    @Inject(storageConfig.KEY)
    private readonly storage: ConfigType<typeof storageConfig>,
  ) {}

  async initiateUpload(userId: string, dto: InitiateUploadDto): Promise<Video> {
    if (dto.size_bytes > MAX_UPLOAD_SIZE_BYTES) {
      throw new FileTooLargeException();
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new ChannelNotFoundException();
    }

    const draft = await this.videoRepository.save(
      this.videoRepository.create({
        channel_id: channel.id,
        title: dto.title,
        status: VideoStatus.DRAFT,
        short_code: generateShortCode(),
        storage_key: '',
        original_filename: dto.original_filename,
        content_type: dto.content_type,
        size_bytes: String(dto.size_bytes),
      }),
    );

    const storageKey = buildVideoKey(draft.id);
    let uploadId: string;
    try {
      uploadId = await this.storageService.createMultipartUpload(
        this.storage.videosBucket,
        storageKey,
        dto.content_type,
      );
    } catch {
      throw new UploadInitiationFailedException();
    }

    draft.storage_key = storageKey;
    draft.upload_id = uploadId;
    return this.videoRepository.save(draft);
  }

  async getUploadPartUrls(
    userId: string,
    videoId: string,
    partNumbers: number[],
  ): Promise<{ part_number: number; url: string }[]> {
    const video = await this.findOwnedVideoOrThrow(userId, videoId);
    if (video.status !== VideoStatus.DRAFT) {
      throw new VideoNotDraftException();
    }

    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        part_number: partNumber,
        url: await this.storageService.presignUploadPart(
          this.storage.videosBucket,
          video.storage_key,
          video.upload_id as string,
          partNumber,
        ),
      })),
    );
  }

  /**
   * Resolves a video by its internal id, scoped to the caller's channel.
   * Non-existence and wrong-ownership both surface as VIDEO_NOT_FOUND (404)
   * per the Error Catalog — these are owner-only management routes, not
   * shareable links, so there is nothing to distinguish for the caller.
   */
  private async findOwnedVideoOrThrow(
    userId: string,
    videoId: string,
  ): Promise<Video> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new ChannelNotFoundException();
    }

    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });
    if (!video || video.channel_id !== channel.id) {
      throw new VideoNotFoundException();
    }

    return video;
  }
}
