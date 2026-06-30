#!/bin/sh
set -e

# --- Litestream defaults ---
export LITESTREAM_S3_PATH="${LITESTREAM_S3_PATH:-${S3_PREFIX:-excalidraw/}litestream}"
export LITESTREAM_SYNC_INTERVAL="${LITESTREAM_SYNC_INTERVAL:-30s}"
export LOG_LEVEL="${LOG_LEVEL:-warn}"
export LITESTREAM_SNAPSHOT_INTERVAL="${LITESTREAM_SNAPSHOT_INTERVAL:-24h}"
export LITESTREAM_RETENTION="${LITESTREAM_RETENTION:-72h}"
export S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-false}"
export AWS_REGION="${AWS_REGION:-us-east-1}"

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

# --- Restore database (before migrations, so restored DB gets migrated) ---
if [ "${LITESTREAM_ENABLED:-}" = "true" ]; then
    # Remove template DB so Litestream restore can provide the real one
    rm -f /app/prisma/dev.db /app/prisma/dev.db-wal /app/prisma/dev.db-shm
    chown nodejs:nodejs /app/prisma
    echo "Restoring database from Litestream replica..."
    if ! su-exec nodejs litestream restore -config /etc/litestream.yml /app/prisma/dev.db 2>&1; then
        echo "Litestream restore failed (no replica yet), trying legacy S3 snapshot..."
        if [ -n "${S3_BUCKET_NAME:-}" ]; then
            node /app/scripts/s3-sync.mjs --restore || echo "S3 restore also failed, starting fresh"
        else
            echo "No S3 bucket configured, starting fresh"
        fi
    fi
    # Verify restored database integrity
    if [ -f "/app/prisma/dev.db" ]; then
        echo "Verifying database integrity..."
        INTEGRITY=$(su-exec nodejs sqlite3 /app/prisma/dev.db "PRAGMA integrity_check;" 2>&1)
        if [ "$INTEGRITY" != "ok" ]; then
            echo "ERROR: Database integrity check failed: $INTEGRITY"
            echo "Attempting restore from older Litestream generations..."
            rm -f /app/prisma/dev.db /app/prisma/dev.db-wal /app/prisma/dev.db-shm
            RECOVERED=false
            GENERATIONS=$(su-exec nodejs litestream generations -config /etc/litestream.yml /app/prisma/dev.db 2>/dev/null | tail -n +2 | awk '{print $1}')
            for GEN in $GENERATIONS; do
                echo "Trying generation $GEN..."
                if su-exec nodejs litestream restore -config /etc/litestream.yml -generation "$GEN" /app/prisma/dev.db 2>&1; then
                    INTEGRITY=$(su-exec nodejs sqlite3 /app/prisma/dev.db "PRAGMA integrity_check;" 2>&1)
                    if [ "$INTEGRITY" = "ok" ]; then
                        echo "Successfully recovered from generation $GEN"
                        RECOVERED=true
                        break
                    fi
                    rm -f /app/prisma/dev.db /app/prisma/dev.db-wal /app/prisma/dev.db-shm
                fi
            done
            if [ "$RECOVERED" = "false" ]; then
                echo "All generations corrupt, starting fresh..."
                rm -f /app/prisma/dev.db /app/prisma/dev.db-wal /app/prisma/dev.db-shm
            fi
        fi
    fi
elif [ -n "${S3_BUCKET_NAME:-}" ]; then
    echo "Restoring data from S3..."
    node /app/scripts/s3-sync.mjs --restore || echo "S3 restore failed, continuing with local state"
fi

# --- Schema and migration bootstrap ---
if [ ! -f "/app/prisma/schema.prisma" ]; then
    echo "Mount appears empty (missing schema.prisma). Bootstrapping schema and migrations..."
else
    echo "Syncing schema and migrations from template..."
fi

mkdir -p /app/prisma/migrations
cp /app/prisma_template/schema.prisma /app/prisma/schema.prisma
cp -R /app/prisma_template/migrations/. /app/prisma/migrations/

# --- Fix permissions ---
echo "Fixing filesystem permissions..."
chown -R nodejs:nodejs /app/uploads
chown -R nodejs:nodejs /app/prisma
chmod 755 /app/uploads
chmod 600 "${JWT_SECRET_FILE}"
chmod 600 "${CSRF_SECRET_FILE}"

if [ -f "/app/prisma/dev.db" ]; then
    echo "Database file found, ensuring write permissions..."
    chmod 600 /app/prisma/dev.db
    [ -f "/app/prisma/dev.db-wal" ] && chmod 600 /app/prisma/dev.db-wal
    [ -f "/app/prisma/dev.db-shm" ] && chmod 600 /app/prisma/dev.db-shm
fi

# --- Run migrations ---
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

# --- Start S3 sync background process (skip if Litestream handles DB replication) ---
if [ -n "${S3_BUCKET_NAME:-}" ] && [ "${LITESTREAM_ENABLED:-}" != "true" ]; then
    echo "Starting S3 sync background process..."
    su-exec nodejs node /app/scripts/s3-sync.mjs &
fi

# --- Start application ---
if [ "${LITESTREAM_ENABLED:-}" = "true" ]; then
    echo "Starting application under Litestream replication..."
    exec su-exec nodejs litestream replicate -config /etc/litestream.yml -exec "node dist/index.js"
else
    echo "Starting application as nodejs..."
    exec su-exec nodejs node dist/index.js
fi
