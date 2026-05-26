# Stage 1: Build frontend
FROM node:26-alpine AS frontend-builder

RUN apk add --no-cache git bash

WORKDIR /app/frontend

COPY frontend/package*.json ./
COPY frontend/.excalidraw-commit ./
COPY frontend/scripts ./scripts/
COPY frontend/vendor* ./vendor/
RUN if ! ls vendor/*.tgz >/dev/null 2>&1; then \
      bash scripts/build-excalidraw-from-source.sh --pack-only; \
    fi
RUN sed -i '/"resolved": "file:vendor\/excalidraw-/{n;s/"integrity": "sha512-[^"]*"/"integrity": ""/;}' package-lock.json && \
    npm install && npm cache clean --force

COPY frontend/ ./
COPY VERSION ../VERSION

ARG VITE_APP_VERSION=""
ARG CODEBUILD_BUILD_ID=""
ARG VITE_APP_BUILD_LABEL
ENV VITE_APP_BUILD_LABEL=$VITE_APP_BUILD_LABEL

RUN VERSION_FILE=$(cat ../VERSION) && \
    if [ -n "$VITE_APP_VERSION" ]; then \
      FINAL_VERSION="$VITE_APP_VERSION"; \
    elif [ -n "$CODEBUILD_BUILD_ID" ]; then \
      FINAL_VERSION="${VERSION_FILE}+build.$(date -u +%Y%m%d%H%M%S)"; \
    else \
      FINAL_VERSION="$VERSION_FILE"; \
    fi && \
    export VITE_APP_VERSION="$FINAL_VERSION" && \
    echo "$FINAL_VERSION" > ../VERSION && \
    npm run build

# Stage 2: Build backend
FROM node:26-alpine AS backend-builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY backend/package*.json ./
COPY backend/tsconfig.json ./
COPY backend/prisma.config.ts ./

RUN npm ci && npm cache clean --force

COPY backend/prisma ./prisma/
RUN DATABASE_URL="file:./prisma/dev.db" npx prisma generate

COPY backend/src ./src
RUN npx tsc

# Stage 3: Production
FROM node:26-alpine

RUN apk add --no-cache openssl su-exec && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

COPY backend/package*.json ./

RUN apk add --no-cache --virtual .build-deps python3 make g++ && \
    npm ci --omit=dev && \
    npm cache clean --force && \
    apk del .build-deps

COPY backend/prisma ./prisma/
COPY backend/prisma ./prisma_template/
COPY backend/prisma.config.ts ./

COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/src/generated ./dist/generated

COPY --from=frontend-builder /app/frontend/dist ./public
COPY --from=frontend-builder /app/VERSION ./VERSION

COPY scripts/s3-sync.mjs ./scripts/s3-sync.mjs
COPY docker-entrypoint.combined.sh ./docker-entrypoint.combined.sh
RUN chmod +x docker-entrypoint.combined.sh

RUN mkdir -p /app/uploads /app/prisma

EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.combined.sh"]
