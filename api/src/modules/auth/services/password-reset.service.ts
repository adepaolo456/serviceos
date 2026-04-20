import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository, IsNull, MoreThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { PasswordResetToken } from '../entities/password-reset-token.entity';
import { User } from '../entities/user.entity';
import { ResendEmailService } from '../../notifications/services/resend.service';

const TOKEN_EXPIRY_MINUTES = 60;
const TOKEN_BYTES = 32;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectRepository(PasswordResetToken)
    private readonly tokens: Repository<PasswordResetToken>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly email: ResendEmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Generate a cryptographically-random token and store its SHA-256 hash.
   * Returns the raw token — only exposed to the caller (embedded in email).
   * Never logged, never persisted in plaintext.
   *
   * Invalidates existing unused tokens for this user first (enforces
   * one-live-token-per-user; prevents token-stuffing where an attacker
   * triggers repeated resets to find a valid one).
   */
  async createToken(
    user: Pick<User, 'id' | 'tenant_id'>,
    requestedBy: string,
    requestedIp: string | null,
  ): Promise<string> {
    const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    await this.tokens.update(
      { user_id: user.id, used_at: IsNull() },
      { used_at: new Date() },
    );

    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

    await this.tokens.save(
      this.tokens.create({
        user_id: user.id,
        tenant_id: user.tenant_id,
        token_hash: tokenHash,
        expires_at: expiresAt,
        requested_by: requestedBy,
        requested_ip: requestedIp,
      }),
    );

    this.logger.log(
      JSON.stringify({
        event: 'audit.password_reset.token_created',
        user_id: user.id,
        tenant_id: user.tenant_id,
        requested_by: requestedBy,
        requested_ip: requestedIp,
        expires_at: expiresAt.toISOString(),
      }),
    );

    return rawToken;
  }

  /**
   * Inline HTML to match the existing ServiceOS email style (see
   * billing/invoice.service.ts for reference pattern — no templating system).
   * Anti-phishing cue included per industry convention.
   */
  async sendResetEmail(
    user: Pick<User, 'id' | 'tenant_id' | 'email' | 'first_name'>,
    rawToken: string,
  ) {
    const appUrl =
      this.config.get<string>('APP_URL') || 'https://app.rentthisapp.com';
    const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;
    const firstName = user.first_name || 'there';

    const subject = 'Reset your ServiceOS password';
    const html = `
      <p>Hi ${firstName},</p>
      <p>We received a request to reset your ServiceOS password. Click the link below to set a new password:</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#059669;color:white;text-decoration:none;border-radius:6px;">Reset password</a></p>
      <p>Or paste this URL into your browser:<br><code>${resetUrl}</code></p>
      <p>This link expires in 60 minutes. If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
      <p>— The ServiceOS team</p>
    `;

    await this.email.sendEmail({ to: user.email, subject, html });

    this.logger.log(
      JSON.stringify({
        event: 'audit.password_reset.email_sent',
        user_id: user.id,
        tenant_id: user.tenant_id,
      }),
    );
  }

  /**
   * Redeem a raw token AND apply the new password atomically.
   *
   * Wrapped in a single DB transaction so token burn + password update
   * succeed or fail together. Without the transaction a password-write
   * failure after token burn would lock the user out (old password
   * rejected, token already burned). Transaction = no half-state.
   *
   * Pessimistic write lock on the token row prevents concurrent-redemption
   * races where two requests with the same token both pass the "not used"
   * check before either marks it used.
   *
   * Returns the user record (caller issues auto-login tokens).
   */
  async redeemAndApply(
    rawToken: string,
    newPassword: string,
  ): Promise<{ id: string; tenant_id: string }> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException({ error: 'password_too_short' });
    }

    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    return await this.dataSource.transaction(async (manager) => {
      const record = await manager.findOne(PasswordResetToken, {
        where: {
          token_hash: tokenHash,
          used_at: IsNull(),
          expires_at: MoreThan(new Date()),
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!record) {
        throw new UnauthorizedException({ error: 'invalid_or_expired_token' });
      }

      const user = await manager.findOne(User, {
        where: { id: record.user_id },
        select: ['id', 'tenant_id', 'email', 'role', 'is_active'],
      });

      if (!user) {
        throw new UnauthorizedException({ error: 'invalid_or_expired_token' });
      }

      if (!user.is_active) {
        // Burn the token to prevent replay attempts on a deactivated account,
        // then reject. The inactive-branch update still happens inside the
        // transaction so it only lands if the caller doesn't roll back.
        await manager.update(PasswordResetToken, record.id, {
          used_at: new Date(),
        });
        this.logger.log(
          JSON.stringify({
            event: 'audit.password_reset.redemption_blocked_inactive',
            user_id: user.id,
            tenant_id: user.tenant_id,
          }),
        );
        throw new UnauthorizedException({ error: 'account_deactivated' });
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);

      await manager.update(User, user.id, {
        password_hash: passwordHash,
        refresh_token_hash: null,
      });
      await manager.update(PasswordResetToken, record.id, {
        used_at: new Date(),
      });

      this.logger.log(
        JSON.stringify({
          event: 'audit.password_reset.redeemed_and_applied',
          user_id: user.id,
          tenant_id: user.tenant_id,
          token_id: record.id,
        }),
      );

      return { id: user.id, tenant_id: user.tenant_id };
    });
  }
}
