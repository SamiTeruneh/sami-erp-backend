// emailConfig.js
const nodemailer = require('nodemailer');

// ============ EMAIL CONFIGURATION ============
// For Gmail: Enable 2FA and create an App Password
// https://myaccount.google.com/apppasswords
// Then use that App Password below

const EMAIL_CONFIG = {
  // Option 1: Gmail (recommended for testing)
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-app-password'  // NOT your regular password!
  },

  // Option 2: Custom SMTP (for production)
  // host: 'smtp.yourdomain.com',
  // port: 587,
  // secure: false,
  // auth: {
  //   user: 'noreply@yourdomain.com',
  //   pass: 'your-smtp-password'
  // }
};

// Create transporter
const transporter = nodemailer.createTransport(EMAIL_CONFIG);

// Verify connection
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Email service error:', error.message);
    console.log('⚠️  Password reset emails will NOT be sent.');
    console.log('📧 Configure EMAIL_USER and EMAIL_PASS in emailConfig.js');
  } else {
    console.log('✅ Email service ready');
  }
});

// ============ SEND VERIFICATION CODE ============
async function sendVerificationCode(toEmail, code, userName) {
  const mailOptions = {
    from: `"SAMI ERP" <${EMAIL_CONFIG.auth.user}>`,
    to: toEmail,
    subject: '🔐 Password Reset Code - SAMI ERP',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f3f4f6; padding: 20px; margin: 0; }
          .container { max-width: 500px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #3B82F6, #1E40AF); padding: 30px; text-align: center; color: white; }
          .header h1 { margin: 0; font-size: 28px; }
          .header p { margin: 8px 0 0; opacity: 0.9; font-size: 14px; }
          .body { padding: 30px; }
          .greeting { font-size: 16px; color: #333; margin-bottom: 16px; }
          .code-box { background: #EFF6FF; border: 2px dashed #3B82F6; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; }
          .code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1E40AF; font-family: 'Courier New', monospace; }
          .label { font-size: 12px; color: #6B7280; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
          .info { background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 12px 16px; border-radius: 8px; font-size: 13px; color: #92400E; margin: 20px 0; }
          .warning { background: #FEE2E2; border-left: 4px solid #EF4444; padding: 12px 16px; border-radius: 8px; font-size: 13px; color: #991B1B; margin: 20px 0; }
          .footer { background: #F9FAFB; padding: 20px; text-align: center; font-size: 12px; color: #6B7280; border-top: 1px solid #E5E7EB; }
          .btn { display: inline-block; background: linear-gradient(135deg, #3B82F6, #1E40AF); color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔐 Password Reset</h1>
            <p>SAMI ERP Security</p>
          </div>
          <div class="body">
            <p class="greeting">Hello <strong>${userName}</strong>,</p>
            <p style="color: #4B5563; line-height: 1.6;">
              We received a request to reset your SAMI ERP password. Use the code below to verify your identity:
            </p>
            
            <div class="code-box">
              <div class="label">Your Verification Code</div>
              <div class="code">${code}</div>
            </div>
            
            <div class="info">
              ⏰ <strong>This code expires in 15 minutes.</strong>
            </div>
            
            <div class="warning">
              🛡️ <strong>Security Notice:</strong><br>
              If you didn't request this password reset, please ignore this email. Your account is safe.
            </div>
            
            <p style="color: #4B5563; font-size: 13px; margin-top: 24px;">
              Never share this code with anyone. Our team will never ask for it.
            </p>
          </div>
          <div class="footer">
            <p style="margin: 0;">© 2024 SAMI ERP • Stationery Management System</p>
            <p style="margin: 8px 0 0; opacity: 0.7;">This is an automated message, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
SAMI ERP - Password Reset

Hello ${userName},

Your password reset code is: ${code}

This code expires in 15 minutes.

If you didn't request this, please ignore this email.

© 2024 SAMI ERP
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('📧 Verification email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Failed to send email:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  transporter,
  sendVerificationCode,
  EMAIL_CONFIG
};