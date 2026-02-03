ARG BUILD_FROM
FROM ${BUILD_FROM}

ENV BUN_INSTALL="/opt/bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

RUN apk add --no-cache bash curl ca-certificates libc6-compat gcompat \
  && curl -fsSL https://bun.sh/install | bash \
  && ln -s ${BUN_INSTALL}/bin/bun /usr/local/bin/bun \
  && rm -rf /root/.bun/cache /var/cache/apk/*

COPY rootfs /

RUN chmod +x /etc/services.d/luftujha/run

WORKDIR /usr/src/app

RUN bun install
