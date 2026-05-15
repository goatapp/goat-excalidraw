#!/bin/sh
set -e

JWT_SECRET_FILE="/app/prisma/.jwt_secret"
CSRF_SECRET_FILE="/app/prisma/.csrf_secret"
MIGRATION_LOCK_DIR="/app/prisma/.migration-lock"
MIGRATION_LOCK_TIMEOUT_SECONDS="${MIGRATION_LOCK_TIMEOUT_SECONDS:-120}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"

# --- JWT secret resolution ---
if [ -z "${JWT_SECRET:-}" ]; then
    echo "JWT_SECRET not provided, resolving persisted secret..."
    if [ -f "${JWT_SECRET_FILE}" ]; then
        JWT_SECRET="$(tr -d '\r\n' < "${JWT_SECRET_FILE}")"
    fi
    if [ -z "${JWT_SECRET}" ]; then
        echo "No persisted JWT secret found. Generating a new secret..."
        JWT_SECRET="$(openssl rand -hex 32)"
        umask 077
        printf "%s" "${JWT_SECRET}" > "${JWT_SECRET_FILE}"
    fi
else
    umask 077
    printf "%s" "${JWT_SECRET}" > "${JWT_SECRET_FILE}"
fi
export JWT_SECRET

# --- CSRF secret resolution ---
if [ -z "${CSRF_SECRET:-}" ]; then
    echo "CSRF_SECRET not provided, resolving persisted secret..."
    if [ -f "${CSRF_SECRET_FILE}" ]; then
        CSRF_SECRET="$(tr -d '\r\n' < "${CSRF_SECRET_FILE}")"
    fi
    if [ -z "${CSRF_SECRET}" ]; then
        echo "No persisted CSRF secret found. Generating a new secret..."
        CSRF_SECRET="$(openssl rand -base64 32)"
        umask 077
        printf "%s" "${CSRF_SECRET}" > "${CSRF_SECRET_FILE}"
    fi
else
    umask 077
    printf "%s" "${CSRF_SECRET}" > "${CSRF_SECRET_FILE}"
fi
export CSRF_SECRET

# --- Schema and migration bootstrap (always runs first) ---
if [ ! -f "/app/prisma/schema.prisma" ]; then
    echo "Mount appears empty (missing schema.prisma). Bootstrapping schema and migrations..."
else
    echo "Syncing schema and migrations from template..."
fi

rm -rf /app/prisma/migrations
mkdir -p /app/prisma/migrations
cp /app/prisma_template/schema.prisma /app/prisma/schema.prisma
if [ -d "/app/prisma_template/migrations" ]; then
    cp -R /app/prisma_template/migrations/. /app/prisma/migrations/
fi

# --- Fix permissions ---
echo "Fixing filesystem permissions..."
chown -R nodejs:nodejs /app/uploads
chown -R nodejs:nodejs /app/prisma
chmod 755 /app/uploads
chmod 600 "${JWT_SECRET_FILE}"
chmod 600 "${CSRF_SECRET_FILE}"

# --- One-time SQLite → PostgreSQL data migration ---
if [ "${MIGRATE_FROM_SQLITE}" = "true" ]; then
    echo "=== SQLite to PostgreSQL Migration ==="

    if [ -z "${S3_BUCKET_NAME:-}" ]; then
        echo "ERROR: MIGRATE_FROM_SQLITE=true but S3_BUCKET_NAME is not set."
        echo "Cannot download SQLite backup without S3 configuration."
        exit 1
    fi

    echo "Downloading SQLite backup from S3..."
    su-exec nodejs node /app/scripts/s3-restore-db.mjs

    echo "Running database migrations..."
    su-exec nodejs npx prisma migrate deploy

    echo "Copying data from SQLite to PostgreSQL..."
    su-exec nodejs node /app/scripts/migrate-sqlite-to-pg.mjs

    echo "=== Migration complete. Remove MIGRATE_FROM_SQLITE env var for future deploys. ==="
fi

# --- Run migrations (normal path) ---
if [ "${MIGRATE_FROM_SQLITE}" != "true" ]; then
    if [ "${RUN_MIGRATIONS}" = "true" ] || [ "${RUN_MIGRATIONS}" = "1" ]; then
        echo "Running database migrations..."

        lock_waited=0
        while ! mkdir "${MIGRATION_LOCK_DIR}" 2>/dev/null; do
            if [ "${lock_waited}" -ge "${MIGRATION_LOCK_TIMEOUT_SECONDS}" ]; then
                echo "Timed out waiting for migration lock after ${MIGRATION_LOCK_TIMEOUT_SECONDS}s"
                exit 1
            fi
            lock_waited=$((lock_waited + 1))
            sleep 1
        done

        trap 'rmdir "${MIGRATION_LOCK_DIR}" 2>/dev/null || true' EXIT INT TERM
        su-exec nodejs npx prisma migrate deploy
        rmdir "${MIGRATION_LOCK_DIR}" 2>/dev/null || true
        trap - EXIT INT TERM
    else
        echo "Skipping database migrations (RUN_MIGRATIONS=${RUN_MIGRATIONS})"
    fi

    # --- Safety guard: detect empty database that should have been migrated from SQLite ---
    if [ -n "${S3_BUCKET_NAME:-}" ] && [ "${SKIP_EMPTY_DB_CHECK}" != "true" ]; then
        USER_COUNT=$(su-exec nodejs node -e "
            import { PrismaClient } from './dist/generated/client/client.js';
            import { PrismaPg } from '@prisma/adapter-pg';
            const adapter = new PrismaPg(process.env.DATABASE_URL);
            const p = new PrismaClient({ adapter });
            p.user.count().then(c => { console.log(c); return p.\$disconnect(); }).catch(() => { console.log('0'); p.\$disconnect(); });
        " 2>/dev/null || echo "0")
        if [ "${USER_COUNT}" = "0" ]; then
            echo ""
            echo "WARNING: PostgreSQL database has no users but S3_BUCKET_NAME is set."
            echo "If you are migrating from SQLite, set MIGRATE_FROM_SQLITE=true and redeploy."
            echo "If you intend to start fresh, set SKIP_EMPTY_DB_CHECK=true to suppress this warning."
            echo ""
        fi
    fi
fi

# --- Start application ---
echo "Starting application as nodejs..."
exec su-exec nodejs node dist/index.js
