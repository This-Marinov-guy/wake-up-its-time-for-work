import fs from "fs";
import pkg from "pg";
import { MongoClient } from "mongodb";

const { Client } = pkg;

// Read config - supports both Docker (/app/) and local paths
const configPath =
  process.env.DATABASES_CONFIG ||
  (fs.existsSync("/app/databases.json")
    ? "/app/databases.json"
    : "./databases.json");
const databases = JSON.parse(fs.readFileSync(configPath, "utf8"));

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
    await client.query("SELECT 1;");
    console.log(`[OK][Postgres] ${db.name}`);
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
    await client.db().command({ ping: 1 });
    console.log(`[OK][MongoDB] ${db.name}`);
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
  } else if (db.type === "mongodb") {
    await wakeMongo(db);
  } else {
    console.error(`[SKIP] Unknown type: ${db.type}`);
  }
}

process.exit(0);