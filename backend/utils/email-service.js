// utils/email-service.js - Email service with matching auth page design
const axios = require('axios');
const nodemailer = require('nodemailer');
const path = require('path');

// Force reload environment variables
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

class HybridEmailService {
  constructor() {
    this.loadEnvironment();
    
    // Brevo configuration
    this.brevoApiKey = process.env.BREVO_API_KEY;
    this.brevoSenderEmail = process.env.BREVO_SENDER_EMAIL || 'remindme810@gmail.com';
    this.brevoSenderName = process.env.BREVO_SENDER_NAME || 'remindME Support';
    this.brevoApiUrl = 'https://api.brevo.com/v3/smtp/email';
    
    // Gmail configuration
    this.gmailUser = process.env.GMAIL_USER || 'remindme810@gmail.com';
    this.gmailPassword = process.env.GMAIL_APP_PASSWORD;
    
    // Setup Gmail transporter
    this.setupGmailTransporter();
    
    console.log('🔍 Hybrid Email Service Init:');
    console.log('  Brevo API Key:', this.brevoApiKey ? 'YES' : 'NO');
    console.log('  Gmail User:', this.gmailUser);
    console.log('  Gmail Password:', this.gmailPassword ? 'YES' : 'NO');
    console.log('  Mode: HYBRID (Brevo primary, Gmail backup)');
  }

  loadEnvironment() {
    const envPaths = [
      path.join(__dirname, '../../.env'),
      path.join(__dirname, '../.env'),
      path.join(process.cwd(), '.env')
    ];
    
    for (const envPath of envPaths) {
      try {
        require('dotenv').config({ path: envPath, override: true });
      } catch (error) {
        // Continue trying other paths
      }
    }
  }

