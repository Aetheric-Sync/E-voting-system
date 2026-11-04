import { Body, Controller, Headers, Inject, Param, Post, Req } from '@nestjs/common';
import { Selection } from '@evote/core';
import { AuthUser, RateLimit, Roles } from '../auth/auth.guard';
import { CastingService } from './casting.service';

@Controller('elections/:id/cast')
export class CastingController {
  constructor(@Inject(CastingService) private readonly casting: CastingService) {}

  @Post()
  @Roles('VOTER')
  @RateLimit(30, 60)
  cast(
    @Req() req: { user: AuthUser },
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
    @Body() body: { selections: Selection[] },
  ) {
    return this.casting.cast(id, req.user.id, body?.selections, key);
  }
}
