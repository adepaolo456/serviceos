require('reflect-metadata');
const serverlessExpress = require('@vendia/serverless-express');

const ALLOWED_ORIGIN = 'https://serviceos-web-zeta.vercel.app';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Credentials': 'true',
};

function setCorsHeaders(res) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

let cachedHandler;

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    if (!cachedHandler) {
      const { createApp } = require('../dist/main');
      const app = await createApp();
      await app.init();
      const expressApp = app.getHttpAdapter().getInstance();
      cachedHandler = serverlessExpress({ app: expressApp });
    }
    return cachedHandler(req, res);
  } catch (error) {
    console.error('HANDLER_ERROR:', error.message);
    console.error('HANDLER_STACK:', error.stack);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error.message }));
  }
};
