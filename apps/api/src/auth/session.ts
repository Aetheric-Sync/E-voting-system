import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type Role = 'ADMIN' | 'OBSERVER' | 'VOTER';

export interface SessionPayload {
  sub: string;
  role: Role;
  name: string;
  /** session id, used for logout (revocation) */
  sid: string;
  /** expiry, unix seconds */
  exp: number;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export class SessionSigner {
  constructor(private readonly secret: Buffer) {
    if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 bytes');
  }

  /** Secret from SESSION_SECRET; random per process in dev (sessions reset on restart). */
  static fromEnv(env = process.env): SessionSigner {
    if (env.SESSION_SECRET) return new SessionSigner(Buffer.from(env.SESSION_SECRET));
    if (env.NODE_ENV === 'production') throw new Error('SESSION_SECRET is required in production');
    return new SessionSigner(randomBytes(32));
  }

  sign(p: Omit<SessionPayload, 'sid' | 'exp'>, ttlSeconds: number, now = Date.now()): { token: string; payload: SessionPayload } {
    const payload: SessionPayload = { ...p, sid: randomBytes(12).toString('hex'), exp: Math.floor(now / 1000) + ttlSeconds };
    const body = b64(JSON.stringify(payload));
    return { token: `${body}.${this.mac(body)}`, payload };
  }

  verify(token: string | undefined, now = Date.now()): SessionPayload | null {
    if (!token) return null;
    const [body, mac, extra] = token.split('.');
    if (!body || !mac || extra !== undefined) return null;
    const expected = Buffer.from(this.mac(body));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload;
      if (!p.sub || !p.role || typeof p.exp !== 'number' || p.exp * 1000 < now) return null;
      return p;
    } catch {
      return null;
    }
  }

  private mac(body: string) {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}
