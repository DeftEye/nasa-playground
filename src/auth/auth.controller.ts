import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService, LoginResult, PublicUser } from './auth.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('register')
  @HttpCode(201)
  register(@Body() dto: RegisterDto): Promise<PublicUser> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<LoginResult> {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<PublicUser> {
    const found = await this.usersService.findById(user.userId);
    if (!found) {
      throw new UnauthorizedException();
    }
    return this.authService.toPublicUser(found);
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async deleteMe(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.usersService.deleteById(user.userId);
  }
}
