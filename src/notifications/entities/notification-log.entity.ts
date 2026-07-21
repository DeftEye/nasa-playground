import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Subscriber } from '../../subscribers/entities/subscriber.entity';

export type NotificationSource = 'apod' | 'eonet' | 'test';
export type NotificationStatus = 'sent' | 'mocked' | 'failed';

@Entity('notification_log')
export class NotificationLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subscriber_id' })
  subscriberId: string;

  @ManyToOne(() => Subscriber, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'subscriber_id' })
  subscriber: Subscriber;

  @Column({ type: 'enum', enum: ['apod', 'eonet', 'test'] })
  source: NotificationSource;

  @Column({ name: 'reference_id' })
  referenceId: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'enum', enum: ['sent', 'mocked', 'failed'] })
  status: NotificationStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'delivered_at', type: 'timestamptz' })
  deliveredAt: Date;
}
