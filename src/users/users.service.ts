import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  create(email: string, passwordHash: string): Promise<User> {
    const user = this.userRepository.create({ email, passwordHash });
    return this.userRepository.save(user);
  }

  async deleteById(id: string): Promise<void> {
    await this.userRepository.delete({ id });
  }
}
