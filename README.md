# wake-up-its-time-for-work

A database "waker" that keeps PostgreSQL and MongoDB databases awake by periodically connecting to them.

## Setup

1. Copy the example config file:
   ```bash
   cp databases.example.json databases.json
   ```

2. Edit `databases.json` with your database credentials.

3. Install dependencies:
   ```bash
   npm install
   ```

## Running Locally

Run the script directly:
```bash
node wakeup.js
```

Or set a custom config path:
```bash
DATABASES_CONFIG=/path/to/databases.json node wakeup.js
```

## Snapshots (optional)

Add a `snapshot` object to any database entry in `databases.json` to have a full local backup taken whenever that database is scanned (subject to the configured frequency). Snapshots use `pg_dump` (Postgres/Supabase, custom format `-Fc`) or `mongodump` (MongoDB, gzip archive), so both tools must be available on `PATH` when running locally - they're already installed in the Docker image.

```json
{
  "type": "postgres",
  "name": "supabase-prod",
  "...": "...",
  "snapshot": {
    "enabled": true,
    "frequency": "weekly",
    "maxSnapshots": 8
  }
}
```

Options:

| Field | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Set to `false` to keep the block but skip snapshots. |
| `frequency` | `"monthly"` | One of `daily`, `weekly`, `biweekly`, `monthly`, `quarterly`, `semi-annually`, `annually`. |
| `intervalDays` | - | Overrides `frequency` with an exact number of days. |
| `maxSnapshots` | `10` | Oldest snapshot is deleted once this many are stored for the database. |
| `dir` | database `name` | Subfolder name under the snapshots directory, in case you want it to differ from `name`. |

A snapshot only runs once the configured interval has elapsed since the most recent one on disk, so it's safe to leave `snapshot` on every entry and run the waker as often as you like.

Snapshots are written to `./backups/<name>` locally, or `/app/backups/<name>` in Docker (never committed to git). Override the base directory with the `SNAPSHOTS_DIR` env var. When running in Docker, mount a host directory to `/app/backups` so backups survive container recreation:

```bash
docker run -d \
  --name db-waker \
  -v $(pwd)/databases.json:/app/databases.json:ro \
  -v $(pwd)/backups:/app/backups \
  db-waker
```

## Running with Docker

1. Build the Docker image:
   ```bash
   docker build -t db-waker .
   ```

2. Run the container (with databases.json mounted):
   ```bash
   docker run -d \
     --name db-waker \
     -v $(pwd)/databases.json:/app/databases.json:ro \
     db-waker
   ```

   The container runs a cron job that wakes databases every 3 days at 03:00.

3. To run manually (one-time execution):
   ```bash
   docker exec -it db-waker node /app/wakeup.js
   ```

4. To view logs:
   ```bash
   docker exec -it db-waker cat /var/log/db-waker.log
   ```
