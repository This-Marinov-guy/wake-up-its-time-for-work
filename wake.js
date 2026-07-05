import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import pkg from "pg";
import { MongoClient } from "mongodb";

const { Client } = pkg;
const execFileAsync = promisify(execFile);

// Helper function to add delays between queries
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Read config - supports both Docker (/app/) and local paths
const configPath =
  process.env.DATABASES_CONFIG ||
  (fs.existsSync("/app/databases.json")
    ? "/app/databases.json"
    : "./databases.json");
const databases = JSON.parse(fs.readFileSync(configPath, "utf8"));

// Snapshots are stored outside the repo - supports both Docker (/app/) and local paths
const snapshotsBaseDir =
  process.env.SNAPSHOTS_DIR ||
  (fs.existsSync("/app/databases.json") ? "/app/backups" : "./backups");

// How many days between snapshots for each supported frequency
const FREQUENCY_DAYS = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 91,
  "semi-annually": 182,
  annually: 365,
};

const DEFAULT_MAX_SNAPSHOTS = 10;
const DEFAULT_FREQUENCY = "monthly";

const getSnapshotIntervalDays = (snapshot) => {
  if (snapshot.intervalDays) return snapshot.intervalDays;
  const days = FREQUENCY_DAYS[snapshot.frequency];
  if (days === undefined) {
    console.error(
      `[SNAPSHOT][WARN] Unknown frequency "${snapshot.frequency}", falling back to "${DEFAULT_FREQUENCY}"`
    );
    return FREQUENCY_DAYS[DEFAULT_FREQUENCY];
  }
  return days;
};

