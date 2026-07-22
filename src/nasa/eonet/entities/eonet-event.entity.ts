import { Column, Entity, JoinTable, ManyToMany, PrimaryColumn } from 'typeorm';
import { EonetCategory } from './eonet-category.entity';

export type EonetStatus = 'open' | 'closed';

/**
 * A single EONET geometry observation. Kept loose (record of unknown values)
 * because EONET geometry entries carry extra fields like `magnitudeValue` /
 * `magnitudeUnit` and large (1000+) coordinate arrays that must be preserved
 * verbatim (architecture §4 / VAL-EONET-016).
 */
export type EonetGeometryPoint = Record<string, unknown>;

@Entity('eonet_events')
export class EonetEvent {
  @PrimaryColumn()
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column()
  link: string;

  @Column({ type: 'enum', enum: ['open', 'closed'] })
  status: EonetStatus;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'first_seen_at', type: 'timestamptz' })
  firstSeenAt: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  geometry: EonetGeometryPoint[] | null;

  @ManyToMany(() => EonetCategory, (category) => category.events)
  @JoinTable({
    name: 'eonet_event_categories',
    joinColumn: { name: 'event_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'category_id', referencedColumnName: 'id' },
  })
  categories: EonetCategory[];
}
