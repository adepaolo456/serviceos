/**
 * Mint arbitrary-role JWTs for tests.
 *
 * RolesGuard and JwtAuthGuard only validate the JWT signature and read
 * `role` from the payload — neither looks the user up in the database.
 * That means we can mint a token with any role/tenantId/user id and it
 * passes auth, which is exactly what we want when testing RBAC without
 * having to create a real user row for every role under test.
 */
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface TestTokenClaims {
  sub: string;
  email: string;
  role: 'owner' | 'admin' | 'dispatcher' | 'driver' | 'viewer';
  tenantId: string;
}

export function mintToken(
  app: INestApplication,
  claims: TestTokenClaims,
): string {
  // JwtService is provided inside AuthModule, not at the root context,
  // so we need `{ strict: false }` to resolve it across the module tree.
  const jwtService = app.get(JwtService, { strict: false });
  return jwtService.sign(claims, { expiresIn: '15m' });
}
