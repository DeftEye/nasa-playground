import { IsEmail, IsInt, IsString, Min } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  readonly name: string;

  @IsEmail()
  readonly email: string;

  @IsInt()
  @Min(0)
  readonly age: number;
}
