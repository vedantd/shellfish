import Database from "better-sqlite3";
import { assertSupportedSqliteRuntime, initializeRegistrySchema } from "@shellfish/registry";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
assertSupportedSqliteRuntime();
const repoRoot = resolve(__dirname, "../../../../");
const dbPath = resolve(
  process.env.DATABASE_PATH?.startsWith("/")
    ? process.env.DATABASE_PATH
    : resolve(repoRoot, process.env.DATABASE_PATH ?? "data/shellfish.db"),
);

mkdirSync(dirname(dbPath), { recursive: true });

const schema = readFileSync(resolve(__dirname, "schema.sql"), "utf8");
const db = new Database(dbPath);
db.exec(schema);
initializeRegistrySchema(db);
db.close();

console.log(`Initialized SQLite schema at ${dbPath}`);
