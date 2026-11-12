import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './configure';
import { ElectionsService } from './elections/elections.service';
import { validateEnvironment } from './validateEnv';

export { validateEnvironment };

async function bootstrap() {
  validateEnvironment();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  const elections = app.get(ElectionsService);
  const runTick = () => elections.tick().catch((e) => console.error('scheduler tick failed', e));
  const timer = setInterval(runTick, 15_000);
  timer.unref();

  // On serverless (Vercel) instances are frozen between requests, so the interval above may never fire.
  // Also tick on incoming traffic, at most once every 15s per instance, before the request is handled.
  if (process.env.VERCEL) {
    let lastTick = 0;
    app.use(async (_req: unknown, _res: unknown, next: () => void) => {
      const now = Date.now();
      if (now - lastTick >= 15_000) {
        lastTick = now;
        await runTick();
      }
      next();
    });
  }

  await app.listen(Number(process.env.PORT ?? 3000));
}

bootstrap();
