/**
 * Arc K Phase 1A Step 1 — TenantContextInterceptor.
 *
 * Runs AFTER NestJS guards (JwtAuthGuard / TenantGuard / PortalGuard).
 * Reads req.user populated by the guard and writes the result into
 * CLS so downstream business logic, future Sentry beforeSend, and
 * structured logging all read tenant context from a single source.
 *
 * Contract:
 *   - Authenticated tenant request → CLS has { tenant_id, user_id, role }
 *   - Authenticated portal request → CLS has { tenant_id, user_id }
 *     (portal JWT carries customerId in 'id', tenantId in 'tenantId')
 *   - Anonymous request (@Public, webhook before tenant resolution,
 *     health check) → CLS has { scope: 'platform' }
 *
 * Webhook handlers and cron loops that resolve their own tenant scope
 * (Stripe, Twilio, automation crons) override the platform scope by
 * calling cls.runWith({ tenant_id }, async () => { ... }) inside the
 * resolution path. See §K.3 audit for the full list.
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ClsService } from 'nestjs-cls';

import { CLS_ROLE, CLS_SCOPE, CLS_TENANT_ID, CLS_USER_ID, ServiceOSClsStore } from './cls.config';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService<ServiceOSClsStore>) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Non-HTTP execution contexts (microservices, RPC) — leave CLS alone.
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<{
      user?: { tenantId?: string; id?: string; sub?: string; role?: string };
    }>();
    const user = req?.user;

    if (user?.tenantId) {
      // Authenticated tenant or portal request.
      this.cls.set(CLS_TENANT_ID, user.tenantId);
      const userId = user.id ?? user.sub;
      if (userId) this.cls.set(CLS_USER_ID, userId);
      if (user.role) this.cls.set(CLS_ROLE, user.role);
    } else if (!this.cls.get(CLS_TENANT_ID)) {
      // No authenticated context AND no upstream override — mark as platform.
      // Webhook handlers and cron loops may override later via cls.runWith.
      this.cls.set(CLS_SCOPE, 'platform');
    }

    return next.handle();
  }
}
