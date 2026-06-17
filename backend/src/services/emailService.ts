import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

let transporter: nodemailer.Transporter | null = null;

const host = process.env.SMTP_HOST;
const port = parseInt(process.env.SMTP_PORT || '587', 10);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.EMAIL_FROM || 'noreply@seculink.com';

if (host && user && pass) {
  try {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, 
      auth: {
        user,
        pass,
      },
    });
    console.log(`[EMAIL] SMTP transporter initialized. From: ${from}`);
  } catch (error) {
    console.error('[EMAIL] Failed to initialize SMTP transport:', error);
  }
} else {
  console.log('[EMAIL] SMTP variables missing in env. Email alerts will fallback to console notifications.');
}

export async function sendNotificationEmail(
  toEmail: string,
  event: 'DOWNLOAD_SUCCESS' | 'SHREDDED',
  fileName: string,
  ipAddress: string,
  details: string
): Promise<void> {
  const subject = `SecuLink Security Alert: File ${event === 'SHREDDED' ? 'Shredded' : 'Downloaded'}`;
  const actionText = event === 'SHREDDED' ? 'permanently shredded and deleted from the vault' : 'successfully downloaded';
  const htmlContent = `
    <div style="font-family: sans-serif; padding: 20px; color: #334155; line-height: 1.6;">
      <h2 style="color: ${event === 'SHREDDED' ? '#ef4444' : '#10b981'}; margin-bottom: 16px;">SecuLink Security Feed</h2>
      <p>This is a automated notification that your shared file has been accessed.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <th style="text-align: left; padding: 8px 0; color: #64748b;">Event</th>
          <td style="padding: 8px 0; font-weight: bold;">${event}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <th style="text-align: left; padding: 8px 0; color: #64748b;">File Name</th>
          <td style="padding: 8px 0;">${fileName}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <th style="text-align: left; padding: 8px 0; color: #64748b;">Action</th>
          <td style="padding: 8px 0;">The file payload was ${actionText}.</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <th style="text-align: left; padding: 8px 0; color: #64748b;">Access IP</th>
          <td style="padding: 8px 0; font-family: monospace;">${ipAddress}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <th style="text-align: left; padding: 8px 0; color: #64748b;">Details</th>
          <td style="padding: 8px 0;">${details}</td>
        </tr>
        <tr>
          <th style="text-align: left; padding: 8px 0; color: #64748b;">Timestamp</th>
          <td style="padding: 8px 0;">${new Date().toISOString()}</td>
        </tr>
      </table>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-top: 32px;" />
      <p style="font-size: 11px; color: #94a3b8; text-align: center;">SecuLink Zero-Knowledge Protected Share System</p>
    </div>
  `;

  if (transporter) {
    try {
      await transporter.sendMail({
        from: `SecuLink Vault <${from}>`,
        to: toEmail,
        subject,
        html: htmlContent,
      });
      console.log(`[EMAIL] Dispatched alert to ${toEmail} for event ${event}.`);
    } catch (error) {
      console.error(`[EMAIL] Failed to send email alert to ${toEmail}:`, error);
    }
  } else {
    console.log(`
=========================================
[EMAIL NOTIFICATION FEEDBACK]
To: ${toEmail}
Subject: ${subject}
Event: ${event}
File: ${fileName}
Client IP: ${ipAddress}
Details: ${details}
=========================================
    `);
  }
}
