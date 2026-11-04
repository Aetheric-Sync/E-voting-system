export interface OtpMessage {
  to: { email?: string; phone?: string };
  name: string;
  code: string;
  ttlMinutes: number;
}

/** Delivery port. Implement with SES / an SMS aggregator; keep at least two SMS providers with fallback. */
export interface Notifier {
  sendOtp(msg: OtpMessage): Promise<void>;
}

export const NOTIFIER = Symbol('NOTIFIER');

/** Development notifier: prints the code. Refuses to run in production. */
export class ConsoleNotifier implements Notifier {
  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ConsoleNotifier cannot be used in production: configure a real notifier');
    }
  }
  async sendOtp(msg: OtpMessage) {
    const dest = msg.to.email ?? msg.to.phone;
    console.log(`[otp] ${msg.name} <${dest}>: ${msg.code} (valid ${msg.ttlMinutes} min)`);
  }
}

/** Test notifier: remembers the last code per destination. */
export class MemoryNotifier implements Notifier {
  readonly sent: OtpMessage[] = [];
  async sendOtp(msg: OtpMessage) {
    this.sent.push(msg);
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
}
