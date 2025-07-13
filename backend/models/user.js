// ============= backend/models/user.js (COMPLETELY CLEAN VERSION) =============
const mongoose = require('mongoose');

// Define user schema
const userSchema = new mongoose.Schema({
  // Basic user information
  name: { 
    type: String, 
    required: true, 
    trim: true 
  },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true 
  },
  password: { 
    type: String 
  },
  
  // Authentication details
  authProvider: { 
    type: String, 
    enum: ['local', 'google', 'facebook', 'apple'], 
    default: 'local' 
  },
  sessionId: { 
    type: String 
  },
  isEmailVerified: { 
    type: Boolean, 
    default: true 
  },
  
  // Profile information
  profile: {
    firstName: { type: String },
    lastName: { type: String },
    joinedAt: { type: Date, default: Date.now }
  },
  
  // User preferences
  preferences: {
    theme: { type: String, enum: ['light', 'dark'], default: 'dark' },
    timezone: { type: String, default: 'UTC' }
  },
  
  // Usage statistics
  stats: {
    totalReminders: { type: Number, default: 0 },
    totalConversations: { type: Number, default: 0 },
    totalFilesUploaded: { type: Number, default: 0 },
    lastActiveAt: { type: Date, default: Date.now }
  },
  
  // Account status
  isActive: { 
    type: Boolean, 
    default: true 
  },
  lastLogin: { 
    type: Date 
  },
  
  // Timestamps
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Create indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ sessionId: 1 });

// Update timestamp before saving
userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Export the model (avoid duplicate creation)
module.exports = mongoose.models.User || mongoose.model('User', userSchema);