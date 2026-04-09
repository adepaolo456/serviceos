/**
 * Shared Nest application bootstrap for the E2E suite.
 *
 * Uses the same createApp() factory as production (src/main.ts) so the
 * app is configured with the same ValidationPipe + CORS + guards. The
 * only test-time difference is the TypeORM config, which is forked on
 * NODE_ENV=test in app.module.ts (synchronize=true, ssl=false).
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createApp } from '../../src/main';

let cachedApp: INestApplication | undefined;
let cachedDs: DataSource | undefined;

export async function getTestApp(): Promise<{
  app: INestApplication;
  ds: DataSource;
}> {
  if (cachedApp && cachedDs) return { app: cachedApp, ds: cachedDs };

  const app = await createApp();
  await app.init();
  const ds = app.get(DataSource);

  cachedApp = app;
  cachedDs = ds;
  return { app, ds };
}

export async function closeTestApp(): Promise<void> {
  if (cachedApp) {
    await cachedApp.close();
  }
  cachedApp = undefined;
  cachedDs = undefined;
}
