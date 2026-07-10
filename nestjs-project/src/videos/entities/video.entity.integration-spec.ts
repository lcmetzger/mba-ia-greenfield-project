import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { Video } from './video.entity';
import { VideoStatus } from './video-status.enum';

const ALL_ENTITIES = [User, Channel, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channelId: string;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);

    const userRepository = dataSource.getRepository(User);
    const channelRepository = dataSource.getRepository(Channel);
    const user = await userRepository.save(
      userRepository.create({ email: 'owner@example.com', password: 'hashed' }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Owner Channel',
        nickname: 'ownerchannel',
        user_id: user.id,
      }),
    );
    channelId = channel.id;
  });

  it('should auto-generate uuid, created_at, and updated_at', async () => {
    const saved = await videoRepository.save(
      videoRepository.create({
        channel_id: channelId,
        title: 'My video',
        short_code: 'shortcode001',
        storage_key: `videos/x/original`,
      }),
    );

    expect(saved.id).toBeDefined();
    expect(saved.created_at).toBeInstanceOf(Date);
    expect(saved.updated_at).toBeInstanceOf(Date);
  });

  it('should default status to draft', async () => {
    const saved = await videoRepository.save(
      videoRepository.create({
        channel_id: channelId,
        title: 'My video',
        short_code: 'shortcode002',
        storage_key: `videos/x/original`,
      }),
    );

    expect(saved.status).toBe(VideoStatus.DRAFT);
  });

  it('should enforce unique short_code constraint', async () => {
    await videoRepository.save(
      videoRepository.create({
        channel_id: channelId,
        title: 'First',
        short_code: 'shortcode003',
        storage_key: 'videos/a/original',
      }),
    );

    await expect(
      videoRepository.save(
        videoRepository.create({
          channel_id: channelId,
          title: 'Second',
          short_code: 'shortcode003',
          storage_key: 'videos/b/original',
        }),
      ),
    ).rejects.toThrow();
  });

  it('should allow nullable fields to be omitted', async () => {
    const saved = await videoRepository.save(
      videoRepository.create({
        channel_id: channelId,
        title: 'Minimal video',
        short_code: 'minimalvideo',
        storage_key: 'videos/c/original',
      }),
    );

    expect(saved.thumbnail_key).toBeNull();
    expect(saved.duration_seconds).toBeNull();
    expect(saved.metadata).toBeNull();
    expect(saved.error_message).toBeNull();
    expect(saved.processed_at).toBeNull();
  });

  it('should load the owning channel via the channel relation', async () => {
    const saved = await videoRepository.save(
      videoRepository.create({
        channel_id: channelId,
        title: 'Relation video',
        short_code: 'shortcode004',
        storage_key: 'videos/d/original',
      }),
    );

    const found = await videoRepository.findOne({
      where: { id: saved.id },
      relations: ['channel'],
    });

    expect(found?.channel?.id).toBe(channelId);
  });
});
