import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  code?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  constructor(private readonly mailboxDir: string = './.dev-mailbox') {}

  async send(message: MailMessage): Promise<void> {
    mkdirSync(this.mailboxDir, { recursive: true });
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
    const filepath = join(this.mailboxDir, filename);
    const content = `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`;
    await writeFile(filepath, content, 'utf8');
    if (message.code !== undefined) {
      console.log(`[dev-mailbox] code: ${message.code} (file: ${filepath})`);
    } else {
      console.log(`[dev-mailbox] wrote ${filepath}`);
    }
  }
}

export class SmtpMailer implements Mailer {
  private readonly transporter: ReturnType<typeof nodemailer.createTransport>;
  private readonly from: string;

  constructor(config: Config) {
    this.from = config.MAIL_FROM;
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth:
        config.SMTP_USER.length > 0
          ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
          : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

export const createMailer = (config: Config): Mailer => {
  if (config.MAIL_MODE === 'smtp') {
    return new SmtpMailer(config);
  }
  return new ConsoleMailer();
};
