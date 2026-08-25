FROM node:20-slim

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=64"

# Install cron, pg_dump (postgres snapshots) and mongodump (mongodb snapshots)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates cron postgresql-client gnupg curl \
 && curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
 && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" > /etc/apt/sources.list.d/mongodb-org-7.0.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends mongodb-database-tools \
 && apt-get purge -y gnupg curl \
 && apt-get autoremove -y \
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

# Ensure databases.json directory exists (will be mounted as volume)
RUN mkdir -p /app && chmod 755 /app

# Local snapshot storage - mount this as a volume to persist backups across container restarts
RUN mkdir -p /app/backups

# Run cron in foreground (Debian-safe)
CMD ["cron", "-f"]
