FROM node:20-alpine

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=64"

# Install cron
RUN apk add --no-cache dcron

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-cache

COPY wakeup.js ./
COPY crontab /etc/crontabs/root

# Logs for cron
RUN touch /var/log/db-waker.log

# Start cron in foreground (important for Docker)
CMD ["crond", "-f", "-l", "2"]
