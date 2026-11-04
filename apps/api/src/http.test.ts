import 'reflect-metadata';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';

let app: INestApplication;
let base = '';

class Client {
  cookie = '';
  async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}, csrf = true) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(csrf && method !== 'GET' ? { 'x-evote-csrf': '1' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...extra,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  }
}

before(async () => {
  process.env.ADMIN_EMAIL = 'admin@test.local';
  process.env.ADMIN_PASSWORD = 'correct-horse-battery';
  process.env.OTP_ECHO = 'true';
  process.env.SESSION_SECRET = 'z'.repeat(48);
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');
  const { configureApp } = await import('./configure');
  const created = await NestFactory.create<import('@nestjs/platform-express').NestExpressApplication>(AppModule, { logger: false });
  configureApp(created);
  app = created;
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');
});
after(async () => {
  await app.close();
});

test('whole election over HTTP, with the right people allowed at each step', async () => {
  const anon = new Client();
  const admin = new Client();
  const voter = new Client();
  const observer = new Client();

  // locked down by default
  assert.equal((await anon.call('GET', '/elections')).status, 401);
  assert.equal((await anon.call('GET', '/health')).status, 200);
  assert.equal((await anon.call('GET', '/health')).headers.get('x-powered-by'), null);

  // staff login: wrong password, then right one; csrf header required
  assert.equal((await admin.call('POST', '/auth/staff/login', { email: 'admin@test.local', password: 'nope' })).status, 401);
  assert.equal((await admin.call('POST', '/auth/staff/login', { email: 'admin@test.local', password: 'correct-horse-battery' }, {}, false)).status, 403);
  const login = await admin.call('POST', '/auth/staff/login', { email: 'admin@test.local', password: 'correct-horse-battery' });
  assert.equal(login.status, 201);
  assert.match(admin.cookie, /^evote_session=/);
  assert.equal((await admin.call('GET', '/auth/me')).json.role, 'ADMIN');

  // create an observer account
  assert.equal((await admin.call('POST', '/users', { email: 'obs@test.local', name: 'Obi', password: 'observer-password-1', role: 'OBSERVER' })).status, 201);
  assert.equal((await observer.call('POST', '/auth/staff/login', { email: 'obs@test.local', password: 'observer-password-1' })).status, 201);
  assert.equal((await observer.call('POST', '/elections', {})).status, 403);

  // create the election
  const created = await admin.call('POST', '/elections', {
    title: 'Departmental election',
    mode: 'ANONYMOUS_AUDIT',
    positions: [
      { title: 'President', type: 'SINGLE', allowAbstain: true, candidates: [{ name: 'Ada' }, { name: 'Bayo' }] },
      { title: 'Referendum: new dues', type: 'REFERENDUM', candidates: [{ name: 'Yes' }, { name: 'No' }] },
    ],
  });
  assert.equal(created.status, 201);
  const e = created.json;
  const [pres, ref] = e.positions;
  const ada = pres.candidateIds.find((id: string) => e.candidates[id].name === 'Ada');
  const yes = ref.candidateIds.find((id: string) => e.candidates[id].name === 'Yes');

  // draft is hidden from the observer
  assert.equal((await observer.call('GET', `/elections/${e.id}`)).status, 404);
  assert.equal((await observer.call('GET', '/elections')).json.length, 0);

  // register
  const imp = await admin.call('POST', `/elections/${e.id}/voters`, { csv: 'id,name,email\nCSC/21/001,Ada Obi,ada@test.local\nCSC/21/002,Bello Musa,bello@test.local\nbad row' });
  assert.equal(imp.json.added, 2);
  assert.equal(imp.json.errors.length, 1);

  // a voter session cannot open the election; the admin can
  const first = await voter.call('POST', '/auth/voter/request-otp', { voterId: 'CSC/21/001' });
  assert.match(first.json.devCode, /^\d{6}$/);
  const again = await voter.call('POST', '/auth/voter/request-otp', { voterId: 'csc/21/001' }); // inside the 30s cooldown
  assert.deepEqual(again.json, { sent: true }, 'a resend inside the cooldown sends nothing and reveals nothing');
  const unknown = await voter.call('POST', '/auth/voter/request-otp', { voterId: 'nobody' });
  assert.deepEqual(unknown.json, { sent: true });
  assert.equal((await voter.call('POST', '/auth/voter/verify-otp', { voterId: 'csc/21/001', code: first.json.devCode === '000000' ? '000001' : '000000' })).status, 401);
  assert.equal((await voter.call('POST', '/auth/voter/verify-otp', { voterId: 'csc/21/001', code: first.json.devCode })).status, 201);
  assert.equal((await voter.call('POST', `/elections/${e.id}/open`)).status, 403);
  assert.equal((await admin.call('POST', `/elections/${e.id}/open`)).status, 201);
  assert.equal((await observer.call('GET', `/elections/${e.id}`)).status, 200, 'observers can see it once it is open');
});

