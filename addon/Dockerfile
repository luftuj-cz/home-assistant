ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.19
FROM ${BUILD_FROM}

RUN apk add --no-cache bash ca-certificates curl gcompat libc6-compat nodejs npm \
  && rm -rf /var/cache/apk/*

COPY rootfs /

RUN chmod +x /etc/services.d/luftujha/run

WORKDIR /usr/src/app

RUN apk add --no-cache --virtual .build-deps build-base python3 \
  && npm ci --omit=dev \
  && apk del .build-deps

# Labels
LABEL \
  io.hass.version="VERSION" \
  io.hass.type="addon" \
  io.hass.arch="armhf|aarch64|i386|amd64"
