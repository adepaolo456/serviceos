import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);
  private accountSid: string;
  private authToken: string;
  private fromNumber: string;

  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    this.authToken = process.env.TWILIO_AUTH_TOKEN || '';
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER || '';
  }

  private get configured(): boolean {
    return !!(this.accountSid && this.authToken && this.fromNumber);
  }

  async sendSms(
    to: string,
    body: string,
  ): Promise<{ success: boolean; sid?: string; error?: string }> {
    if (!this.configured) {
      this.logger.warn('Twilio not configured — SMS not sent');
      return { success: false, error: 'Twilio not configured' };
    }

    // Normalize phone number
    let phone = to.replace(/[^\d+]/g, '');
    if (!phone.startsWith('+')) {
      phone = phone.startsWith('1') ? `+${phone}` : `+1${phone}`;
    }

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
      const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

      const params = new URLSearchParams({
        To: phone,
        From: this.fromNumber,
        Body: body,
      });

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const data = await res.json();

      if (!res.ok) {
        this.logger.error(`SMS failed to ${phone}: ${data.message || res.statusText}`);
        return { success: false, error: data.message || `HTTP ${res.status}` };
      }

      this.logger.log(`SMS sent to ${phone}: ${data.sid}`);
      return { success: true, sid: data.sid };
    } catch (err: any) {
      this.logger.error(`SMS failed to ${phone}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}
