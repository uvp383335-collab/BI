import { Resend } from 'resend'

// Chooses Gmail SMTP in development (or when USE_GMAIL_FOR_DEV=true), Resend in production.
// Environment variables used for Gmail (development):
//   GMAIL_USER - sender Gmail address (e.g. info@yourdomain.com)
//   GMAIL_APP_PASSWORD - an App Password generated for the Gmail account
//
// For Resend (production):
//   RESEND_API_KEY - Resend API key
// Common:
//   EMAIL_FROM - optional from address override (defaults to no-reply@example.com)

async function send(to: string, subject: string, html: string, text: string) {
  const FROM_EMAIL = process.env.EMAIL_FROM || 'no-reply@example.com'

  const useGmail = (process.env.USE_GMAIL_FOR_DEV === 'true') || process.env.NODE_ENV === 'development'

  if (useGmail) {
    // Development path: send via Gmail SMTP using nodemailer.
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      // eslint-disable-next-line no-console
      console.warn(`[email:dev] GMAIL_USER or GMAIL_APP_PASSWORD not set. Would send to ${to}: ${subject}\n${text}`)
      return
    }

    // Dynamic import to avoid loading nodemailer in environments that won't use it.
    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    })

    await transporter.sendMail({ from: FROM_EMAIL, to, subject, text, html })
    return
  }

  // Production/default path: Resend
  if (!process.env.RESEND_API_KEY) {
    // In local/dev environments without a configured provider, log instead of failing the request.
    // eslint-disable-next-line no-console
    console.warn(`[email:dev] RESEND_API_KEY not set. Would send to ${to}: ${subject}\n${text}`)
    return
  }

  const resend = new Resend(process.env.RESEND_API_KEY || 're_placeholder')
  await resend.emails.send({ from: FROM_EMAIL, to, subject, html, text })
}

export async function sendVerificationEmail(to: string, token: string) {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

  const link = `${FRONTEND_URL}/verify-email?token=${token}`
  const subject = 'Verify your email address'
  const text = `Welcome! Please verify your email by visiting: ${link}\nThis link expires in 24 hours.`
  const html = `<p>Welcome! Please verify your email by clicking the link below.</p><p><a href="${link}">Verify email</a></p><p>This link expires in 24 hours.</p>`
  await send(to, subject, html, text)
}

export async function sendInvitationEmail(
  to: string,
  token: string,
  orgName: string,
  inviterName?: string,
) {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

  const link = `${FRONTEND_URL}/accept-invitation?token=${token}`
  const subject = `You're invited to join ${orgName}`
  const inviter = inviterName ? `${inviterName} has invited` : 'You have been invited'
  const text = `${inviter} you to join ${orgName}. Accept your invitation: ${link}\nThis link expires in 7 days.`
  const html = `<p>${inviter} you to join <strong>${orgName}</strong>.</p><p><a href="${link}">Accept invitation</a></p><p>This link expires in 7 days.</p>`
  await send(to, subject, html, text)
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

  const link = `${FRONTEND_URL}/reset-password?token=${token}`
  const subject = 'Reset your password'
  const text = `Reset your password by visiting: ${link}\nThis link expires in 1 hour. If you did not request this, ignore this email.`
  const html = `<p>Reset your password by clicking the link below.</p><p><a href="${link}">Reset password</a></p><p>This link expires in 1 hour. If you did not request this, ignore this email.</p>`
  await send(to, subject, html, text)
}
