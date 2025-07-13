// ============= AUTH ROUTES (auth.js) =============
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const AppleStrategy = require('passport-apple').Strategy;
const { User } = require('./models/user');

const router = express.Router();

// JWT Secret (add to .env file)
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';

// ============= LOCAL AUTHENTICATION =============

// Signup Route
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation
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
      return res.status(400).json({ 
        success: false, 
        message: 'User with this email already exists' 
      });
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      authProvider: 'local',
      isEmailVerified: false,
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

    // Generate session ID for the user
    const sessionId = `session-${user._id}-${Date.now()}`;
    user.sessionId = sessionId;
    await user.save();

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
    console.error('Signup error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Login Route
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }

    // Check if user registered with OAuth
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

    // Update last login
    user.lastLogin = new Date();
    
    // Generate new session ID
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
        profile: user.profile
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

// Logout Route
router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies.auth_token || req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      // Invalidate session in database
      await User.findByIdAndUpdate(decoded.userId, { sessionId: null });
    }

    res.clearCookie('auth_token');
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.clearCookie('auth_token');
    res.json({ success: true, message: 'Logged out successfully' });
  }
});

// ============= OAUTH CONFIGURATION =============

// Google OAuth Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ 
      $or: [
        { googleId: profile.id },
        { email: profile.emails[0].value.toLowerCase() }
      ]
    });

    if (user) {
      // Update existing user
      if (!user.googleId) {
        user.googleId = profile.id;
        user.authProvider = 'google';
      }
      user.lastLogin = new Date();
      user.sessionId = `session-${user._id}-${Date.now()}`;
      await user.save();
    } else {
      // Create new user
      user = new User({
        googleId: profile.id,
        name: profile.displayName,
        email: profile.emails[0].value.toLowerCase(),
        authProvider: 'google',
        isEmailVerified: true,
        profile: {
          firstName: profile.name.givenName,
          lastName: profile.name.familyName,
          avatar: profile.photos[0]?.value,
          joinedAt: new Date()
        },
        sessionId: `session-${Date.now()}-google`,
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
      user.sessionId = `session-${user._id}-${Date.now()}`;
      await user.save();
    }

    return done(null, user);
  } catch (error) {
    return done(error, null);
  }
}));

// Facebook OAuth Strategy
passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_APP_ID,
  clientSecret: process.env.FACEBOOK_APP_SECRET,
  callbackURL: "/auth/facebook/callback",
  profileFields: ['id', 'displayName', 'email', 'first_name', 'last_name', 'picture']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ 
      $or: [
        { facebookId: profile.id },
        { email: profile.emails?.[0]?.value?.toLowerCase() }
      ]
    });

    if (user) {
      if (!user.facebookId) {
        user.facebookId = profile.id;
        user.authProvider = 'facebook';
      }
      user.lastLogin = new Date();
      user.sessionId = `session-${user._id}-${Date.now()}`;
      await user.save();
    } else {
      user = new User({
        facebookId: profile.id,
        name: profile.displayName,
        email: profile.emails?.[0]?.value?.toLowerCase(),
        authProvider: 'facebook',
        isEmailVerified: true,
        profile: {
          firstName: profile.name?.givenName || profile.displayName.split(' ')[0],
          lastName: profile.name?.familyName || profile.displayName.split(' ').slice(1).join(' '),
          avatar: profile.photos?.[0]?.value,
          joinedAt: new Date()
        },
        sessionId: `session-${Date.now()}-facebook`,
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
      user.sessionId = `session-${user._id}-${Date.now()}`;
      await user.save();
    }

    return done(null, user);
  } catch (error) {
    return done(error, null);
  }
}));

// Apple OAuth Strategy
passport.use(new AppleStrategy({
  clientID: process.env.APPLE_CLIENT_ID,
  teamID: process.env.APPLE_TEAM_ID,
  callbackURL: "/auth/apple/callback",
  keyID: process.env.APPLE_KEY_ID,
  privateKeyString: process.env.APPLE_PRIVATE_KEY
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ 
      $or: [
        { appleId: profile.id },
        { email: profile.email?.toLowerCase() }
      ]
    });

    if (user) {
      if (!user.appleId) {
        user.appleId = profile.id;
        user.authProvider = 'apple';
      }
      user.lastLogin = new Date();
      user.sessionId = `session-${user._id}-${Date.now()}`;
      await user.save();
    } else {
      user = new User({
        appleId: profile.id,
        name: profile.name?.firstName + ' ' + (profile.name?.lastName || ''),
        email: profile.email?.toLowerCase(),
        authProvider: 'apple',
        isEmailVerified: true,
        profile: {
          firstName: profile.name?.firstName || 'Apple',
          lastName: profile.name?.lastName || 'User',
          joinedAt: new Date()
        },
        sessionId: `session-${Date.now()}-apple`,
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
      user.sessionId = `session-${user._id}-${Date.now()}`;
      await user.save();
    }

    return done(null, user);
  } catch (error) {
    return done(error, null);
  }
}));

// Passport serialization
passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// ============= OAUTH ROUTES =============

// Google OAuth routes
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

