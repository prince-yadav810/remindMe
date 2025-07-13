// ============= EMAIL SYSTEM (utils/email.js) =============
const nodemailer = require('nodemailer');
const crypto = require('crypto');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransporter({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }

  async sendVerificationEmail(user, verificationToken) {
    const verificationUrl = `${process.env.APP_URL}/auth/verify-email?token=${verificationToken}&email=${encodeURIComponent(user.email)}`;
    
    const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verify Your Email - remindME</title>
      <style>
        body { font-family: 'Inter', Arial, sans-serif; margin: 0; padding: 0; background-color: #1f1e1d; color: #e8e8e3; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; padding: 40px 0; }
        .logo { font-size: 32px; font-weight: bold; color: #4accd1; }
        .content { background: #2a2928; border-radius: 12px; padding: 40px; margin: 20px 0; }
        .button { display: inline-block; background: linear-gradient(135deg, #238588, #4accd1); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
        .footer { text-align: center; color: #8a8a88; font-size: 14px; margin-top: 40px; }
        .security-note { background: #3a3a38; padding: 16px; border-radius: 8px; margin: 20px 0; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">🤖 remindME</div>
        </div>
        
        <div class="content">
          <h2 style="color: #4accd1; margin-top: 0;">Welcome to remindME!</h2>
          
          <p>Hi ${user.name},</p>
          
          <p>Thank you for signing up for remindME! To complete your registration and start using your AI personal assistant, please verify your email address by clicking the button below:</p>
          
          <div style="text-align: center;">
            <a href="${verificationUrl}" class="button">Verify My Email</a>
          </div>
          
          <p>This verification link will expire in 24 hours for security reasons.</p>
          
          <div class="security-note">
            <strong>🔒 Security Note:</strong> If you didn't create an account with remindME, please ignore this email. Your email address will not be used unless you complete the verification process.
          </div>
          
          <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #4accd1;">${verificationUrl}</p>
        </div>
        
        <div class="footer">
          <p>This email was sent by remindME. If you have any questions, please contact our support team.</p>
          <p>© ${new Date().getFullYear()} remindME. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>`;

    const mailOptions = {
      from: process.env.EMAIL_FROM || '"remindME" <noreply@remindme.app>',
      to: user.email,
      subject: 'Verify Your Email - Welcome to remindME!',
      html: htmlTemplate
    };

    try {
      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Verification email sent to:', user.email);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('❌ Failed to send verification email:', error);
      throw new Error('Failed to send verification email');
    }
  }

  async sendPasswordResetEmail(user, resetToken) {
    const resetUrl = `${process.env.APP_URL}/auth/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;
    
    const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset - remindME</title>
      <style>
        body { font-family: 'Inter', Arial, sans-serif; margin: 0; padding: 0; background-color: #1f1e1d; color: #e8e8e3; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; padding: 40px 0; }
        .logo { font-size: 32px; font-weight: bold; color: #4accd1; }
        .content { background: #2a2928; border-radius: 12px; padding: 40px; margin: 20px 0; }
        .button { display: inline-block; background: linear-gradient(135deg, #238588, #4accd1); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
        .footer { text-align: center; color: #8a8a88; font-size: 14px; margin-top: 40px; }
        .warning { background: #ff6b6b; color: white; padding: 16px; border-radius: 8px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">🤖 remindME</div>
        </div>
        
        <div class="content">
          <h2 style="color: #4accd1; margin-top: 0;">Password Reset Request</h2>
          
          <p>Hi ${user.name},</p>
          
          <p>We received a request to reset the password for your remindME account. If you made this request, click the button below to create a new password:</p>
          
          <div style="text-align: center;">
            <a href="${resetUrl}" class="button">Reset My Password</a>
          </div>
          
          <p>This password reset link will expire in 1 hour for security reasons.</p>
          
          <div class="warning">
            <strong>⚠️ Important:</strong> If you didn't request a password reset, please ignore this email. Your account is secure and no changes have been made.
          </div>
          
          <p>For your security, here are some details about this request:</p>
          <ul>
            <li>Request time: ${new Date().toLocaleString()}</li>
            <li>IP address: [Your IP would be logged here]</li>
          </ul>
          
          <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #4accd1;">${resetUrl}</p>
        </div>
        
        <div class="footer">
          <p>If you continue to have problems, please contact our support team.</p>
          <p>© ${new Date().getFullYear()} remindME. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>`;

    const mailOptions = {
      from: process.env.EMAIL_FROM || '"remindME" <noreply@remindme.app>',
      to: user.email,
      subject: 'Reset Your Password - remindME',
      html: htmlTemplate
    };

    try {
      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Password reset email sent to:', user.email);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('❌ Failed to send password reset email:', error);
      throw new Error('Failed to send password reset email');
    }
  }

  async sendWelcomeEmail(user) {
    const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to remindME!</title>
      <style>
        body { font-family: 'Inter', Arial, sans-serif; margin: 0; padding: 0; background-color: #1f1e1d; color: #e8e8e3; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; padding: 40px 0; }
        .logo { font-size: 32px; font-weight: bold; color: #4accd1; }
        .content { background: #2a2928; border-radius: 12px; padding: 40px; margin: 20px 0; }
        .button { display: inline-block; background: linear-gradient(135deg, #238588, #4accd1); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 20px 0; }
        .feature { background: rgba(35, 133, 136, 0.1); padding: 20px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #4accd1; }
        .footer { text-align: center; color: #8a8a88; font-size: 14px; margin-top: 40px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">🤖 remindME</div>
        </div>
        
        <div class="content">
          <h2 style="color: #4accd1; margin-top: 0;">Welcome to your AI Assistant!</h2>
          
          <p>Hi ${user.name},</p>
          
          <p>Your email has been verified and you're now ready to experience the power of AI-assisted personal management! 🎉</p>
          
          <div style="text-align: center;">
            <a href="${process.env.APP_URL}/app" class="button">Start Using remindME</a>
          </div>
          
          <h3 style="color: #4accd1;">Here's what you can do with remindME:</h3>
          
          <div class="feature">
            <h4>💬 Natural Conversations</h4>
            <p>Chat with your AI assistant using natural language. Just say "Remind me to call Mom tomorrow" and it's done!</p>
          </div>
          
          <div class="feature">
            <h4>📄 Smart File Processing</h4>
            <p>Upload documents, PDFs, or images and ask questions about them. Your AI remembers everything!</p>
          </div>
          
          <div class="feature">
            <h4>⏰ Intelligent Reminders</h4>
            <p>Set context-aware reminders that understand your schedule and preferences.</p>
          </div>
          
          <div class="feature">
            <h4>🧠 Memory Assistant</h4>
            <p>Never forget important information again. remindME organizes and categorizes everything automatically.</p>
          </div>
          
          <p><strong>Getting Started Tips:</strong></p>
          <ul>
            <li>Try saying: "What's on my schedule today?"</li>
            <li>Upload a document and ask: "What are the key points in this file?"</li>
            <li>Set a reminder: "Remind me to review the proposal next Monday at 2 PM"</li>
          </ul>
          
          <p>We're excited to see how remindME helps you stay organized and productive!</p>
        </div>
        
        <div class="footer">
          <p>Need help? Check out our <a href="${process.env.APP_URL}/help" style="color: #4accd1;">Help Center</a> or contact support.</p>
          <p>© ${new Date().getFullYear()} remindME. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>`;

    const mailOptions = {
      from: process.env.EMAIL_FROM || '"remindME" <noreply@remindme.app>',
      to: user.email,
      subject: 'Welcome to remindME - Your AI Assistant is Ready!',
      html: htmlTemplate
    };

    try {
      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Welcome email sent to:', user.email);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('❌ Failed to send welcome email:', error);
      // Don't throw error for welcome emails as they're not critical
      return { success: false, error: error.message };
    }
  }

  generateVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
  }
}

module.exports = new EmailService();

// ============= ENHANCED AUTH ROUTES WITH EMAIL VERIFICATION =============
// Add these routes to your auth.js file:

const emailService = require('../utils/email');

// Enhanced signup with email verification
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation (same as before)
    if (!name || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    if (password.length < 8) {
      return res.status(400).json({ 
        success: false, 
        message: 'Password must be at least 8 characters long' 
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      if (!existingUser.isEmailVerified) {
        // User exists but email not verified - resend verification
        const verificationToken = emailService.generateVerificationToken();
        existingUser.emailVerificationToken = verificationToken;
        existingUser.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        await existingUser.save();

        await emailService.sendVerificationEmail(existingUser, verificationToken);
        
        return res.status(200).json({
          success: true,
          message: 'Account exists but email not verified. New verification email sent.',
          requiresVerification: true
        });
      }
      
      return res.status(400).json({ 
        success: false, 
        message: 'User with this email already exists' 
      });
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Generate verification token
    const verificationToken = emailService.generateVerificationToken();

    // Create user (not verified initially)
    const user = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      authProvider: 'local',
      isEmailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      profile: {
        firstName: name.split(' ')[0],
        lastName: name.split(' ').slice(1).join(' ') || '',
        joinedAt: new Date()
      },
      preferences: {
        theme: 'dark',
        timezone: 'UTC',
        notifications: {
          email: true,
          push: true,
          reminder: true
        }
      }
    });

    await user.save();

    // Send verification email
    try {
      await emailService.sendVerificationEmail(user, verificationToken);
    } catch (emailError) {
      console.error('Failed to send verification email:', emailError);
      // Continue anyway - user can request resend
    }

    res.status(201).json({
      success: true,
      message: 'Account created successfully! Please check your email to verify your account.',
      requiresVerification: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Email verification route
router.get('/verify-email', async (req, res) => {
  try {
    const { token, email } = req.query;

    if (!token || !email) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification link'
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification link'
      });
    }

    // Verify the user
    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    // Send welcome email
    try {
      await emailService.sendWelcomeEmail(user);
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
    }

    // Redirect to success page or login
    res.redirect('/auth?verified=true');
    
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification failed'
    });
  }
});

// Resend verification email
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const user = await User.findOne({ 
      email: email.toLowerCase(),
      isEmailVerified: false 
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found or already verified'
      });
    }

    // Generate new verification token
    const verificationToken = emailService.generateVerificationToken();
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    // Send verification email
    await emailService.sendVerificationEmail(user, verificationToken);

    res.json({
      success: true,
      message: 'Verification email sent successfully'
    });

  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend verification email'
    });
  }
});

// Forgot password route
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    // Always return success for security (don't reveal if email exists)
    if (!user) {
      return res.json({
        success: true,
        message: 'If an account with that email exists, we sent a password reset link.'
      });
    }

    // Generate reset token
    const resetToken = emailService.generateResetToken();
    user.passwordResetToken = resetToken;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // Send reset email
    await emailService.sendPasswordResetEmail(user, resetToken);

    res.json({
      success: true,
      message: 'If an account with that email exists, we sent a password reset link.'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process password reset request'
    });
  }
});

// Reset password route
router.post('/reset-password', async (req, res) => {
  try {
    const { token, email, newPassword } = req.body;

    if (!token || !email || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      passwordResetToken: token,
      passwordResetExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset link'
      });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update user
    user.password = hashedPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  }
});

// Enhanced login to check email verification
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }

    // Check if email is verified
    if (!user.isEmailVerified && user.authProvider === 'local') {
      return res.status(401).json({
        success: false,
        message: 'Please verify your email before logging in',
        requiresVerification: true
      });
    }

    // Check OAuth provider
    if (user.authProvider !== 'local') {
      return res.status(401).json({ 
        success: false, 
        message: `Please sign in with ${user.authProvider}` 
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }

    // Update last login and generate session
    user.lastLogin = new Date();
    const sessionId = `session-${user._id}-${Date.now()}`;
    user.sessionId = sessionId;
    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user._id, 
        email: user.email,
        sessionId: sessionId
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set HTTP-only cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        sessionId: sessionId,
        profile: user.profile,
        isEmailVerified: user.isEmailVerified
      },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// ============= UPDATED USER MODEL =============
// Add these fields to your User schema in models/user.js:

/*
// Email verification fields
isEmailVerified: { type: Boolean, default: false },
emailVerificationToken: { type: String },
emailVerificationExpires: { type: Date },

// Password reset fields  
passwordResetToken: { type: String },
passwordResetExpires: { type: Date },
*/