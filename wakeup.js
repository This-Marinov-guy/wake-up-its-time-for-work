import fs from 'fs';
import pkg from 'pg';
import { MongoClient } from 'mongodb';

const { Client } = pkg;

// Read config
const databases = JSON.parse(
  fs.readFileSync('/app/databases.json', 'utf8')
);

const wakePostgres = async (db) => {
  const client = new Client({
    host: db.host,
    port: db.port,
    database: db.database,
    user: db.user,
    password: db.password,
    ssl: { rejectUnauthorized: false }, // Supabase-friendly
    connectionTimeoutMillis: 5000
  });

  try {
    await client.connect();
    await client.query('SELECT 1;');
    console.log(`[OK][Postgres] ${db.name}`);
  } catch (err) {
    console.error(`[ERROR][Postgres] ${db.name}: ${err.message}`);
  } finally {
    await client.end();
  }
};

const wakeMongo = async (db) => {
  const client = new MongoClient(db.uri, {
    connectTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 1,
    minPoolSize: 0
  });

  try {
    await client.connect();
    await client.db().command({ ping: 1 });
    console.log(`[OK][MongoDB] ${db.name}`);
  } catch (err) {
    console.error(`[ERROR][MongoDB] ${db.name}: ${err.message}`);
  } finally {
    await client.close(true);
  }
};

// Run sequentially for lowest memory usage
for (const db of databases) {
  if (db.type === 'postgres') {
    await wakePostgres(db);
  } else if (db.type === 'mongodb') {
    await wakeMongo(db);
  } else {
    console.error(`[SKIP] Unknown type: ${db.type}`);
  }
}

// Explicit exit so container dies and frees memory
process.exit(0);