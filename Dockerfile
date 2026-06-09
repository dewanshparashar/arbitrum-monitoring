FROM node:20-bookworm-slim AS base

WORKDIR /app

COPY package.json yarn.lock tsconfig.base.json ./
COPY packages ./packages
COPY docs ./docs
COPY deploy ./deploy
COPY README.md ./

RUN yarn install --frozen-lockfile
RUN chmod +x deploy/docker/start-indexer.sh deploy/docker/start-api.sh deploy/docker/start-web.sh

FROM base AS monitor-indexer

ENV PONDER_TELEMETRY_DISABLED=1

CMD ["./deploy/docker/start-indexer.sh"]

FROM base AS monitor-api

RUN yarn workspace monitor-api build

CMD ["./deploy/docker/start-api.sh"]

FROM base AS monitor-web

RUN yarn workspace monitor-web build

CMD ["./deploy/docker/start-web.sh"]
