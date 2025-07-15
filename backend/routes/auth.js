// ============= backend/routes/auth.js (UPDATED WITH OTP FUNCTIONALITY) =============
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/user');
const emailService = require('../utils/email-service');

const router = express.Router();

// JWT Secret from environment
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 password reset attempts per hour
  message: {
    success: false,
    message: 'Too many password reset attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Signup endpoint
router.post('/signup', authLimiter, async (req, res) => {
  try {
    console.log('📝 Signup attempt:', req.body.email);
    
    const { name, email, password } = req.body;

    // Input validation
    if (!name || !email || !password) {
      console.log('❌ Missing fields');
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    if (password.length < 8) {
      console.log('❌ Password too short');
      return res.status(400).json({ 
        success: false, 
        message: 'Password must be at least 8 characters long' 
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      console.log('❌ User already exists:', email);
      return res.status(400).json({ 
        success: false, 
        message: 'User with this email already exists' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    console.log('🔐 Password hashed successfully');

    // Create new user
    const user = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      authProvider: 'local',
      profile: {
        firstName: name.split(' ')[0],
        lastName: name.split(' ').slice(1).join(' ') || ''
      }
    });

    // Save user to database
    await user.save();
    console.log('💾 User saved to database');

    // Generate session ID
    const sessionId = `session-${user._id}-${Date.now()}`;
    user.sessionId = sessionId;
    await user.save();

    console.log('✅ Signup successful for:', email);

    // Send success response
    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        sessionId: sessionId
      }
    });

  } catch (error) {
    console.error('❌ Signup error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during signup' 
    });
  }
});

// Login endpoint
router.post('/login', authLimiter, async (req, res) => {
  try {
    console.log('🔑 Login attempt:', req.body.email);
    
    const { email, password } = req.body;

    // Input validation
    if (!email || !password) {
      console.log('❌ Missing email or password');
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    // Find user in database
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.log('❌ User not found:', email);
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.log('❌ Invalid password for:', email);
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }

    // Update login information
    const sessionId = `session-${user._id}-${Date.now()}`;
    user.sessionId = sessionId;
    user.lastLogin = new Date();
    user.stats.lastActiveAt = new Date();
    
    // Clear any existing password reset OTP on successful login
    user.clearPasswordResetOTP();
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

    // Set secure cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    console.log('✅ Login successful for:', email);

    // Send success response
    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        sessionId: sessionId,
        profile: user.profile
      },
      token
    });

  } catch (error) {
    console.error('❌ Login error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during login' 
    });
  }
});

// Forgot Password endpoint - Send OTP
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    console.log('🔑 Forgot password request');
    
    const { email } = req.body;

    // Input validation
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required'
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    
    // Always return success for security (don't reveal if email exists)
    const successMessage = 'If an account with this email exists, you will receive a verification code shortly.';
    
    if (!user) {
      console.log('❌ Password reset requested for non-existent email:', email);
      return res.json({
        success: true,
        message: successMessage
      });
    }

    // Check if user is using OAuth (can't reset password for OAuth users)
    if (user.authProvider !== 'local') {
      console.log('❌ Password reset requested for OAuth user:', email);
      return res.json({
        success: true,
        message: successMessage
      });
    }

    // Generate OTP
    const otp = user.generatePasswordResetOTP();
    await user.save();

    console.log(`🔢 OTP generated for ${email}: ${otp}`);

    // Send OTP via email
    try {
      await emailService.sendPasswordResetOTP(user, otp);
      console.log(`✅ OTP email sent to: ${email}`);
    } catch (emailError) {
      console.error('❌ Failed to send OTP email:', emailError);
      
      // Clear the OTP if email failed
      user.clearPasswordResetOTP();
      await user.save();
      
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification code. Please try again.'
      });
    }

    res.json({
      success: true,
      message: successMessage
    });

  } catch (error) {
    console.error('❌ Forgot password error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again later.'
    });
  }
});

