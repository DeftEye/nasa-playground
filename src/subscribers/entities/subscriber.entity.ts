import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { EonetCategory } from '../../nasa/eonet/entities/eonet-category.entity';

@Entity('subscribers')
export class Subscriber {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id' })
  ownerId: string;

  @ManyToOne(() => User, (user) => user.subscribers, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @Column()
  name: string;

  @Column({ name: 'discord_webhook_url' })
  discordWebhookUrl: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ name: 'apod_enabled', default: true })
  apodEnabled: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToMany(() => EonetCategory)
  @JoinTable({
    name: 'subscriber_categories',
    joinColumn: { name: 'subscriber_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'category_id', referencedColumnName: 'id' },
  })
  categories: EonetCategory[];
}
