import nodemailer from 'nodemailer'

let _transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter {
  if (_transporter) return _transporter
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) {
    throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD env vars are required for email sending')
  }
  _transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })
  return _transporter
}

function frontendUrl(): string {
  return process.env.FRONTEND_URL ?? 'http://localhost:5173'
}

export async function sendInviteEmail(to: string, token: string): Promise<void> {
  const link = `${frontendUrl()}/create-account?token=${token}`
  await getTransporter().sendMail({
    from: `Trader <${process.env.GMAIL_USER}>`,
    to,
    subject: 'You have been invited to Trader',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Welcome to Trader</h2>
        <p>You have been invited to create an account. Click below to get started.</p>
        <p>This link expires in <strong>7 days</strong>.</p>
        <p>
          <a href="${link}" style="display:inline-block;padding:12px 24px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:6px">
            Create Account
          </a>
        </p>
        <p style="color:#666;font-size:12px">Or copy this link: ${link}</p>
      </div>
    `,
  })
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${frontendUrl()}/reset-password?token=${token}`
  await getTransporter().sendMail({
    from: `Trader <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Password Reset — Trader',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Reset your password</h2>
        <p>Click the link below to reset your Trader password. This link expires in <strong>1 hour</strong>.</p>
        <p>
          <a href="${link}" style="display:inline-block;padding:12px 24px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:6px">
            Reset Password
          </a>
        </p>
        <p style="color:#666;font-size:12px">Or copy this link: ${link}</p>
        <p style="color:#666;font-size:12px">If you did not request a password reset, you can safely ignore this email.</p>
      </div>
    `,
  })
}
