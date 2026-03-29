import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  InviteUserDto,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Tenant)
    private tenantsRepository: Repository<Tenant>,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.usersRepository.findOne({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    let slug = dto.companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const existingTenant = await this.tenantsRepository.findOne({
      where: { slug },
    });
    if (existingTenant) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const tenant = this.tenantsRepository.create({
      name: dto.companyName,
      slug,
      business_type: dto.businessType,
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    });
    const savedTenant = await this.tenantsRepository.save(tenant);

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = this.usersRepository.create({
      tenant_id: savedTenant.id,
      email: dto.email,
      password_hash: passwordHash,
      first_name: dto.firstName,
      last_name: dto.lastName,
      phone: dto.phone,
      role: 'owner',
    });
    const savedUser = await this.usersRepository.save(user);

    const tokens = await this.generateTokens(savedUser, savedTenant.id);
    await this.updateRefreshTokenHash(savedUser.id, tokens.refreshToken);

    return {
      user: {
        id: savedUser.id,
        email: savedUser.email,
        firstName: savedUser.first_name,
        lastName: savedUser.last_name,
        role: savedUser.role,
      },
      tenant: {
        id: savedTenant.id,
        name: savedTenant.name,
        slug: savedTenant.slug,
      },
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersRepository.findOne({
      where: { email: dto.email },
      select: [
        'id',
        'email',
        'password_hash',
        'first_name',
        'last_name',
        'role',
        'tenant_id',
        'is_active',
      ],
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.is_active) {
      throw new ForbiddenException('Account is deactivated');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.password_hash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.usersRepository.update(user.id, { last_login_at: new Date() });

    const tokens = await this.generateTokens(user, user.tenant_id);
    await this.updateRefreshTokenHash(user.id, tokens.refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
      },
      ...tokens,
    };
  }

  async refreshToken(dto: RefreshTokenDto) {
    try {
      const payload = this.jwtService.verify<{ sub: string }>(dto.refreshToken);
      const user = await this.usersRepository.findOne({
        where: { id: payload.sub },
        select: ['id', 'email', 'role', 'tenant_id', 'refresh_token_hash'],
      });

      if (!user || !user.refresh_token_hash) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const isValid = await bcrypt.compare(
        dto.refreshToken,
        user.refresh_token_hash,
      );
      if (!isValid) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const tokens = await this.generateTokens(user, user.tenant_id);
      await this.updateRefreshTokenHash(user.id, tokens.refreshToken);

      return tokens;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async getProfile(userId: string) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      relations: ['tenant'],
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      role: user.role,
      tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
        subscriptionTier: user.tenant.subscription_tier,
        subscriptionStatus: user.tenant.subscription_status,
      },
    };
  }

  async inviteUser(dto: InviteUserDto, tenantId: string) {
    const existingUser = await this.usersRepository.findOne({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const tempPassword = Math.random().toString(36).slice(-12);
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = this.usersRepository.create({
      tenant_id: tenantId,
      email: dto.email,
      password_hash: passwordHash,
      first_name: dto.firstName,
      last_name: dto.lastName,
      phone: dto.phone,
      role: dto.role,
    });
    const savedUser = await this.usersRepository.save(user);

    return {
      id: savedUser.id,
      email: savedUser.email,
      firstName: savedUser.first_name,
      lastName: savedUser.last_name,
      role: savedUser.role,
      tempPassword,
    };
  }

  private async generateTokens(user: User, tenantId: string) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, { expiresIn: '15m' }),
      this.jwtService.signAsync(payload, { expiresIn: '7d' }),
    ]);

    return { accessToken, refreshToken };
  }

  private async updateRefreshTokenHash(userId: string, refreshToken: string) {
    const hash = await bcrypt.hash(refreshToken, 12);
    await this.usersRepository.update(userId, { refresh_token_hash: hash });
  }
}
