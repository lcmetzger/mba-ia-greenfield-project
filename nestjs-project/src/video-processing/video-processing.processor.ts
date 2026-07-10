import { createWriteStream } from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Job } from 'bullmq';
import { Repository } from 'typeorm';
import storageConfig from '../config/storage.config';
import { VIDEO_PROCESSING_QUEUE } from '../queue/queue.constants';
import { buildThumbnailKey } from '../storage/storage.keys';
import { StorageService } from '../storage/storage.service';
import { VideoStatus } from '../videos/entities/video-status.enum';
import { Video } from '../videos/entities/video.entity';
import { FfmpegService } from './ffmpeg.service';

interface VideoProcessJobData {
  videoId: string;
}

const THUMBNAIL_MAX_SECONDS = 5;

@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly ffmpegService: FfmpegService,
    @Inject(storageConfig.KEY)
    private readonly storage: ConfigType<typeof storageConfig>,
  ) {
    super();
  }

  async process(job: Job<VideoProcessJobData>): Promise<void> {
    const video = await this.videoRepository.findOneByOrFail({
      id: job.data.videoId,
    });

    const workDir = await mkdtemp(join(tmpdir(), 'video-processing-'));
    try {
      const originalPath = join(workDir, 'original');
      const thumbnailPath = join(workDir, 'thumbnail.jpg');

      const original = await this.storageService.getObjectStream(
        this.storage.videosBucket,
        video.storage_key,
      );
      await pipeline(
        original.Body as Readable,
        createWriteStream(originalPath),
      );

      const metadata = await this.ffmpegService.extractMetadata(originalPath);
      const thumbnailAt = Math.min(
        metadata.durationSeconds / 2,
        THUMBNAIL_MAX_SECONDS,
      );
      await this.ffmpegService.generateThumbnail(
        originalPath,
        thumbnailPath,
        thumbnailAt,
      );

      const thumbnailKey = buildThumbnailKey(video.id);
      const thumbnailBuffer = await readFile(thumbnailPath);
      await this.storageService.putObject(
        this.storage.thumbnailsBucket,
        thumbnailKey,
        thumbnailBuffer,
        'image/jpeg',
      );

      video.status = VideoStatus.READY;
      video.duration_seconds = String(metadata.durationSeconds);
      video.metadata = {
        width: metadata.width,
        height: metadata.height,
        codec: metadata.codec,
        bitrate: metadata.bitrate,
      };
      video.thumbnail_key = thumbnailKey;
      video.processed_at = new Date();
      await this.videoRepository.save(video);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<VideoProcessJobData> | undefined): Promise<void> {
    if (!job) {
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      this.logger.warn(
        `Video ${job.data.videoId} processing failed (attempt ${job.attemptsMade}/${maxAttempts}), will retry`,
      );
      return;
    }

    this.logger.error(
      `Video ${job.data.videoId} processing failed after ${job.attemptsMade} attempts: ${job.failedReason}`,
    );
    await this.videoRepository.update(
      { id: job.data.videoId },
      {
        status: VideoStatus.ERROR,
        error_message: job.failedReason ?? 'Processing failed',
      },
    );
  }
}
