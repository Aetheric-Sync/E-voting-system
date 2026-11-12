import * as nodemailer from 'nodemailer';
import { Logger } from '@nestjs/common';

export interface OtpMessage {
  to: { email?: string; phone?: string };
  name: string;
  code: string;
  ttlMinutes: number;
}

/** Delivery port. Implement with SMTP and/or SMS; keep ConsoleNotifier for dev only. */
export interface Notifier {
  sendOtp(msg: OtpMessage): Promise<void>;
}

export const NOTIFIER = Symbol('NOTIFIER');

// ---------------------------------------------------------------------------
// Contact masking helpers (never log real addresses)
// ---------------------------------------------------------------------------

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***@***';
  const visible = local.length > 2 ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1] : '**';
  return `${visible}@${domain}`;
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return '*'.repeat(phone.length - 4) + phone.slice(-4);
}

function maskDest(to: { email?: string; phone?: string }): string {
  if (to.email) return maskEmail(to.email);
  if (to.phone) return maskPhone(to.phone);
  return '(no contact)';
}

// ---------------------------------------------------------------------------
// ConsoleNotifier — dev only
// ---------------------------------------------------------------------------

/** Development notifier: prints the code. Refuses to run in production. */
export class ConsoleNotifier implements Notifier {
  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ConsoleNotifier cannot be used in production: configure NOTIFIER=smtp or NOTIFIER=sms');
    }
  }

  async sendOtp(msg: OtpMessage) {
    // Log masked destination; never log the code in a real line.
    // We print it here intentionally for dev demos only.
    const dest = msg.to.email ?? msg.to.phone;
    console.log(`[otp] ${msg.name} <${dest}>: ${msg.code} (valid ${msg.ttlMinutes} min)`);
  }
}

// ---------------------------------------------------------------------------
// MemoryNotifier — test helper
// ---------------------------------------------------------------------------

/** Test notifier: remembers every delivered message. Never logs codes. */
export class MemoryNotifier implements Notifier {
  readonly sent: OtpMessage[] = [];

  async sendOtp(msg: OtpMessage) {
    this.sent.push(msg);
  }

  last() {
    return this.sent[this.sent.length - 1];
  }
}

// ---------------------------------------------------------------------------
// SmtpNotifier — production email
// ---------------------------------------------------------------------------

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export class SmtpNotifier implements Notifier {
  private readonly transport: nodemailer.Transporter;
  private readonly from: string;
  private readonly log = new Logger('SmtpNotifier');

  constructor(cfg: SmtpConfig) {
    this.from = cfg.from;
    this.transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
    });
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SmtpNotifier {
    const host = env.SMTP_HOST;
    if (!host) throw new Error('SMTP_HOST is required when NOTIFIER includes smtp');
    return new SmtpNotifier({
      host,
      port: parseInt(env.SMTP_PORT ?? '587', 10),
      secure: (env.SMTP_PORT ?? '587') === '465',
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM ?? env.SMTP_USER ?? `noreply@${host}`,
    });
  }

  async sendOtp(msg: OtpMessage): Promise<void> {
    if (!msg.to.email) return; // no email address — skip
    const masked = maskEmail(msg.to.email);
    try {
      await this.transport.sendMail({
        from: this.from,
        to: msg.to.email,
        subject: 'Your sign-in code',
        text: [
          `Hello ${msg.name},`,
          '',
          `Your one-time sign-in code is: ${msg.code}`,
          '',
          `It expires in ${msg.ttlMinutes} minutes. Do not share this code.`,
        ].join('\n'),
        html: `<p>Hello ${msg.name},</p><p>Your one-time sign-in code is: <strong>${msg.code}</strong></p><p>It expires in ${msg.ttlMinutes} minutes. Do not share this code.</p>`,
      });
      this.log.log(`OTP email sent to ${masked}`);
    } catch (err) {
      this.log.error(`OTP email to ${masked} failed: ${(err as Error).message}`);
      throw new Error('Message delivery failed — please try again');
    }
  }
}

