# Runs as root by design: the HA base image boots s6-overlay, which needs root to set
# up its supervision tree and the Supervisor-mounted volumes (/data, share, config).
# Adding a non-root USER breaks startup. (sonar docker:S6471 reviewed as Safe)
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.24
FROM ${BUILD_FROM}

RUN apk add --no-cache bash ca-certificates curl gcompat libc6-compat nodejs npm \
  && rm -rf /var/cache/apk/*

COPY rootfs /

# Ensure the service script is executable (unchanged)
RUN chmod +x /etc/services.d/luftujha/run

WORKDIR /usr/src/app

RUN apk add --no-cache --virtual .build-deps build-base linux-headers python3 \
  && npm ci --omit=dev \
  && apk del .build-deps

LABEL \
  io.hass.version="VERSION" \
  io.hass.type="addon" \
  io.hass.arch="armhf|aarch64|i386|amd64"
