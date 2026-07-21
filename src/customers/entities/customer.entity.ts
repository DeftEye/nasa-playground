import {
  Column,
  Entity,
  JoinTable,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Exchange } from './exchange.entity';

@Entity() // sql table === 'coffee'
export class Customer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  email: string;

  @Column()
  age: number;

  @JoinTable()
  @OneToMany((type) => Exchange, (exchange) => exchange.customer, {
    cascade: true,
  })
  exchanges: Exchange[]; // this is a relation, not a column
}
