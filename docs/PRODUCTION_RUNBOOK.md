# AI Radar production runbook

This runbook covers the parts that can be made reproducible in the repository. It does not claim that a public deployment, domain, SMTP account, or LLM provider exists until those external resources are configured.

## 1. Generate secrets

Create three independent values outside the repository:

- `POSTGRES_PASSWORD`: database password.
- `AI_RADAR_ADMIN_TOKEN`: one-time bootstrap and break-glass token.
- `AI_RADAR_JWT_SECRET`: at least 32 random bytes for access-token signing.

Also set:

```text
AI_RADAR_CORS_ORIGINS=https://your-frontend.example
AI_RADAR_FETCH_ALLOWED_HOSTS=openai.com,anthropic.com,ai.google.dev
```

Never expose the admin token or JWT secret through a `VITE_` variable.

## 2. Start PostgreSQL and the API

From the repository root:

```bash
docker compose --env-file .env.production up --build -d
docker compose ps
curl http://127.0.0.1:8000/health
```

The API container waits for PostgreSQL health, runs `alembic upgrade head`, starts as a non-root user, and exposes a container health check. The persistent database lives in the named `ai_radar_postgres` volume.

On the first application start, the version-controlled catalog seed initializes model families, concrete releases, graph relations, and timelines in PostgreSQL. Later additions are persistent records and are not overwritten on restart.

## 3. Bootstrap the first administrator

Bootstrap works only while the users table is empty:

```bash
curl -X POST http://127.0.0.1:8000/api/v2/auth/bootstrap \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $AI_RADAR_ADMIN_TOKEN" \
  -d '{"email":"admin@example.com","password":"replace-with-a-long-unique-password"}'
```

After the first user exists, the endpoint returns `409`. Create reviewers and additional users through `POST /api/v2/admin/users` using the returned Bearer token.

## 4. Connect the frontend

Build or deploy the frontend with:

```text
VITE_API_BASE_URL=https://api.your-domain.example
```

Public reads use `/api/snapshot`. The protected console is `/admin/review`; credentials are sent only to the API and the short-lived Bearer token is kept in `sessionStorage`. `/admin/review-demo` remains a clearly labelled read-only portfolio route.

Administrators can use the “扩展模型目录” section to add entities/releases, relations, and timeline events. Use a concrete release's `familyId` to attach it to a top-level model family. A verified relation or timeline event must carry at least one source id.

The current frontend build targets Cloudflare through the existing Lovable/TanStack configuration. Configure the `VITE_API_BASE_URL` build variable in the hosting project, then deploy the generated worker. A public deployment cannot be completed from this repository alone without access to the user's Cloudflare/Lovable project.

## 5. Schedule collection and digests

Run one due-source collection cycle:

```bash
python -m app.worker --once
```

Use the cloud scheduler or cron every 15–30 minutes; each source enforces its own 120–1440 minute interval. Collection is HTTPS-only, allowlist-only, blocks non-public IPs and redirects, limits response size, and honors ETag/Last-Modified.

Queue one daily digest cycle with an admin Bearer token:

```text
POST /api/v2/admin/digests/run
```

This creates auditable rows in `email_outbox`. After configuring the SMTP variables from `backend/.env.example`, deliver queued messages with `POST /api/v2/admin/email-outbox/send`. Without credentials, delivery returns `503` and queued messages remain intact.

## 6. Back up and restore

Example logical backup:

```bash
docker compose exec -T postgres pg_dump -U ai_radar -d ai_radar -Fc > ai-radar.dump
```

Test restores in a separate database before relying on them. Do not overwrite the production database during a restore drill.

## 7. Release gate

Before release:

```bash
python -m ruff format --check backend/app backend/tests backend/migrations
python -m ruff check backend/app backend/tests backend/migrations
python -m pytest backend/tests
npm run check
```

Then verify:

- `/health` reports the expected environment, database, and auth state.
- public snapshot contains no pending, rejected, or needs-more-evidence Claim.
- `/admin/review` rejects viewer accounts.
- one approved test candidate creates a publication record, audit entry, and follower notification.
- one test model version written through the admin catalog API appears in family versions, timeline, graph neighbors, and comparison reads.
- CORS lists only the real frontend origins.
- HTTPS termination, database backup, logs, alerting, and rollback are configured in the selected hosting platform.
