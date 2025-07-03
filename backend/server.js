const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3001',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use(express.static('frontend'));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/remindme', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Conversation Schema
const conversationSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  messages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Conversation = mongoose.model('Conversation', conversationSchema);

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || !sessionId) {
      return res.status(400).json({ error: 'Message and sessionId are required' });
    }

    // Find or create conversation
    let conversation = await Conversation.findOne({ sessionId });
    if (!conversation) {
      conversation = new Conversation({ sessionId, messages: [] });
    }

    // Add user message
    conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date()
    });

    // Prepare context for Gemini
    const conversationHistory = conversation.messages.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }]
    }));

    // Get AI response
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    
    const chat = model.startChat({
      history: conversationHistory.slice(0, -1), // Exclude the current message
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.7,
      },
    });

    const result = await chat.sendMessage(message);
    const aiResponse = result.response.text();

    // Add AI response to conversation
    conversation.messages.push({
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date()
    });

    // Update conversation
    conversation.updatedAt = new Date();
    await conversation.save();

    res.json({
      response: aiResponse,
      sessionId: sessionId,
      success: true
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: 'Failed to process chat message',
      details: error.message 
    });
  }
});

// Get conversation history
app.get('/api/conversation/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const conversation = await Conversation.findOne({ sessionId });
    
    if (!conversation) {
      return res.json({ messages: [] });
    }

    res.json({ messages: conversation.messages });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    geminiConfigured: !!process.env.GEMINI_API_KEY 
  });
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Frontend: http://localhost:${PORT}`);
  console.log(`🔌 API: http://localhost:${PORT}/api/health`);
});

module.exports = app;