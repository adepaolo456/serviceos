import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ResendEmailService {
  private readonly logger = new Logger(ResendEmailService.name);
  private apiKey: string;
  private defaultFrom: string;

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY || '';
    this.defaultFrom = process.env.RESEND_FROM_EMAIL || 'noreply@rentthis.com';
  }

  private get configured(): boolean {
    return !!(this.apiKey && this.apiKey !== 'placeholder');
  }

  async sendEmail(params: {
    to: string;
    subject: string;
    html: string;
    from?: string;
    replyTo?: string;
  }): Promise<{ success: boolean; id?: string; error?: string }> {
    if (!this.configured) {
      this.logger.warn('Resend not configured — email not sent');
      return { success: false, error: 'Resend not configured' };
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: params.from || this.defaultFrom,
          to: [params.to],
          subject: params.subject,
          html: params.html,
          reply_to: params.replyTo || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errMsg = data.message || data.error?.message || `HTTP ${res.status}`;
        this.logger.error(`Email failed to ${params.to}: ${errMsg}`);
        return { success: false, error: errMsg };
      }

      this.logger.log(`Email sent to ${params.to}: ${data.id}`);
      return { success: true, id: data.id };
    } catch (err: any) {
      this.logger.error(`Email failed to ${params.to}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}
