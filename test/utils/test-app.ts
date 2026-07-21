import { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';

export interface TestAppContext {
  app: INestApplication;
  dataSource: DataSource;
  http: ReturnType<typeof request>;
}

/**
 * Boots the full Nest application wired to the test database and returns a
 * ready-to-use supertest client plus the underlying TypeORM DataSource. Mirrors
 * the global pipes configured in `main.ts` so integration tests exercise the
 * same request pipeline as production.
 */
export async function createTestApp(): Promise<TestAppContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  await app.init();

  const dataSource = app.get(DataSource);
  const http = request(app.getHttpServer() as Server);

  return { app, dataSource, http };
}

export async function closeTestApp(
  context: TestAppContext | undefined,
): Promise<void> {
  if (context?.app) {
    await context.app.close();
  }
}
