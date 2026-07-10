import { Test } from '@nestjs/testing';
import { WorkerModule } from './worker.module';

/**
 * Compiles the real WorkerModule bootstrap (autoLoadEntities: true against
 * the real Postgres connection) — not a hand-built TestingModule with an
 * explicit entities array. VideoProcessingModule previously omitted
 * Channel/User from its TypeOrmModule.forFeature() call; that only breaks
 * under autoLoadEntities (TypeORM can't build Video's relation metadata
 * without Channel's, or Channel's without User's), so a test that supplies
 * entities explicitly never catches it. This test exercises the exact
 * configuration the video-worker container runs.
 */
describe('WorkerModule', () => {
  it('should compile successfully with the real autoLoadEntities configuration', async () => {
    const module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    expect(module).toBeDefined();
    await module.close();
  }, 30000);
});
