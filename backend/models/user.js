// ============= backend/models/user.js (UPDATED WITH OTP FIELDS) =============
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
  
  // OTP Fields for Password Reset
  passwordResetOTP: {
    code: { type: String },
    expiresAt: { type: Date },
    attempts: { type: Number, default: 0 },
    isUsed: { type: Boolean, default: false }
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
userSchema.index({ 'passwordResetOTP.code': 1 });
userSchema.index({ 'passwordResetOTP.expiresAt': 1 });

// Update timestamp before saving
userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Method to generate OTP
userSchema.methods.generatePasswordResetOTP = function() {
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Set OTP with 10-minute expiry
  this.passwordResetOTP = {
    code: otp,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    attempts: 0,
    isUsed: false
  };
  
  return otp;
};

// Method to verify OTP
userSchema.methods.verifyPasswordResetOTP = function(inputOTP) {
  const otpData = this.passwordResetOTP;
  
  // Check if OTP exists
  if (!otpData || !otpData.code) {
    return { isValid: false, reason: 'No OTP found. Please request a new one.' };
  }
  
  // Check if OTP is already used
  if (otpData.isUsed) {
    return { isValid: false, reason: 'OTP has already been used. Please request a new one.' };
  }
  
  // Check if OTP is expired
  if (new Date() > otpData.expiresAt) {
    return { isValid: false, reason: 'OTP has expired. Please request a new one.' };
  }
  
  // Check attempts limit (max 5 attempts)
  if (otpData.attempts >= 5) {
    return { isValid: false, reason: 'Too many invalid attempts. Please request a new OTP.' };
  }
  
  // Increment attempts
  this.passwordResetOTP.attempts += 1;
  
  // Check if OTP matches
  if (otpData.code !== inputOTP) {
    return { isValid: false, reason: `Invalid OTP. ${5 - this.passwordResetOTP.attempts} attempts remaining.` };
  }
  
  // Mark OTP as used
  this.passwordResetOTP.isUsed = true;
  
  return { isValid: true, reason: 'OTP verified successfully.' };
};

// Method to clear OTP data
userSchema.methods.clearPasswordResetOTP = function() {
  this.passwordResetOTP = {
    code: undefined,
    expiresAt: undefined,
    attempts: 0,
    isUsed: false
  };
};

// Export the model (avoid duplicate creation)
module.exports = mongoose.models.User || mongoose.model('User', userSchema);