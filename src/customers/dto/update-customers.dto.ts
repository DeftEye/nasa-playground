import { PartialType } from '@nestjs/mapped-types';
import { CreateCustomerDto } from './create-customer.dto';
import { IsArray } from 'class-validator';

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @IsArray()
  exchanges?: string[]; // Assuming exchanges are represented by their names
  // You can add more fields here if needed
}
