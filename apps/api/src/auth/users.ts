import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type StaffRole = 'ADMIN' | 'OBSERVER';

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  passwordHash: string;
  createdAt: string;
}

export interface UserStore {
  getByEmail(email: string): Promise<StaffUser | undefined>;
  list(): Promise<StaffUser[]>;
  create(u: Omit<StaffUser, 'id' | 'createdAt'>): Promise<StaffUser>;
}

export const USER_STORE = Symbol('USER_STORE');

export class InMemoryUserStore implements UserStore {
  private users = new Map<string, StaffUser>();
  async getByEmail(email: string) {
    return this.users.get(email.toLowerCase());
  }
  async list() {
    return [...this.users.values()];
  }
  async create(u: Omit<StaffUser, 'id' | 'createdAt'>) {
    const email = u.email.toLowerCase();
    if (this.users.has(email)) throw new Error('exists');
    const user: StaffUser = { ...u, email, id: randomUUID(), createdAt: new Date().toISOString() };
    this.users.set(email, user);
    return user;
  }
}

export class PostgresUserStore implements UserStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getByEmail(email: string): Promise<StaffUser | undefined> {
    const row = await this.prisma.staffUser.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!row) return undefined;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role as StaffRole,
      passwordHash: row.passwordHash,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(): Promise<StaffUser[]> {
    const rows = await this.prisma.staffUser.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role as StaffRole,
      passwordHash: r.passwordHash,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async create(u: Omit<StaffUser, 'id' | 'createdAt'>): Promise<StaffUser> {
    const email = u.email.toLowerCase();
    const existing = await this.prisma.staffUser.findUnique({ where: { email } });
    if (existing) throw new Error('exists');
    const created = await this.prisma.staffUser.create({
      data: {
        id: randomUUID(),
        email,
        name: u.name,
        role: u.role,
        passwordHash: u.passwordHash,
      },
    });
    return {
      id: created.id,
      email: created.email,
      name: created.name,
      role: created.role as StaffRole,
      passwordHash: created.passwordHash,
      createdAt: created.createdAt.toISOString(),
    };
  }
}
