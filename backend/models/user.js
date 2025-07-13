// ============= FIX: Create backend/models/user.js (NEW FILE) =============
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
    }
  },
  
  // Usage Statistics
  stats: {
    totalReminders: { type: Number, default: 0 },
    totalConversations: { type: Number, default: 0 },
    totalFilesUploaded: { type: Number, default: 0 },
    lastActiveAt: { type: Date, default: Date.now }
  },
  
  // Account Status
  isActive: { type: Boolean, default: true },
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

// Update the updatedAt field before saving
userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Method to check if user is premium
userSchema.methods.isPremium = function() {
  return false; // Implement premium logic later
};

// FIXED: Export without destructuring
module.exports = mongoose.model('User', userSchema);

// ============= FIX: Clean backend/routes/auth.js (REPLACE YOUR CURRENT auth.js) =============
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user'); // FIXED: Direct import

const router = express.Router();

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';

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
      isEmailVerified: true, // Set to true for now
      profile: {
        firstName: name.split(' ')[0],
        lastName: name.split(' ').slice(1).join(' ') || '',
        joinedAt: new Date()
      }
    });

    await user.save();

    // Generate session ID
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
    res.clearCookie('auth_token');
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
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

    const decoded = jwt.verify(token, JWT_SECRET);
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

// Get user profile
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

module.exports = { router, authenticateToken };