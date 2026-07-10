import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import queueConfig from '../config/queue.config';
import { VIDEO_PROCESSING_QUEUE } from './queue.constants';
import { QueueModule } from './queue.module';

describe('QueueModule', () => {
  it('should compile successfully and provide the video processing queue', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
      ],
    }).compile();

    expect(module.get(getQueueToken(VIDEO_PROCESSING_QUEUE))).toBeDefined();
    await module.close();
  });
});
