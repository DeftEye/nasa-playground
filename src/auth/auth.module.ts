import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { SignOptions } from 'jsonwebtoken';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { resolveJwtSecret } from './jwt-secret';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      useFactory: (): JwtModuleOptions => ({
        secret: resolveJwtSecret(),
        signOptions: {
          expiresIn: (process.env.JWT_EXPIRES_IN ??
            '7d') as SignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard],
  exports: [JwtAuthGuard, JwtModule, PassportModule],
})
export class AuthModule {}
