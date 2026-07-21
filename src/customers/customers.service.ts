import { Injectable, NotFoundException } from '@nestjs/common';
import { Customer } from './entities/customer.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customers.dto';
import { Exchange } from './entities/exchange.entity';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Exchange)
    private readonly exchangeRepository: Repository<Exchange>,
  ) {}

  findAll() {
    return this.customerRepository.find({ relations: ['exchanges'] });
  }

  async findOne(id: string) {
    const customer = await this.customerRepository.findOne({
      where: { id: +id },
      relations: ['exchanges'],
    });
    if (!customer) {
      throw new NotFoundException(`Customer #${id} not found`);
    }
    return customer;
  }

  async create(createCustomerDto: CreateCustomerDto) {
    const customer = this.customerRepository.create(createCustomerDto);
    return this.customerRepository.save(customer);
  }

  async update(id: string, updateCustomerDto: UpdateCustomerDto) {
    const exchanges =
      updateCustomerDto.exchanges &&
      (await Promise.all(
        updateCustomerDto.exchanges.map((name) =>
          this.preloadExchangeByName(name),
        ),
      ));
    const customer = await this.customerRepository.preload({
      id: +id,
      ...updateCustomerDto,
      exchanges,
    });
    if (!customer) {
      throw new NotFoundException(`Customer #${id} not found`);
    }
    return this.customerRepository.save(customer);
  }

  async remove(id: string) {
    const customer = await this.findOne(id);
    return this.customerRepository.remove(customer);
  }

  private async preloadExchangeByName(name: string): Promise<Exchange> {
    const existingExchange = await this.exchangeRepository.findOne({
      where: { name },
    });
    if (existingExchange) {
      return existingExchange;
    }
    return this.exchangeRepository.create({ name });
  }
}
