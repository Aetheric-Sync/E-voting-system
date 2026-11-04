# E-Voting Platform

Multi-tenant e-voting for ~1M voters. Two integrity modes per election: **Anonymous + audit chain** (built) and **End-to-end verifiable** (contract fixed, Phase 5).

Design doc: see the "E-Voting Platform Architecture" doc.

## What is in the box

| Path | What | Status |
| --- | --- | --- |
| `packages/core` | Audit hash chain, integrity strategy contract, anonymous strategy, ranked-choice (instant runoff) tally, voter CSV parser | Built, 12 tests |
| `apps/api` | NestJS API: auth, election lifecycle, scheduler, casting, tally, audit, verification, public results | Built, 29 tests (unit + full-stack HTTP) |
| `apps/web` | Next.js app with every portal (below) | Built, driven end to end in a browser |
| `apps/mobile` | Expo app skeleton | Skeleton only, not installed or built |
| `apps/api/prisma/schema.prisma` | Target Postgres schema | Design only, not wired |

### Portals (`apps/web`)

| Portal | Path | Who |
| --- | --- | --- |
| Voter | `/vote`, `/vote/elections`, `/vote/elections/:id` | Voters: OTP sign-in, ballot, review, receipt |
| Receipt check | `/verify` | Anyone: confirm a receipt is in the ballot box |
| Public results | `/results`, `/results/:id` | Anyone, after an election is sealed |
| Admin | `/admin`, `/admin/elections/new`, `/admin/elections/:id`, `/admin/users` | Administrators: build elections, import voters (CSV), open/close/seal, turnout, audit, verification, staff accounts |
| Observer | `/observer`, `/observer/elections/:id` | Observers: read-only turnout, audit trail, verification |
| Staff sign-in | `/staff` | Administrators and observers |

## Run it locally

```bash
npm install
npm run build
npm test            # core 12 + api 29

# API (port 3000). OTP_ECHO shows one-time codes on screen: development only.
cd apps/api
ADMIN_EMAIL=admin@uni.test ADMIN_PASSWORD='choose-a-long-password' \
OTP_ECHO=true SESSION_SECRET=any-long-random-string node dist/main.js

# Web (port 3001); /api/* is proxied to the API so the session cookie is first-party
cd apps/web
API_URL=http://localhost:3000 npx next start -p 3001
```

Then open http://localhost:3001/staff, sign in, create an election, import voters, open it, and vote from a private window at `/vote`.

For development with reload: `npm run start:dev -w @evote/api` and `npm run dev -w @evote/web`.

## Configuration

| Variable | Where | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | API | Required in production. Signs the session cookie. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | API | Seeds the first administrator (min 10 characters). In production no admin is created without them. Outside production a random password is logged if unset. |
| `OTP_ECHO` | API | `true` returns the one-time code in the response so you can demo without email/SMS. The API refuses to start with it in production. |
| `TRUST_PROXY` | API | Set when running behind a load balancer so rate limits see real client IPs. |
| `PORT` | API | Default 3000. |
| `API_URL` | Web (build/start) | Where the web server forwards `/api/*`. Default `http://localhost:3000`. |

## Auth model

- **Voters** sign in with their register ID and a 6-digit code sent by email or SMS: 10-minute expiry, 5 attempts, 30-second resend cooldown, generic responses so nobody can probe who is on a register.
- **Staff** sign in with email and password (scrypt, min 10 characters). Roles: `ADMIN`, `OBSERVER`.
- Sessions are an HMAC-signed `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production) with server-side revocation on sign-out. State-changing requests also need the `x-evote-csrf` header, which the web app sends.
- Delivery goes through a `Notifier` port. The console notifier is for development and refuses to run in production: plug in your email/SMS provider.

## API

| Method | Path | Role |
| --- | --- | --- |
| POST | `/auth/voter/request-otp`, `/auth/voter/verify-otp` | public, rate limited |
| POST | `/auth/staff/login`, `/auth/logout` | public / any |
| GET | `/auth/me` | any signed in |
| GET, POST | `/users` | admin |
| GET, POST | `/elections` | admin (observer can GET) |
| GET, DELETE | `/elections/:id` | admin, observer (DELETE: admin, draft only) |
| POST | `/elections/:id/voters` (`{csv}` or `{voters}`) | admin, draft only |
| GET | `/elections/:id/register` | admin, observer (contacts masked) |
| POST | `/elections/:id/open` `/close` `/seal` | admin |
| GET | `/elections/:id/turnout` `/results` `/audit` `/verify` | admin, observer (results only after seal) |
| GET | `/me/elections`, `/me/elections/:id` | voter |
| POST | `/elections/:id/cast` (`Idempotency-Key` header) | voter, rate limited |
| GET | `/public/elections`, `/public/elections/:id/results` | public, sealed only |
| GET | `/public/elections/:id/receipt/:code` | public, rate limited |

Elections can open and close themselves at `opensAt` / `closesAt` (checked every 15 seconds, and casting enforces the window). Sealing is always a manual administrator action.

## Anonymity rules (do not break these)

1. Ballots have no voter reference and no timestamp.
2. Participation records have no ballot reference.
3. Idempotency replays return no receipt, since storing voter-to-receipt would link voter to ballot.
4. Ballots are read back in hash order, not insertion order.
5. The audit log records ballot hashes and counts, never voter IDs or choices.

## Checked so far

- 41 automated tests (core and API, including full-stack HTTP over a real Nest app).
- A full election driven in a real browser: staff sign-in, builder, CSV import, open, three voters casting (single choice and ranked), receipt checks, close, seal, verification, public results, observer account with read-only access, role blocking, and no horizontal scroll at 375 px.
- `npm audit`: 0 vulnerabilities.
- Not done: HawkScan DAST (no `HAWK_API_KEY` in this environment), load testing, accessibility audit with assistive technology, external security review.

## Known gaps before any real election

- **In-memory store.** Restarting the API loses everything. Swap in a Postgres `VoteStore` (serializable transaction for `commitVote`); the schema is drafted.
- Idempotency, OTP and rate-limit state are per process; move them to Redis before running more than one API instance.
- Email/SMS provider for the `Notifier` port.
- Audit-log order and participation order can still be correlated by someone with database access; mitigate with batched commits.
- Multi-seat ranked (STV), nominations, disputes, kiosk mode, the mobile app and Mode B cryptography are roadmap phases 3-5.
- External security review and legal sign-off are required before binding use.
