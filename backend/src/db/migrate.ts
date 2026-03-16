import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = path.resolve("db/migrations");
const DEFAULT_CONNECT_RETRIES = 30;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function isRetryableConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH" ||
    code === "57P03"
  );
}

async function connectWithRetry(
  pool: pg.Pool,
  maxAttempts: number,
  delayMs: number
): Promise<pg.PoolClient> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await pool.connect();
    } catch (err) {
      lastError = err;
      if (!isRetryableConnectionError(err) || attempt === maxAttempts) {
        throw err;
      }

      const code = typeof err === "object" && err !== null
        ? String((err as { code?: unknown }).code ?? "unknown")
        : "unknown";
      console.warn(
        `Database not ready yet (attempt ${attempt}/${maxAttempts}, code=${code}). Retrying in ${delayMs}ms...`
      );
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to connect to database");
}

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

  const maxAttempts = readPositiveInt(
    process.env.MIGRATE_CONNECT_RETRIES,
    DEFAULT_CONNECT_RETRIES
  );
  const delayMs = readPositiveInt(
    process.env.MIGRATE_CONNECT_RETRY_DELAY_MS,
    DEFAULT_CONNECT_RETRY_DELAY_MS
  );

  const pool = new pg.Pool({ connectionString });
  const client = await connectWithRetry(pool, maxAttempts, delayMs);

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
