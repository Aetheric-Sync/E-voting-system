# E-Voting Platform

Multi-tenant e-voting for ~1M voters. Two integrity modes per election: **Anonymous + audit chain** (built) and **End-to-end verifiable** (contract fixed, Phase 5).

## What is in the box

| Path | What | Status |
| --- | --- | --- |
| `packages/core` | Audit hash chain, integrity strategy contract, anonymous strategy, ranked-choice (instant runoff) tally, voter CSV parser | Built, 12 tests |
| `apps/api` | NestJS API: auth, election lifecycle, scheduler, casting, tally, audit, verification, public results | Built, 82 tests (unit + integration) |
| `apps/web` | Next.js app with every portal (below) | Built, E2E test suite |
| `apps/mobile` | Expo app skeleton | Skeleton only, not installed or built |
| `apps/api/prisma/schema.prisma` | Postgres schema | Schema, migrations, and immutability triggers |

### Portals (`apps/web`)

| Portal | Path | Who |
| --- | --- | --- |
| Voter | `/vote`, `/vote/elections`, `/vote/elections/:id` | Voters: OTP sign-in, ballot, review, receipt |
| Receipt check | `/verify` | Anyone: confirm a receipt is in the ballot box |
| Public results | `/results`, `/results/:id` | Anyone, after an election is sealed |
| Admin | `/admin`, `/admin/elections/new`, `/admin/elections/:id/edit`, `/admin/users` | Administrators: build elections, import voters (CSV), open/close/seal, turnout, audit, verification, staff accounts |
| Observer | `/observer`, `/observer/elections/:id` | Observers: read-only turnout, audit trail, verification |
| Staff sign-in | `/staff` | Administrators and observers |

## Run it locally

```bash
# Start Postgres and Redis (or point DATABASE_URL/REDIS_URL at existing instances)
docker compose up -d postgres redis

# Install, build, test
npm install
npm run build
npm test            # core 12 + api 82

# Apply Prisma migrations (creates tables and immutability triggers)
cd apps/api && npx prisma migrate deploy && cd ../..

# API (port 3000)
cd apps/api
DATABASE_URL=postgresql://evote:evote_dev_only@localhost:5433/evote \
REDIS_URL=redis://localhost:6380 \
ADMIN_EMAIL=admin@uni.test ADMIN_PASSWORD='choose-a-long-password' \
OTP_ECHO=true SESSION_SECRET=any-long-random-string-here \
node dist/main.js

# Web (port 3001); /api/* is proxied to the API
cd apps/web
API_URL=http://localhost:3000 npx next start -p 3001
```

Then open http://localhost:3001/staff, sign in, create an election, import voters, open it, and vote from a private window at `/vote`.

For development with reload: `npm run start:dev -w @evote/api` and `npm run dev -w @evote/web`.

## Configuration

| Variable | Where | Notes |
| --- | --- | --- |
| `DATABASE_URL` | API | Postgres connection string. Required when `STORE=postgres`. |
| `STORE` | API | `memory` (default dev) or `postgres` (default production). `memory` is refused in production. |
| `REDIS_URL` | API | Redis connection string. Used for distributed rate-limiting and idempotency tracking. Required when `INSTANCES > 1` in production. |
| `INSTANCES` | API | Number of API replicas (default `1`). If `> 1` in production, `REDIS_URL` is strictly required. |
| `SESSION_SECRET` | API | Required in production. Must be ≥ 32 characters. Signs the session cookie. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | API | Seeds the first administrator (password ≥ 10 chars). In production no admin is created without them. Outside production a random password is logged if unset. |
| `NOTIFIER` | API | `console` (dev only), `smtp`, `sms`, or `both`. `console` is refused in production. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | API | Required when `NOTIFIER=smtp` or `NOTIFIER=both`. |
| `SMS_PROVIDER` | API | Required when `NOTIFIER=sms` or `NOTIFIER=both`. Supported: `termii`. |
| `TERMII_API_KEY`, `TERMII_SENDER_ID` | API | Required when `SMS_PROVIDER=termii`. |
| `OTP_ECHO` | API | `true` returns the one-time code in the response for demos. Refused in production. |
| `NO_RATE_LIMIT` | API | `true` relaxes rate limits in automated tests. Refused in production. |
| `TRUST_PROXY` | API | Set `1` when behind a load balancer so rate limits see real client IPs. |
| `PORT` | API | Default 3000. |
| `API_URL` | Web (build/start) | Where the web server forwards `/api/*`. Default `http://localhost:3000`. |

