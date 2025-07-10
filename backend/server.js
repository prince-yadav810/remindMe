const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Text extraction libraries
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// Import database models
const { UploadedFile, Memory, Reminder, Conversation } = require('./models/database');

require('dotenv').config();
// Add this after the require('dotenv').config(); line
console.log('🔑 API Key loaded:', process.env.GEMINI_API_KEY ? 'YES' : 'NO');
console.log('🔑 API Key first 10 chars:', process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 10) + '...' : 'NOT SET');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'", "https://cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'", "'unsafe-hashes'"], // This allows inline event handlers
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  }
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
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/uploads', express.static('uploads'));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/remindme', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============= FILE UPLOAD CONFIGURATION =============
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/gif'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Please upload PDF, DOCX, TXT, or image files.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// ============= TEXT EXTRACTION FUNCTIONS =============
async function extractTextFromFile(filePath, mimeType) {
  try {
    let extractedText = '';
    let metadata = {};

    switch (mimeType) {
      case 'application/pdf':
        const pdfBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(pdfBuffer);
        extractedText = pdfData.text;
        metadata = {
          pages: pdfData.numpages,
          wordCount: pdfData.text.split(/\s+/).length
        };
        break;

      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        const docxBuffer = fs.readFileSync(filePath);
        const docxResult = await mammoth.extractRawText({ buffer: docxBuffer });
        extractedText = docxResult.value;
        metadata = {
          wordCount: extractedText.split(/\s+/).length
        };
        break;

      case 'text/plain':
        extractedText = fs.readFileSync(filePath, 'utf8');
        metadata = {
          wordCount: extractedText.split(/\s+/).length
        };
        break;

      case 'image/jpeg':
      case 'image/png':
      case 'image/gif':
        // For now, just indicate it's an image
        // You can add OCR later using libraries like tesseract.js
        extractedText = `[Image file: ${path.basename(filePath)}]`;
        metadata = {
          type: 'image'
        };
        break;

      default:
        extractedText = `[Unsupported file type: ${mimeType}]`;
    }

    return { extractedText, metadata };
  } catch (error) {
    console.error('Text extraction error:', error);
    return { extractedText: `[Error extracting text: ${error.message}]`, metadata: {} };
  }
}

