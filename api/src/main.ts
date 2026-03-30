import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

export async function createApp() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, mobile apps)
      if (!origin) return callback(null, true);
      // Always allow our own domains
      const allowed = ['http://localhost:3000', 'https://serviceos-web-zeta.vercel.app'];
      if (allowed.includes(origin)) return callback(null, true);
      // Allow any origin for public/widget API routes (checked per-request in middleware)
      // This is necessary for the embeddable widget to work from tenant domains
      return callback(null, true);
    },
    credentials: true,
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