  setupGmailTransporter() {
    if (this.gmailPassword) {
      try {
        this.gmailTransporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: this.gmailUser,
            pass: this.gmailPassword
          }
        });
        console.log('✅ Gmail transporter configured successfully');
      } catch (error) {
        console.error('❌ Gmail transporter setup failed:', error.message);
      }
    } else {
      console.log('⚠️  Gmail app password not configured');
    }
  }

  // Get the base email template that matches auth page design
  getEmailTemplate(title, content) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - remindME</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
          background: linear-gradient(135deg, #1f1e1d 0%, #2a2928 50%, #1f1e1d 100%);
          color: #e8e8e3;
          min-height: 100vh;
          margin: 0;
          padding: 0;
        }
        
        .email-container {
          max-width: 600px;
          margin: 0 auto;
          background: linear-gradient(135deg, #1f1e1d 0%, #2a2928 50%, #1f1e1d 100%);
          min-height: 100vh;
        }
        
        .header {
          padding: 40px 20px;
          text-align: center;
          border-bottom: 1px solid #3a3a38;
        }
        
        .logo {
          display: inline-flex;
          align-items: center;
          font-size: 32px;
          font-weight: 700;
          color: #e8e8e3;
          text-decoration: none;
          margin-bottom: 10px;
        }
        
        .logo-icon {
          margin-right: 12px;
          color: #238588;
          font-size: 36px;
        }
        
        .tagline {
          color: #b8b8b3;
          font-size: 16px;
          margin: 0;
        }
        
        .content-card {
          margin: 40px 20px;
          padding: 40px;
          background: rgba(34, 33, 33, 0.8);
          backdrop-filter: blur(20px);
          border-radius: 20px;
          border: 1px solid #3a3a38;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        }
        
        .content-title {
          font-size: 28px;
          font-weight: 700;
          color: #4accd1;
          text-align: center;
          margin-bottom: 20px;
        }
        
        .greeting {
          font-size: 16px;
          color: #e8e8e3;
          margin-bottom: 24px;
        }
        
        .highlight {
          color: #4accd1;
          font-weight: 600;
        }
        
        .otp-container {
          background: linear-gradient(135deg, #238588, #4accd1);
          border-radius: 16px;
          padding: 30px;
          text-align: center;
          margin: 30px 0;
          position: relative;
          overflow: hidden;
        }
        
        .otp-container::before {
          content: '';
          position: absolute;
          top: -50%;
          left: -50%;
          width: 200%;
          height: 200%;
          background: linear-gradient(45deg, transparent, rgba(255,255,255,0.1), transparent);
          animation: shimmer 3s infinite;
        }
        
        @keyframes shimmer {
          0% { transform: translateX(-100%) translateY(-100%) rotate(30deg); }
          100% { transform: translateX(100%) translateY(100%) rotate(30deg); }
        }
        
        .otp-label {
          color: rgba(255,255,255,0.9);
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 16px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        
        .otp-code {
          font-size: 48px;
          font-weight: 700;
          color: white;
          letter-spacing: 12px;
          font-family: 'Courier New', monospace;
          margin: 20px 0;
          text-shadow: 0 4px 8px rgba(0,0,0,0.3);
          position: relative;
          z-index: 1;
        }
        
        .otp-note {
          color: rgba(255,255,255,0.8);
          font-size: 14px;
          margin: 0;
          position: relative;
          z-index: 1;
        }
        
        .info-box {
          background: rgba(255, 193, 7, 0.1);
          border: 1px solid rgba(255, 193, 7, 0.3);
          border-radius: 12px;
          padding: 20px;
          margin: 25px 0;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .info-icon {
          color: #ffc107;
          font-size: 20px;
          flex-shrink: 0;
        }
        
        .info-text {
          color: #e8e8e3;
          font-size: 15px;
          font-weight: 500;
        }
        
        .security-section {
          background: rgba(35, 133, 136, 0.1);
          border: 1px solid rgba(35, 133, 136, 0.3);
          border-radius: 12px;
          padding: 24px;
          margin: 25px 0;
        }
        
        .security-title {
          color: #4accd1;
          font-weight: 600;
          font-size: 16px;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .security-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        
        .security-list li {
          color: #b8b8b3;
          font-size: 14px;
          padding: 6px 0;
          padding-left: 20px;
          position: relative;
          line-height: 1.5;
        }
        
        .security-list li::before {
          content: '•';
          color: #4accd1;
          font-weight: bold;
          position: absolute;
          left: 0;
        }
        
        .success-container {
          background: linear-gradient(135deg, #22c55e, #16a34a);
          border-radius: 16px;
          padding: 30px;
          text-align: center;
          margin: 30px 0;
        }
        
        .success-icon {
          font-size: 64px;
          color: white;
          margin-bottom: 20px;
        }
        
        .success-title {
          font-size: 24px;
          font-weight: 700;
          color: white;
          margin-bottom: 16px;
        }
        
        .success-message {
          color: rgba(255,255,255,0.9);
          font-size: 16px;
          line-height: 1.5;
        }
        
        .button {
          display: inline-block;
          background: linear-gradient(135deg, #238588, #4accd1);
          color: white;
          padding: 16px 32px;
          text-decoration: none;
          border-radius: 12px;
          font-weight: 600;
          font-size: 16px;
          margin: 20px 0;
          transition: transform 0.3s ease;
        }
        
        .button:hover {
          transform: translateY(-2px);
        }
        
        .footer {
          padding: 40px 20px;
          text-align: center;
          border-top: 1px solid #3a3a38;
          color: #8a8a88;
          font-size: 14px;
        }
        
        .footer-links {
          margin: 20px 0;
        }
        
        .footer-link {
          color: #4accd1;
          text-decoration: none;
          margin: 0 15px;
          transition: color 0.3s ease;
        }
        
        .footer-link:hover {
          color: #238588;
        }
        
        @media (max-width: 600px) {
          .content-card {
            margin: 20px 10px;
            padding: 20px;
          }
          
          .otp-code {
            font-size: 36px;
            letter-spacing: 8px;
          }
          
          .content-title {
            font-size: 24px;
          }
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="header">
          <div class="logo">
            <span class="logo-icon">🤖</span>
            remindME
          </div>
          <p class="tagline">Your AI Personal Assistant</p>
        </div>
        
        <div class="content-card">
          ${content}
        </div>
        
        <div class="footer">
          <div class="footer-links">
            <a href="#" class="footer-link">Help Center</a>
            <a href="#" class="footer-link">Contact Support</a>
            <a href="#" class="footer-link">Privacy Policy</a>
          </div>
          <p>© ${new Date().getFullYear()} remindME. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>`;
  }

  async sendEmail(to, subject, htmlContent, textContent = null) {
    console.log(`📧 Attempting to send email to: ${to}`);
    
    let brevoError;
    
    // Try Brevo first
    if (this.brevoApiKey) {
      try {
        console.log('🚀 Trying Brevo API...');
        const result = await this.sendViaBrevo(to, subject, htmlContent, textContent);
        console.log('✅ SUCCESS: Email sent via Brevo!');
        return result;
      } catch (error) {
        brevoError = error;
        console.log('❌ Brevo failed:', error.message);
        
        if (error.message.includes('not yet activated') || error.message.includes('permission_denied')) {
          console.log('🔄 Brevo SMTP not activated, trying Gmail backup...');
        } else {
          console.log('🔄 Brevo error, trying Gmail backup...');
        }
      }
    }

    // Try Gmail backup
    if (this.gmailTransporter) {
      try {
        console.log('📧 Trying Gmail SMTP...');
        const result = await this.sendViaGmail(to, subject, htmlContent, textContent);
        console.log('✅ SUCCESS: Email sent via Gmail backup!');
        return result;
      } catch (gmailError) {
        console.log('❌ Gmail backup also failed:', gmailError.message);
        throw new Error(`Both email services failed. Brevo: ${brevoError?.message || 'not configured'}, Gmail: ${gmailError.message}`);
      }
    }

    // If no email service is configured, fall back to development mode
    console.log('⚠️  No email service configured, using development mode');
    return this.developmentMode(to, subject, textContent);
  }

  async sendViaBrevo(to, subject, htmlContent, textContent) {
    const emailData = {
      sender: {
        email: this.brevoSenderEmail,
        name: this.brevoSenderName
      },
      to: [{ email: to, name: to.split('@')[0] }],
      subject: subject,
      htmlContent: htmlContent
    };

    if (textContent) {
      emailData.textContent = textContent;
    }

    const response = await axios.post(this.brevoApiUrl, emailData, {
      headers: {
        'accept': 'application/json',
        'api-key': this.brevoApiKey,
        'content-type': 'application/json'
      },
      timeout: 10000
    });

    return {
      success: true,
      messageId: response.data.messageId,
      service: 'brevo',
      response: response.data
    };
  }

  async sendViaGmail(to, subject, htmlContent, textContent) {
    const mailOptions = {
      from: `"${this.brevoSenderName}" <${this.gmailUser}>`,
      to: to,
      subject: subject,
      html: htmlContent,
      text: textContent
    };

    const result = await this.gmailTransporter.sendMail(mailOptions);
    
    return {
      success: true,
      messageId: result.messageId,
      service: 'gmail',
      response: result
    };
  }

  developmentMode(to, subject, textContent) {
    console.log('\n📧 =============== EMAIL (DEV MODE) ===============');
    console.log(`📤 To: ${to}`);
    console.log(`📋 Subject: ${subject}`);
    console.log(`📝 Content: ${textContent || 'HTML email content'}`);
    console.log('💡 Configure Brevo API key or Gmail app password for real emails');
    console.log('================================================\n');
    
    return {
      success: true,
      messageId: `dev-${Date.now()}`,
      service: 'development'
    };
  }

  async sendPasswordResetOTP(user, otp) {
    const subject = 'Password Reset Code - remindME';
    
    const content = `
      <h2 class="content-title">Password Reset Request</h2>
      
      <p class="greeting">Hi <span class="highlight">${user.name}</span>,</p>
      
      <p style="color: #e8e8e3; margin-bottom: 24px; line-height: 1.6;">
        We received a request to reset the password for your remindME account. Use the verification code below to proceed with resetting your password:
      </p>
      
      <div class="otp-container">
        <div class="otp-label">Your Verification Code</div>
        <div class="otp-code">${otp}</div>
        <p class="otp-note">Enter this code in the password reset form</p>
      </div>
      
      <div class="info-box">
        <span class="info-icon">⏰</span>
        <span class="info-text"><strong>This code expires in 10 minutes</strong> for your security.</span>
      </div>
      
      <p style="color: #e8e8e3; margin-bottom: 24px; line-height: 1.6;">
        If you didn't request a password reset, please ignore this email. Your account remains secure and no changes have been made.
      </p>
      
      <div class="security-section">
        <div class="security-title">
          🔒 Security Information
        </div>
        <ul class="security-list">
          <li>Never share this code with anyone</li>
          <li>remindME will never ask for your code via phone or email</li>
          <li>This code can only be used once</li>
          <li>If you didn't request this, please secure your account immediately</li>
        </ul>
      </div>
      
      <p style="color: #b8b8b3; font-size: 14px; margin-top: 30px; text-align: center;">
        <strong>Need help?</strong> Contact our support team if you have any questions about this password reset request.
      </p>
    `;

    const textContent = `
    Password Reset Code - remindME
    
    Hi ${user.name},
    
    We received a request to reset the password for your remindME account.
    
    Your verification code is: ${otp}
    
    This code expires in 10 minutes for your security.
    
    If you didn't request a password reset, please ignore this email.
    
    Security reminders:
    - Never share this code with anyone
    - remindME will never ask for your code via phone or email
    - This code can only be used once
    
    Need help? Contact our support team.
    
    © ${new Date().getFullYear()} remindME. All rights reserved.
    `;

    const htmlContent = this.getEmailTemplate('Password Reset Code', content);

    try {
      const result = await this.sendEmail(user.email, subject, htmlContent, textContent);
      console.log(`✅ Password reset OTP sent to: ${user.email} via ${result.service}`);
      return result;
    } catch (error) {
      console.error('❌ Failed to send password reset OTP:', error);
      throw error;
    }
  }

  async sendPasswordResetSuccessNotification(user) {
    const subject = 'Password Successfully Reset - remindME';
    
    const content = `
      <div class="success-container">
        <div class="success-icon">✅</div>
        <h2 class="success-title">Password Reset Successful!</h2>
        <p class="success-message">Your password has been successfully updated and your account is secure.</p>
      </div>
      
      <p class="greeting">Hi <span class="highlight">${user.name}</span>,</p>
      
      <p style="color: #e8e8e3; margin-bottom: 24px; line-height: 1.6;">
        Great news! Your password has been successfully reset. You can now sign in to your remindME account using your new password.
      </p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${process.env.APP_URL || 'http://localhost:3001'}/auth" class="button">
          Sign In to remindME
        </a>
      </div>
      
      <div class="info-box">
        <span class="info-icon">🔒</span>
        <span class="info-text"><strong>Security note:</strong> If you didn't make this change, please contact our support team immediately.</span>
      </div>
      
      <p style="color: #b8b8b3; font-size: 14px; margin-top: 30px; text-align: center;">
        Keep your account secure by using a strong, unique password and enabling two-factor authentication when available.
      </p>
    `;

    const textContent = `
    Password Reset Successful - remindME
    
    Hi ${user.name},
    
    Great news! Your password has been successfully reset.
    
    You can now sign in to your remindME account using your new password.
    
    Sign in at: ${process.env.APP_URL || 'http://localhost:3001'}/auth
    
    Security note: If you didn't make this change, please contact our support team immediately.
    
    © ${new Date().getFullYear()} remindME. All rights reserved.
    `;

    const htmlContent = this.getEmailTemplate('Password Reset Successful', content);

    try {
      const result = await this.sendEmail(user.email, subject, htmlContent, textContent);
      console.log(`✅ Password reset success notification sent to: ${user.email}`);
      return result;
    } catch (error) {
      console.error('❌ Failed to send password reset success notification:', error);
      return { success: false, error: error.message };
    }
  }

  async sendTestEmail(toEmail) {
    const subject = 'TEST: remindME Email Service Working!';
    
    const content = `
      <h2 class="content-title">🎉 Email Service Test</h2>
      
      <p class="greeting">Hi there!</p>
      
      <p style="color: #e8e8e3; margin-bottom: 24px; line-height: 1.6;">
        Congratulations! If you're reading this email, your remindME email service is working perfectly.
      </p>
      
      <div class="info-box">
        <span class="info-icon">✅</span>
        <span class="info-text">All email systems are operational and ready for production.</span>
      </div>
      
      <div style="background: rgba(35, 133, 136, 0.1); border: 1px solid rgba(35, 133, 136, 0.3); border-radius: 12px; padding: 20px; margin: 25px 0;">
        <h4 style="color: #4accd1; margin-bottom: 16px;">📊 Service Status:</h4>
        <ul style="list-style: none; padding: 0; margin: 0;">
          <li style="color: #e8e8e3; padding: 4px 0; padding-left: 20px; position: relative;">
            <span style="color: #4accd1; position: absolute; left: 0;">•</span>
            Brevo API: ${this.brevoApiKey ? 'Configured ✅' : 'Not configured ⚠️'}
          </li>
          <li style="color: #e8e8e3; padding: 4px 0; padding-left: 20px; position: relative;">
            <span style="color: #4accd1; position: absolute; left: 0;">•</span>
            Gmail SMTP: ${this.gmailPassword ? 'Configured ✅' : 'Not configured ⚠️'}
          </li>
          <li style="color: #e8e8e3; padding: 4px 0; padding-left: 20px; position: relative;">
            <span style="color: #4accd1; position: absolute; left: 0;">•</span>
            Hybrid Fallback: Active ✅
          </li>
        </ul>
      </div>
      
      <p style="color: #b8b8b3; font-size: 14px; margin-top: 30px; text-align: center;">
        Test completed at: ${new Date().toISOString()}
      </p>
    `;

    const textContent = `
    remindME Email Service Test
    
    Congratulations! If you're reading this email, your remindME email service is working perfectly.
    
    Service Status:
    - Brevo API: ${this.brevoApiKey ? 'Configured' : 'Not configured'}
    - Gmail SMTP: ${this.gmailPassword ? 'Configured' : 'Not configured'}
    - Hybrid Fallback: Active
    
    All email systems are operational and ready for production.
    
    Test completed at: ${new Date().toISOString()}
    
    © ${new Date().getFullYear()} remindME. All rights reserved.
    `;

    const htmlContent = this.getEmailTemplate('Email Service Test', content);

    try {
      return await this.sendEmail(toEmail, subject, htmlContent, textContent);
    } catch (error) {
      console.error('❌ Test email failed:', error);
      throw error;
    }
  }
}

module.exports = new HybridEmailService();