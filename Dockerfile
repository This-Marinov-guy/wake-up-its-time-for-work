FROM node:20-alpine

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=64"

RUN apk add --no-cache dcron

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-cache

COPY wake.js ./
COPY crontab /etc/crontabs/root

# Required for cron + volume mount
RUN mkdir -p /var/log

CMD ["crond", "-f", "-l", "2"]
