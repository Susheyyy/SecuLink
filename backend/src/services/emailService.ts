import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM || 'SecuLink Vault <noreply@seculink.com>';

let resend: Resend | null = null;

if (apiKey) {
  resend = new Resend(apiKey);
  console.log(`[EMAIL] Resend transporter initialized. From: ${from}`);
} else {
  console.log('[EMAIL] RESEND_API_KEY missing in env. Email alerts will fallback to console notifications.');
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

  if (resend) {
    try {
      await resend.emails.send({
        from,
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

export async function sendOtpEmail(
  toEmail: string,
  otpCode: string,
  fileName: string
): Promise<void> {
  const subject = `SecuLink: Your Access Code`;
  const htmlContent = `
    <div style="font-family: sans-serif; padding: 20px; color: #334155; line-height: 1.6;">
      <h2 style="color: #6366f1; margin-bottom: 16px;">SecuLink Access Verification</h2>
      <p>Someone (hopefully you) is attempting to access a protected shared file:</p>
      <p style="font-size: 14px; color: #64748b;"><strong>File:</strong> ${fileName}</p>
      <p>Your one-time access code is:</p>
      <div style="background: #f1f5f9; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
        <span style="font-size: 36px; font-weight: bold; font-family: monospace; letter-spacing: 8px; color: #1e293b;">${otpCode}</span>
      </div>
      <p style="font-size: 13px; color: #94a3b8;">This code expires in 10 minutes. Do not share this code with anyone.</p>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-top: 32px;" />
      <p style="font-size: 11px; color: #94a3b8; text-align: center;">SecuLink Zero-Knowledge Protected Share System</p>
    </div>
  `;

  if (resend) {
    try {
      await resend.emails.send({
        from,
        to: toEmail,
        subject,
        html: htmlContent,
      });
      console.log(`[EMAIL] OTP dispatched to ${toEmail}.`);
    } catch (error) {
      console.error(`[EMAIL] Failed to send OTP to ${toEmail}:`, error);
    }
  } else {
    console.log(`
=========================================
[OTP EMAIL FEEDBACK]
To: ${toEmail}
OTP Code: ${otpCode}
File: ${fileName}
=========================================
    `);
  }
}
