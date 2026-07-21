import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CustomersModule } from './customers/customers.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnowflakeModule } from './snowflake/snowflake.module';
import { AuthModule } from './auth/auth.module';
import { NasaModule } from './nasa/nasa.module';
import { UsersModule } from './users/users.module';
import { SubscribersModule } from './subscribers/subscribers.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CustomersModule,
    SnowflakeModule,
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
  providers: [AppService],
})
export class AppModule {}
