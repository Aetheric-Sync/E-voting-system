import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './configure';
import { ElectionsService } from './elections/elections.service';

async function bootstrap() {
  if (process.env.OTP_ECHO === 'true' && process.env.NODE_ENV === 'production') {
    throw new Error('OTP_ECHO must not be enabled in production');
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  const elections = app.get(ElectionsService);
  const timer = setInterval(() => elections.tick().catch((e) => console.error('scheduler tick failed', e)), 15_000);
  timer.unref();

  await app.listen(Number(process.env.PORT ?? 3000));
}

bootstrap();