// Reset Password endpoint - Verify OTP and reset password
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    console.log('🔄 Password reset attempt');
    
    const { email, otp, newPassword } = req.body;

    // Input validation
    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, verification code, and new password are required'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long'
      });
    }

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: 'Verification code must be exactly 6 digits'
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code or email address'
      });
    }

    // Check if user is using OAuth
    if (user.authProvider !== 'local') {
      return res.status(400).json({
        success: false,
        message: 'Cannot reset password for social login accounts'
      });
    }

    // Verify OTP
    const otpVerification = user.verifyPasswordResetOTP(otp);
    
    if (!otpVerification.isValid) {
      await user.save(); // Save the updated attempt count
      return res.status(400).json({
        success: false,
        message: otpVerification.reason
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update user password and clear OTP
    user.password = hashedPassword;
    user.clearPasswordResetOTP();
    
    // Invalidate all existing sessions for security
    user.sessionId = null;
    
    await user.save();

    console.log(`✅ Password reset successful for: ${email}`);

    // Send success notification email
    try {
      await emailService.sendPasswordResetSuccessNotification(user);
    } catch (emailError) {
      console.error('❌ Failed to send success notification:', emailError);
      // Continue anyway - the password was reset successfully
    }

    res.json({
      success: true,
      message: 'Password reset successful. You can now sign in with your new password.'
    });

  } catch (error) {
    console.error('❌ Reset password error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again later.'
    });
  }
});

// Logout endpoint
router.post('/logout', async (req, res) => {
  try {
    console.log('👋 Logout request');
    
    // Clear the authentication cookie
    res.clearCookie('auth_token');
    
    // Optional: Invalidate session in database
    const token = req.cookies.auth_token;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        await User.findByIdAndUpdate(decoded.userId, { sessionId: null });
      } catch (error) {
        // Token invalid, but still clear cookie
        console.log('⚠️ Invalid token during logout');
      }
    }

    console.log('✅ Logout successful');
    res.json({ success: true, message: 'Logged out successfully' });

  } catch (error) {
    console.error('❌ Logout error:', error.message);
    res.clearCookie('auth_token');
    res.json({ success: true, message: 'Logged out successfully' });
  }
});

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const token = req.cookies.auth_token || req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access token required' 
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Find user and check session
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    if (user.sessionId !== decoded.sessionId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Session expired. Please log in again.' 
      });
    }

    // Add user to request object
    req.user = user;
    req.sessionId = decoded.sessionId;
    next();

  } catch (error) {
    console.error('❌ Authentication error:', error.message);
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid or expired token' 
    });
  }
};

// Get user profile endpoint
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    console.log('👤 Profile request for user:', req.user.email);
    
    const user = await User.findById(req.user._id).select('-password');
    
    res.json({
      success: true,
      user: user
    });

  } catch (error) {
    console.error('❌ Profile error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching profile' 
    });
  }
});

// Update user profile endpoint
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    console.log('📝 Profile update for user:', req.user.email);
    
    const { name, preferences } = req.body;
    
    const updateData = {};
    if (name) {
      updateData.name = name;
      updateData['profile.firstName'] = name.split(' ')[0];
      updateData['profile.lastName'] = name.split(' ').slice(1).join(' ') || '';
    }
    if (preferences) {
      updateData.preferences = { ...req.user.preferences, ...preferences };
    }
    updateData.updatedAt = new Date();

    const user = await User.findByIdAndUpdate(
      req.user._id, 
      updateData, 
      { new: true }
    ).select('-password');

    console.log('✅ Profile updated successfully');

    res.json({
      success: true,
      user: user
    });

  } catch (error) {
    console.error('❌ Profile update error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating profile' 
    });
  }
});

// Test email endpoint (for development only)
router.post('/test-email', async (req, res) => {
  try {
    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ message: 'Not found' });
    }

    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required'
      });
    }

    await brevoEmailService.sendTestEmail(email);
    
    res.json({
      success: true,
      message: 'Test email sent successfully'
    });

  } catch (error) {
    console.error('❌ Test email error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to send test email',
      error: error.message
    });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Auth service is healthy',
    timestamp: new Date().toISOString()
  });
});

// Export router and middleware
module.exports = { router, authenticateToken };