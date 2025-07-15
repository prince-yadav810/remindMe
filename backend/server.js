// ============= FIXED SERVER.JS WITH DUAL API SYSTEM =============
const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Text extraction libraries
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// Import database models
const { UploadedFile, Memory, Reminder, Conversation } = require('./models/database');
const User = require('./models/user');

// Import authentication routes
const { router: authRouter, authenticateToken } = require('./routes/auth');

// Load .env from parent directory
require('dotenv').config({ path: path.join(__dirname, '../.env') });

console.log('🔑 BREVO_API_KEY loaded:', process.env.BREVO_API_KEY ? 'YES' : 'NO');
console.log('📧 BREVO_SENDER_EMAIL:', process.env.BREVO_SENDER_EMAIL);

const app = express();
const PORT = process.env.PORT || 3001;

// Use single API key (like your working app.py)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY must be set in .env file');
    console.error('Get your API key from: https://makersuite.google.com/app/apikey');
    process.exit(1);
}

console.log('🔑 API Key loaded:', GEMINI_API_KEY ? 'YES' : 'NO');
console.log('🔑 API Key first 10 chars:', GEMINI_API_KEY ? GEMINI_API_KEY.substring(0, 10) + '...' : 'NOT SET');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ============= DUAL API PROMPTS (FROM APP.PY) =============

// Chat API Prompt - Returns JSON with message and trigger
const CHAT_ANALYSIS_PROMPT = `
Analyze the user's message and respond in JSON format. You should:
1. Provide a helpful response to the user
2. Determine if the message contains reminder/scheduling information

User message: "{message}"

Respond ONLY in this JSON format:
{
    "message": "Your helpful response to the user",
    "trigger": true/false
}

Set trigger to true if the user wants to:
- Set a reminder
- Schedule something
- Remember to do something
- Has appointment/meeting information
- Mentions specific dates/times for tasks

Set trigger to false for general questions, greetings, or casual conversation.

Examples:
- "Remind me to call John at 3 PM" → trigger: true
- "I have a meeting tomorrow at 10 AM" → trigger: true  
- "What's the weather like?" → trigger: false
- "Hello, how are you?" → trigger: false
`;

// Enhanced Data API Prompt - Better date handling
const DATA_EXTRACTION_PROMPT = `
Extract reminder details from this message. Handle conflicting date information intelligently.

User message: "{message}"

Instructions:
- If multiple dates are mentioned, prioritize specific dates over relative dates
- Extract the main task/action clearly
- For dates: prefer specific dates like "July 15" over "today" if both are present
- For times: extract any time mentioned (2pm, 14:00, etc.)
- Always provide a title even if you need to infer it

Respond ONLY in this JSON format:
{
    "title": "Brief action to remember (required)",
    "date": "specific date like 'july 15' or relative like 'today/tomorrow'",
    "time": "HH:MM in 24-hour format or null",
    "description": "Additional context if any"
}

Date priority rules:
- Specific dates (July 15, Dec 25, 2024-07-15) take priority over relative dates
- If only relative dates (today, tomorrow), use those
- If no date mentioned, default to "today"

Examples:
- "meeting today at 3 PM" → {"title": "Meeting", "date": "today", "time": "15:00", "description": ""}
- "meeting today at 3 PM on 15 july" → {"title": "Meeting", "date": "july 15", "time": "15:00", "description": ""}
- "Zoom meeting with Prince at 2pm on 15 july" → {"title": "Zoom meeting with Prince", "date": "july 15", "time": "14:00", "description": ""}
- "call John at 2 PM on Monday" → {"title": "Call John", "date": "monday", "time": "14:00", "description": ""}
`;

// ============= UTILITY FUNCTIONS (FROM APP.PY) =============

function parseJsonResponse(responseText) {
    try {
        let cleanText = responseText.trim();
        if (cleanText.startsWith('```json')) {
            cleanText = cleanText.slice(7, -3);
        } else if (cleanText.startsWith('```')) {
            cleanText = cleanText.slice(3, -3);
        }
        
        // Extract JSON from response
        const jsonMatch = cleanText.match(/\{.*\}/s);
        if (jsonMatch) {
            cleanText = jsonMatch[0];
        }
        
        return JSON.parse(cleanText.trim());
    } catch (error) {
        console.error('JSON parsing error:', error, 'text:', responseText.substring(0, 200));
        return null;
    }
}

