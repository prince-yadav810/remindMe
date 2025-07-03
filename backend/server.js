const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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
      return res.status(400).json({ 
        error: 'Message and sessionId are required',
        success: false 
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ 
        error: 'AI service not configured. Please check server configuration.',
        success: false 
      });
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

    // Prepare context for Gemini with enhanced prompt
    const conversationHistory = conversation.messages.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }]
    }));

    // Enhanced system prompt for better Claude-like responses
    const systemPrompt = `You are a helpful AI assistant called remindME. You help users manage their daily tasks, reminders, and information. You should be:
    - Conversational and friendly
    - Helpful and informative
    - Concise but thorough when needed
    - Able to help with reminders, scheduling, and organization
    - Supportive of productivity and time management
    
    Current conversation context: This is a chat session where you help the user with their daily needs.`;

    // Get AI response
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    
    const chat = model.startChat({
      history: conversationHistory.slice(0, -1), // Exclude the current message
      generationConfig: {
        maxOutputTokens: 1500,
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
      },
    });

    const result = await chat.sendMessage(systemPrompt + '\n\nUser: ' + message);
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
      success: true,
      messageCount: conversation.messages.length
    });

  } catch (error) {
    console.error('Chat error:', error);
    
    // Enhanced error handling
    let errorMessage = 'I apologize, but I encountered an error. Please try again.';
    
    if (error.message.includes('API key')) {
      errorMessage = 'AI service is not properly configured. Please contact support.';
    } else if (error.message.includes('quota')) {
      errorMessage = 'AI service is temporarily unavailable due to high demand. Please try again later.';
    } else if (error.message.includes('network') || error.message.includes('ECONNRESET')) {
      errorMessage = 'Connection error. Please check your internet connection and try again.';
    }
    
    res.status(500).json({ 
      error: errorMessage,
      success: false,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get conversation history
app.get('/api/conversation/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const conversation = await Conversation.findOne({ sessionId });
    
    if (!conversation) {
      return res.json({ 
        messages: [],
        sessionId: sessionId,
        success: true 
      });
    }

    res.json({ 
      messages: conversation.messages,
      sessionId: sessionId,
      success: true,
      messageCount: conversation.messages.length
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch conversation',
      success: false 
    });
  }
});

// Clear conversation history (for New Chat functionality)
app.delete('/api/conversation/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    await Conversation.findOneAndDelete({ sessionId });
    
    res.json({ 
      success: true,
      message: 'Conversation cleared successfully' 
    });
  } catch (error) {
    console.error('Clear conversation error:', error);
    res.status(500).json({ 
      error: 'Failed to clear conversation',
      success: false 
    });
  }
});

// Get conversation statistics
app.get('/api/stats/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const conversation = await Conversation.findOne({ sessionId });
    
    if (!conversation) {
      return res.json({ 
        messageCount: 0,
        createdAt: new Date(),
        success: true 
      });
    }

    res.json({ 
      messageCount: conversation.messages.length,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      success: true
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch statistics',
      success: false 
    });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    const geminiConfigured = !!process.env.GEMINI_API_KEY;
    
    // Count total conversations
    const totalConversations = await Conversation.countDocuments();
    
    res.json({ 
      status: 'OK',
      timestamp: new Date().toISOString(),
      services: {
        database: mongoStatus,
        ai: geminiConfigured ? 'configured' : 'not configured'
      },
      stats: {
        totalConversations: totalConversations,
        uptime: process.uptime()
      },
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
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