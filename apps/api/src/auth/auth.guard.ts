import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { RateLimiter } from './rate-limit';
import { Role, SessionSigner } from './session';

export const COOKIE_NAME = 'evote_session';
export const CSRF_HEADER = 'x-evote-csrf';

export const PUBLIC_KEY = 'public';
export const ROLES_KEY = 'roles';
export const RATE_KEY = 'rate';

export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const RateLimit = (limit: number, windowSeconds: number) => SetMetadata(RATE_KEY, { limit, windowSeconds });

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  sid: string;
  exp: number;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/**
 * Global guard. Order matters:
 *   1. CSRF: every state-changing request must carry a custom header. Browsers will not add it
 *      to cross-site requests without a CORS preflight, which this API never approves.
 *   2. Rate limit (per client address and route) where @RateLimit is set.
 *   3. Session: signed, unexpired, not revoked, and allowed by @Roles. @Public skips the session.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionSigner) private readonly signer: SessionSigner,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  canActivate(ctx: ExecutionContext): boolean | Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const targets = [ctx.getHandler(), ctx.getClass()];

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw new ForbiddenException('Missing CSRF header');
    }

    const rate = this.reflector.getAllAndOverride<{ limit: number; windowSeconds: number } | undefined>(RATE_KEY, targets);
    if (rate) {
      const allowed = this.limiter.allow(`${req.ip}|${req.method}|${req.route?.path ?? req.path}`, rate.limit, rate.windowSeconds);
      if (allowed instanceof Promise) {
        return allowed.then((ok) => {
          if (!ok) throw new HttpException('Too many requests, slow down', HttpStatus.TOO_MANY_REQUESTS);
          return this.authenticateSession(ctx, targets, req);
        });
      }
      if (!allowed) {
        throw new HttpException('Too many requests, slow down', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    return this.authenticateSession(ctx, targets, req);
  }

  private authenticateSession(ctx: ExecutionContext, targets: any[], req: any): boolean {
    const payload = this.signer.verify(readCookie(req.headers.cookie, COOKIE_NAME));
    const session = payload && !this.auth.isRevoked(payload.sid) ? payload : null;
    if (session) req.user = { id: session.sub, role: session.role, name: session.name, sid: session.sid, exp: session.exp } satisfies AuthUser;

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    if (!session) throw new UnauthorizedException('Please sign in');

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(session.role)) throw new ForbiddenException('You do not have access to this');
    return true;
  }
}