function convertDateToISO(dateStr) {
    const today = new Date();
    const currentYear = today.getFullYear();
    
    // DEFAULT TO TODAY if no date provided
    if (!dateStr || dateStr === '' || dateStr === 'null' || dateStr === 'undefined') {
        console.log('🗓️  No date provided, defaulting to today');
        return today.toISOString().split('T')[0];
    }
    dateStr = dateStr.toLowerCase().trim();
    
    if (dateStr === 'today' || dateStr === '') {
        return today.toISOString().split('T')[0];
    } else if (dateStr === 'tomorrow') {
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
    } else if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(dateStr)) {
        const days = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
        const targetDay = days[dateStr];
        const currentDay = today.getDay();
        let daysAhead = targetDay - currentDay;
        if (daysAhead <= 0) daysAhead += 7;
        
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + daysAhead);
        return targetDate.toISOString().split('T')[0];
    } else {
        // Handle "july 15", "december 25", etc.
        const monthDayMatch = dateStr.match(/(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})/);
        
        if (monthDayMatch) {
            const monthStr = monthDayMatch[1];
            const day = parseInt(monthDayMatch[2]);
            
            const monthMap = {
                january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
                april: 3, apr: 3, may: 4, june: 5, jun: 5,
                july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8,
                october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11
            };
            
            const month = monthMap[monthStr];
            
            try {
                const targetDate = new Date(currentYear, month, day);
                if (targetDate < today) {
                    targetDate.setFullYear(currentYear + 1);
                }
                return targetDate.toISOString().split('T')[0];
            } catch (error) {
                console.error('Invalid date:', month, day);
                return today.toISOString().split('T')[0];
            }
        }
        
        return today.toISOString().split('T')[0];
    }
}

function convertTimeTo24h(timeStr) {
    if (!timeStr) return null;
    
    timeStr = timeStr.toLowerCase().trim();
    
    // Handle 12 AM/PM specifically
    if (timeStr.includes('12am') || timeStr.includes('12 am')) {
        return "00:00";
    } else if (timeStr.includes('12pm') || timeStr.includes('12 pm')) {
        return "12:00";
    }
    
    // Handle other AM/PM cases
    const timeMatch = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/);
    if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        const minute = parseInt(timeMatch[2] || '0');
        const isPM = timeMatch[3] === 'pm';
        
        if (isPM && hour !== 12) {
            hour += 12;
        } else if (!isPM && hour === 12) {
            hour = 0;
        }
        
        return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }
    
    // Handle 24-hour format
    if (timeStr.includes(':')) {
        const parts = timeStr.split(':');
        try {
            const hour = parseInt(parts[0]);
            const minute = parseInt(parts[1] || '0');
            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
            }
        } catch (e) {
            // ignore
        }
    }
    
    // Default times for common words
    if (timeStr.includes('morning')) return "09:00";
    if (timeStr.includes('afternoon')) return "14:00";
    if (timeStr.includes('evening')) return "18:00";
    if (timeStr.includes('night')) return "20:00";
    
    return null;
}

