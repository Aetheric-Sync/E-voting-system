import { BadRequestException, Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthUser, COOKIE_NAME, Public, RateLimit, Roles } from './auth.guard';
import { Role, SessionSigner } from './session';
import { StaffRole } from './users';

const VOTER_TTL = 2 * 60 * 60;
const STAFF_TTL = 8 * 60 * 60;

export function text(body: unknown, field: string, max = 200): string {
  const v = (body as Record<string, unknown> | undefined)?.[field];
  if (typeof v !== 'string' || !v.trim()) throw new BadRequestException(`${field} is required`);
  if (v.length > max) throw new BadRequestException(`${field} is too long`);
  return v;
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionSigner) private readonly signer: SessionSigner,
  ) {}

  private startSession(res: Response, sub: string, role: Role, name: string, ttl: number) {
    const { token } = this.signer.sign({ sub, role, name }, ttl);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: ttl * 1000,
    });
  }

  @Public()
  @RateLimit(10, 60)
  @Post('voter/request-otp')
  requestOtp(@Body() body: unknown) {
    return this.auth.requestOtp(text(body, 'voterId', 80));
  }

  @Public()
  @RateLimit(20, 60)
  @Post('voter/verify-otp')
  async verifyOtp(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const voter = await this.auth.verifyOtp(text(body, 'voterId', 80), text(body, 'code', 12));
    this.startSession(res, voter.id, 'VOTER', voter.name, VOTER_TTL);
    return { role: 'VOTER', name: voter.name };
  }

  @Public()
  @RateLimit(10, 60)
  @Post('staff/login')
  async staffLogin(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.staffLogin(text(body, 'email'), text(body, 'password', 200));
    this.startSession(res, user.id, user.role as StaffRole, user.name, STAFF_TTL);
    return { role: user.role, name: user.name };
  }

  @Post('logout')
  logout(@Req() req: { user: AuthUser }, @Res({ passthrough: true }) res: Response) {
    this.auth.revoke(req.user.sid, req.user.exp);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: { user: AuthUser }) {
    return { id: req.user.id, role: req.user.role, name: req.user.name };
  }
}

@Controller('users')
@Roles('ADMIN')
export class UsersController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  list() {
    return this.auth.listStaff();
  }

  @Post()
  create(@Body() body: { email: string; name: string; password: string; role: StaffRole }) {
    return this.auth.createStaff(body);
  }
}
