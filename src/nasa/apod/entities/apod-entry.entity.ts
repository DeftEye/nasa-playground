import { Column, Entity, PrimaryColumn } from 'typeorm';

export type ApodMediaType = 'image' | 'video' | 'other';

@Entity('apod_entries')
export class ApodEntry {
  @PrimaryColumn({ type: 'date' })
  date: string;

  @Column()
  title: string;

  @Column({ type: 'text' })
  explanation: string;

  @Column()
  url: string;

  @Column({
    name: 'media_type',
    type: 'enum',
    enum: ['image', 'video', 'other'],
  })
  mediaType: ApodMediaType;

  @Column({ name: 'video_url', type: 'varchar', nullable: true })
  videoUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  copyright: string | null;

  @Column({ name: 'fetched_at', type: 'timestamptz' })
  fetchedAt: Date;
}
