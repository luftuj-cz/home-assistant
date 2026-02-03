# Build Stage for Frontend
FROM oven/bun:1.1 AS frontend-builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install
COPY . .
RUN bun run build

# Final Stage
ARG BUILD_FROM
FROM ${BUILD_FROM}

ENV BUN_INSTALL="/opt/bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

RUN apk add --no-cache bash curl ca-certificates libc6-compat gcompat \
  && curl -fsSL https://bun.sh/install | bash \
  && ln -s ${BUN_INSTALL}/bin/bun /usr/local/bin/bun \
  && rm -rf /root/.bun/cache /var/cache/apk/*

COPY addon/rootfs /

# Copy built frontend from stage 1 to the target directory in stage 2
# The target directory is /usr/share/luftujha/www as per sync-dist.mjs
COPY --from=frontend-builder /app/dist /usr/share/luftujha/www

RUN chmod +x /etc/services.d/luftujha/run

WORKDIR /usr/src/app

RUN bun install
