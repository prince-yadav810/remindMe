const fs = require('fs');
const { execSync } = require('child_process');

console.log('🚀 remindME Quick Setup Starting...\n');

// Step 1: Install dependencies
console.log('📦 Installing dependencies...');
try {
  execSync('npm install', { stdio: 'inherit' });
  console.log('✅ Dependencies installed\n');
} catch (error) {
  console.log('⚠️  Some dependencies failed, continuing...\n');
}

// Step 2: Generate secure secrets
console.log('🔐 Generating secure secrets...');
const crypto = require('crypto');
const jwtSecret = crypto.randomBytes(64).toString('hex');
const sessionSecret = crypto.randomBytes(32).toString('hex');

// Step 3: Create/update .env file
const envContent = `# remindME Configuration
PORT=3001
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/remindme

# Secure Secrets (Auto-generated)
JWT_SECRET=${jwtSecret}
SESSION_SECRET=${sessionSecret}

# AI Configuration (ADD YOUR KEY HERE!)
GEMINI_API_KEY=your-gemini-api-key-here

# URLs
APP_URL=http://localhost:3001
FRONTEND_URL=http://localhost:3001
`;

fs.writeFileSync('../.env', envContent);
console.log('✅ Environment file created\n');

// Step 4: Create uploads directory
if (!fs.existsSync('../uploads')) {
  fs.mkdirSync('../uploads', { recursive: true });
  console.log('✅ Uploads directory created\n');
}

console.log('🎉 Quick setup completed!');
console.log('\n📋 Next steps:');
console.log('1. Add your Gemini API key to .env file');
console.log('2. Make sure MongoDB is running');
console.log('3. Run: npm start');
console.log('\n🔑 Get Gemini API key: https://makersuite.google.com/app/apikey');