async function processReminderData(reminderData, userId, sessionId, originalMessage) {
    console.log('🔍 Processing reminder data:', { reminderData, userId, sessionId });
    
    if (!reminderData || !reminderData.title) {
        console.log('Invalid reminder data, creating fallback');
        reminderData = {
            title: originalMessage.substring(0, 50) + '...',
            date: 'today',
            time: null,
            description: `Auto-extracted from: ${originalMessage}`
        };
    }
    
    // Ensure date defaults to today if not provided
    if (!reminderData.date || reminderData.date === '' || reminderData.date === 'null') {
        reminderData.date = 'today';
    }
    
    // Convert date and time
    const isoDate = convertDateToISO(reminderData.date);
    const convertedTime = convertTimeTo24h(reminderData.time);
    
    console.log(`📅 Creating reminder: "${reminderData.title}" on ${isoDate} at ${convertedTime || 'no time'}`);
    
    // Create reminder time
    let reminderTime;
    if (convertedTime) {
        reminderTime = new Date(`${isoDate}T${convertedTime}:00`);
    } else {
        reminderTime = new Date(`${isoDate}T09:00:00`);
    }
    
    // CRITICAL: Ensure userId is included and valid
    if (!userId) {
        throw new Error('UserId is required for reminder creation');
    }
    
    console.log('👤 Creating reminder for userId:', userId);
    
    // Create reminder in database with explicit field validation
    const reminderDoc = {
        sessionId: sessionId,
        userId: new mongoose.Types.ObjectId(userId), // Ensure proper ObjectId format
        title: reminderData.title.trim(),
        description: (reminderData.description || '').trim(),
        reminderTime: reminderTime,
        isRecurring: false,
        status: 'pending',
        priority: 'medium',
        createdAt: new Date(),
        updatedAt: new Date()
    };
    
    console.log('💾 Saving reminder document:', reminderDoc);
    
    const reminder = new Reminder(reminderDoc);
    const savedReminder = await reminder.save();
    
    // VERIFICATION: Confirm the reminder was saved with userId
    const verifyReminder = await Reminder.findById(savedReminder._id);
    if (!verifyReminder || !verifyReminder.userId) {
        throw new Error('Reminder was not saved properly with userId');
    }
    
    console.log('✅ Reminder saved and verified with ID:', savedReminder._id, 'and userId:', savedReminder.userId);
    
    // Update user stats
    await User.findByIdAndUpdate(userId, {
        $inc: { 'stats.totalReminders': 1 },
        $set: { 'stats.lastActiveAt': new Date() }
    });
    
    return {
        id: savedReminder._id,
        title: savedReminder.title,
        date: isoDate,
        time: convertedTime,
        description: savedReminder.description,
        reminderTime: savedReminder.reminderTime,
        status: savedReminder.status,
        verified: true // Flag to indicate successful verification
    };
}

// ============= MIDDLEWARE SETUP =============
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-session-secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/remindme'
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'", "https://cdnjs.cloudflare.com"],
            scriptSrcAttr: ["'unsafe-inline'", "'unsafe-hashes'"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'"]
        }
    }
}));

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true
}));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many authentication attempts, please try again later.'
});

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later.'
});

app.use('/auth/login', authLimiter);
app.use('/auth/signup', authLimiter);
app.use('/api/', generalLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(uploadsDir));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/remindme', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// ============= AUTHENTICATION ROUTES =============

app.use('/auth', authRouter);

// Serve auth page
app.get('/auth', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/auth.html'));
});

// Serve forgot password page (NEW ROUTE)
app.get('/forgot-password', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/forgot-password.html'));
});

// Serve reset password page (NEW ROUTE) 
app.get('/reset-password', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/reset-password.html'));
});

