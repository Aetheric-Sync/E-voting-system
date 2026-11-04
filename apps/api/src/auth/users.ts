import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

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
