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
}
