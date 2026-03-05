ARG BUILD_FROM
FROM ${BUILD_FROM}

RUN apk add --no-cache bash curl ca-certificates libc6-compat gcompat nodejs npm \
  && rm -rf /var/cache/apk/*

COPY rootfs /

RUN chmod +x /etc/services.d/luftujha/run

WORKDIR /usr/src/app

RUN npm ci --omit=dev

# Labels
LABEL \
  io.hass.version="VERSION" \
  io.hass.type="addon" \
  io.hass.arch="armhf|aarch64|i386|amd64"