// Serve main app (protected)
app.get('/app', authenticateToken, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Redirect root to appropriate page
app.get('/', (req, res) => {
    const token = req.cookies.auth_token;
    if (token) {
        try {
            const jwt = require('jsonwebtoken');
            jwt.verify(token, process.env.JWT_SECRET);
            res.redirect('/app');
        } catch (error) {
            res.redirect('/auth');
        }
    } else {
        res.redirect('/auth');
    }
});

// ============= ENHANCED CHAT ENDPOINT WITH DUAL API =============
app.post('/api/chat', authenticateToken, async (req, res) => {
    try {
        const { message } = req.body;
        const userId = req.user._id;
        const userSessionId = req.sessionId;

        if (!message) {
            return res.status(400).json({ 
                error: 'Message is required',
                success: false 
            });
        }

        console.log('💬 Processing message:', message, 'for user:', userId);

        // Step 1: Chat API - Get response and detect trigger
        const model = genAI.getGenerativeModel({ 
            model: 'gemini-1.5-flash',
            generationConfig: {
                maxOutputTokens: 500,
                temperature: 0.7,
            }
        });

        const chatPrompt = CHAT_ANALYSIS_PROMPT.replace('{message}', message);
        const chatResult = await model.generateContent(chatPrompt);
        const chatResponse = chatResult.response.text();
        
        console.log('🤖 Chat API response:', chatResponse);
        
        const chatData = parseJsonResponse(chatResponse);
        
        if (!chatData) {
            // Fallback if JSON parsing fails
            const fallbackPrompt = `You are remindME, a helpful AI assistant for ${req.user.name}. User says: "${message}". Respond helpfully.`;
            const fallbackResult = await model.generateContent(fallbackPrompt);
            const fallbackResponse = fallbackResult.response.text();
            
            return res.json({
                response: fallbackResponse,
                sessionId: userSessionId,
                trigger: false,
                success: true
            });
        }

        const responseData = {
            response: chatData.message || 'I understand your message.',
            trigger: chatData.trigger || false,
            sessionId: userSessionId,
            success: true,
            reminder_created: null,
            processing_status: 'completed'
        };

        console.log('🎯 AI Response generated, trigger detected:', chatData.trigger);

        // Step 2: If trigger is true, process with Data API
        if (chatData.trigger) {
            console.log('🔄 Trigger detected, extracting reminder details...');
            responseData.processing_status = 'processing_reminder';
            
            try {
                // Data API - Extract reminder details
                const dataPrompt = DATA_EXTRACTION_PROMPT.replace('{message}', message);
                const dataResult = await model.generateContent(dataPrompt);
                const dataResponse = dataResult.response.text();
                
                console.log('📊 Data API response:', dataResponse);
                
                const reminderData = parseJsonResponse(dataResponse);
                
                if (reminderData) {
                    // Process and store the reminder with retry logic
                    let storedReminder = null;
                    let attempts = 0;
                    const maxAttempts = 3;
                    
                    while (!storedReminder && attempts < maxAttempts) {
                        attempts++;
                        try {
                            console.log(`🔄 Attempt ${attempts} to create reminder...`);
                            storedReminder = await processReminderData(reminderData, userId, userSessionId, message);
                            
                            if (storedReminder && storedReminder.verified) {
                                responseData.reminder_created = storedReminder;
                                responseData.processing_status = 'reminder_created';
                                console.log(`✅ Reminder created successfully on attempt ${attempts}: ${storedReminder.title}`);
                                break;
                            }
                        } catch (reminderError) {
                            console.error(`❌ Reminder creation attempt ${attempts} failed:`, reminderError);
                            if (attempts === maxAttempts) {
                                console.error('❌ All reminder creation attempts failed');
                                responseData.processing_status = 'reminder_failed';
                                responseData.error = 'Failed to create reminder after multiple attempts';
                            }
                            // Wait before retry
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }
                    }
                } else {
                    console.log('❌ Failed to parse reminder data from Data API');
                    responseData.processing_status = 'parsing_failed';
                }
                
            } catch (dataError) {
                console.error('❌ Data API error:', dataError);
                responseData.processing_status = 'data_api_failed';
                responseData.error = 'Failed to extract reminder details';
            }
        }

        // Save conversation to database
        try {
            let conversation = await Conversation.findOne({ 
                sessionId: userSessionId,
                userId: userId 
            });
            
            if (!conversation) {
                conversation = new Conversation({ 
                    sessionId: userSessionId, 
                    userId: userId,
                    messages: [] 
                });
            }
            
            conversation.messages.push(
                { role: 'user', content: message, timestamp: new Date() },
                { role: 'assistant', content: responseData.response, timestamp: new Date() }
            );
            
            await conversation.save();

            // Update user stats
            await User.findByIdAndUpdate(userId, {
                $inc: { 'stats.totalConversations': 1 },
                $set: { 'stats.lastActiveAt': new Date() }
            });

        } catch (dbError) {
            console.log('Database save failed:', dbError.message);
        }

        // Add delay to ensure database consistency before response
        if (responseData.reminder_created) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        return res.json(responseData);

    } catch (error) {
        console.error('❌ Chat error:', error.message);
        res.status(500).json({ 
            error: 'AI service is temporarily busy. Please try again.',
            success: false
        });
    }
});

// ============= REST OF THE ENDPOINTS (UNCHANGED) =============

// File upload configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
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

// Text extraction functions (unchanged)
async function extractTextFromFile(filePath, mimeType) {
    try {
        let extractedText = '';
        let metadata = {};

        switch (mimeType) {
            case 'application/pdf':
                const pdfBuffer = fs.readFileSync(filePath);
                const pdfData = await pdfParse(pdfBuffer);
                extractedText = pdfData.text;
                metadata = { pages: pdfData.numpages, wordCount: pdfData.text.split(/\s+/).length };
                break;

            case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                const docxBuffer = fs.readFileSync(filePath);
                const docxResult = await mammoth.extractRawText({ buffer: docxBuffer });
                extractedText = docxResult.value;
                metadata = { wordCount: extractedText.split(/\s+/).length };
                break;

            case 'text/plain':
                extractedText = fs.readFileSync(filePath, 'utf8');
                metadata = { wordCount: extractedText.split(/\s+/).length };
                break;

            case 'image/jpeg':
            case 'image/png':
            case 'image/gif':
                extractedText = `[Image file: ${path.basename(filePath)}]`;
                metadata = { type: 'image' };
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

async function processFileContent(extractedText, filename) {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `Analyze this document and provide a JSON response:
        
        Document: ${filename}
        Content: ${extractedText}
        
        Provide:
        1. Brief summary (2-3 sentences)
        2. Key topics
        3. Important dates
        4. Action items
        5. People/organizations mentioned
        6. Sentiment
        
        Respond in JSON format:
        {
          "summary": "Brief summary",
          "keyTopics": ["topic1", "topic2"],
          "importantDates": ["date1", "date2"],
          "actionItems": ["action1", "action2"],
          "entities": ["person1", "org1"],
          "sentiment": "positive/negative/neutral"
        }`;

        const result = await model.generateContent(prompt);
        const response = result.response.text();
        
        try {
            return JSON.parse(response);
        } catch (parseError) {
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

// File upload
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded', success: false });
        }

        const userId = req.user._id;
        const userSessionId = req.sessionId;

        console.log('📁 File uploaded by user:', req.user.email, req.file.originalname);

        const uploadedFile = new UploadedFile({
            sessionId: userSessionId,
            userId: userId,
            filename: req.file.filename,
            originalName: req.file.originalname,
            fileType: path.extname(req.file.originalname).toLowerCase(),
            fileSize: req.file.size,
            filePath: req.file.path,
            mimeType: req.file.mimetype,
            processingStatus: 'processing'
        });

        await uploadedFile.save();

        const { extractedText, metadata } = await extractTextFromFile(req.file.path, req.file.mimetype);
        const aiAnalysis = await processFileContent(extractedText, req.file.originalname);

        uploadedFile.extractedText = extractedText;
        uploadedFile.metadata = metadata;
        uploadedFile.processingStatus = 'completed';
        uploadedFile.processedAt = new Date();
        await uploadedFile.save();

        const memory = new Memory({
            sessionId: userSessionId,
            userId: userId,
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
                people: aiAnalysis.entities.filter(e => e.includes(' '))
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
            memory: { id: memory._id, summary: memory.summary, tags: memory.tags }
        });

    } catch (error) {
        console.error('File upload error:', error);
        res.status(500).json({ error: error.message || 'Failed to process file', success: false });
    }
});

// Get reminders
app.get('/api/reminders', authenticateToken, async (req, res) => {
    try {
        const userId = req.user._id;
        console.log('📋 Fetching reminders for userId:', userId);
        
        // Add cache-busting headers
        res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        
        const today = new Date();
        const nextWeek = new Date(today.getTime() + (7 * 24 * 60 * 60 * 1000));

        // Get all reminders for this user with explicit userId query
        const allReminders = await Reminder.find({ 
            userId: new mongoose.Types.ObjectId(userId),
            status: { $ne: 'completed' }
        }).sort({ reminderTime: 1 }).lean(); // Use lean() for better performance

        console.log(`📊 Found ${allReminders.length} reminders for user ${userId}`);
        
        // Debug: Log details of found reminders
        if (allReminders.length > 0) {
            allReminders.slice(0, 3).forEach((reminder, index) => {
                console.log(`📝 Reminder ${index + 1}: "${reminder.title}" at ${reminder.reminderTime} (userId: ${reminder.userId})`);
            });
        } else {
            console.log('ℹ️  No reminders found for this user');
        }

        const todayReminders = allReminders.filter(reminder => {
            const reminderDate = new Date(reminder.reminderTime);
            return reminderDate.toDateString() === today.toDateString();
        });

        const upcomingReminders = allReminders.filter(reminder => {
            const reminderDate = new Date(reminder.reminderTime);
            return reminderDate >= today && reminderDate <= nextWeek;
        });

        console.log(`📅 Today: ${todayReminders.length}, Upcoming: ${upcomingReminders.length}, Total: ${allReminders.length}`);

        // Enhanced format function with better error handling
        const formatReminder = (reminder) => {
            try {
                const reminderDate = new Date(reminder.reminderTime);
                return {
                    id: reminder._id,
                    title: reminder.title || 'Untitled Reminder',
                    description: reminder.description || '',
                    time: reminderDate.toTimeString().slice(0, 5),
                    date: reminderDate.toISOString().split('T')[0],
                    completed: reminder.status === 'completed',
                    reminderTime: reminder.reminderTime,
                    status: reminder.status,
                    priority: reminder.priority
                };
            } catch (error) {
                console.error('Error formatting reminder:', error, reminder);
                return {
                    id: reminder._id,
                    title: 'Error formatting reminder',
                    description: '',
                    time: '09:00',
                    date: today.toISOString().split('T')[0],
                    completed: false
                };
            }
        };

        const response = {
            success: true,
            today_reminders: todayReminders.map(formatReminder),
            upcoming_reminders: upcomingReminders.map(formatReminder),
            all_reminders: allReminders.map(formatReminder),
            total_count: allReminders.length,
            user_id: userId,
            timestamp: new Date().toISOString()
        };

        console.log('📤 Sending reminders response:', {
            today: response.today_reminders.length,
            upcoming: response.upcoming_reminders.length,
            total: response.total_count,
            userId: userId
        });

        res.json(response);

    } catch (error) {
        console.error('❌ Get reminders error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch reminders',
            error: error.message 
        });
    }
});

// Create reminder manually
app.post('/api/reminders', authenticateToken, async (req, res) => {
    try {
        const { title, time, date, description } = req.body;
        const userId = req.user._id;
        const userSessionId = req.sessionId;

        if (!title || !date) {
            return res.status(400).json({ success: false, message: 'Title and date are required' });
        }

        const reminder = new Reminder({
            sessionId: userSessionId,
            userId: userId,
            title: title,
            description: description || '',
            reminderTime: new Date(`${date}T${time || '09:00'}:00`),
            isRecurring: false,
            status: 'pending',
            priority: 'medium'
        });

        await reminder.save();

        res.json({
            success: true,
            reminder: {
                id: reminder._id,
                title: reminder.title,
                time: time,
                date: date,
                description: reminder.description
            }
        });

    } catch (error) {
        console.error('Reminder creation error:', error);
        res.status(500).json({ success: false, message: 'Failed to create reminder' });
    }
});

// Get conversation history
app.get('/api/conversation', authenticateToken, async (req, res) => {
    try {
        const userId = req.user._id;
        const userSessionId = req.sessionId;
        
        const conversation = await Conversation.findOne({ 
            sessionId: userSessionId,
            userId: userId 
        });
        
        if (!conversation) {
            return res.json({ 
                messages: [],
                sessionId: userSessionId,
                success: true 
            });
        }

        res.json({ 
            messages: conversation.messages,
            sessionId: userSessionId,
            success: true,
            messageCount: conversation.messages.length
        });
    } catch (error) {
        console.error('Get conversation error:', error);
        res.status(500).json({ error: 'Failed to fetch conversation', success: false });
    }
});

// Health check
app.get('/api/health', async (req, res) => {
    try {
        const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        const geminiConfigured = !!GEMINI_API_KEY;
        
        const totalUsers = await User.countDocuments();
        const totalConversations = await Conversation.countDocuments();
        const totalFiles = await UploadedFile.countDocuments();
        const totalMemories = await Memory.countDocuments();
        const totalReminders = await Reminder.countDocuments();
        
        res.json({ 
            status: 'OK',
            timestamp: new Date().toISOString(),
            services: {
                database: mongoStatus,
                ai: geminiConfigured ? 'configured' : 'not configured',
                authentication: 'active'
            },
            stats: {
                totalUsers,
                totalConversations,
                totalFiles,
                totalMemories,
                totalReminders,
                uptime: process.uptime()
            },
            version: '2.0.0 - Dual API',
            environment: process.env.NODE_ENV || 'development'
        });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({ status: 'ERROR', timestamp: new Date().toISOString(), error: 'Health check failed' });
    }
});



// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 10MB.', success: false });
        }
    }
    res.status(500).json({ error: 'Something broke!', success: false });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Auth Page: http://localhost:${PORT}/auth`);
    console.log(`📱 Main App: http://localhost:${PORT}/app`);
    console.log(`🔌 API Health: http://localhost:${PORT}/api/health`);
    console.log(`📁 Uploads directory: ${uploadsDir}`);
    console.log('🤖 Using Dual API System: Chat API → Data API (if triggered)');
});

module.exports = app;