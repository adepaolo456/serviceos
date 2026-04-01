import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class ResendEmailService {
  private readonly logger = new Logger(ResendEmailService.name);
  private client: Resend | null = null;
  private defaultFrom: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.defaultFrom = process.env.RESEND_FROM_EMAIL || 'noreply@rentthis.com';

    if (apiKey && apiKey !== 'placeholder') {
      this.client = new Resend(apiKey);
    }
  }

  async sendEmail(params: {
    to: string;
    subject: string;
    html: string;
    from?: string;
    replyTo?: string;
  }): Promise<{ success: boolean; id?: string; error?: string }> {
    if (!this.client) {
      this.logger.warn('Resend not configured — email not sent');
      return { success: false, error: 'Resend not configured' };
    }

    try {
      const result = await this.client.emails.send({
        from: params.from || this.defaultFrom,
        to: params.to,
        subject: params.subject,
        html: params.html,
        replyTo: params.replyTo,
      });
      if (result.error) {
        this.logger.error(`Email failed to ${params.to}: ${result.error.message}`);
        return { success: false, error: result.error.message };
      }
      this.logger.log(`Email sent to ${params.to}: ${result.data?.id}`);
      return { success: true, id: result.data?.id };
    } catch (err: any) {
      this.logger.error(`Email failed to ${params.to}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}
