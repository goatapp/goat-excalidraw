# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci && npm cache clean --force

COPY frontend/ ./
COPY VERSION ../VERSION

ARG VITE_APP_VERSION
ARG VITE_APP_BUILD_LABEL
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_APP_BUILD_LABEL=$VITE_APP_BUILD_LABEL

RUN npm run build

# Stage 2: Build backend
FROM node:20-alpine AS backend-builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY backend/package*.json ./
COPY backend/tsconfig.json ./

RUN npm ci && npm cache clean --force

COPY backend/prisma ./prisma/
RUN npx prisma generate

COPY backend/src ./src
RUN npx tsc

# Stage 3: Production
FROM node:20-alpine

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

COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/src/generated ./dist/generated

COPY --from=frontend-builder /app/frontend/dist ./public

COPY scripts/s3-sync.js ./scripts/s3-sync.js
COPY docker-entrypoint.combined.sh ./docker-entrypoint.combined.sh
RUN chmod +x docker-entrypoint.combined.sh

RUN mkdir -p /app/uploads /app/prisma

EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.combined.sh"]
