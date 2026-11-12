import { Controller, Get, Module, OnModuleInit, OnModuleDestroy, Inject, Optional, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { AuthController, UsersController } from './auth/auth.controller';
import { AuthGuard, Public } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { buildNotifier, NOTIFIER } from './auth/notifier';
import { InMemoryRateLimitStore, RATE_LIMIT_STORE, RateLimitStore, RateLimiter, RedisRateLimitStore } from './auth/rate-limit';
import { SessionSigner } from './auth/session';
import { InMemoryUserStore, PostgresUserStore, USER_STORE } from './auth/users';
import { AUTH_STORAGE, InMemoryAuthStorage, PostgresAuthStorage } from './auth/auth-storage';
import { CastingController } from './casting/casting.controller';
import { CastingService } from './casting/casting.service';
import { InMemoryVoteStore, VOTE_STORE, VoteStore } from './domain/store';
import { PostgresVoteStore } from './domain/postgres-store';
import { ElectionsController, MeController, PublicController } from './elections/elections.controller';
import { ElectionsService } from './elections/elections.service';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  ok() {
    return { status: 'ok' };
  }
}

@Controller('ready')
class ReadyController {
  private readonly log = new Logger('ReadyController');

  constructor(
    @Optional() @Inject(PrismaClient) private readonly prisma?: PrismaClient | null,
    @Optional() @Inject(RATE_LIMIT_STORE) private readonly rlStore?: RateLimitStore,
  ) {}

  @Public()
  @Get()
  async check() {
    const checks: Record<string, string> = {};

    // Postgres liveness
    if (this.prisma) {
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        checks['postgres'] = 'ok';
      } catch (err) {
        checks['postgres'] = `error: ${(err as Error).message}`;
        this.log.error(`Readiness check: postgres failed — ${(err as Error).message}`);
      }
    } else {
      checks['postgres'] = 'not configured';
    }

    // Redis liveness (if using Redis store)
    const { RedisRateLimitStore } = await import('./auth/rate-limit');
    if (this.rlStore instanceof RedisRateLimitStore) {
      try {
        const pong = await (this.rlStore as any).redis.ping();
        checks['redis'] = pong === 'PONG' ? 'ok' : `unexpected: ${pong}`;
      } catch (err) {
        checks['redis'] = `error: ${(err as Error).message}`;
        this.log.error(`Readiness check: redis failed — ${(err as Error).message}`);
      }
    } else {
      checks['redis'] = 'not configured';
    }

    const allOk = Object.values(checks).every((v) => v === 'ok' || v === 'not configured');
    return { status: allOk ? 'ok' : 'degraded', checks };
  }
}

function shouldUsePostgres(): boolean {
  const store = (process.env.STORE ?? (process.env.DATABASE_URL ? 'postgres' : 'memory')).toLowerCase();
  return store === 'postgres';
}

@Module({
  controllers: [HealthController, ReadyController, AuthController, UsersController, ElectionsController, MeController, PublicController, CastingController],
  providers: [
    {
      provide: PrismaClient,
      useFactory: () => {
        if (shouldUsePostgres()) {
          return new PrismaClient();
        }
        return null;
      },
    },
    {
      provide: VOTE_STORE,
      useFactory: (prisma: PrismaClient | null) => {
        return shouldUsePostgres() && prisma ? new PostgresVoteStore(prisma) : new InMemoryVoteStore();
      },
      inject: [PrismaClient],
    },
    {
      provide: USER_STORE,
      useFactory: (prisma: PrismaClient | null) => {
        return shouldUsePostgres() && prisma ? new PostgresUserStore(prisma) : new InMemoryUserStore();
      },
      inject: [PrismaClient],
    },
    {
      provide: AUTH_STORAGE,
      useFactory: (prisma: PrismaClient | null) => {
        return shouldUsePostgres() && prisma ? new PostgresAuthStorage(prisma) : new InMemoryAuthStorage();
      },
      inject: [PrismaClient],
    },
    {
      provide: RATE_LIMIT_STORE,
      useFactory: () => {
        if (process.env.REDIS_URL) {
          return new RedisRateLimitStore(process.env.REDIS_URL);
        }
        return new InMemoryRateLimitStore();
      },
    },
    {
      provide: RateLimiter,
      useFactory: (store: RateLimitStore) => new RateLimiter(store),
      inject: [RATE_LIMIT_STORE],
    },
    {
      provide: NOTIFIER,
      useFactory: () => buildNotifier(),
    },
    { provide: SessionSigner, useFactory: () => SessionSigner.fromEnv() },
    AuthService,
    ElectionsService,
    {
      provide: CastingService,
      useFactory: (store: VoteStore, elections: ElectionsService, rateLimitStore: RateLimitStore) =>
        new CastingService(store, elections, rateLimitStore),
      inject: [VOTE_STORE, ElectionsService, RATE_LIMIT_STORE],
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AppModule');

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Optional() @Inject(PrismaClient) private readonly prisma?: PrismaClient | null,
    @Optional() @Inject(RATE_LIMIT_STORE) private readonly rateLimitStore?: RateLimitStore,
  ) {}

  async onModuleInit() {
    if (this.prisma) {
      await this.prisma.$connect();
    }
    await this.auth.seedAdmin();
    if (!process.env.REDIS_URL && process.env.NODE_ENV === 'production') {
      this.log.warn('Running with in-memory RateLimiter in production. Configure REDIS_URL when running multiple instances.');
    }
  }

  async onModuleDestroy() {
    if (this.rateLimitStore?.close) {
      await this.rateLimitStore.close();
    }
    if (this.prisma) {
      await this.prisma.$disconnect();
    }
  }
}
