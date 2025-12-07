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
