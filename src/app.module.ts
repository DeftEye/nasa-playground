import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CustomersModule } from './customers/customers.module';
import { AuthModule } from './auth/auth.module';
import { NasaModule } from './nasa/nasa.module';
import { UsersModule } from './users/users.module';
import { SubscribersModule } from './subscribers/subscribers.module';
import { NotificationsModule } from './notifications/notifications.module';
import { GlobalJwtAuthGuard } from './auth/global-jwt-auth.guard';

/**
 * Conditionally mounts `ServeStaticModule` so `npm run build` + `npm run
 * start:prod` serves the built frontend (`web/dist`) at `/` alongside the
 * API at `/api/*` from a single Node process on port 3000 (architecture §1 /
 * §6 / VAL-CROSS-001).
 *
 * Only activated in production when `web/dist` exists. In dev, Vite serves the
 * FE on :5173 with a proxy to :3000; in tests, `NODE_ENV=test` skips this so
 * the test harness doesn't require a built frontend.
 */
function maybeServeStatic(): DynamicModule[] {
  const webDist = join(__dirname, '..', 'web', 'dist');
  if (process.env.NODE_ENV === 'production' && existsSync(webDist)) {
    return [
      ServeStaticModule.forRoot({
        rootPath: webDist,
        // Exclude API routes so NestJS controllers handle /api/* (architecture §1).
        exclude: ['/api/(.*)'],
        serveRoot: '/',
      }),
    ];
  }
  return [];
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ...maybeServeStatic(),
    CustomersModule,
    AuthModule,
    UsersModule,
    NasaModule,
    SubscribersModule,
    NotificationsModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
      username: process.env.POSTGRES_USER ?? 'postgres',
      password: process.env.POSTGRES_PASSWORD ?? 'pass123',
      database: process.env.POSTGRES_DB ?? 'nasa_sky_tracker',
      autoLoadEntities: true,
      synchronize: true,
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: GlobalJwtAuthGuard,
    },
  ],
})
export class AppModule {}
