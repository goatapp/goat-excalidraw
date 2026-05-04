# Build stage
FROM node:25-alpine AS builder

RUN apk add --no-cache git bash

WORKDIR /app/frontend

# Copy package files first for better caching
COPY frontend/package*.json ./
COPY frontend/.excalidraw-commit ./
COPY frontend/scripts ./scripts/
COPY frontend/vendor* ./vendor/

# Build excalidraw from source if vendor tarballs don't exist
RUN if ! ls vendor/*.tgz >/dev/null 2>&1; then \
      bash scripts/build-excalidraw-from-source.sh --pack-only; \
    fi

# Install dependencies (strip integrity hashes for vendor tarballs that may differ)
RUN sed -i '/"resolved": "file:vendor\/excalidraw-/{n;s/"integrity": "sha512-[^"]*"/"integrity": ""/;}' package-lock.json && \
    npm install && npm cache clean --force

# Copy source code and config files
COPY frontend/ ./
COPY VERSION ../VERSION

# Build arguments
ARG VITE_APP_VERSION
ARG VITE_APP_BUILD_LABEL
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_APP_BUILD_LABEL=$VITE_APP_BUILD_LABEL

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy nginx config template (will be processed at runtime)
COPY frontend/nginx.conf.template /etc/nginx/nginx.conf.template

# Copy entrypoint script
COPY frontend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Copy built application from builder
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

# Use custom entrypoint to process nginx config template
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
