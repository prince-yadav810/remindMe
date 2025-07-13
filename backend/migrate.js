// ============= DATABASE MIGRATION SCRIPT (migrate.js) =============
const mongoose = require('mongoose');
const { User } = require('./models/user');
const { UploadedFile, Memory, Reminder, Conversation } = require('./models/database');
require('dotenv').config();

async function runMigration() {
  try {
    console.log('🔄 Starting database migration...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/remindme', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Check if migration has already been run
    const existingUsers = await User.countDocuments();
    if (existingUsers > 0) {
      console.log('ℹ️  Users collection already exists, checking for orphaned data...');
    }

    // Create default user for any orphaned data
    let defaultUser = await User.findOne({ email: 'migration@remindme.app' });
    
    if (!defaultUser) {
      defaultUser = new User({
        name: 'Migration User',
        email: 'migration@remindme.app',
        authProvider: 'local',
        isEmailVerified: true,
        profile: {
          firstName: 'Migration',
          lastName: 'User',
          joinedAt: new Date()
        },
        sessionId: 'migration-session-' + Date.now()
      });
      await defaultUser.save();
      console.log('✅ Created default migration user');
    }

    // Find data without userId and assign to default user
    const orphanedFiles = await UploadedFile.countDocuments({ userId: { $exists: false } });
    const orphanedMemories = await Memory.countDocuments({ userId: { $exists: false } });
    const orphanedReminders = await Reminder.countDocuments({ userId: { $exists: false } });
    const orphanedConversations = await Conversation.countDocuments({ userId: { $exists: false } });

    console.log(`📊 Found orphaned data:`);
    console.log(`   Files: ${orphanedFiles}`);
    console.log(`   Memories: ${orphanedMemories}`);
    console.log(`   Reminders: ${orphanedReminders}`);
    console.log(`   Conversations: ${orphanedConversations}`);

    if (orphanedFiles > 0) {
      await UploadedFile.updateMany(
        { userId: { $exists: false } },
        { userId: defaultUser._id }
      );
      console.log(`✅ Updated ${orphanedFiles} orphaned files`);
    }

    if (orphanedMemories > 0) {
      await Memory.updateMany(
        { userId: { $exists: false } },
        { userId: defaultUser._id }
      );
      console.log(`✅ Updated ${orphanedMemories} orphaned memories`);
    }

    if (orphanedReminders > 0) {
      await Reminder.updateMany(
        { userId: { $exists: false } },
        { userId: defaultUser._id }
      );
      console.log(`✅ Updated ${orphanedReminders} orphaned reminders`);
    }

    if (orphanedConversations > 0) {
      await Conversation.updateMany(
        { userId: { $exists: false } },
        { userId: defaultUser._id }
      );
      console.log(`✅ Updated ${orphanedConversations} orphaned conversations`);
    }

    // Create indexes for better performance
    console.log('🔍 Creating database indexes...');
    
    await User.collection.createIndex({ email: 1 }, { unique: true });
    await User.collection.createIndex({ sessionId: 1 });
    await User.collection.createIndex({ emailVerificationToken: 1 });
    await User.collection.createIndex({ passwordResetToken: 1 });
    
    await UploadedFile.collection.createIndex({ userId: 1, sessionId: 1 });
    await Memory.collection.createIndex({ userId: 1, sessionId: 1 });
    await Reminder.collection.createIndex({ userId: 1, sessionId: 1 });
    await Conversation.collection.createIndex({ userId: 1, sessionId: 1 });
    
    console.log('✅ Created database indexes');

    // Migration summary
    const finalStats = {
      totalUsers: await User.countDocuments(),
      totalFiles: await UploadedFile.countDocuments(),
      totalMemories: await Memory.countDocuments(),
      totalReminders: await Reminder.countDocuments(),
      totalConversations: await Conversation.countDocuments()
    };

    console.log('\n📈 Migration Summary:');
    console.log(`   Total Users: ${finalStats.totalUsers}`);
    console.log(`   Total Files: ${finalStats.totalFiles}`);
    console.log(`   Total Memories: ${finalStats.totalMemories}`);
    console.log(`   Total Reminders: ${finalStats.totalReminders}`);
    console.log(`   Total Conversations: ${finalStats.totalConversations}`);

    console.log('\n✅ Migration completed successfully!');
    
    if (defaultUser && (orphanedFiles > 0 || orphanedMemories > 0 || orphanedReminders > 0 || orphanedConversations > 0)) {
      console.log('\nℹ️  Note: Orphaned data has been assigned to migration@remindme.app');
      console.log('   You can reassign this data to actual users later if needed.');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    process.exit(0);
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };

// ============= ENHANCED FRONTEND AUTH JAVASCRIPT =============
// Add this to a new file: public/js/auth.js

(function() {
    'use strict';

    // Enhanced authentication handling
    class AuthManager {
        constructor() {
            this.initializeEventListeners();
            this.checkAuthStatus();
            this.setupFormValidation();
        }

        initializeEventListeners() {
            // Form submissions
            const loginForm = document.getElementById('loginForm');
            const signupForm = document.getElementById('signupForm');
            
            if (loginForm) {
                loginForm.addEventListener('submit', this.handleLogin.bind(this));
            }
            
            if (signupForm) {
                signupForm.addEventListener('submit', this.handleSignup.bind(this));
            }

            // Forgot password link
            const forgotPasswordLink = document.querySelector('[onclick="showForgotPassword()"]');
            if (forgotPasswordLink) {
                forgotPasswordLink.addEventListener('click', this.handleForgotPassword.bind(this));
            }

            // Email verification resend
            this.setupEmailVerificationHandler();

            // URL parameter handling
            this.handleURLParameters();
        }

        handleURLParameters() {
            const urlParams = new URLSearchParams(window.location.search);
            
            // Handle email verification success
            if (urlParams.get('verified') === 'true') {
                this.showSuccess('Email verified successfully! You can now log in.');
                // Switch to login tab
                setTimeout(() => {
                    this.switchTab('login');
                }, 1500);
            }

            // Handle OAuth errors
            if (urlParams.get('error') === 'oauth_error') {
                this.showError('OAuth authentication failed. Please try again.');
            }

            // Handle password reset
            if (urlParams.get('reset') === 'success') {
                this.showSuccess('Password reset successfully! You can now log in with your new password.');
                this.switchTab('login');
            }
        }

        setupFormValidation() {
            // Real-time password strength indicator
            const passwordInputs = document.querySelectorAll('input[type="password"]');
            passwordInputs.forEach(input => {
                if (input.id.includes('signup') || input.id.includes('Password')) {
                    input.addEventListener('input', this.updatePasswordStrength.bind(this));
                }
            });

            // Email format validation
            const emailInputs = document.querySelectorAll('input[type="email"]');
            emailInputs.forEach(input => {
                input.addEventListener('blur', this.validateEmail.bind(this));
            });

            // Confirm password matching
            const confirmPasswordInput = document.getElementById('confirmPassword');
            const signupPasswordInput = document.getElementById('signupPassword');
            
            if (confirmPasswordInput && signupPasswordInput) {
                confirmPasswordInput.addEventListener('input', () => {
                    this.validatePasswordMatch(signupPasswordInput.value, confirmPasswordInput.value);
                });
            }
        }

        updatePasswordStrength(event) {
            const password = event.target.value;
            const strengthMeter = this.getOrCreatePasswordStrengthMeter(event.target);
            
            const strength = this.calculatePasswordStrength(password);
            strengthMeter.style.display = password.length > 0 ? 'block' : 'none';
            
            const strengthBar = strengthMeter.querySelector('.strength-bar');
            const strengthText = strengthMeter.querySelector('.strength-text');
            
            strengthBar.style.width = `${strength.percentage}%`;
            strengthBar.className = `strength-bar strength-${strength.level}`;
            strengthText.textContent = strength.text;
        }

        calculatePasswordStrength(password) {
            let score = 0;
            let feedback = [];

            if (password.length >= 8) score += 25;
            else feedback.push('at least 8 characters');

            if (/[a-z]/.test(password)) score += 25;
            else feedback.push('lowercase letters');

            if (/[A-Z]/.test(password)) score += 25;
            else feedback.push('uppercase letters');

            if (/[0-9]/.test(password)) score += 25;
            else feedback.push('numbers');

            if (/[^A-Za-z0-9]/.test(password)) score += 10;

            let level, text;
            if (score < 30) {
                level = 'weak';
                text = 'Weak - Add ' + feedback.slice(0, 2).join(', ');
            } else if (score < 60) {
                level = 'fair';
                text = 'Fair - Add ' + feedback.slice(0, 1).join(', ');
            } else if (score < 90) {
                level = 'good';
                text = 'Good password';
            } else {
                level = 'strong';
                text = 'Strong password';
            }

            return { percentage: Math.min(score, 100), level, text };
        }

        getOrCreatePasswordStrengthMeter(input) {
            let meter = input.parentNode.parentNode.querySelector('.password-strength');
            
            if (!meter) {
                meter = document.createElement('div');
                meter.className = 'password-strength';
                meter.style.cssText = `
                    margin-top: 8px;
                    display: none;
                `;
                
                meter.innerHTML = `
                    <div class="strength-bar-container" style="
                        background: #3a3a38;
                        height: 4px;
                        border-radius: 2px;
                        overflow: hidden;
                        margin-bottom: 4px;
                    ">
                        <div class="strength-bar" style="
                            height: 100%;
                            transition: all 0.3s ease;
                            border-radius: 2px;
                        "></div>
                    </div>
                    <div class="strength-text" style="
                        font-size: 12px;
                        color: #8a8a88;
                    "></div>
                `;
                
                // Add CSS for strength levels
                const style = document.createElement('style');
                style.textContent = `
                    .strength-weak { background-color: #ff6b6b; }
                    .strength-fair { background-color: #feca57; }
                    .strength-good { background-color: #48dbfb; }
                    .strength-strong { background-color: #1dd1a1; }
                `;
                document.head.appendChild(style);
                
                input.parentNode.parentNode.appendChild(meter);
            }
            
            return meter;
        }

        validateEmail(event) {
            const email = event.target.value;
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            
            if (email && !emailRegex.test(email)) {
                this.showFieldError(event.target, 'Please enter a valid email address');
            } else {
                this.clearFieldError(event.target);
            }
        }

        validatePasswordMatch(password, confirmPassword) {
            const confirmInput = document.getElementById('confirmPassword');
            
            if (confirmPassword && password !== confirmPassword) {
                this.showFieldError(confirmInput, 'Passwords do not match');
            } else {
                this.clearFieldError(confirmInput);
            }
        }

        showFieldError(input, message) {
            this.clearFieldError(input);
            
            const errorDiv = document.createElement('div');
            errorDiv.className = 'field-error';
            errorDiv.style.cssText = `
                color: #ff6b6b;
                font-size: 12px;
                margin-top: 4px;
            `;
            errorDiv.textContent = message;
            
            input.parentNode.appendChild(errorDiv);
            input.style.borderColor = '#ff6b6b';
        }

        clearFieldError(input) {
            const existingError = input.parentNode.querySelector('.field-error');
            if (existingError) {
                existingError.remove();
            }
            input.style.borderColor = '#3a3a38';
        }

        async handleLogin(event) {
            event.preventDefault();
            
            const button = event.target.querySelector('.auth-button');
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;
            
            if (!email || !password) {
                this.showError('Please fill in all fields');
                return;
            }
            
            this.setLoading(button, true);
            this.clearMessages();
            
            try {
                const response = await fetch('/auth/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email, password }),
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    this.showSuccess('Login successful! Redirecting...');
                    
                    // Store user data in sessionStorage for immediate use
                    sessionStorage.setItem('user', JSON.stringify(data.user));
                    
                    setTimeout(() => {
                        window.location.href = '/app';
                    }, 1500);
                } else {
                    if (data.requiresVerification) {
                        this.showEmailVerificationPrompt(email);
                    } else {
                        this.showError(data.message || 'Login failed');
                    }
                }
            } catch (error) {
                this.showError('Network error. Please try again.');
                console.error('Login error:', error);
            } finally {
                this.setLoading(button, false);
            }
        }

        async handleSignup(event) {
            event.preventDefault();
            
            const button = event.target.querySelector('.auth-button');
            const name = document.getElementById('signupName').value.trim();
            const email = document.getElementById('signupEmail').value.trim();
            const password = document.getElementById('signupPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            
            // Client-side validation
            if (!name || !email || !password || !confirmPassword) {
                this.showError('Please fill in all fields');
                return;
            }
            
            if (password !== confirmPassword) {
                this.showError('Passwords do not match');
                return;
            }
            
            if (password.length < 8) {
                this.showError('Password must be at least 8 characters long');
                return;
            }
            
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                this.showError('Please enter a valid email address');
                return;
            }
            
            this.setLoading(button, true);
            this.clearMessages();
            
            try {
                const response = await fetch('/auth/signup', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ name, email, password }),
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    if (data.requiresVerification) {
                        this.showEmailVerificationSuccess(email);
                    } else {
                        this.showSuccess('Account created successfully! Please log in.');
                        setTimeout(() => {
                            this.switchTab('login');
                            document.getElementById('loginEmail').value = email;
                        }, 1500);
                    }
                } else {
                    this.showError(data.message || 'Signup failed');
                }
            } catch (error) {
                this.showError('Network error. Please try again.');
                console.error('Signup error:', error);
            } finally {
                this.setLoading(button, false);
            }
        }

        showEmailVerificationPrompt(email) {
            const message = `
                <div style="text-align: left;">
                    <strong>Email verification required</strong><br>
                    Please check your email to verify your account.<br><br>
                    Didn't receive the email? 
                    <button onclick="authManager.resendVerification('${email}')" 
                            style="background: none; border: none; color: #4accd1; text-decoration: underline; cursor: pointer;">
                        Resend verification email
                    </button>
                </div>
            `;
            
            const errorEl = document.getElementById('errorMessage');
            errorEl.innerHTML = message;
            errorEl.style.display = 'block';
            errorEl.style.backgroundColor = 'rgba(74, 204, 209, 0.1)';
            errorEl.style.borderColor = 'rgba(74, 204, 209, 0.3)';
            errorEl.style.color = '#4accd1';
        }

        showEmailVerificationSuccess(email) {
            const message = `
                <div style="text-align: left;">
                    <strong>Account created successfully!</strong><br>
                    We've sent a verification email to <strong>${email}</strong><br>
                    Please check your email and click the verification link to activate your account.<br><br>
                    <small>Didn't receive the email? Check your spam folder or 
                    <button onclick="authManager.resendVerification('${email}')" 
                            style="background: none; border: none; color: #4accd1; text-decoration: underline; cursor: pointer;">
                        resend verification email
                    </button></small>
                </div>
            `;
            
            const successEl = document.getElementById('successMessage');
            successEl.innerHTML = message;
            successEl.style.display = 'block';
        }

        async resendVerification(email) {
            try {
                const response = await fetch('/auth/resend-verification', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email }),
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    this.showSuccess('Verification email sent successfully!');
                } else {
                    this.showError(data.message || 'Failed to resend verification email');
                }
            } catch (error) {
                this.showError('Network error. Please try again.');
            }
        }

        async handleForgotPassword(event) {
            event.preventDefault();
            
            const email = prompt('Enter your email address:');
            if (!email) return;
            
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                this.showError('Please enter a valid email address');
                return;
            }
            
            try {
                const response = await fetch('/auth/forgot-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email }),
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    this.showSuccess('If an account with that email exists, we sent a password reset link.');
                } else {
                    this.showError(data.message || 'Failed to send reset email');
                }
            } catch (error) {
                this.showError('Network error. Please try again.');
            }
        }

        checkAuthStatus() {
            // Check if user is already authenticated
            const token = this.getCookie('auth_token');
            if (token && window.location.pathname === '/auth') {
                // User might already be logged in, redirect to app
                window.location.href = '/app';
            }
        }

        getCookie(name) {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) return parts.pop().split(';').shift();
        }

        switchTab(tab) {
            const tabs = document.querySelectorAll('.auth-tab');
            const forms = document.querySelectorAll('.auth-form');
            
            tabs.forEach(t => t.classList.remove('active'));
            forms.forEach(f => f.classList.remove('active'));
            
            document.querySelector(`[onclick="switchTab('${tab}')"]`).classList.add('active');
            document.getElementById(tab + 'Form').classList.add('active');
            
            this.clearMessages();
        }

        setLoading(button, isLoading) {
            if (isLoading) {
                button.classList.add('loading');
                button.disabled = true;
            } else {
                button.classList.remove('loading');
                button.disabled = false;
            }
        }

        showError(message) {
            const errorEl = document.getElementById('errorMessage');
            const successEl = document.getElementById('successMessage');
            
            successEl.style.display = 'none';
            errorEl.innerHTML = message;
            errorEl.style.display = 'block';
            errorEl.style.backgroundColor = 'rgba(255, 107, 107, 0.1)';
            errorEl.style.borderColor = 'rgba(255, 107, 107, 0.3)';
            errorEl.style.color = '#ff6b6b';
            
            setTimeout(() => {
                errorEl.style.display = 'none';
            }, 8000);
        }

        showSuccess(message) {
            const errorEl = document.getElementById('errorMessage');
            const successEl = document.getElementById('successMessage');
            
            errorEl.style.display = 'none';
            successEl.innerHTML = message;
            successEl.style.display = 'block';
            
            setTimeout(() => {
                successEl.style.display = 'none';
            }, 8000);
        }

        clearMessages() {
            document.getElementById('errorMessage').style.display = 'none';
            document.getElementById('successMessage').style.display = 'none';
        }
    }

    // Initialize auth manager when DOM is loaded
    let authManager;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            authManager = new AuthManager();
            window.authManager = authManager; // Make it globally accessible
        });
    } else {
        authManager = new AuthManager();
        window.authManager = authManager;
    }

    // Global functions for backward compatibility
    window.switchTab = function(tab) {
        authManager.switchTab(tab);
    };

    window.togglePassword = function(inputId) {
        const input = document.getElementById(inputId);
        const icon = input.nextElementSibling.querySelector('i');
        
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    };

    window.showForgotPassword = function() {
        authManager.handleForgotPassword(event);
    };

})();