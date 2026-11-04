import { Controller, Get, Module, OnModuleInit, Inject } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController, UsersController } from './auth/auth.controller';
import { AuthGuard, Public } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { ConsoleNotifier, NOTIFIER } from './auth/notifier';
import { RateLimiter } from './auth/rate-limit';
import { SessionSigner } from './auth/session';
import { InMemoryUserStore, USER_STORE } from './auth/users';
import { CastingController } from './casting/casting.controller';
import { CastingService } from './casting/casting.service';
import { InMemoryVoteStore, VOTE_STORE } from './domain/store';
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

@Module({
  controllers: [HealthController, AuthController, UsersController, ElectionsController, MeController, PublicController, CastingController],
  providers: [
    // Swap for the Postgres adapters (see prisma/schema.prisma) without touching services.
    { provide: VOTE_STORE, useClass: InMemoryVoteStore },
    { provide: USER_STORE, useClass: InMemoryUserStore },
    // Swap for an SES / SMS implementation of Notifier.
    { provide: NOTIFIER, useFactory: () => new ConsoleNotifier() },
    { provide: SessionSigner, useFactory: () => SessionSigner.fromEnv() },
    RateLimiter,
    AuthService,
    ElectionsService,
    CastingService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements OnModuleInit {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async onModuleInit() {
    await this.auth.seedAdmin();
  }
}