## Auth model

- **Voters** sign in with their register ID and a 6-digit code sent by email or SMS: 10-minute expiry, 5 attempts, 30-second resend cooldown, generic responses so nobody can probe who is on a register. OTP codes are stored only as `sha256(salt + code)` — plaintext is never persisted.
- **Staff** sign in with email and password (scrypt, min 10 characters). Roles: `ADMIN`, `OBSERVER`.
- Sessions are an HMAC-signed `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production) with server-side revocation on sign-out. State-changing requests also need the `x-evote-csrf` header, which the web app sends. Revocations are propagated to other API instances within 5 seconds via Postgres polling.
- Delivery goes through a `Notifier` port. Adapters: `ConsoleNotifier` (dev), `SmtpNotifier` (nodemailer), `SmsNotifier` (Termii; interface is generic for future providers), `MultiNotifier` (email if present, else SMS). Contact addresses and phone numbers are masked in all logs; OTP codes are never logged.

## API

| Method | Path | Role |
| --- | --- | --- |
| POST | `/auth/voter/request-otp`, `/auth/voter/verify-otp` | public, rate limited |
| POST | `/auth/staff/login`, `/auth/logout` | public / any |
| GET | `/auth/me` | any signed in |
| GET, POST | `/users` | admin |
| GET, POST | `/elections` | admin (observer can GET) |
| PUT | `/elections/:id` | admin, draft only |
| POST | `/elections/:id/duplicate` | admin |
| GET, DELETE | `/elections/:id` | admin, observer (DELETE: admin, draft only) |
| POST | `/elections/:id/voters` (`{csv}` or `{voters}`) | admin, draft only |
| GET | `/elections/:id/register` | admin, observer (contacts masked) |
| POST | `/elections/:id/open` `/close` `/seal` | admin |
| GET | `/elections/:id/turnout` `/results` `/audit` `/verify` | admin, observer (results only after seal) |
| GET | `/me/elections`, `/me/elections/:id` | voter |
| POST | `/elections/:id/cast` (`Idempotency-Key` header) | voter, rate limited |
| GET | `/public/elections`, `/public/elections/:id/results` | public, sealed only |
| GET | `/public/elections/:id/receipt/:code` | public, rate limited |
| GET | `/health` | public — liveness probe |
| GET | `/ready` | public — readiness probe (checks Postgres + Redis) |

Elections can open and close themselves at `opensAt` / `closesAt` (checked every 15 seconds). Sealing is always a manual administrator action.

## Anonymity rules (do not break these)

1. Ballots have no voter reference and no timestamp.
2. Participation records have no ballot reference.
3. Idempotency replays return no receipt, since storing voter-to-receipt would link voter to ballot.
4. Ballots are read back in hash order (`COLLATE "C"`), not insertion order.
5. The audit log records ballot hashes and counts, never voter IDs or choices.
6. Redis stores only rate-counter integers and idempotency tombstones (`'1'`). No receipts, ballot hashes, or choices are ever written to Redis.

## Deploy

### Quick start

```bash
cp .env.production.example .env.production
# Edit .env.production — fill in every CHANGE_ME value
# Update Caddyfile — replace example.com with your real domain

docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# Run database migrations (once, before first boot)
docker compose -f docker-compose.prod.yml exec api \
  node -e "require('./apps/api/dist/main').validateEnvironment()"

# Or run prisma migrate deploy directly:
DATABASE_URL="postgresql://..." npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

