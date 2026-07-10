import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { VideoStatus } from './video-status.enum';

@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  channel_id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'enum', enum: VideoStatus, default: VideoStatus.DRAFT })
  @Index()
  status: VideoStatus;

  @Column({ type: 'varchar', length: 12, unique: true })
  short_code: string;

  @Column({ type: 'varchar' })
  storage_key: string;

  @Column({ type: 'varchar', nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'varchar', nullable: true })
  upload_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  original_filename: string | null;

  @Column({ type: 'varchar', nullable: true })
  content_type: string | null;

  @Column({ type: 'bigint', nullable: true })
  size_bytes: string | null;

  @Column({ type: 'numeric', nullable: true })
  duration_seconds: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  processed_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Channel)
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
