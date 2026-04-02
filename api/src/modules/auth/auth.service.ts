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
      where: { email: dto.email, tenant_id: dto.tenantId },
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
        businessType: user.tenant.business_type,
        businessTypeLabel: user.tenant.business_type_label,
        enabledModules: user.tenant.enabled_modules || [],
        address: user.tenant.address,
        serviceRadius: user.tenant.service_radius_miles,
        subscriptionTier: user.tenant.subscription_tier,
        subscriptionStatus: user.tenant.subscription_status,
        customerOverageRates: user.tenant.customer_overage_rates,
        websiteEnabled: user.tenant.website_enabled,
        websiteHeadline: user.tenant.website_headline,
        websitePrimaryColor: user.tenant.website_primary_color,
        websitePhone: user.tenant.website_phone,
        websiteEmail: user.tenant.website_email,
        websiteServiceArea: user.tenant.website_service_area,
        websiteAbout: user.tenant.website_about,
        websiteDescription: user.tenant.website_description,
        websiteLogoUrl: user.tenant.website_logo_url,
        websiteHeroImageUrl: user.tenant.website_hero_image_url,
        widgetEnabled: user.tenant.widget_enabled,
        allowedWidgetDomains: user.tenant.allowed_widget_domains,
        yardLatitude: user.tenant.yard_latitude ? Number(user.tenant.yard_latitude) : null,
        yardLongitude: user.tenant.yard_longitude ? Number(user.tenant.yard_longitude) : null,
        yardAddress: user.tenant.yard_address,
      },
    };
  }

  async updateTenantProfile(
    tenantId: string,
    data: {
      companyName?: string;
      businessType?: string;
      address?: Record<string, string>;
      serviceRadius?: number;
      websiteEnabled?: boolean;
      websiteHeadline?: string;
      websiteDescription?: string;
      websiteHeroImageUrl?: string;
      websiteLogoUrl?: string;
      websitePrimaryColor?: string;
      websitePhone?: string;
      websiteEmail?: string;
      websiteServiceArea?: string;
      websiteAbout?: string;
      widgetEnabled?: boolean;
      allowedWidgetDomains?: string[];
      businessTypeLabel?: string;
      enabledModules?: string[];
      subscriptionTier?: string;
      subscriptionStatus?: string;
      customerOverageRates?: Record<string, unknown>;
      yardLatitude?: number;
      yardLongitude?: number;
      yardAddress?: Record<string, string>;
    },
  ) {
    const update: Record<string, unknown> = {};
    if (data.companyName !== undefined) update.name = data.companyName;
    if (data.yardLatitude !== undefined) update.yard_latitude = data.yardLatitude;
    if (data.yardLongitude !== undefined) update.yard_longitude = data.yardLongitude;
    if (data.yardAddress !== undefined) update.yard_address = data.yardAddress;
    if (data.businessType !== undefined) update.business_type = data.businessType;
    if (data.address !== undefined) update.address = data.address;
    if (data.serviceRadius !== undefined) update.service_radius_miles = data.serviceRadius;
    if (data.websiteEnabled !== undefined) update.website_enabled = data.websiteEnabled;
    if (data.websiteHeadline !== undefined) update.website_headline = data.websiteHeadline;
    if (data.websiteDescription !== undefined) update.website_description = data.websiteDescription;
    if (data.websiteHeroImageUrl !== undefined) update.website_hero_image_url = data.websiteHeroImageUrl;
    if (data.websiteLogoUrl !== undefined) update.website_logo_url = data.websiteLogoUrl;
    if (data.websitePrimaryColor !== undefined) update.website_primary_color = data.websitePrimaryColor;
    if (data.websitePhone !== undefined) update.website_phone = data.websitePhone;
    if (data.websiteEmail !== undefined) update.website_email = data.websiteEmail;
    if (data.websiteServiceArea !== undefined) update.website_service_area = data.websiteServiceArea;
    if (data.websiteAbout !== undefined) update.website_about = data.websiteAbout;
    if (data.widgetEnabled !== undefined) update.widget_enabled = data.widgetEnabled;
    if (data.allowedWidgetDomains !== undefined) update.allowed_widget_domains = data.allowedWidgetDomains;
    if (data.businessTypeLabel !== undefined) update.business_type_label = data.businessTypeLabel;
    if (data.enabledModules !== undefined) update.enabled_modules = data.enabledModules;
    if (data.subscriptionTier !== undefined) update.subscription_tier = data.subscriptionTier;
    if (data.subscriptionStatus !== undefined) update.subscription_status = data.subscriptionStatus;
    if (data.customerOverageRates !== undefined) update.customer_overage_rates = data.customerOverageRates;

    await this.tenantsRepository.update(tenantId, update);

    const tenant = await this.tenantsRepository.findOne({ where: { id: tenantId } });
    return {
      name: tenant?.name,
      businessType: tenant?.business_type,
      address: tenant?.address,
      serviceRadius: tenant?.service_radius_miles,
    };
  }

  async getPreferences(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    return user?.permissions || {};
  }

  async updatePreferences(userId: string, data: Record<string, unknown>) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    const current = (user?.permissions || {}) as Record<string, unknown>;
    const merged = { ...current, ...data };
    await this.usersRepository.update(userId, { permissions: merged } as any);
    return merged;
  }

  async clockIn(userId: string) {
    await this.usersRepository.update(userId, {
      is_clocked_in: true,
      clocked_in_at: new Date(),
    } as any);
  }

  async clockOut(userId: string) {
    await this.usersRepository.update(userId, {
      is_clocked_in: false,
      clocked_out_at: new Date(),
      current_latitude: null,
      current_longitude: null,
      current_location_updated_at: null,
      current_status_text: null,
    } as any);
  }

  async updateLocation(userId: string, data: { latitude: number; longitude: number; statusText?: string }) {
    await this.usersRepository.update(userId, {
      current_latitude: data.latitude,
      current_longitude: data.longitude,
      current_location_updated_at: new Date(),
      current_status_text: data.statusText || null,
    } as any);
  }

  async inviteUser(dto: InviteUserDto, tenantId: string) {
    const existingUser = await this.usersRepository.findOne({
      where: { email: dto.email, tenant_id: tenantId },
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

  async googleLogin(googleUser: {
    googleId: string;
    email: string;
    firstName: string;
    lastName: string;
  }) {
    // TODO: Google OAuth needs tenant context (subdomain or pre-login selection)
    // Currently matches any user with this email globally. For single-tenant
    // deployments this is safe, but for multi-tenant it needs a tenant selector
    // before the OAuth redirect.
    let user = await this.usersRepository.findOne({
      where: { email: googleUser.email },
    });

    let isNew = false;

    if (user) {
      // Existing user — just generate tokens
      const tokens = await this.generateTokens(user, user.tenant_id);
      await this.updateRefreshTokenHash(user.id, tokens.refreshToken);
      return { ...tokens, isNew: false };
    }

    // New user — create tenant + user
    isNew = true;
    const companyName = `${googleUser.firstName}'s Company`;
    const slug = companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') + '-' + Date.now().toString(36);

    const tenant = this.tenantsRepository.create({
      name: companyName,
      slug,
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    });
    const savedTenant = await this.tenantsRepository.save(tenant);

    // Create user with a random password (they'll use Google to login)
    const randomPass = await bcrypt.hash(Math.random().toString(36), 12);
    user = this.usersRepository.create({
      tenant_id: savedTenant.id,
      email: googleUser.email,
      password_hash: randomPass,
      first_name: googleUser.firstName,
      last_name: googleUser.lastName,
      role: 'owner',
    });
    const savedUser = await this.usersRepository.save(user);

    const tokens = await this.generateTokens(savedUser, savedTenant.id);
    await this.updateRefreshTokenHash(savedUser.id, tokens.refreshToken);

    return { ...tokens, isNew };
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
