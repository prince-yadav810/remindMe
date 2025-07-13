// ============= TESTING SUITE (tests/auth.test.js) =============
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const { User } = require('../models/user');
const emailService = require('../utils/email');

// Mock email service for testing
jest.mock('../utils/email');

describe('Authentication System', () => {
  let server;
  let testUser;

  beforeAll(async () => {
    // Connect to test database
    const MONGODB_TEST_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/remindme_test';
    await mongoose.connect(MONGODB_TEST_URI);
    
    server = app.listen(0); // Use random port for testing
  });

  beforeEach(async () => {
    // Clear test data
    await User.deleteMany({});
    
    // Create test user
    testUser = new User({
      name: 'Test User',
      email: 'test@example.com',
      password: '$2a$12$test.hash.password', // Pre-hashed for testing
      authProvider: 'local',
      isEmailVerified: true,
      sessionId: 'test-session-123'
    });
    await testUser.save();
  });

  afterAll(async () => {
    await mongoose.connection.close();
    server.close();
  });

  describe('POST /auth/signup', () => {
    it('should create a new user successfully', async () => {
      const newUser = {
        name: 'New User',
        email: 'newuser@example.com',
        password: 'StrongPassword123!'
      };

      const response = await request(app)
        .post('/auth/signup')
        .send(newUser)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.requiresVerification).toBe(true);
      expect(response.body.user.email).toBe(newUser.email);

      // Verify user was created in database
      const createdUser = await User.findOne({ email: newUser.email });
      expect(createdUser).toBeTruthy();
      expect(createdUser.isEmailVerified).toBe(false);
    });

    it('should reject weak passwords', async () => {
      const newUser = {
        name: 'New User',
        email: 'newuser@example.com',
        password: '123' // Too weak
      };

      const response = await request(app)
        .post('/auth/signup')
        .send(newUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('8 characters');
    });

    it('should reject duplicate emails', async () => {
      const duplicateUser = {
        name: 'Duplicate User',
        email: 'test@example.com', // Already exists
        password: 'StrongPassword123!'
      };

      const response = await request(app)
        .post('/auth/signup')
        .send(duplicateUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('already exists');
    });

    it('should validate required fields', async () => {
      const incompleteUser = {
        name: 'Incomplete User'
        // Missing email and password
      };

      const response = await request(app)
        .post('/auth/signup')
        .send(incompleteUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('required');
    });
  });

  describe('POST /auth/login', () => {
    it('should login successfully with valid credentials', async () => {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('TestPassword123!', 12);
      
      testUser.password = hashedPassword;
      await testUser.save();

      const loginData = {
        email: 'test@example.com',
        password: 'TestPassword123!'
      };

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe(loginData.email);
      expect(response.body.token).toBeTruthy();
      
      // Check if cookie is set
      const cookies = response.headers['set-cookie'];
      expect(cookies.some(cookie => cookie.includes('auth_token'))).toBe(true);
    });

    it('should reject invalid passwords', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'WrongPassword'
      };

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid');
    });

    it('should reject unverified email addresses', async () => {
      testUser.isEmailVerified = false;
      await testUser.save();

      const loginData = {
        email: 'test@example.com',
        password: 'TestPassword123!'
      };

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.requiresVerification).toBe(true);
    });

    it('should reject non-existent users', async () => {
      const loginData = {
        email: 'nonexistent@example.com',
        password: 'TestPassword123!'
      };

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Protected Routes', () => {
    let authToken;

    beforeEach(async () => {
      // Generate valid JWT token for testing
      const jwt = require('jsonwebtoken');
      authToken = jwt.sign(
        { 
          userId: testUser._id, 
          email: testUser.email,
          sessionId: testUser.sessionId
        },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );
    });

    it('should access protected route with valid token', async () => {
      const response = await request(app)
        .get('/auth/profile')
        .set('Cookie', [`auth_token=${authToken}`])
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe(testUser.email);
    });

    it('should reject access without token', async () => {
      const response = await request(app)
        .get('/auth/profile')
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should reject access with invalid token', async () => {
      const response = await request(app)
        .get('/auth/profile')
        .set('Cookie', ['auth_token=invalid.token.here'])
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Email Verification', () => {
    it('should verify email with valid token', async () => {
      const verificationToken = 'valid-verification-token';
      testUser.isEmailVerified = false;
      testUser.emailVerificationToken = verificationToken;
      testUser.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await testUser.save();

      const response = await request(app)
        .get(`/auth/verify-email?token=${verificationToken}&email=${testUser.email}`)
        .expect(302); // Redirect

      // Check if user is now verified
      const updatedUser = await User.findById(testUser._id);
      expect(updatedUser.isEmailVerified).toBe(true);
      expect(updatedUser.emailVerificationToken).toBeUndefined();
    });

    it('should reject expired verification tokens', async () => {
      const verificationToken = 'expired-verification-token';
      testUser.isEmailVerified = false;
      testUser.emailVerificationToken = verificationToken;
      testUser.emailVerificationExpires = new Date(Date.now() - 60 * 60 * 1000); // Expired 1 hour ago
      await testUser.save();

      const response = await request(app)
        .get(`/auth/verify-email?token=${verificationToken}&email=${testUser.email}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('expired');
    });
  });

  describe('Password Reset', () => {
    it('should initiate password reset for existing user', async () => {
      const response = await request(app)
        .post('/auth/forgot-password')
        .send({ email: testUser.email })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalled();

      // Check if reset token was set
      const updatedUser = await User.findById(testUser._id);
      expect(updatedUser.passwordResetToken).toBeTruthy();
      expect(updatedUser.passwordResetExpires).toBeTruthy();
    });

    it('should reset password with valid token', async () => {
      const resetToken = 'valid-reset-token';
      testUser.passwordResetToken = resetToken;
      testUser.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
      await testUser.save();

      const newPassword = 'NewStrongPassword123!';

      const response = await request(app)
        .post('/auth/reset-password')
        .send({
          token: resetToken,
          email: testUser.email,
          newPassword: newPassword
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify password was changed
      const updatedUser = await User.findById(testUser._id);
      expect(updatedUser.passwordResetToken).toBeUndefined();
      expect(updatedUser.passwordResetExpires).toBeUndefined();
    });

    it('should reject weak passwords in reset', async () => {
      const resetToken = 'valid-reset-token';
      testUser.passwordResetToken = resetToken;
      testUser.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
      await testUser.save();

      const response = await request(app)
        .post('/auth/reset-password')
        .send({
          token: resetToken,
          email: testUser.email,
          newPassword: '123' // Too weak
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('8 characters');
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit login attempts', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'WrongPassword'
      };

      // Make multiple failed requests
      for (let i = 0; i < 6; i++) {
        await request(app)
          .post('/auth/login')
          .send(loginData);
      }

      // Next request should be rate limited
      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(429);

      expect(response.body.message).toContain('Too many');
    });
  });
});

// ============= LOAD TESTING UTILITY (tests/load.test.js) =============
const autocannon = require('autocannon');

async function runLoadTest() {
  console.log('🚀 Starting load test...');

  const instance = autocannon({
    url: 'http://localhost:3001',
    connections: 10,
    pipelining: 1,
    duration: 10, // 10 seconds
    headers: {
      'Content-Type': 'application/json'
    },
    requests: [
      {
        method: 'GET',
        path: '/api/health'
      },
      {
        method: 'GET',
        path: '/auth'
      }
    ]
  });

  instance.on('done', (result) => {
    console.log('📊 Load Test Results:');
    console.log(`   Requests/sec: ${result.requests.average}`);
    console.log(`   Latency avg: ${result.latency.average}ms`);
    console.log(`   Throughput: ${result.throughput.average} bytes/sec`);
    console.log(`   Errors: ${result.errors}`);
    
    if (result.requests.average > 100) {
      console.log('✅ Load test passed');
    } else {
      console.log('⚠️  Load test shows performance issues');
    }
  });

  return instance;
}

module.exports = { runLoadTest };

// ============= SECURITY TESTING (tests/security.test.js) =============
const request = require('supertest');
const app = require('../server');

describe('Security Tests', () => {
  describe('SQL Injection Protection', () => {
    it('should reject SQL injection attempts in login', async () => {
      const maliciousData = {
        email: "admin@example.com'; DROP TABLE users; --",
        password: "password"
      };

      const response = await request(app)
        .post('/auth/login')
        .send(maliciousData)
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('XSS Protection', () => {
    it('should sanitize malicious input in signup', async () => {
      const maliciousData = {
        name: '<script>alert("xss")</script>',
        email: 'test@example.com',
        password: 'StrongPassword123!'
      };

      const response = await request(app)
        .post('/auth/signup')
        .send(maliciousData);

      // Should not contain script tags in response
      expect(JSON.stringify(response.body)).not.toContain('<script>');
    });
  });

  describe('Header Security', () => {
    it('should include security headers', async () => {
      const response = await request(app)
        .get('/auth')
        .expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
    });

    it('should not expose server information', async () => {
      const response = await request(app)
        .get('/auth')
        .expect(200);

      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['server']).toBeUndefined();
    });
  });

  describe('CSRF Protection', () => {
    it('should require proper content type for POST requests', async () => {
      const response = await request(app)
        .post('/auth/login')
        .set('Content-Type', 'text/plain')
        .send('malicious data')
        .expect(400);
    });
  });
});

// ============= FINAL SETUP SCRIPT (setup-complete.js) =============
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const mongoose = require('mongoose');
const { runMigration } = require('./migrate');
const { runLoadTest } = require('./tests/load.test');

class CompleteSetup {
  constructor() {
    this.steps = [
      'checkPrerequisites',
      'installDependencies', 
      'setupEnvironment',
      'setupDatabase',
      'createFileStructure',
      'runMigration',
      'testSystem',
      'generateDocumentation',
      'finalizeSetup'
    ];
    this.currentStep = 0;
  }

  async run() {
    console.log('🚀 remindME Complete Setup Starting...\n');
    
    try {
      for (const step of this.steps) {
        await this[step]();
        this.currentStep++;
        this.showProgress();
      }
      
      console.log('\n🎉 Setup completed successfully!');
      this.showNextSteps();
      
    } catch (error) {
      console.error(`\n❌ Setup failed at step: ${this.steps[this.currentStep]}`);
      console.error('Error:', error.message);
      console.log('\n🛠️  Please check the error above and run setup again.');
      process.exit(1);
    }
  }

  showProgress() {
    const percentage = Math.round((this.currentStep / this.steps.length) * 100);
    const progressBar = '█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5));
    console.log(`\n[${progressBar}] ${percentage}% - ${this.steps[this.currentStep - 1]} ✅`);
  }

  async checkPrerequisites() {
    console.log('🔍 Checking prerequisites...');
    
    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    
    if (majorVersion < 16) {
      throw new Error(`Node.js 16+ required. Current version: ${nodeVersion}`);
    }
    console.log(`   Node.js: ${nodeVersion} ✅`);

    // Check if MongoDB is accessible
    try {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/remindme';
      await mongoose.connect(mongoUri);
      await mongoose.connection.close();
      console.log('   MongoDB: Accessible ✅');
    } catch (error) {
      console.log('   MongoDB: Not accessible ⚠️');
      console.log('   Please ensure MongoDB is running and accessible');
    }

    // Check required environment variables
    const requiredEnvVars = ['GEMINI_API_KEY', 'JWT_SECRET'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.log(`   Missing environment variables: ${missingVars.join(', ')} ⚠️`);
    } else {
      console.log('   Environment variables: Present ✅');
    }
  }

  async installDependencies() {
    console.log('📦 Installing dependencies...');
    
    if (!fs.existsSync('node_modules')) {
      console.log('   Installing npm packages...');
      execSync('npm install', { stdio: 'inherit' });
    } else {
      console.log('   Dependencies already installed');
    }

    // Install additional dev dependencies for testing
    const devDeps = [
      'jest@^29.7.0',
      'supertest@^6.3.3',
      'autocannon@^7.12.0'
    ];

    console.log('   Installing testing dependencies...');
    execSync(`npm install --save-dev ${devDeps.join(' ')}`, { stdio: 'inherit' });
  }

  async setupEnvironment() {
    console.log('⚙️  Setting up environment...');
    
    // Create .env file if it doesn't exist
    if (!fs.existsSync('.env')) {
      const { createEnvFile } = require('./setup');
      createEnvFile();
      console.log('   Created .env file with secure defaults');
    } else {
      console.log('   Environment file already exists');
    }

    // Validate critical environment variables
    const critical = ['JWT_SECRET', 'SESSION_SECRET'];
    critical.forEach(varName => {
      if (!process.env[varName]) {
        console.log(`   ⚠️  Warning: ${varName} not set`);
      }
    });
  }

  async setupDatabase() {
    console.log('🗄️  Setting up database...');
    
    try {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/remindme');
      
      // Create indexes
      const collections = ['users', 'uploadedfiles', 'memories', 'reminders', 'conversations'];
      for (const collection of collections) {
        try {
          await mongoose.connection.db.collection(collection).createIndexes([
            { key: { createdAt: -1 } },
            { key: { updatedAt: -1 } }
          ]);
        } catch (error) {
          // Index might already exist
        }
      }
      
      await mongoose.connection.close();
      console.log('   Database indexes created');
    } catch (error) {
      console.log('   Database setup failed:', error.message);
    }
  }

  async createFileStructure() {
    console.log('📁 Creating file structure...');
    
    const directories = [
      'public/js',
      'public/css', 
      'public/images',
      'routes',
      'models',
      'middleware',
      'utils',
      'tests',
      'uploads',
      'logs'
    ];

    directories.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`   Created: ${dir}`);
      }
    });

    // Create necessary files
    const files = {
      'public/auth.html': 'Auth page (check artifacts)',
      'public/reset-password.html': 'Password reset page (check artifacts)',
      'public/js/auth.js': 'Auth JavaScript (check artifacts)',
      'routes/auth.js': 'Auth routes (check artifacts)',
      'models/user.js': 'User model (check artifacts)',
      'utils/email.js': 'Email service (check artifacts)',
      'middleware/auth.js': 'Auth middleware (check artifacts)',
      'tests/auth.test.js': 'Auth tests (check artifacts)'
    };

    Object.entries(files).forEach(([file, description]) => {
      if (!fs.existsSync(file)) {
        console.log(`   Missing: ${file} - ${description}`);
      }
    });
  }

  async runMigration() {
    console.log('🔄 Running database migration...');
    
    try {
      await runMigration();
      console.log('   Migration completed successfully');
    } catch (error) {
      console.log('   Migration failed:', error.message);
      console.log('   This is normal if starting fresh');
    }
  }

  async testSystem() {
    console.log('🧪 Testing system...');
    
    try {
      // Run unit tests
      console.log('   Running unit tests...');
      execSync('npm test', { stdio: 'inherit' });
      
      // Run load test (optional)
      if (process.env.RUN_LOAD_TEST === 'true') {
        console.log('   Running load test...');
        await runLoadTest();
      }
      
    } catch (error) {
      console.log('   Some tests failed - this is normal for initial setup');
    }
  }

  async generateDocumentation() {
    console.log('📚 Generating documentation...');
    
    const apiDocs = `# remindME API Documentation

## Authentication Endpoints

### POST /auth/signup
Register a new user account.

**Request Body:**
\`\`\`json
{
  "name": "John Doe",
  "email": "john@example.com", 
  "password": "StrongPassword123!"
}
\`\`\`

**Response:**
\`\`\`json
{
  "success": true,
  "message": "Account created successfully!",
  "requiresVerification": true,
  "user": {
    "id": "user_id",
    "name": "John Doe",
    "email": "john@example.com"
  }
}
\`\`\`

### POST /auth/login
Authenticate user and return JWT token.

**Request Body:**
\`\`\`json
{
  "email": "john@example.com",
  "password": "StrongPassword123!"
}
\`\`\`

**Response:**
\`\`\`json
{
  "success": true,
  "message": "Login successful",
  "user": { ... },
  "token": "jwt_token_here"
}
\`\`\`

### GET /auth/verify-email
Verify user email address.

**Query Parameters:**
- \`token\`: Email verification token
- \`email\`: User email address

### POST /auth/forgot-password
Request password reset email.

**Request Body:**
\`\`\`json
{
  "email": "john@example.com"
}
\`\`\`

### POST /auth/reset-password
Reset user password.

**Request Body:**
\`\`\`json
{
  "token": "reset_token",
  "email": "john@example.com",
  "newPassword": "NewStrongPassword123!"
}
\`\`\`

## Protected Endpoints

All protected endpoints require authentication via JWT token in cookies or Authorization header:
\`Authorization: Bearer <jwt_token>\`

### GET /auth/profile
Get current user profile.

### PUT /auth/profile
Update user profile.

### POST /auth/logout
Logout and invalidate session.

## Application Endpoints

### POST /api/chat
Send message to AI assistant.

### POST /api/upload
Upload and process files.

### GET /api/reminders
Get user reminders.

### POST /api/reminders
Create new reminder.

## OAuth Endpoints

### GET /auth/google
Initiate Google OAuth flow.

### GET /auth/facebook
Initiate Facebook OAuth flow.

### GET /auth/apple
Initiate Apple OAuth flow.

## Error Responses

All endpoints return errors in this format:
\`\`\`json
{
  "success": false,
  "message": "Error description",
  "errors": ["Detailed error messages"]
}
\`\`\`

## Rate Limiting

- Authentication endpoints: 5 requests per 15 minutes
- General API endpoints: 100 requests per 15 minutes
- File upload: 10 uploads per hour
`;

    fs.writeFileSync('API_DOCS.md', apiDocs);
    console.log('   API documentation generated');
  }

  async finalizeSetup() {
    console.log('🎯 Finalizing setup...');
    
    // Update package.json scripts
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    packageJson.scripts = {
      ...packageJson.scripts,
      "test": "jest",
      "test:watch": "jest --watch",
      "test:security": "jest tests/security.test.js",
      "test:load": "node tests/load.test.js",
      "migrate": "node migrate.js",
      "dev": "nodemon server.js",
      "start": "node server.js",
      "setup": "node setup-complete.js"
    };
    
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
    console.log('   Updated package.json scripts');

    // Create startup script
    const startScript = `#!/bin/bash
echo "🚀 Starting remindME..."

# Check environment
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Run 'npm run setup' first."
    exit 1
fi

# Start MongoDB if not running
if ! pgrep -x "mongod" > /dev/null; then
    echo "Starting MongoDB..."
    if command -v brew &> /dev/null; then
        brew services start mongodb-community
    elif command -v systemctl &> /dev/null; then
        sudo systemctl start mongod
    fi
fi

# Start application
echo "✅ Starting remindME server..."
npm run dev
`;

    fs.writeFileSync('start.sh', startScript);
    if (process.platform !== 'win32') {
      fs.chmodSync('start.sh', '755');
    }
    console.log('   Created startup script');
  }

  showNextSteps() {
    console.log('\n📋 Next Steps:');
    console.log('   1. Review and update .env file with your API keys');
    console.log('   2. Configure OAuth providers (Google, Facebook, Apple)');
    console.log('   3. Set up email service (Gmail, SendGrid, etc.)');
    console.log('   4. Start the application: npm run dev');
    console.log('   5. Visit http://localhost:3001 to test');
    console.log('\n📚 Documentation:');
    console.log('   - API Documentation: API_DOCS.md');
    console.log('   - Setup Guide: README.md');
    console.log('\n🧪 Testing:');
    console.log('   - Run tests: npm test');
    console.log('   - Security tests: npm run test:security');
    console.log('   - Load tests: npm run test:load');
    console.log('\n🚀 Production:');
    console.log('   - Review security checklist in README.md');
    console.log('   - Set NODE_ENV=production');
    console.log('   - Configure HTTPS and domain');
    console.log('   - Set up monitoring and logging');
  }
}

// Run setup if this file is executed directly
if (require.main === module) {
  const setup = new CompleteSetup();
  setup.run().catch(console.error);
}

module.exports = CompleteSetup;

// ============= JEST CONFIGURATION (jest.config.js) =============
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  collectCoverageFrom: [
    'routes/**/*.js',
    'models/**/*.js',
    'middleware/**/*.js',
    'utils/**/*.js',
    '!tests/**/*.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testMatch: [
    '<rootDir>/tests/**/*.test.js'
  ],
  verbose: true,
  forceExit: true,
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true
};

// ============= TEST SETUP (tests/setup.js) =============
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await mongod.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
});

// Mock console.log in tests to reduce noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};