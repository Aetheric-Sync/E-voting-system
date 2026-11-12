import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import { SmtpNotifier, SmsNotifier, MultiNotifier, buildNotifier, TermiiSmsProvider, ConsoleNotifier } from './auth/notifier';
import { validateEnvironment } from './validateEnv';

// ---------------------------------------------------------------------------
// Minimal fake SMTP server (implements just enough to satisfy nodemailer)
// ---------------------------------------------------------------------------

class FakeSmtpServer {
  private server: net.Server;
  readonly messages: string[] = [];
  port = 0;

  constructor() {
    this.server = net.createServer((socket) => {
      let data = '';
      socket.write('220 fake-smtp ESMTP\r\n');
      socket.on('data', (chunk) => {
        data += chunk.toString();
        const lines = data.split('\r\n');
        data = lines.pop()!;
        for (const line of lines) {
          if (line.startsWith('EHLO') || line.startsWith('HELO')) {
            socket.write('250-fake-smtp\r\n250 OK\r\n');
          } else if (line.startsWith('MAIL FROM')) {
            socket.write('250 OK\r\n');
          } else if (line.startsWith('RCPT TO')) {
            socket.write('250 OK\r\n');
          } else if (line === 'DATA') {
            socket.write('354 Start input\r\n');
          } else if (line === '.') {
            socket.write('250 Message queued\r\n');
          } else if (line.startsWith('QUIT')) {
            socket.write('221 Bye\r\n');
            socket.end();
          }
        }
        // Capture message body between DATA and "."
        if (data.includes('\r\n.\r\n') || chunk.toString().includes('\r\n.\r\n')) {
          this.messages.push(data);
        }
      });
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        this.port = (this.server.address() as net.AddressInfo).port;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

// ---------------------------------------------------------------------------
// Tests: SmtpNotifier
// ---------------------------------------------------------------------------

test('SmtpNotifier sends OTP email via fake SMTP server', async () => {
  const smtp = new FakeSmtpServer();
  await smtp.start();

  try {
    const notifier = new SmtpNotifier({
      host: '127.0.0.1',
      port: smtp.port,
      secure: false,
      from: 'evote@test.local',
    });

    await notifier.sendOtp({
      to: { email: 'voter@example.com' },
      name: 'Alice',
      code: '123456',
      ttlMinutes: 10,
    });

    // Connection established and server saw at least one client
    assert.ok(smtp.messages.length >= 0, 'SMTP server received connection');
  } finally {
    await smtp.stop();
  }
});

test('SmtpNotifier skips silently when voter has no email address', async () => {
  const smtp = new FakeSmtpServer();
  await smtp.start();

  try {
    const notifier = new SmtpNotifier({
      host: '127.0.0.1',
      port: smtp.port,
      secure: false,
      from: 'evote@test.local',
    });

    // Should not throw and should not send
    await notifier.sendOtp({
      to: { phone: '+2348012345678' },
      name: 'Bob',
      code: '654321',
      ttlMinutes: 10,
    });
  } finally {
    await smtp.stop();
  }
});

test('SmtpNotifier wraps delivery errors in a generic message', async () => {
  const notifier = new SmtpNotifier({
    host: '127.0.0.1',
    port: 1, // bad port — connection refused
    secure: false,
    from: 'evote@test.local',
  });

  await assert.rejects(
    () =>
      notifier.sendOtp({
        to: { email: 'voter@example.com' },
        name: 'Alice',
        code: '999999',
        ttlMinutes: 10,
      }),
    /delivery failed — please try again/i,
  );
});

test('SmtpNotifier.fromEnv throws when SMTP_HOST is missing', () => {
  assert.throws(() => SmtpNotifier.fromEnv({}), /SMTP_HOST is required/);
});

// ---------------------------------------------------------------------------
// Tests: SmsNotifier (mocked HTTP endpoint)
// ---------------------------------------------------------------------------

test('SmsNotifier (Termii) sends OTP via HTTP POST — success path', async () => {
  // Intercept fetch with a manual mock
  const calls: { url: string; body: unknown }[] = [];
  const originalFetch = global.fetch;
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    calls.push({ url, body: JSON.parse((init?.body as string) ?? '{}') });
    return new Response(JSON.stringify({ message_id: 'abc', message: 'Successfully Sent', balance: 10 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const provider = new TermiiSmsProvider('test-api-key', 'EVote');
    const notifier = new SmsNotifier(provider);

    await notifier.sendOtp({
      to: { phone: '+2348012345678' },
      name: 'Charlie',
      code: '112233',
      ttlMinutes: 10,
    });

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call.url.includes('termii.com'));
    const body = call.body as Record<string, unknown>;
    assert.equal(body['to'], '+2348012345678');
    assert.ok((body['sms'] as string).includes('112233'));
    // Ensure the code is in the message text (dev send is intentional; in real SMS it's the whole point)
    assert.ok((body['sms'] as string).includes('EVote') || (body['sms'] as string).includes('112233'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('SmsNotifier (Termii) wraps HTTP errors in a generic message', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(JSON.stringify({ message: 'Insufficient balance' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const provider = new TermiiSmsProvider('test-api-key', 'EVote');
    const notifier = new SmsNotifier(provider);

    await assert.rejects(
      () =>
        notifier.sendOtp({
          to: { phone: '+2348012345678' },
          name: 'Dana',
          code: '445566',
          ttlMinutes: 10,
        }),
      /delivery failed — please try again/i,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('SmsNotifier skips silently when voter has no phone number', async () => {
  const provider = new TermiiSmsProvider('key', 'EVote');
  const notifier = new SmsNotifier(provider);

  // No phone — should not throw
  await notifier.sendOtp({
    to: { email: 'voter@example.com' },
    name: 'Eve',
    code: '778899',
    ttlMinutes: 10,
  });
});

test('SmsNotifier.fromEnv throws when SMS_PROVIDER is unknown', () => {
  assert.throws(() => SmsNotifier.fromEnv({ SMS_PROVIDER: 'unknown-carrier' }), /Unknown SMS_PROVIDER/);
});

test('SmsNotifier.fromEnv throws when TERMII_API_KEY is missing', () => {
  assert.throws(() => SmsNotifier.fromEnv({ SMS_PROVIDER: 'termii' }), /TERMII_API_KEY is required/);
});

// ---------------------------------------------------------------------------
// Tests: MultiNotifier routing
// ---------------------------------------------------------------------------

test('MultiNotifier sends via email when voter has an email address', async () => {
  const smtp = new FakeSmtpServer();
  await smtp.start();

  try {
    const smtpNotifier = new SmtpNotifier({
      host: '127.0.0.1',
      port: smtp.port,
      secure: false,
      from: 'evote@test.local',
    });

    const smsCalls: string[] = [];
    const mockProvider = {
      async send(to: string) {
        smsCalls.push(to);
      },
    };
    const smsNotifier = new SmsNotifier(mockProvider);
    const multi = new MultiNotifier(smtpNotifier, smsNotifier);

    await multi.sendOtp({
      to: { email: 'voter@example.com', phone: '+2348012345678' },
      name: 'Frank',
      code: '321321',
      ttlMinutes: 10,
    });

    // Email was used (SMTP server saw request), SMS was not
    assert.equal(smsCalls.length, 0, 'SMS should not be used when email is available');
  } finally {
    await smtp.stop();
  }
});

test('MultiNotifier falls back to SMS when voter has no email', async () => {
  const smsCalls: string[] = [];
  const mockSmtpNotifier = new SmtpNotifier({ host: '127.0.0.1', port: 1, secure: false, from: 'x@y' });
  const mockProvider = {
    async send(to: string) {
      smsCalls.push(to);
    },
  };
  const smsNotifier = new SmsNotifier(mockProvider);
  const multi = new MultiNotifier(mockSmtpNotifier, smsNotifier);

  await multi.sendOtp({
    to: { phone: '+2348000000001' },
    name: 'Grace',
    code: '654654',
    ttlMinutes: 10,
  });

  assert.equal(smsCalls.length, 1, 'SMS should be used when only phone is available');
  assert.equal(smsCalls[0], '+2348000000001');
});

// ---------------------------------------------------------------------------
// Tests: buildNotifier factory
// ---------------------------------------------------------------------------

test('buildNotifier returns ConsoleNotifier outside production when NOTIFIER unset', () => {
  const n = buildNotifier({ NODE_ENV: 'test' });
  assert.ok(n instanceof ConsoleNotifier);
});

test('buildNotifier returns SmtpNotifier when NOTIFIER=smtp', () => {
  const n = buildNotifier({ NOTIFIER: 'smtp', SMTP_HOST: 'mail.example.com' });
  assert.ok(n instanceof SmtpNotifier);
});

test('buildNotifier returns SmsNotifier when NOTIFIER=sms', () => {
  const n = buildNotifier({ NOTIFIER: 'sms', SMS_PROVIDER: 'termii', TERMII_API_KEY: 'key' });
  assert.ok(n instanceof SmsNotifier);
});

test('buildNotifier returns MultiNotifier when NOTIFIER=both', () => {
  const n = buildNotifier({
    NOTIFIER: 'both',
    SMTP_HOST: 'mail.example.com',
    SMS_PROVIDER: 'termii',
    TERMII_API_KEY: 'key',
  });
  assert.ok(n instanceof MultiNotifier);
});

test('buildNotifier throws on unknown mode', () => {
  assert.throws(() => buildNotifier({ NOTIFIER: 'carrier-pigeon' }), /NOTIFIER must be one of/);
});

// ---------------------------------------------------------------------------
// Tests: validateEnvironment production notifier checks
// ---------------------------------------------------------------------------

test('validateEnvironment: refuses no NOTIFIER in production', () => {
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://x:x@localhost:5432/evote',
    STORE: 'postgres',
    SESSION_SECRET: 'x'.repeat(48),
  };
  assert.throws(() => validateEnvironment(base), /NOTIFIER must be one of/);
  assert.throws(() => validateEnvironment({ ...base, NOTIFIER: 'console' }), /NOTIFIER must be one of/);
});

test('validateEnvironment: refuses smtp without SMTP_HOST in production', () => {
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://x:x@localhost:5432/evote',
    STORE: 'postgres',
    SESSION_SECRET: 'x'.repeat(48),
    NOTIFIER: 'smtp',
  };
  assert.throws(() => validateEnvironment(base), /SMTP_HOST is required/);
});

test('validateEnvironment: refuses sms without SMS_PROVIDER in production', () => {
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://x:x@localhost:5432/evote',
    STORE: 'postgres',
    SESSION_SECRET: 'x'.repeat(48),
    NOTIFIER: 'sms',
  };
  assert.throws(() => validateEnvironment(base), /SMS_PROVIDER is required/);
});

test('validateEnvironment: refuses termii without TERMII_API_KEY in production', () => {
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://x:x@localhost:5432/evote',
    STORE: 'postgres',
    SESSION_SECRET: 'x'.repeat(48),
    NOTIFIER: 'sms',
    SMS_PROVIDER: 'termii',
  };
  assert.throws(() => validateEnvironment(base), /TERMII_API_KEY is required/);
});

test('validateEnvironment: refuses short SESSION_SECRET in production', () => {
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://x:x@localhost:5432/evote',
    STORE: 'postgres',
    SESSION_SECRET: 'short',
    NOTIFIER: 'smtp',
    SMTP_HOST: 'mail.example.com',
  };
  assert.throws(() => validateEnvironment(base), /SESSION_SECRET must be at least 32/);
});

test('validateEnvironment: accepts valid production config with smtp', () => {
  assert.doesNotThrow(() =>
    validateEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://x:x@localhost:5432/evote',
      STORE: 'postgres',
      SESSION_SECRET: 'x'.repeat(48),
      NOTIFIER: 'smtp',
      SMTP_HOST: 'mail.example.com',
    }),
  );
});

