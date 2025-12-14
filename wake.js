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
    
    // Fetch 10 rows from each table
    for (const table of tables) {
      try {
        await client.query(`SELECT * FROM "${table}" LIMIT 10`);
        console.log(`[OK][Postgres] ${db.name} - fetched from table: ${table}`);
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
    
    // Fetch 10 documents from each collection
    for (const collectionName of collectionsToQuery) {
      try {
        const collection = mongoDb.collection(collectionName);
        await collection.find({}).limit(10).toArray();
        console.log(`[OK][MongoDB] ${db.name} - fetched from collection: ${collectionName}`);
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
  } else if (db.type === "mongodb") {
    await wakeMongo(db);
  } else {
    console.error(`[SKIP] Unknown type: ${db.type}`);
  }
}

process.exit(0);