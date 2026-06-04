FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json yarn.lock ./
COPY packages ./packages
COPY config.example.json ./config.example.json

RUN yarn install --frozen-lockfile
RUN yarn workspace monitor-api build
RUN yarn workspace monitor-worker build
RUN yarn workspace monitor-web build

COPY docker/run-service.sh /app/docker/run-service.sh

CMD ["/bin/sh", "/app/docker/run-service.sh"]