router.get('/google/callback', 
  passport.authenticate('google', { session: false }),
  async (req, res) => {
    try {
      const token = jwt.sign(
        { 
          userId: req.user._id, 
          email: req.user.email,
          sessionId: req.user.sessionId
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.redirect('/app');
    } catch (error) {
      res.redirect('/auth?error=oauth_error');
    }
  }
);

// Facebook OAuth routes
router.get('/facebook', passport.authenticate('facebook', {
  scope: ['email']
}));

router.get('/facebook/callback',
  passport.authenticate('facebook', { session: false }),
  async (req, res) => {
    try {
      const token = jwt.sign(
        { 
          userId: req.user._id, 
          email: req.user.email,
          sessionId: req.user.sessionId
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.redirect('/app');
    } catch (error) {
      res.redirect('/auth?error=oauth_error');
    }
  }
);

// Apple OAuth routes
router.get('/apple', passport.authenticate('apple'));

router.post('/apple/callback',
  passport.authenticate('apple', { session: false }),
  async (req, res) => {
    try {
      const token = jwt.sign(
        { 
          userId: req.user._id, 
          email: req.user.email,
          sessionId: req.user.sessionId
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.redirect('/app');
    } catch (error) {
      res.redirect('/auth?error=oauth_error');
    }
  }
);

// ============= MIDDLEWARE =============

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

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user || user.sessionId !== decoded.sessionId) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid or expired token' 
      });
    }

    req.user = user;
    req.sessionId = decoded.sessionId;
    next();
  } catch (error) {
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid token' 
    });
  }
};

// ============= PROTECTED ROUTES =============

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json({
      success: true,
      user: user
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching profile' 
    });
  }
});

// Update user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, preferences } = req.body;
    
    const updateData = {};
    if (name) updateData.name = name;
    if (preferences) updateData.preferences = { ...req.user.preferences, ...preferences };

    const user = await User.findByIdAndUpdate(
      req.user._id, 
      updateData, 
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      user: user
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Error updating profile' 
    });
  }
});

// Change password
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (req.user.authProvider !== 'local') {
      return res.status(400).json({
        success: false,
        message: 'Cannot change password for OAuth accounts'
      });
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, req.user.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters long'
      });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 12);
    await User.findByIdAndUpdate(req.user._id, { password: hashedNewPassword });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error changing password'
    });
  }
});

module.exports = { router, authenticateToken };

// ============= USER MODEL (models/user.js) =============
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Basic Information
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String }, // Only for local auth
  
  // OAuth IDs
  googleId: { type: String, sparse: true },
  facebookId: { type: String, sparse: true },
  appleId: { type: String, sparse: true },
  
  // Authentication metadata
  authProvider: { 
    type: String, 
    enum: ['local', 'google', 'facebook', 'apple'], 
    default: 'local' 
  },
  sessionId: { type: String }, // Current active session
  isEmailVerified: { type: Boolean, default: false },
  emailVerificationToken: { type: String },
  passwordResetToken: { type: String },
  passwordResetExpires: { type: Date },
  
  // Profile Information
  profile: {
    firstName: { type: String },
    lastName: { type: String },
    avatar: { type: String }, // URL to profile picture
    timezone: { type: String, default: 'UTC' },
    language: { type: String, default: 'en' },
    joinedAt: { type: Date, default: Date.now }
  },
  
  // User Preferences
  preferences: {
    theme: { type: String, enum: ['light', 'dark'], default: 'dark' },
    timezone: { type: String, default: 'UTC' },
    dateFormat: { type: String, default: 'MM/DD/YYYY' },
    timeFormat: { type: String, enum: ['12h', '24h'], default: '12h' },
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      reminder: { type: Boolean, default: true },
      marketing: { type: Boolean, default: false }
    },
    privacy: {
      profileVisible: { type: Boolean, default: false },
      dataSharing: { type: Boolean, default: false }
    }
  },
  
  // Usage Statistics
  stats: {
    totalReminders: { type: Number, default: 0 },
    totalConversations: { type: Number, default: 0 },
    totalFilesUploaded: { type: Number, default: 0 },
    lastActiveAt: { type: Date, default: Date.now }
  },
  
  // Subscription Information (for future use)
  subscription: {
    plan: { type: String, enum: ['free', 'premium', 'pro'], default: 'free' },
    status: { type: String, enum: ['active', 'canceled', 'expired'], default: 'active' },
    startDate: { type: Date },
    endDate: { type: Date },
    stripeCustomerId: { type: String },
    stripeSubscriptionId: { type: String }
  },
  
  // Account Status
  isActive: { type: Boolean, default: true },
  isSuspended: { type: Boolean, default: false },
  suspensionReason: { type: String },
  lastLogin: { type: Date },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ sessionId: 1 });
userSchema.index({ googleId: 1 }, { sparse: true });
userSchema.index({ facebookId: 1 }, { sparse: true });
userSchema.index({ appleId: 1 }, { sparse: true });
userSchema.index({ 'subscription.plan': 1 });
userSchema.index({ createdAt: -1 });

// Update the updatedAt field before saving
userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.profile.firstName} ${this.profile.lastName}`.trim();
});

// Method to check if user is premium
userSchema.methods.isPremium = function() {
  return this.subscription.plan !== 'free' && this.subscription.status === 'active';
};

// Method to get user's current session info
userSchema.methods.getSessionInfo = function() {
  return {
    id: this._id,
    sessionId: this.sessionId,
    name: this.name,
    email: this.email,
    authProvider: this.authProvider,
    preferences: this.preferences
  };
};

const User = mongoose.model('User', userSchema);

module.exports = { User };

// ============= ENVIRONMENT VARIABLES (.env) =============
/*
Add these to your .env file:

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here-make-it-long-and-random

# OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret

APPLE_CLIENT_ID=your-apple-client-id
APPLE_TEAM_ID=your-apple-team-id
APPLE_KEY_ID=your-apple-key-id
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_APPLE_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----"

# Application URLs
APP_URL=http://localhost:3001
FRONTEND_URL=http://localhost:3001
*/