// ============= AI PROCESSING FUNCTIONS =============
async function processFileContent(extractedText, filename) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('Gemini API key not configured');
    }

    // NEW - Updated model name
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
    Analyze the following document content and provide a structured analysis:
    
    Document: ${filename}
    Content: ${extractedText}
    
    Please provide:
    1. A brief summary (2-3 sentences)
    2. Key topics and themes
    3. Important dates mentioned
    4. Action items or tasks mentioned
    5. People or organizations mentioned
    6. Sentiment analysis (positive/negative/neutral)
    
    Format your response as JSON with the following structure:
    {
      "summary": "Brief summary here",
      "keyTopics": ["topic1", "topic2"],
      "importantDates": ["date1", "date2"],
      "actionItems": ["action1", "action2"],
      "entities": ["person1", "organization1"],
      "sentiment": "positive/negative/neutral"
    }
    `;

    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    try {
      return JSON.parse(response);
    } catch (parseError) {
      // If JSON parsing fails, return a basic structure
      return {
        summary: response.substring(0, 200) + '...',
        keyTopics: [],
        importantDates: [],
        actionItems: [],
        entities: [],
        sentiment: 'neutral'
      };
    }
  } catch (error) {
    console.error('AI processing error:', error);
    return {
      summary: `Document uploaded: ${filename}`,
      keyTopics: [],
      importantDates: [],
      actionItems: [],
      entities: [],
      sentiment: 'neutral'
    };
  }
}

// ============= FILE UPLOAD ENDPOINT =============
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No file uploaded',
        success: false 
      });
    }

    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ 
        error: 'Session ID is required',
        success: false 
      });
    }

    console.log('📁 File uploaded:', req.file.originalname);

    // Create file record
    const uploadedFile = new UploadedFile({
      sessionId: sessionId,
      filename: req.file.filename,
      originalName: req.file.originalname,
      fileType: path.extname(req.file.originalname).toLowerCase(),
      fileSize: req.file.size,
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      processingStatus: 'processing'
    });

    await uploadedFile.save();

    // Extract text content
    const { extractedText, metadata } = await extractTextFromFile(req.file.path, req.file.mimetype);
    
    // Process with AI
    const aiAnalysis = await processFileContent(extractedText, req.file.originalname);

    // Update file with extracted content
    uploadedFile.extractedText = extractedText;
    uploadedFile.metadata = metadata;
    uploadedFile.processingStatus = 'completed';
    uploadedFile.processedAt = new Date();
    await uploadedFile.save();

    // Create memory record
    const memory = new Memory({
      sessionId: sessionId,
      sourceType: 'file',
      sourceId: uploadedFile._id.toString(),
      title: req.file.originalname,
      content: extractedText,
      summary: aiAnalysis.summary,
      tags: aiAnalysis.keyTopics,
      aiProcessing: {
        sentiment: aiAnalysis.sentiment,
        actionItems: aiAnalysis.actionItems,
        keyPhrases: aiAnalysis.keyTopics,
        entities: aiAnalysis.entities
      },
      context: {
        dateRelevant: aiAnalysis.importantDates.length > 0 ? new Date(aiAnalysis.importantDates[0]) : null,
        people: aiAnalysis.entities.filter(e => e.includes(' ')) // Simple heuristic for names
      }
    });

    await memory.save();

    res.json({
      success: true,
      file: {
        id: uploadedFile._id,
        originalName: req.file.originalname,
        fileType: uploadedFile.fileType,
        fileSize: uploadedFile.fileSize,
        processingStatus: uploadedFile.processingStatus,
        uploadedAt: uploadedFile.uploadedAt
      },
      analysis: aiAnalysis,
      memory: {
        id: memory._id,
        summary: memory.summary,
        tags: memory.tags
      }
    });

  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to process file',
      success: false 
    });
  }
});

// ============= ENHANCED CHAT ENDPOINT =============
// Replace your chat endpoint in server.js with this enhanced version:

// Replace your chat endpoint with this debug version to see what's happening:

// Replace your chat endpoint with this corrected version:

// Replace your chat endpoint with this debug version:

// QUICK FIX: Replace with this ultra-simple version for testing:

// QUICK FIX: Replace with this ultra-simple version for testing:

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
        error: 'AI service not configured.',
        success: false 
      });
    }

    // Simple AI request without conversation history for now
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.7,
      }
    });

    const prompt = `You are remindME, a helpful AI assistant. User says: "${message}". Respond helpfully and concisely.`;
    
    const result = await model.generateContent(prompt);
    const aiResponse = result.response.text();

    // Save to database (simplified)
    try {
      let conversation = await Conversation.findOne({ sessionId });
      if (!conversation) {
        conversation = new Conversation({ sessionId, messages: [] });
      }
      
      conversation.messages.push(
        { role: 'user', content: message, timestamp: new Date() },
        { role: 'assistant', content: aiResponse, timestamp: new Date() }
      );
      
      await conversation.save();
    } catch (dbError) {
      console.log('Database save failed:', dbError.message);
      // Continue anyway - don't fail the response
    }

    res.json({
      response: aiResponse,
      sessionId: sessionId,
      success: true
    });

  } catch (error) {
    console.error('Chat error:', error.message);
    
    res.status(500).json({ 
      error: 'AI service is temporarily busy. Please try again.',
      success: false
    });
  }
});

// ============= FILE MANAGEMENT ENDPOINTS =============

// Get uploaded files for session
app.get('/api/files/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const files = await UploadedFile.find({ sessionId })
      .sort({ uploadedAt: -1 })
      .select('originalName fileType fileSize uploadedAt processingStatus');
    
    res.json({ 
      files: files,
      success: true 
    });
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch files',
      success: false 
    });
  }
});

// Get memories for session
app.get('/api/memories/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const memories = await Memory.find({ sessionId })
      .sort({ createdAt: -1 })
      .select('title summary tags sourceType createdAt');
    
    res.json({ 
      memories: memories,
      success: true 
    });
  } catch (error) {
    console.error('Get memories error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch memories',
      success: false 
    });
  }
});

// ============= EXISTING ENDPOINTS =============

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

// Clear conversation history
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

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    const geminiConfigured = !!process.env.GEMINI_API_KEY;
    
    const totalConversations = await Conversation.countDocuments();
    const totalFiles = await UploadedFile.countDocuments();
    const totalMemories = await Memory.countDocuments();
    
    res.json({ 
      status: 'OK',
      timestamp: new Date().toISOString(),
      services: {
        database: mongoStatus,
        ai: geminiConfigured ? 'configured' : 'not configured'
      },
      stats: {
        totalConversations,
        totalFiles,
        totalMemories,
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
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: 'File too large. Maximum size is 10MB.',
        success: false 
      });
    }
  }
  
  res.status(500).json({ 
    error: 'Something broke!',
    success: false 
  });
});

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3001',
  credentials: true
}));

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Frontend: http://localhost:${PORT}`);
  console.log(`🔌 API: http://localhost:${PORT}/api/health`);
  console.log(`📁 Uploads directory: ${uploadsDir}`);
});

module.exports = app;