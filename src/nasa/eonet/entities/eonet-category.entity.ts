import { Column, Entity, ManyToMany, PrimaryColumn } from 'typeorm';
import { EonetEvent } from './eonet-event.entity';

@Entity('eonet_categories')
export class EonetCategory {
  @PrimaryColumn()
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ManyToMany(() => EonetEvent, (event) => event.categories)
  events: EonetEvent[];
}
