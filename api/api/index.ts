import serverlessExpress from '@vendia/serverless-express';
import { createApp } from '../src/main';

const ALLOWED_ORIGIN = 'https://serviceos-web-zeta.vercel.app';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Credentials': 'true',
};

function setCorsHeaders(res: any) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

let cachedHandler: ReturnType<typeof serverlessExpress>;

export default async function handler(req: any, res: any) {
  // Set CORS headers on every response
  setCorsHeaders(res);

  // Handle preflight — return 204 immediately, skip NestJS bootstrap
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!cachedHandler) {
    const app = await createApp();
    await app.init();
    const expressApp = app.getHttpAdapter().getInstance();
    cachedHandler = serverlessExpress({ app: expressApp });
  }
  return cachedHandler(req, res);
}
