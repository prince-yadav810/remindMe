// ============= backend/routes/auth.js (COMPLETELY CLEAN VERSION) =============
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user');

const router = express.Router();

// JWT Secret from environment
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';

// Signup endpoint
router.post('/signup', async (req, res) => {
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
router.post('/login', async (req, res) => {
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

// Export router and middleware
module.exports = { router, authenticateToken };