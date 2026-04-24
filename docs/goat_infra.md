# GOAT Infrastructure Deployment

Excalidraw is deployed to GOAT's AWS ECS infrastructure as a single combined container (frontend + backend on port 8000). SQLite is used for persistence with periodic S3 backups.

## Architecture

```
                    ┌─────────────────────────────────┐
  SSO Proxy ──────► │  ECS Container (port 8000)      │
  (X-Forwarded-     │                                 │
   Email header)    │  Express serves:                │
                    │    /           → static frontend │
                    │    /api/*     → backend routes   │
                    │    /socket.io → WebSocket        │
                    │    /health    → healthcheck      │
                    │                                 │
                    │  Background:                    │
                    │    s3-sync.js → periodic backup  │
                    └──────────┬──────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   S3 Bucket         │
                    │   excalidraw/       │
                    │     dev.db          │
                    │     uploads/        │
                    └─────────────────────┘
```

The container runs behind GOAT's envoy service mesh and an upstream SSO proxy. There is no nginx — Express handles static files, API routing, and WebSocket connections on a single port.

## Key Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Combined multi-stage build (frontend + backend) |
| `docker-entrypoint.combined.sh` | Startup: S3 restore, migrations, S3 sync, app |
| `scripts/s3-sync.js` | S3 backup/restore with checksum and mtime optimization |
| `docker-compose.combined.yml` | Local development with the combined container |
| `buildspec.yml` | GOAT CodeBuild spec (reference only; cabra injects its own) |

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | SQLite path (default: `file:/app/prisma/dev.db`) |
| `JWT_SECRET` | 32+ char secret for JWT signing (via Parameter Store in GOAT) |
| `CSRF_SECRET` | Secret for CSRF token generation (via Parameter Store in GOAT) |
| `FRONTEND_URL` | App origin for CORS (e.g., `https://excalidraw.staging.goateng.com`) |

### Auth

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_MODE` | `local` | Auth mode: `local`, `hybrid`, `oidc_enforced`, or `proxy` |
| `PROXY_AUTH_HEADER` | `x-forwarded-email` | Header containing authenticated email (proxy mode) |
| `PROXY_ADMIN_EMAILS` | _(empty)_ | Comma-separated emails that get ADMIN role (proxy mode) |

### S3 Sync

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_BUCKET_NAME` | _(required for sync)_ | S3 bucket for backups (via `resource_reference` in GOAT) |
| `S3_SYNC_INTERVAL_MS` | `300000` | Sync interval in ms (5 minutes) |
| `S3_PREFIX` | `excalidraw/` | Key prefix within the S3 bucket |

### Other

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8000` | Server port |
| `NODE_ENV` | `development` | Set to `production` in GOAT |
| `TRUST_PROXY` | `false` | Set to `1` when behind GOAT load balancer |
| `ENFORCE_HTTPS_REDIRECT` | `true` | Set to `false` in GOAT (TLS terminated upstream) |
| `UPDATE_CHECK_OUTBOUND` | `true` | Set to `false` in GOAT (no egress for GitHub API) |
| `RUN_MIGRATIONS` | `true` | Run Prisma migrations on startup |

## goat-services Configuration

https://github.com/goatapp/goat-services/tree/master/apps/goat-excalidraw
https://github.com/goatapp/goat-services/tree/master/sites/goat-excalidraw

## Constraints

- **Single replica only.** SQLite does not support concurrent access from multiple containers. Scaling must be `min: 1, max: 1`.
- **No pre-deploy tasks.** Prisma migrations run in the container entrypoint because the SQLite database is local to the container filesystem. A GOAT `release.pre_task` would run against an ephemeral copy.
- **S3 sync data loss window.** Up to `S3_SYNC_INTERVAL_MS` of data can be lost if the container crashes between syncs. The sync process runs a final upload on graceful shutdown (`SIGTERM`).

## S3 Sync Details

Data is stored under the configured prefix (default `excalidraw/`):

```
s3://<bucket>/excalidraw/dev.db          # SQLite database snapshot
s3://<bucket>/excalidraw/uploads/        # User-uploaded files
```

Optimizations to reduce unnecessary S3 API calls:
- **Database:** SHA-256 checksum compared before upload. Skipped if unchanged.
- **Uploads:** File mtime + size tracked in a local manifest (`/app/prisma/.s3-sync-manifest.json`). Only changed files are uploaded.

## Local Development

Run the combined container locally:

```bash
docker compose -f docker-compose.combined.yml up --build
```

Then open http://localhost:8000. S3 sync is automatically skipped when `S3_BUCKET_NAME` is not set.

To test with proxy auth:

```bash
AUTH_MODE=proxy docker compose -f docker-compose.combined.yml up --build

# In another terminal:
curl -H "X-Forwarded-Email: you@example.com" http://localhost:8000/api/auth/me
```

The original `docker-compose.yml` and `make dev` still work for the two-container local dev setup with hot reload.
