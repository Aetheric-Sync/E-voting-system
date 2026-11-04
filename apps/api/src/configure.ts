import type { NestExpressApplication } from '@nestjs/platform-express';

/** Shared by main.ts and the tests so the tests run against the production setup. */
export function configureApp(app: NestExpressApplication) {
  app.disable('x-powered-by');
  // Number of reverse proxies in front of this API (the web app counts as one). Rate limits use the client address.
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.enableShutdownHooks();
}
