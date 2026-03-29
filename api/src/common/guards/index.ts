import {
  Injectable,
  ExecutionContext,
  CanActivate,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../decorators';

interface AuthUser {
  id: string;
  email: string;
  role: string;
  tenantId: string;
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}

const ROLE_HIERARCHY: Record<string, number> = {
  owner: 5,
  admin: 4,
  dispatcher: 3,
  driver: 2,
  viewer: 1,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthUser | undefined;
    if (!user) {
      throw new ForbiddenException('No user found');
    }
    const userLevel = ROLE_HIERARCHY[user.role] ?? 0;
    const minRequired = Math.min(
      ...requiredRoles.map((r) => ROLE_HIERARCHY[r] ?? 0),
    );
    if (userLevel < minRequired) {
      throw new ForbiddenException('Insufficient role permissions');
    }
    return true;
  }
}
