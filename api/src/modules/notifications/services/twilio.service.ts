import { Injectable, Logger } from '@nestjs/common';
import * as Twilio from 'twilio';

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);
  private client: Twilio.Twilio | null = null;
  private fromNumber: string;

  constructor() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER || '';

    if (sid && token && sid !== 'placeholder') {
      this.client = Twilio.default(sid, token);
    }
  }

  async sendSms(
    to: string,
    body: string,
  ): Promise<{ success: boolean; sid?: string; error?: string }> {
    if (!this.client) {
      this.logger.warn('Twilio not configured — SMS not sent');
      return { success: false, error: 'Twilio not configured' };
    }

    // Normalize phone number
    let phone = to.replace(/[^\d+]/g, '');
    if (!phone.startsWith('+')) {
      phone = phone.startsWith('1') ? `+${phone}` : `+1${phone}`;
    }

    try {
      const message = await this.client.messages.create({
        body,
        from: this.fromNumber,
        to: phone,
      });
      this.logger.log(`SMS sent to ${phone}: ${message.sid}`);
      return { success: true, sid: message.sid };
    } catch (err: any) {
      this.logger.error(`SMS failed to ${phone}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}
