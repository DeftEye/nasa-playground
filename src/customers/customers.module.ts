import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './entities/customer.entity';
import { Exchange } from './entities/exchange.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, Exchange])],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
