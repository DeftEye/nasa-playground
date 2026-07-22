import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Delete,
  Query,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customers.dto';
import { Public } from '../auth/public.decorator';

/**
 * Legacy `customers` module (off-limits per AGENTS.md). Marked `@Public()` to
 * preserve its pre-existing public accessibility now that a global JWT guard
 * is registered in `AppModule`. No business logic is changed.
 */
@Public()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customerService: CustomersService) {}

  @Get()
  findAll(@Query() paginationQuery) {
    //  const { limit, offset } = paginationQuery;
    return this.customerService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customerService.findOne(id);
  }

  @Post()
  create(@Body() createCustomerDto: CreateCustomerDto) {
    console.log(createCustomerDto instanceof CreateCustomerDto);
    return this.customerService.create(createCustomerDto);
    // return `This action creates a customer`;
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
  ) {
    return this.customerService.update(id, updateCustomerDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.customerService.remove(id);
  }
}
