import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // Graceful shutdown (VAL-HARD-002). `enableShutdownHooks` wires the Nest
  // lifecycle (beforeApplicationShutdown / onApplicationShutdown) so the
  // TypeORM DataSource is closed cleanly via OnApplicationShutdown. By default
  // Nest re-raises the signal after cleanup, which terminates the process with
  // a signal exit code (143 for SIGTERM) rather than 0; the VAL-HARD-002
  // contract requires a clean exit 0 on SIGTERM, so we take over SIGTERM
  // explicitly: `app.close()` runs the same lifecycle hooks (closing the DB
  // connection) and then we exit 0. Other signals (SIGINT, SIGHUP, ...) keep
  // Nest's default hook behaviour.
  app.enableShutdownHooks(['SIGINT', 'SIGHUP', 'SIGQUIT']);
  process.on('SIGTERM', () => {
    // `app.close()` runs the Nest lifecycle (beforeApplicationShutdown /
    // onApplicationShutdown) which `@nestjs/typeorm` wires to
    // `dataSource.destroy()`, closing the Postgres connection. Then exit 0.
    void app
      .close()
      .catch((err) => {
        console.error('Error during graceful shutdown:', err);
      })
      .finally(() => process.exit(0));
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
