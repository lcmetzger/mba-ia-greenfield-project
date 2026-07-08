import { Body, Controller, Post } from '@nestjs/common';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { VideosService } from './videos.service';

@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
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
}
