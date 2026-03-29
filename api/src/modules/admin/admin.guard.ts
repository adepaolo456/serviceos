import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

const SUPER_ADMIN_EMAIL = 'adepaolo456@gmail.com';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { email?: string } | undefined;
    if (!user?.email || user.email !== SUPER_ADMIN_EMAIL) {
      throw new ForbiddenException('Super admin access required');
    }
    return true;
  }
}
