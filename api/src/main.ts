import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  // Per-request CORS: public endpoints (widget / tenant websites) allow any origin
  // without credentials; everything else uses a strict allowlist with credentials.
  const allowedOrigins = [
    'https://serviceos.vercel.app',
    'https://www.serviceos.vercel.app',
    'https://serviceos-web-zeta.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
  ];
  const tenantSubdomainRegex = /^https:\/\/[a-z0-9-]+\.serviceos\.app$/;

  app.enableCors((req, cb) => {
    const url = (req as { url?: string }).url || '';
    // Public endpoints — widget.js fetches these from arbitrary tenant domains.
    // No credentials, any origin.
    if (url.startsWith('/public/')) {
      return cb(null, { origin: true, credentials: false });
    }
    // Authenticated endpoints — strict allowlist with credentials.
    cb(null, {
      origin: (origin, originCb) => {
        // Allow requests with no origin (mobile apps, Postman, server-to-server)
        if (!origin) return originCb(null, true);
        if (allowedOrigins.includes(origin)) return originCb(null, true);
        // Allow any *.vercel.app preview deploys
        if (origin.endsWith('.vercel.app')) return originCb(null, true);
        // Allow tenant subdomains (tenant websites feature)
        if (tenantSubdomainRegex.test(origin)) return originCb(null, true);
        return originCb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    });
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('ServiceOS API')
    .setDescription('Multi-tenant SaaS API for service businesses')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  return app;
}

async function bootstrap() {
  const app = await createApp();
  await app.listen(process.env.PORT ?? 3001);
}

if (!process.env.VERCEL) {
  void bootstrap();
}