test('voting, receipts, sealing and public results', async () => {
  const admin = new Client();
  await admin.call('POST', '/auth/staff/login', { email: 'admin@test.local', password: 'correct-horse-battery' });
  const made = await admin.call('POST', '/elections', {
    title: 'Vote test',
    mode: 'ANONYMOUS_AUDIT',
    positions: [{ title: 'President', type: 'SINGLE', candidates: [{ name: 'Ada' }, { name: 'Bayo' }] }],
  });
  const e = made.json;
  const pos = e.positions[0];
  const ada = pos.candidateIds.find((id: string) => e.candidates[id].name === 'Ada');
  await admin.call('POST', `/elections/${e.id}/voters`, { voters: [{ id: 'w1', name: 'W One', email: 'w1@x.com' }, { id: 'w2', name: 'W Two', phone: '+2348030000000' }] });
  await admin.call('POST', `/elections/${e.id}/open`);

  const w1 = new Client();
  const { devCode } = (await w1.call('POST', '/auth/voter/request-otp', { voterId: 'w1' })).json;
  assert.match(devCode, /^\d{6}$/);
  assert.equal((await w1.call('POST', '/auth/voter/verify-otp', { voterId: 'w1', code: devCode })).status, 201);

  // voters cannot reach staff routes or other elections' data
  assert.equal((await w1.call('GET', '/elections')).status, 403);
  assert.equal((await w1.call('POST', `/elections/${e.id}/close`)).status, 403);
  assert.equal((await w1.call('GET', `/elections/${e.id}/audit`)).status, 403);
  const mine = await w1.call('GET', '/me/elections');
  assert.equal(mine.json.length, 1);
  assert.equal(mine.json[0].votedPositionIds.length, 0);
  const ballot = await w1.call('GET', `/me/elections/${e.id}`);
  assert.equal(ballot.json.sealed, undefined);

  // cast
  const cast = await w1.call('POST', `/elections/${e.id}/cast`, { selections: [{ positionId: pos.id, candidateIds: [ada] }] }, { 'idempotency-key': 'abc' });
  assert.equal(cast.status, 201);
  const receipt = cast.json.receipts[0].receiptCode;
  assert.equal((await w1.call('POST', `/elections/${e.id}/cast`, { selections: [{ positionId: pos.id, candidateIds: [ada] }] }, { 'idempotency-key': 'def' })).status, 409);
  assert.equal((await w1.call('GET', '/me/elections')).json[0].votedPositionIds.length, 1);

  // anyone can check the receipt; a made-up one is not found
  const anon = new Client();
  const ok = await anon.call('GET', `/public/elections/${e.id}/receipt/${receipt}`);
  assert.equal(ok.json.found, true);
  assert.equal(ok.json.position, 'President');
  assert.equal(JSON.stringify(ok.json).includes(ada), false);
  assert.equal((await anon.call('GET', `/public/elections/${e.id}/receipt/0123456789ABCDEF`)).json.found, false);

  // no results before sealing, for anyone
  assert.equal((await anon.call('GET', `/public/elections/${e.id}/results`)).status, 404);
  assert.equal((await admin.call('GET', `/elections/${e.id}/results`)).status, 409);

  await admin.call('POST', `/elections/${e.id}/close`);
  assert.equal((await w1.call('POST', `/elections/${e.id}/cast`, { selections: [] }, { 'idempotency-key': 'zzz' })).status, 409);
  const sealed = await admin.call('POST', `/elections/${e.id}/seal`);
  assert.equal(sealed.status, 201);

  const pub = await anon.call('GET', `/public/elections/${e.id}/results`);
  assert.equal(pub.status, 200);
  assert.equal(pub.json.sealed.results[0].counts[ada], 1);
  assert.equal((await anon.call('GET', '/public/elections')).json.some((x: { id: string }) => x.id === e.id), true);

  const v = await admin.call('GET', `/elections/${e.id}/verify`);
  assert.deepEqual([v.json.tallyMatches, v.json.hashMatches, v.json.auditIntact], [true, true, true]);
  const audit = await admin.call('GET', `/elections/${e.id}/audit`);
  assert.equal(audit.json.intact, true);
  assert.equal(JSON.stringify(audit.json).includes('w1'), false, 'voter ids must not appear in the audit log');

  // logout revokes the session
  assert.equal((await w1.call('POST', '/auth/logout')).status, 201);
});

test('logout makes the old cookie useless', async () => {
  const c = new Client();
  await c.call('POST', '/auth/staff/login', { email: 'admin@test.local', password: 'correct-horse-battery' });
  const old = c.cookie;
  assert.equal((await c.call('GET', '/auth/me')).status, 200);
  await c.call('POST', '/auth/logout');
  const replay = new Client();
  replay.cookie = old;
  assert.equal((await replay.call('GET', '/auth/me')).status, 401);
});
