FROM node:20-slim

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=64"

# Install cron
RUN apt-get update \
 && apt-get install -y --no-install-recommends cron \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY wake.js ./
COPY crontab /etc/cron.d/db-waker

# Permissions required by cron
RUN chmod 0644 /etc/cron.d/db-waker \
 && crontab /etc/cron.d/db-waker \
 && mkdir -p /var/log \
 && touch /var/log/db-waker.log

# Run cron in foreground (Debian-safe)
CMD ["cron", "-f"]
