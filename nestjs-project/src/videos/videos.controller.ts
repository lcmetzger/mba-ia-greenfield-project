import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import storageConfig from '../config/storage.config';
import { StorageService } from '../storage/storage.service';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { UploadPartsDto } from './dto/upload-parts.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@ApiBearerAuth('access-token')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly storageService: StorageService,
    @Inject(storageConfig.KEY)
    private readonly storage: ConfigType<typeof storageConfig>,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Initiate a video upload',
    description:
      'Pre-registers the video as a draft and starts a multipart upload on the object storage.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft video created and multipart upload started',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        short_code: { type: 'string' },
        upload_id: { type: 'string' },
        status: { type: 'string', example: 'draft' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed or declared size exceeds the 10GB limit',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Authenticated user has no channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async initiateUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ) {
    const video = await this.videosService.initiateUpload(user.sub, dto);
    return {
      id: video.id,
      short_code: video.short_code,
      upload_id: video.upload_id,
      status: video.status,
    };
  }

  @Post(':id/upload-parts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get presigned URLs for multipart upload parts',
    description:
      'Returns one presigned PUT URL per requested part number. Safe to call again for a part that failed to upload.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned URLs generated',
    schema: {
      properties: {
        parts: {
          type: 'array',
          items: {
            properties: {
              part_number: { type: 'number' },
              url: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or does not belong to the caller',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in draft status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getUploadPartUrls(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UploadPartsDto,
  ) {
    const parts = await this.videosService.getUploadPartUrls(
      user.sub,
      id,
      dto.part_numbers,
    );
    return { parts };
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a multipart upload',
    description:
      'Finalizes the multipart upload on the object storage, transitions the video to processing, and enqueues the processing job.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed, video is now processing',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string', example: 'processing' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or does not belong to the caller',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in draft status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Object storage failed to complete the multipart upload',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CompleteUploadDto,
  ) {
    const video = await this.videosService.completeUpload(
      user.sub,
      id,
      dto.parts,
    );
    return { id: video.id, status: video.status };
  }

  @Get()
  @ApiOperation({
    summary: "List the caller's videos",
    description:
      "Returns every video belonging to the authenticated user's channel.",
  })
  @ApiResponse({
    status: 200,
    description: "List of the caller's videos",
    schema: {
      properties: {
        items: {
          type: 'array',
          items: {
            properties: {
              id: { type: 'string', format: 'uuid' },
              short_code: { type: 'string' },
              title: { type: 'string' },
              status: { type: 'string' },
              duration_seconds: { type: 'string', nullable: true },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  async list(@CurrentUser() user: JwtPayload) {
    const videos = await this.videosService.listByChannel(user.sub);
    return {
      items: videos.map((video) => ({
        id: video.id,
        short_code: video.short_code,
        title: video.title,
        status: video.status,
        duration_seconds: video.duration_seconds,
        created_at: video.created_at,
      })),
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get video detail',
    description:
      'Returns the current status and metadata of a video owned by the caller. Used for polling processing status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video detail',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        short_code: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string' },
        duration_seconds: { type: 'string', nullable: true },
        metadata: { type: 'object', nullable: true },
        error_message: { type: 'string', nullable: true },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or does not belong to the caller',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const video = await this.videosService.findById(user.sub, id);
    return {
      id: video.id,
      short_code: video.short_code,
      title: video.title,
      status: video.status,
      duration_seconds: video.duration_seconds,
      metadata: video.metadata,
      error_message: video.error_message,
      created_at: video.created_at,
      updated_at: video.updated_at,
    };
  }

  @Get(':shortCode/stream')
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Proxies the video bytes from object storage, honoring the Range header for partial content (seeking).',
  })
  @ApiResponse({
    status: 200,
    description: 'Full video body (no Range header sent)',
  })
  @ApiResponse({
    status: 206,
    description: 'Partial video body for the requested byte range',
  })
  @ApiResponse({
    status: 403,
    description: 'Video does not belong to the caller',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @CurrentUser() user: JwtPayload,
    @Param('shortCode') shortCode: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const video = await this.videosService.resolveByShortCode(
      user.sub,
      shortCode,
    );
    const range = req.headers.range;

    const object = await this.storageService.getObjectStream(
      this.storage.videosBucket,
      video.storage_key,
      range,
    );

    const headers: Record<string, string> = {
      'Content-Type': video.content_type ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    };
    if (object.ContentLength !== undefined) {
      headers['Content-Length'] = String(object.ContentLength);
    }

    if (range && object.ContentRange) {
      headers['Content-Range'] = object.ContentRange;
      res.writeHead(HttpStatus.PARTIAL_CONTENT, headers);
    } else {
      res.writeHead(HttpStatus.OK, headers);
    }

    await pipeline(object.Body as Readable, res);
  }
}
