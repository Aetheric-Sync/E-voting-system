import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { VoterRow } from '@evote/core';
import { AuthUser, Public, RateLimit, Roles } from '../auth/auth.guard';
import { CreateElectionInput, ElectionsService } from './elections.service';

@Controller('elections')
export class ElectionsController {
  constructor(@Inject(ElectionsService) private readonly svc: ElectionsService) {}

  @Get()
  @Roles('ADMIN', 'OBSERVER')
  list(@Req() req: { user: AuthUser }) {
    return this.svc.list(req.user.role === 'ADMIN');
  }

  @Post()
  @Roles('ADMIN')
  create(@Req() req: { user: AuthUser }, @Body() body: CreateElectionInput) {
    return this.svc.create(body, req.user.id);
  }

  @Get(':id')
  @Roles('ADMIN', 'OBSERVER')
  get(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.svc.getVisible(id, req.user.role === 'ADMIN');
  }

  @Put(':id')
  @Roles('ADMIN')
  update(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: CreateElectionInput) {
    return this.svc.update(id, body, req.user.id);
  }

  @Post(':id/duplicate')
  @Roles('ADMIN')
  duplicate(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.svc.duplicate(id, req.user.id);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.svc.remove(id, req.user.id);
  }

  @Post(':id/voters')
  @Roles('ADMIN')
  importVoters(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: { csv?: string; voters?: VoterRow[] }) {
    return this.svc.importVoters(id, body ?? {}, req.user.id);
  }

  @Get(':id/register')
  @Roles('ADMIN')
  register(@Param('id') id: string) {
    return this.svc.register(id);
  }

  @Post(':id/open')
  @Roles('ADMIN')
  open(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.svc.open(id, req.user.id);
  }

  @Post(':id/close')
  @Roles('ADMIN')
  close(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.svc.close(id, req.user.id);
  }

  @Post(':id/seal')
  @Roles('ADMIN')
  seal(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.svc.seal(id, req.user.id);
  }

  @Get(':id/turnout')
  @Roles('ADMIN', 'OBSERVER')
  turnout(@Param('id') id: string) {
    return this.svc.turnout(id);
  }

  @Get(':id/results')
  @Roles('ADMIN', 'OBSERVER')
  results(@Param('id') id: string) {
    return this.svc.results(id);
  }

  @Get(':id/audit')
  @Roles('ADMIN', 'OBSERVER')
  audit(@Param('id') id: string) {
    return this.svc.auditLog(id);
  }

  @Get(':id/verify')
  @Roles('ADMIN', 'OBSERVER')
  verify(@Param('id') id: string) {
    return this.svc.verify(id);
  }
}

/** What a signed-in voter can see: only their own elections. */
@Controller('me')
export class MeController {
  constructor(@Inject(ElectionsService) private readonly svc: ElectionsService) {}

  @Get('elections')
  @Roles('VOTER')
  mine(@Req() req: { user: AuthUser }) {
    return this.svc.electionsForVoter(req.user.id);
  }

  @Get('elections/:id')
  @Roles('VOTER')
  ballot(@Req() req: { user: AuthUser }, @Param('id') id: string) {
    return this.svc.ballotForVoter(id, req.user.id);
  }
}

/** No sign-in: anyone can read published results and check a receipt. */
@Controller('public')
@Public()
export class PublicController {
  constructor(@Inject(ElectionsService) private readonly svc: ElectionsService) {}

  @Get('elections')
  list() {
    return this.svc.publicList();
  }

  @Get('elections/:id/results')
  results(@Param('id') id: string) {
    return this.svc.publicResults(id);
  }

  @Get('elections/:id/receipt/:code')
  @RateLimit(30, 60)
  receipt(@Param('id') id: string, @Param('code') code: string) {
    return this.svc.checkReceipt(id, code);
  }
}
