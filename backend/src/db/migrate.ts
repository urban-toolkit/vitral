import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = path.resolve("db/migrations");

async function ensureMigrationsTable(client: pg.PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(client: pg.PoolClient): Promise<Set<string>> {
  const res = await client.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations`
  );
  return new Set(res.rows.map((r) => r.filename));
}

function getMigrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // lexical sort = order
}

async function runMigration(
  client: pg.PoolClient,
  filename: string
) {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filePath, "utf8");

  console.log(`→ Applying migration ${filename}`);

  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (filename) VALUES ($1)`,
      [filename]
    );
    await client.query("COMMIT");
    console.log(`Migration applied ${filename}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`Migration failed ${filename}`);
    throw err;
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL");
  }

  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();

  try {
    console.log("Running migrations…");

    await ensureMigrationsTable(client);

    const applied = await getAppliedMigrations(client);
    const files = getMigrationFiles();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`Skipping already applied migration ${file}`);
        continue;
      }
      await runMigration(client, file);
    }

    console.log("All migrations complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