### How it works

`docker-compose.prod.yml` runs five services:

| Service | Image | Role |
| --- | --- | --- |
| `caddy` | `caddy:2-alpine` | Reverse proxy + automatic HTTPS (Let's Encrypt). Routes `/api/*` to the API; everything else to the web app. |
| `web` | built from `apps/web/Dockerfile` | Next.js portal. Serves all user-facing pages. |
| `api` | built from `apps/api/Dockerfile` | NestJS REST API. Only reachable via Caddy on the internal Docker network. |
| `postgres` | `postgres:16-alpine` | Primary datastore. Data persisted in a Docker volume. |
| `redis` | `redis:7-alpine` | Rate limiter and idempotency cache. Persistent snapshot every 60 seconds. |

### Health and readiness probes

- **GET /health** — always returns `{"status":"ok"}` if the process is running.
- **GET /ready** — returns `{"status":"ok","checks":{"postgres":"ok","redis":"ok"}}` when both dependencies are reachable. Returns `{"status":"degraded",...}` otherwise. Use this for load-balancer health checks.

## Backup and restore

### Backup Postgres

```bash
# Daily backup (run from host or a cron container)
docker exec evote-postgres-1 \
  pg_dump -U evote --format=custom evote \
  > backup-$(date +%F).pgdump

# Compress and store offsite (example: S3)
aws s3 cp backup-$(date +%F).pgdump s3://your-bucket/evote-backups/
```

### Restore Postgres

```bash
# Stop the api first to avoid write conflicts
docker compose -f docker-compose.prod.yml stop api

docker exec -i evote-postgres-1 \
  pg_restore -U evote -d evote --clean --if-exists < backup-YYYY-MM-DD.pgdump

docker compose -f docker-compose.prod.yml start api
```

### Verify the audit chain after restore

```bash
# From inside the api container or using the API's /elections/:id/audit endpoint:
curl -s -H "Cookie: evote_session=<admin-token>" \
  http://localhost:3000/elections/<election-id>/verify \
  | jq '{valid, ballotCount, auditEntries}'
```

The `/verify` endpoint replays the full hash chain from the genesis entry and
confirms that every ballot hash is accounted for. A `"valid": true` response
means the audit log has not been tampered with. Run this after every restore and
before certifying results.

To verify manually:

```bash
# 1. Export the audit log
curl -s .../elections/<id>/audit | jq '.chain' > chain.json

# 2. Replay hashes independently (Node.js):
node -e "
const c = require('./chain.json');
const { createHash } = require('crypto');
let prev = '';
for (const entry of c) {
  const digest = createHash('sha256').update(prev + JSON.stringify(entry.payload)).digest('hex');
  if (digest !== entry.hash) { console.error('CHAIN BROKEN at seq', entry.seq); process.exit(1); }
  prev = entry.hash;
}
console.log('Chain OK:', c.length, 'entries');
"
```

## Checked

- 12 core + 82 API tests (unit + integration) with Postgres and Redis.
- 22 notifier tests (fake SMTP server, mocked Termii endpoint, factory, production env guards).
- 6 Redis/in-memory rate-limit and idempotency tests.
- Multi-instance session revocation test (two PostgresAuthStorage instances, 5-second poll).
- E2E browser suite (Playwright): admin, voter, observer, security, a11y specs.
- `npm audit`: 0 vulnerabilities.
- Load test: not done (Stage D skipped).

## Known gaps before any real election

- External security review and legal sign-off (data protection, election law, accessibility).
- HawkScan / DAST scan (no `HAWK_API_KEY` in this environment).
- Load test with realistic concurrent voter volume.
- SMS fallback provider (Termii only; Africa's Talking can be added as a second `SmsProvider`).
- Audit-log / participation-order correlation by someone with direct DB access; mitigate with batched commits (roadmap).
- Multi-seat ranked (STV), nominations, disputes, kiosk mode, mobile app, Mode B cryptography: roadmap phases 3-5.