const listSnapshots = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((file) => {
      const fullPath = path.join(dir, file);
      return { file, fullPath, mtime: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime);
};

const isSnapshotDue = (dir, intervalDays) => {
  const snapshots = listSnapshots(dir);
  if (snapshots.length === 0) return true;
  const last = snapshots[snapshots.length - 1];
  const ageDays = (Date.now() - last.mtime) / (1000 * 60 * 60 * 24);
  return ageDays >= intervalDays;
};

// Deletes the oldest snapshots once we're over the configured max, so disk usage stays bounded
const pruneSnapshots = (dir, maxSnapshots) => {
  const snapshots = listSnapshots(dir);
  const excess = snapshots.length - maxSnapshots;
  for (let i = 0; i < excess; i++) {
    fs.unlinkSync(snapshots[i].fullPath);
    console.log(`[SNAPSHOT] ${path.basename(dir)} - removed oldest snapshot: ${snapshots[i].file}`);
  }
};

// Runs `dumpFn(dir, timestamp) -> filePath` when the configured snapshot is due, then prunes old ones
const runSnapshot = async (db, dumpFn) => {
  const snapshot = db.snapshot;
  if (!snapshot || snapshot.enabled === false) return;

  const dir = path.join(snapshotsBaseDir, snapshot.dir || db.name);
  fs.mkdirSync(dir, { recursive: true });

  const intervalDays = getSnapshotIntervalDays(snapshot);
  if (!isSnapshotDue(dir, intervalDays)) {
    console.log(`[SNAPSHOT] ${db.name} - not due yet (every ${intervalDays}d)`);
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  let outFile;
  try {
    outFile = await dumpFn(dir, timestamp);
    console.log(`[SNAPSHOT][OK] ${db.name} -> ${outFile}`);
  } catch (err) {
    console.error(`[SNAPSHOT][ERROR] ${db.name}: ${err.message}`);
    return;
  }

  pruneSnapshots(dir, snapshot.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS);
};

const dumpPostgres = (db) => async (dir, timestamp) => {
  const outFile = path.join(dir, `${db.name}-${timestamp}.dump`);
  await execFileAsync(
    "pg_dump",
    [
      "-h", db.host,
      "-p", String(db.port),
      "-U", db.user,
      "-d", db.database,
      "-Fc",
      "-f", outFile,
    ],
    {
      env: {
        ...process.env,
        PGPASSWORD: db.password,
        PGSSLMODE: db.ssl ? "require" : "prefer",
      },
      maxBuffer: 1024 * 1024 * 100,
    }
  );
  return outFile;
};

const dumpMongo = (db) => async (dir, timestamp) => {
  const outFile = path.join(dir, `${db.name}-${timestamp}.archive.gz`);
  await execFileAsync(
    "mongodump",
    ["--uri", db.uri, `--archive=${outFile}`, "--gzip"],
    { maxBuffer: 1024 * 1024 * 100 }
  );
  return outFile;
};

const wakePostgres = async (db) => {
  const client = new Client({
    host: db.host,
    port: db.port,
    database: db.database,
    user: db.user,
    password: db.password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  });

  // Prevent unhandled error crashes from pooler disconnect
  client.on("error", (err) => {
    console.error(`[WARN][Postgres] ${db.name} client error: ${err.message}`);
  });

  try {
    await client.connect();
    
    // Get up to 3 tables from the database
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      LIMIT 3
    `);
    
    const tables = tablesResult.rows.map(row => row.table_name);
    
    if (tables.length === 0) {
      console.log(`[OK][Postgres] ${db.name} (no tables found)`);
      return;
    }
    
    // Fetch 10 rows from each table with delays to keep connection active
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      try {
        await client.query(`SELECT * FROM "${table}" LIMIT 10`);
        console.log(`[OK][Postgres] ${db.name} - fetched from table: ${table}`);
        // Add 2 second delay between queries to keep connection active
        if (i < tables.length - 1) {
          await sleep(2000);
        }
      } catch (tableErr) {
        console.error(`[WARN][Postgres] ${db.name} - failed to fetch from table ${table}: ${tableErr.message}`);
      }
    }
    
    console.log(`[OK][Postgres] ${db.name} (queried ${tables.length} table(s))`);
  } catch (err) {
    console.error(`[ERROR][Postgres] ${db.name}: ${err.message}`);
  } finally {
    try {
      await client.end();
    } catch (e) {
      // Ignore close errors
    }
  }
};

const wakeMongo = async (db) => {
  const client = new MongoClient(db.uri, {
    connectTimeoutMS: 30000,
    serverSelectionTimeoutMS: 30000,
    maxPoolSize: 1,
    minPoolSize: 0,
  });

  try {
    await client.connect();
    const mongoDb = client.db();
    
    // Get up to 3 collections
    const collections = await mongoDb.listCollections().toArray();
    const collectionsToQuery = collections.slice(0, 3).map(col => col.name);
    
    if (collectionsToQuery.length === 0) {
      console.log(`[OK][MongoDB] ${db.name} (no collections found)`);
      return;
    }
    
    // Fetch 10 documents from each collection with delays to keep connection active
    for (let i = 0; i < collectionsToQuery.length; i++) {
      const collectionName = collectionsToQuery[i];
      try {
        const collection = mongoDb.collection(collectionName);
        await collection.find({}).limit(10).toArray();
        console.log(`[OK][MongoDB] ${db.name} - fetched from collection: ${collectionName}`);
        // Add 2 second delay between queries to keep connection active
        if (i < collectionsToQuery.length - 1) {
          await sleep(2000);
        }
      } catch (collectionErr) {
        console.error(`[WARN][MongoDB] ${db.name} - failed to fetch from collection ${collectionName}: ${collectionErr.message}`);
      }
    }
    
    console.log(`[OK][MongoDB] ${db.name} (queried ${collectionsToQuery.length} collection(s))`);
  } catch (err) {
    console.error(`[ERROR][MongoDB] ${db.name}: ${err.message}`);
  } finally {
    try {
      await client.close(true);
    } catch (e) {
      // Ignore close errors
    }
  }
};

// Run sequentially for lowest memory usage
for (const db of databases) {
  if (db.type === "postgres") {
    await wakePostgres(db);
    await runSnapshot(db, dumpPostgres(db));
  } else if (db.type === "mongodb") {
    await wakeMongo(db);
    await runSnapshot(db, dumpMongo(db));
  } else {
    console.error(`[SKIP] Unknown type: ${db.type}`);
  }
}

process.exit(0);