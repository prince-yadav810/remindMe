// ============= SETUP.JS - Automated Setup Script =============
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function generateSecureSecret(length = 64) {
  return crypto.randomBytes(length).toString('hex');
}

function createDirectoryStructure() {
  const directories = [
    'routes',
    'models',
    'public',
    'uploads',
    'middleware',
    'utils',
    'tests'
  ];

  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✅ Created directory: ${dir}`);
    }
  });
}

function createEnvFile() {
  const envTemplate = `# remindME Application Configuration
# Generated on ${new Date().toISOString()}

# Server Configuration
PORT=3001
NODE_ENV=development

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/remindme

# Security Configuration (Auto-generated - DO NOT SHARE)
JWT_SECRET=${generateSecureSecret(64)}
SESSION_SECRET=${generateSecureSecret(32)}

# AI Configuration
GEMINI_API_KEY=your-gemini-api-key-here

# Application URLs
APP_URL=http://localhost:3001
FRONTEND_URL=http://localhost:3001

# Email Configuration (Optional - for password reset)
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_FROM="remindME <noreply@yourdomain.com>"

# OAuth Configuration
# Google OAuth (https://console.cloud.google.com/)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Facebook OAuth (https://developers.facebook.com/)
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret

# Apple OAuth (https://developer.apple.com/)
APPLE_CLIENT_ID=your-apple-client-id
APPLE_TEAM_ID=your-apple-team-id
APPLE_KEY_ID=your-apple-key-id
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nYOUR_APPLE_PRIVATE_KEY_HERE\\n-----END PRIVATE KEY-----"

# Optional: Analytics and Monitoring
ANALYTICS_ID=your-analytics-id
SENTRY_DSN=your-sentry-dsn

# Optional: File Storage (for production)
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_S3_BUCKET=your-s3-bucket-name
AWS_REGION=us-east-1
`;

  if (!fs.existsSync('.env')) {
    fs.writeFileSync('.env', envTemplate);
    console.log('✅ Created .env file with secure secrets');
  } else {
    console.log('⚠️  .env file already exists, skipping creation');
  }
}

function createGitignore() {
  const gitignoreContent = `# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Uploads and temporary files
uploads/
temp/
*.tmp
*.log

# Database
*.db
*.sqlite

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Production builds
dist/
build/

# Testing
coverage/
.nyc_output

# Runtime
pids
*.pid
*.seed
*.pid.lock

# Optional npm cache directory
.npm

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# dotenv environment variables file
.env.test

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage
*.lcov

# nyc test coverage
.nyc_output

# Dependency directories
node_modules/
jspm_packages/

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Microbundle cache
.rpt2_cache/
.rts2_cache_cjs/
.rts2_cache_es/
.rts2_cache_umd/

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# parcel-bundler cache (https://parceljs.org/)
.cache
.parcel-cache

# Next.js build output
.next

# Nuxt.js build / generate output
.nuxt
dist

# Gatsby files
.cache/
public

# Storybook build outputs
.out
.storybook-out

# Temporary folders
tmp/
temp/
`;

  if (!fs.existsSync('.gitignore')) {
    fs.writeFileSync('.gitignore', gitignoreContent);
    console.log('✅ Created .gitignore file');
  }
}

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function setupConfiguration() {
  console.log('\n🚀 Welcome to remindME Setup!\n');
  
  console.log('This setup will help you configure your remindME application.\n');

  // Basic configuration
  const geminiKey = await askQuestion('Enter your Google Gemini API key (or press Enter to skip): ');
  const mongoUri = await askQuestion('Enter your MongoDB URI (or press Enter for default localhost): ');

  // OAuth configuration
  console.log('\n📱 OAuth Configuration (optional - press Enter to skip any):');
  const googleClientId = await askQuestion('Google Client ID: ');
  const googleClientSecret = await askQuestion('Google Client Secret: ');
  const facebookAppId = await askQuestion('Facebook App ID: ');
  const facebookAppSecret = await askQuestion('Facebook App Secret: ');

  // Update .env file with provided values
  if (fs.existsSync('.env')) {
    let envContent = fs.readFileSync('.env', 'utf8');
    
    if (geminiKey) {
      envContent = envContent.replace('GEMINI_API_KEY=your-gemini-api-key-here', `GEMINI_API_KEY=${geminiKey}`);
    }
    
    if (mongoUri) {
      envContent = envContent.replace('MONGODB_URI=mongodb://localhost:27017/remindme', `MONGODB_URI=${mongoUri}`);
    }
    
    if (googleClientId) {
      envContent = envContent.replace('GOOGLE_CLIENT_ID=your-google-client-id', `GOOGLE_CLIENT_ID=${googleClientId}`);
    }
    
    if (googleClientSecret) {
      envContent = envContent.replace('GOOGLE_CLIENT_SECRET=your-google-client-secret', `GOOGLE_CLIENT_SECRET=${googleClientSecret}`);
    }
    
    if (facebookAppId) {
      envContent = envContent.replace('FACEBOOK_APP_ID=your-facebook-app-id', `FACEBOOK_APP_ID=${facebookAppId}`);
    }
    
    if (facebookAppSecret) {
      envContent = envContent.replace('FACEBOOK_APP_SECRET=your-facebook-app-secret', `FACEBOOK_APP_SECRET=${facebookAppSecret}`);
    }
    
    fs.writeFileSync('.env', envContent);
    console.log('✅ Updated .env file with your configuration');
  }
}

function createStartupScript() {
  const startupScript = `#!/bin/bash
# remindME Startup Script

echo "🚀 Starting remindME Application..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ and try again."
    exit 1
fi

# Check if MongoDB is running
if ! pgrep -x "mongod" > /dev/null; then
    echo "⚠️  MongoDB is not running. Starting MongoDB..."
    # Try to start MongoDB (adjust path as needed)
    if command -v brew &> /dev/null; then
        brew services start mongodb-community
    elif command -v systemctl &> /dev/null; then
        sudo systemctl start mongod
    else
        echo "Please start MongoDB manually"
    fi
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Running setup..."
    node setup.js
fi

# Start the application
echo "✅ Starting remindME server..."
npm run dev
`;

  fs.writeFileSync('start.sh', startupScript);
  
  // Make script executable on Unix systems
  if (process.platform !== 'win32') {
    fs.chmodSync('start.sh', '755');
  }
  
  console.log('✅ Created startup script (start.sh)');
}

function createReadme() {
  const readmeContent = `# remindME - AI Personal Assistant

An intelligent personal assistant that helps you manage daily routines and information without mental overhead.

## ✨ Features

- 🤖 **Conversational AI Interface** - Natural language interaction with your personal data
- 🧠 **Intelligent Categorization** - Automatic organization and retrieval of information
- 📄 **Smart File Processing** - Upload documents, PDFs, images with AI analysis
- ⏰ **Context-Aware Reminders** - Smart reminders that understand context
- 🔐 **Secure Authentication** - Email/password and OAuth (Google, Facebook, Apple)
- 📱 **Responsive Design** - Works seamlessly on desktop and mobile

## 🚀 Quick Start

### Prerequisites
- Node.js 16+
- MongoDB 4.4+
- Google Gemini API key

### Installation

1. **Clone and Setup**
   \`\`\`bash
   git clone <your-repo-url>
   cd remindme-app
   npm install
   node setup.js
   \`\`\`

2. **Start the Application**
   \`\`\`bash
   # Development mode
   npm run dev
   
   # Or use the startup script
   ./start.sh
   \`\`\`

3. **Open in Browser**
   - Visit: http://localhost:3001
   - Create an account or sign in
   - Start chatting with your AI assistant!

## 🔧 Configuration

### Environment Variables
The setup script creates a \`.env\` file with all necessary configuration. Key variables:

- \`GEMINI_API_KEY\` - Your Google Gemini API key
- \`MONGODB_URI\` - MongoDB connection string
- \`JWT_SECRET\` - Automatically generated secure secret
- OAuth credentials for social login

### OAuth Setup
See the detailed setup instructions in the setup script output for configuring:
- Google OAuth
- Facebook OAuth  
- Apple OAuth

## 📁 Project Structure

\`\`\`
remindme-app/
├── server.js              # Main server file
├── routes/
│   └── auth.js            # Authentication routes
├── models/
│   ├── database.js        # Database models
│   └── user.js           # User model
├── public/
│   ├── auth.html         # Login/signup page
│   └── index.html        # Main app interface
├── middleware/           # Custom middleware
├── utils/               # Utility functions
└── uploads/            # File uploads storage
\`\`\`

## 🔐 Security Features

- Bcrypt password hashing
- JWT token authentication
- Session management
- Rate limiting
- CORS protection
- Helmet security headers
- Input validation and sanitization

## 🎯 Usage Examples

### Chat Interface
\`\`\`
You: "Remind me to call John tomorrow at 3 PM"
remindME: "I've created a reminder for you to call John tomorrow at 3:00 PM"

You: "What meetings do I have this week?"
remindME: "Based on your uploaded calendar, you have..."
\`\`\`

### File Processing
- Upload PDFs, Word docs, images
- AI extracts key information automatically
- Ask questions about uploaded content
- Get intelligent summaries and insights

## 🚀 Production Deployment

1. **Environment Setup**
   \`\`\`bash
   NODE_ENV=production
   # Update all OAuth redirect URLs
   # Use strong secrets
   # Configure HTTPS
   \`\`\`

2. **Database**
   - Use MongoDB Atlas or self-hosted MongoDB
   - Set up regular backups
   - Configure proper indexes

3. **Security**
   - Enable HTTPS
   - Configure proper CORS
   - Set up monitoring and logging
   - Regular security updates

## 📊 API Endpoints

### Authentication
- \`POST /auth/signup\` - User registration
- \`POST /auth/login\` - User login
- \`POST /auth/logout\` - User logout
- \`GET /auth/profile\` - Get user profile

### Core Features
- \`POST /api/chat\` - Chat with AI
- \`POST /api/upload\` - Upload files
- \`GET /api/reminders\` - Get reminders
- \`POST /api/reminders\` - Create reminder

### OAuth Routes
- \`GET /auth/google\` - Google OAuth
- \`GET /auth/facebook\` - Facebook OAuth
- \`GET /auth/apple\` - Apple OAuth

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For support, please:
1. Check the documentation
2. Search existing issues
3. Create a new issue with detailed information

## 🚀 Roadmap

- [ ] Email verification system
- [ ] Advanced file processing (OCR, audio)
- [ ] Integration with external calendars
- [ ] Mobile apps (iOS/Android)
- [ ] Team collaboration features
- [ ] Advanced analytics dashboard

---

Built with ❤️ using Node.js, MongoDB, and Google Gemini AI
\`\`\`

Enjoy using remindME! 🎉
`;

  fs.writeFileSync('README.md', readmeContent);
  console.log('✅ Created comprehensive README.md');
}

async function main() {
  try {
    console.log('🔧 Setting up remindME application...\n');
    
    // Create directory structure
    createDirectoryStructure();
    
    // Create configuration files
    createEnvFile();
    createGitignore();
    createStartupScript();
    createReadme();
    
    // Interactive configuration
    await setupConfiguration();
    
    console.log('\n✅ Setup completed successfully!\n');
    console.log('Next steps:');
    console.log('1. Review and update the .env file with your API keys');
    console.log('2. Install dependencies: npm install');
    console.log('3. Start the application: npm run dev or ./start.sh');
    console.log('4. Visit http://localhost:3001 to test your application\n');
    
    console.log('📚 For detailed OAuth setup instructions, check the generated README.md file.');
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
  } finally {
    rl.close();
  }
}

// Run setup if this file is executed directly
if (require.main === module) {
  main();
}

module.exports = {
  generateSecureSecret,
  createDirectoryStructure,
  createEnvFile
};