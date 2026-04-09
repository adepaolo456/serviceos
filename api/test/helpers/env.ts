/**
 * Jest `setupFiles` entry — runs ONCE per test worker, before any test
 * module is imported. This is critical because AppModule / ConfigModule /
 * the TypeORM factory all read env vars at module load time, so
 * process.env must be populated before any `import './src/app.module'`
 * executes.
 *
 * Loads api/.env.test if present (zero-dependency, no dotenv package).
 * Forces NODE_ENV=test so app.module.ts flips synchronize=true and
 * ssl=false for the local Docker Postgres.
 */
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.join(__dirname, '..', '..', '.env.test');

if (fs.existsSync(envPath)) {
  const contents = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    // Strip matching wrapper quotes if present.
    const unquoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value;
    if (!(key in process.env)) {
      process.env[key] = unquoted;
    }
  }
}

process.env.NODE_ENV = 'test';

// Sanity check — fail fast with a clear message if the developer forgot
// to start the test DB or copy .env.test.
if (!process.env.DATABASE_URL) {
  throw new Error(
    '[E2E setup] DATABASE_URL is not set. Copy api/.env.test.example to api/.env.test and start the test DB: npm run test:e2e:db:up',
  );
}
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';
}
