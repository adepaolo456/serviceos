import serverlessExpress from '@vendia/serverless-express';
import { createApp } from '../src/main';

const ALLOWED_ORIGIN = 'https://serviceos-web-zeta.vercel.app';

let cachedHandler: ReturnType<typeof serverlessExpress>;

export default async function handler(req: any, res: any) {
  // Handle CORS preflight immediately without bootstrapping NestJS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.status(200).end();
    return;
  }

  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (!cachedHandler) {
    const app = await createApp();
    await app.init();
    const expressApp = app.getHttpAdapter().getInstance();
    cachedHandler = serverlessExpress({ app: expressApp });
  }
  return cachedHandler(req, res);
}
