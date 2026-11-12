export function validateEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (env.OTP_ECHO === 'true' && env.NODE_ENV === 'production') {
    throw new Error('OTP_ECHO must not be enabled in production');
  }
  if (env.NO_RATE_LIMIT === 'true' && env.NODE_ENV === 'production') {
    throw new Error('NO_RATE_LIMIT must not be enabled in production');
  }

  if (env.NODE_ENV === 'production') {
    // Store
    const store = (env.STORE ?? 'postgres').toLowerCase();
    if (store === 'memory') {
      throw new Error('STORE=memory is refused in production: use STORE=postgres with DATABASE_URL');
    }
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be configured in production');
    }

    // Session secret strength
    const secret = env.SESSION_SECRET ?? '';
    if (secret.length < 32) {
      throw new Error('SESSION_SECRET must be at least 32 characters in production');
    }

    // Multi-instance rate limiting
    const instances = parseInt(env.INSTANCES ?? '1', 10);
    if (instances > 1 && !env.REDIS_URL) {
      throw new Error(
        'REDIS_URL must be configured in production when INSTANCES > 1 (in-memory rate limiter and idempotency cache cannot coordinate across multiple instances)',
      );
    }

    // Notifier — must be a real one in production
    const notifier = (env.NOTIFIER ?? '').toLowerCase();
    if (!notifier || notifier === 'console') {
      throw new Error('NOTIFIER must be one of: smtp, sms, both — ConsoleNotifier is not allowed in production');
    }
    if ((notifier === 'smtp' || notifier === 'both') && !env.SMTP_HOST) {
      throw new Error('SMTP_HOST is required when NOTIFIER includes smtp');
    }
    if ((notifier === 'sms' || notifier === 'both') && !env.SMS_PROVIDER) {
      throw new Error('SMS_PROVIDER is required when NOTIFIER includes sms');
    }
    if ((notifier === 'sms' || notifier === 'both') && (env.SMS_PROVIDER ?? '').toLowerCase() === 'termii' && !env.TERMII_API_KEY) {
      throw new Error('TERMII_API_KEY is required when SMS_PROVIDER=termii');
    }
  }
}
