import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantSettings } from '../tenant-settings/entities/tenant-settings.entity';
import {
  RegisterDto,
  LoginDto,
  RefreshTokenDto,
  InviteUserDto,
  LookupTenantsDto,
} from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Tenant)
    private tenantsRepository: Repository<Tenant>,
    @InjectRepository(TenantSettings)
    private tenantSettingsRepository: Repository<TenantSettings>,
    private jwtService: JwtService,
  ) {}

  /**
   * Normalize an email for consistent storage and lookup. Trim whitespace +
   * lowercase. Real-world email providers treat local-part case-insensitively
   * despite RFC 5321 technically allowing case sensitivity; aligning with that
   * norm prevents case-variant duplicates and silent OAuth lookup failures.
   *
   * Public so the forgot-password controller path can normalize before using
   * the email as a rate-limit key (must match the storage normalization to
   * rate-limit case-variant spam consistently).
   */
  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Lookup used by the forgot-password flow. Returns a minimal projection
   * suitable for the controller to decide (active-and-send vs silent-drop).
   * Normalization happens here so callers can't accidentally miss it.
   */
  async findUserByEmailForPasswordReset(email: string) {
    const normalizedEmail = this.normalizeEmail(email);
    return this.usersRepository.findOne({
      where: { email: normalizedEmail },
      select: ['id', 'tenant_id', 'email', 'first_name', 'is_active'],
    });
  }

  /**
   * Issue a fresh access+refresh token pair for a user that has already
   * been authenticated by an out-of-band mechanism (password reset
   * redemption). Loads the user, mints tokens, rotates the stored
   * refresh_token_hash. Mirrors the end of the login() flow but without
   * the credential-check step.
   *
   * The caller is responsible for having already proven the user's
   * identity (e.g. a valid unused unexpired reset token). Never expose
   * this to a public endpoint without a gate.
   */
  async generateTokensForUser(userId: string) {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: ['id', 'email', 'role', 'tenant_id'],
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const tokens = await this.generateTokens(user, user.tenant_id);
    await this.updateRefreshTokenHash(user.id, tokens.refreshToken);
    return tokens;
  }

  async register(dto: RegisterDto) {
    const normalizedEmail = this.normalizeEmail(dto.email);
    const existingUser = await this.usersRepository.findOne({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists.');
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
      email: normalizedEmail,
      password_hash: passwordHash,
      first_name: dto.firstName,
      last_name: dto.lastName,
      phone: dto.phone,
      role: 'owner',
    });
    let savedUser: User;
    try {
      savedUser = await this.usersRepository.save(user);
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const driverError = (err as any).driverError;
        const code = driverError?.code;
        const constraint = driverError?.constraint || '';
        const detail = driverError?.detail || '';
        const message = err.message || '';

        if (code === '23505') {
          if (
            constraint === 'users_email_lower_unique' ||
            detail.includes('users_email_lower_unique') ||
            message.includes('users_email_lower_unique')
          ) {
            throw new ConflictException(
              'An account with this email already exists.'
            );
          }
        }
      }
      throw err;
    }

    // Pre-create tenant_settings row so the new tenant starts with an
    // explicit row (entity defaults applied) rather than relying on the
    // lazy-create path in TenantSettingsService.getSettings(). The lazy
    // fallback is preserved as a safety net.
    const tenantSettings = this.tenantSettingsRepository.create({
      tenant_id: savedTenant.id,
    });
    await this.tenantSettingsRepository.save(tenantSettings);

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
    let tenantId = dto.tenantId;
    const normalizedEmail = this.normalizeEmail(dto.email);

    // If no tenantId provided, look up tenants for this email
    if (!tenantId) {
      const users = await this.usersRepository.find({
        where: { email: normalizedEmail },
        select: ['id', 'tenant_id'],
      });

      if (users.length === 0) {
        throw new UnauthorizedException('Invalid credentials');
      }

      if (users.length === 1) {
        tenantId = users[0].tenant_id;
      } else {
        // Multiple tenants — need selection
        const tenants = await this.tenantsRepository
          .createQueryBuilder('t')
          .select(['t.id', 't.name', 't.website_logo_url'])
          .where('t.id IN (:...ids)', { ids: users.map((u) => u.tenant_id) })
          .getMany();

        throw new UnauthorizedException({
          statusCode: 400,
          error: 'tenant_selection_required',
          tenants: tenants.map((t) => ({
            id: t.id,
            name: t.name,
            logo_url: t.website_logo_url || null,
          })),
        });
      }
    }

    const user = await this.usersRepository.findOne({
      where: { email: normalizedEmail, tenant_id: tenantId },
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

  async lookupTenants(email: string) {
    const start = Date.now();
    const normalizedEmail = this.normalizeEmail(email);

    const users = await this.usersRepository.find({
      where: { email: normalizedEmail },
      select: ['id', 'tenant_id'],
    });

    let tenants: { id: string; name: string; logo_url: string | null }[] = [];

    if (users.length > 0) {
      const tenantRows = await this.tenantsRepository
        .createQueryBuilder('t')
        .select(['t.id', 't.name', 't.website_logo_url'])
        .where('t.id IN (:...ids)', { ids: users.map((u) => u.tenant_id) })
        .getMany();

      tenants = tenantRows.map((t) => ({
        id: t.id,
        name: t.name,
        logo_url: t.website_logo_url || null,
      }));
    }

    // Timing-safe: ensure consistent response time
    const elapsed = Date.now() - start;
    const floor = 200;
    if (elapsed < floor) {
      await new Promise((r) => setTimeout(r, floor - elapsed));
    }

    return { tenants };
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

    // Phase B3 — load tenant-wide settings so the frontend can
    // thread `tenant.timezone` into tenant-aware date helpers.
    // Lazy-create mirrors TenantSettingsService.getSettings() so
    // older tenants that never wrote a settings row still receive
    // the canonical 'America/New_York' default without erroring.
    let settings = await this.tenantSettingsRepository.findOne({
      where: { tenant_id: user.tenant.id },
    });
    if (!settings) {
      settings = await this.tenantSettingsRepository.save(
        this.tenantSettingsRepository.create({ tenant_id: user.tenant.id }),
      );
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
        yardLatitude: user.tenant.yard_latitude
          ? Number(user.tenant.yard_latitude)
          : null,
        yardLongitude: user.tenant.yard_longitude
          ? Number(user.tenant.yard_longitude)
          : null,
        yardAddress: user.tenant.yard_address,
        // Phase B3 — tenant-wide timezone. Always present in the
        // response; falls back to 'America/New_York' when the
        // column value is somehow null to keep frontend date
        // helpers tenant-aware in all cases.
        timezone: settings.timezone ?? 'America/New_York',
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
    if (data.yardLatitude !== undefined)
      update.yard_latitude = data.yardLatitude;
    if (data.yardLongitude !== undefined)
      update.yard_longitude = data.yardLongitude;
    if (data.yardAddress !== undefined) update.yard_address = data.yardAddress;
    if (data.businessType !== undefined)
      update.business_type = data.businessType;
    if (data.address !== undefined) update.address = data.address;
    if (data.serviceRadius !== undefined)
      update.service_radius_miles = data.serviceRadius;
    if (data.websiteEnabled !== undefined)
      update.website_enabled = data.websiteEnabled;
    if (data.websiteHeadline !== undefined)
      update.website_headline = data.websiteHeadline;
    if (data.websiteDescription !== undefined)
      update.website_description = data.websiteDescription;
    if (data.websiteHeroImageUrl !== undefined)
      update.website_hero_image_url = data.websiteHeroImageUrl;
    if (data.websiteLogoUrl !== undefined)
      update.website_logo_url = data.websiteLogoUrl;
    if (data.websitePrimaryColor !== undefined)
      update.website_primary_color = data.websitePrimaryColor;
    if (data.websitePhone !== undefined)
      update.website_phone = data.websitePhone;
    if (data.websiteEmail !== undefined)
      update.website_email = data.websiteEmail;
    if (data.websiteServiceArea !== undefined)
      update.website_service_area = data.websiteServiceArea;
    if (data.websiteAbout !== undefined)
      update.website_about = data.websiteAbout;
    if (data.widgetEnabled !== undefined)
      update.widget_enabled = data.widgetEnabled;
    if (data.allowedWidgetDomains !== undefined)
      update.allowed_widget_domains = data.allowedWidgetDomains;
    if (data.businessTypeLabel !== undefined)
      update.business_type_label = data.businessTypeLabel;
    if (data.enabledModules !== undefined)
      update.enabled_modules = data.enabledModules;
    if (data.subscriptionTier !== undefined)
      update.subscription_tier = data.subscriptionTier;
    if (data.subscriptionStatus !== undefined)
      update.subscription_status = data.subscriptionStatus;
    if (data.customerOverageRates !== undefined)
      update.customer_overage_rates = data.customerOverageRates;

    await this.tenantsRepository.update(tenantId, update);

    const tenant = await this.tenantsRepository.findOne({
      where: { id: tenantId },
    });
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
    const current = user?.permissions || {};
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

  async updateLocation(
    userId: string,
    data: { latitude: number; longitude: number; statusText?: string },
  ) {
    await this.usersRepository.update(userId, {
      current_latitude: data.latitude,
      current_longitude: data.longitude,
      current_location_updated_at: new Date(),
      current_status_text: data.statusText || null,
    } as any);
  }

  async inviteUser(dto: InviteUserDto, tenantId: string) {
    const normalizedEmail = this.normalizeEmail(dto.email);
    const existingUser = await this.usersRepository.findOne({
      where: { email: normalizedEmail, tenant_id: tenantId },
    });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists.');
    }

    const tempPassword = Math.random().toString(36).slice(-12);
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = this.usersRepository.create({
      tenant_id: tenantId,
      email: normalizedEmail,
      password_hash: passwordHash,
      first_name: dto.firstName,
      last_name: dto.lastName,
      phone: dto.phone,
      role: dto.role,
    });
    let savedUser: User;
    try {
      savedUser = await this.usersRepository.save(user);
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const driverError = (err as any).driverError;
        const code = driverError?.code;
        const constraint = driverError?.constraint || '';
        const detail = driverError?.detail || '';
        const message = err.message || '';

        if (code === '23505') {
          if (
            constraint === 'users_email_lower_unique' ||
            detail.includes('users_email_lower_unique') ||
            message.includes('users_email_lower_unique')
          ) {
            throw new ConflictException(
              'An account with this email already exists.'
            );
          }
        }
      }
      throw err;
    }

    return {
      id: savedUser.id,
      email: savedUser.email,
      firstName: savedUser.first_name,
      lastName: savedUser.last_name,
      role: savedUser.role,
      tempPassword,
    };
  }

  /**
   * Google OAuth login under Option A (email unique per platform).
   *
   * - Unknown email → reject. No auto-create. Platform admins provision
   *   accounts explicitly via register/invite; OAuth only logs existing
   *   users in.
   * - Deactivated user → reject (parallel to password login at L163-165).
   *   Deactivation must apply uniformly across auth methods.
   * - Email is normalized before lookup to avoid case-variant misses against
   *   the globally-unique email constraint.
   *
   * Tenant is derived from the user record, never client-supplied. The state
   * parameter from OAuth init is no longer passed through because tenant
   * selection is implicit under Option A.
   */
  async googleLogin(googleUser: {
    googleId: string;
    email: string;
    firstName?: string;
    lastName?: string;
  }) {
    const normalizedEmail = this.normalizeEmail(googleUser.email);

    const user = await this.usersRepository.findOne({
      where: { email: normalizedEmail },
      select: [
        'id',
        'email',
        'first_name',
        'last_name',
        'role',
        'tenant_id',
        'is_active',
      ],
    });

    if (!user) {
      throw new UnauthorizedException({ error: 'no_account_found' });
    }

    if (!user.is_active) {
      throw new UnauthorizedException({ error: 'account_deactivated' });
    }

    await this.usersRepository.update(user.id, { last_login_at: new Date() });

    const tokens = await this.generateTokens(user, user.tenant_id);
    await this.updateRefreshTokenHash(user.id, tokens.refreshToken);
    return { ...tokens, isNew: false };
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
