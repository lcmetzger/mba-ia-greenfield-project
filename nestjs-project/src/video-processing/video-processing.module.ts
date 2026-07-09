import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { User } from '../users/entities/user.entity';
import { Video } from '../videos/entities/video.entity';
import { FfmpegService } from './ffmpeg.service';
import { VideoProcessingProcessor } from './video-processing.processor';

@Module({
  // Channel and User are not queried directly here, but Video's
  // @ManyToOne(() => Channel) (and Channel's own @OneToOne(() => User))
  // relations need their metadata registered on this DataSource — the
  // worker only imports this module (no ChannelsModule/UsersModule), and
  // without it TypeORM fails at startup with "Entity metadata for
  // Video#channel was not found", which the automated tests never caught
  // because they build their own DataSource with an explicit entities
  // array instead of relying on autoLoadEntities.
  imports: [
    TypeOrmModule.forFeature([Video, Channel, User]),
    StorageModule,
    QueueModule,
  ],
  providers: [FfmpegService, VideoProcessingProcessor],
})
export class VideoProcessingModule {}