// ---------------------------------------------------------------------------
// SmsNotifier — production SMS (Termii; interface generic for future providers)
// ---------------------------------------------------------------------------

export interface SmsProvider {
  send(to: string, text: string): Promise<void>;
}

/** Termii SMS provider. */
export class TermiiSmsProvider implements SmsProvider {
  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly log = new Logger('TermiiSMS');

  constructor(apiKey: string, senderId = 'EVote') {
    this.apiKey = apiKey;
    this.senderId = senderId;
  }

  async send(to: string, text: string): Promise<void> {
    const res = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        from: this.senderId,
        sms: text,
        type: 'plain',
        api_key: this.apiKey,
        channel: 'generic',
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.log.error(`Termii SMS to ${maskPhone(to)} returned ${res.status}: ${body.slice(0, 120)}`);
      throw new Error('SMS delivery failed — please try again');
    }
    this.log.log(`OTP SMS sent to ${maskPhone(to)}`);
  }
}

export class SmsNotifier implements Notifier {
  private readonly log = new Logger('SmsNotifier');

  constructor(private readonly provider: SmsProvider) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SmsNotifier {
    const provider = (env.SMS_PROVIDER ?? '').toLowerCase();
    if (provider === 'termii') {
      const key = env.TERMII_API_KEY;
      if (!key) throw new Error('TERMII_API_KEY is required when SMS_PROVIDER=termii');
      return new SmsNotifier(new TermiiSmsProvider(key, env.TERMII_SENDER_ID));
    }
    throw new Error(`Unknown SMS_PROVIDER "${env.SMS_PROVIDER}". Supported: termii`);
  }

  async sendOtp(msg: OtpMessage): Promise<void> {
    if (!msg.to.phone) return; // no phone — skip
    const text = `Your EVote sign-in code is ${msg.code}. Valid for ${msg.ttlMinutes} minutes. Do not share.`;
    try {
      await this.provider.send(msg.to.phone, text);
    } catch (err) {
      this.log.error(`OTP SMS to ${maskPhone(msg.to.phone)} failed: ${(err as Error).message}`);
      throw new Error('Message delivery failed — please try again');
    }
  }
}

// ---------------------------------------------------------------------------
// MultiNotifier — email if voter has email, SMS if only phone
// ---------------------------------------------------------------------------

export class MultiNotifier implements Notifier {
  private readonly log = new Logger('MultiNotifier');

  constructor(
    private readonly smtp: SmtpNotifier,
    private readonly sms: SmsNotifier,
  ) {}

  async sendOtp(msg: OtpMessage): Promise<void> {
    if (msg.to.email) {
      await this.smtp.sendOtp(msg);
    } else if (msg.to.phone) {
      await this.sms.sendOtp(msg);
    } else {
      this.log.warn(`Voter ${msg.name} has no email or phone — OTP not delivered`);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory: build the right Notifier from env
// ---------------------------------------------------------------------------

/**
 * NOTIFIER env:
 *   console (default dev) — ConsoleNotifier, refuses production
 *   smtp                  — SmtpNotifier (requires SMTP_HOST)
 *   sms                   — SmsNotifier  (requires SMS_PROVIDER + provider keys)
 *   both                  — MultiNotifier (email if present, else SMS)
 */
export function buildNotifier(env: NodeJS.ProcessEnv = process.env): Notifier {
  const mode = (env.NOTIFIER ?? (env.NODE_ENV === 'production' ? '' : 'console')).toLowerCase();
  switch (mode) {
    case 'console':
      return new ConsoleNotifier();
    case 'smtp':
      return SmtpNotifier.fromEnv(env);
    case 'sms':
      return SmsNotifier.fromEnv(env);
    case 'both':
      return new MultiNotifier(SmtpNotifier.fromEnv(env), SmsNotifier.fromEnv(env));
    default:
      throw new Error(`NOTIFIER must be one of: console, smtp, sms, both. Got: "${env.NOTIFIER ?? ''}"`);
  }
}
