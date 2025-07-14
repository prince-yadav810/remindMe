// ============= ENHANCED SERVER.JS WITH ALL FIXES =============
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

const app = express();
const PORT = process.env.PORT || 3001;

// Use single API key
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

// ============= ENHANCED UTILITY FUNCTIONS =============

// Get comprehensive current date/time context
function getCurrentDateTimeContext() {
    const now = new Date();
    const options = {
        timeZone: 'America/New_York', // You can make this configurable
        weekday: 'long',
        year: 'numeric', 
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    };
    
    const readable = now.toLocaleString('en-US', options);
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
    const isoDate = now.toISOString().split('T')[0];
    const time24 = now.toTimeString().slice(0, 5);
    
    return {
        readable: readable,
        dayOfWeek: dayOfWeek,
        isoDate: isoDate,
        time24: time24,
        timestamp: now.getTime(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        dateObject: now
    };
}

// Enhanced JSON parsing with better error handling
function parseJsonResponse(responseText) {
    try {
        let cleanText = responseText.trim();
        
        // Remove markdown code blocks
        if (cleanText.startsWith('```json')) {
            cleanText = cleanText.slice(7, -3);
        } else if (cleanText.startsWith('```')) {
            cleanText = cleanText.slice(3, -3);
        }
        
        // Extract JSON from response using multiple patterns
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            cleanText = jsonMatch[0];
        }
        
        // Try to parse
        const parsed = JSON.parse(cleanText.trim());
        console.log('✅ Successfully parsed JSON:', parsed);
        return parsed;
        
    } catch (error) {
        console.error('❌ JSON parsing error:', error.message);
        console.error('Raw text (first 200 chars):', responseText.substring(0, 200));
        
        // Try to extract key information manually as fallback
        try {
            const messageMatch = responseText.match(/"message"\s*:\s*"([^"]+)"/);
            const triggerMatch = responseText.match(/"trigger"\s*:\s*(true|false)/);
            const titleMatch = responseText.match(/"title"\s*:\s*"([^"]+)"/);
            
            if (messageMatch) {
                const fallback = {
                    message: messageMatch[1],
                    trigger: triggerMatch ? triggerMatch[1] === 'true' : false
                };
                
                if (titleMatch) {
                    fallback.title = titleMatch[1];
                }
                
                console.log('🔧 Using fallback parsing:', fallback);
                return fallback;
            }
        } catch (fallbackError) {
            console.error('❌ Fallback parsing also failed:', fallbackError.message);
        }
        
        return null;
    }
}

// Enhanced date conversion with better relative time support
function convertDateToISO(dateStr, currentDateTime) {
    const now = currentDateTime || new Date();
    console.log('🕒 Converting date:', dateStr, 'with current time:', now.toISOString());
    
    if (!dateStr || dateStr === '' || dateStr === 'null' || dateStr === 'undefined') {
        console.log('🗓️ No date provided, defaulting to today');
        return now.toISOString().split('T')[0];
    }
    
    dateStr = dateStr.toLowerCase().trim();
    
    // Handle relative dates
    if (dateStr === 'today') {
        return now.toISOString().split('T')[0];
    } else if (dateStr === 'tomorrow') {
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
    } else if (dateStr === 'yesterday') {
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        return yesterday.toISOString().split('T')[0];
    }
    
    // Handle "in X hours/minutes/days" calculations
    if (dateStr.includes('in ') && (dateStr.includes('hour') || dateStr.includes('minute') || dateStr.includes('day'))) {
        const calculatedDate = new Date(now);
        
        if (dateStr.includes('hour')) {
            const hours = parseInt(dateStr.match(/\d+/)?.[0] || '1');
            calculatedDate.setHours(calculatedDate.getHours() + hours);
            console.log(`⏰ Added ${hours} hours: ${calculatedDate.toISOString()}`);
            return calculatedDate.toISOString().split('T')[0];
        } else if (dateStr.includes('minute')) {
            const minutes = parseInt(dateStr.match(/\d+/)?.[0] || '30');
            calculatedDate.setMinutes(calculatedDate.getMinutes() + minutes);
            console.log(`⏰ Added ${minutes} minutes: ${calculatedDate.toISOString()}`);
            return calculatedDate.toISOString().split('T')[0];
        } else if (dateStr.includes('day')) {
            const days = parseInt(dateStr.match(/\d+/)?.[0] || '1');
            calculatedDate.setDate(calculatedDate.getDate() + days);
            console.log(`📅 Added ${days} days: ${calculatedDate.toISOString()}`);
            return calculatedDate.toISOString().split('T')[0];
        }
    }
    
    // Handle day names (next Monday, Tuesday, etc.)
    if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(dateStr)) {
        const days = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
        const targetDay = days[dateStr];
        const currentDay = now.getDay();
        let daysAhead = targetDay - currentDay;
        if (daysAhead <= 0) daysAhead += 7; // Next occurrence
        
        const targetDate = new Date(now);
        targetDate.setDate(now.getDate() + daysAhead);
        console.log(`📅 Next ${dateStr}: ${targetDate.toISOString().split('T')[0]}`);
        return targetDate.toISOString().split('T')[0];
    }
    
    // Handle month day format like "july 15", "december 25"
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
            const targetDate = new Date(now.getFullYear(), month, day);
            // If the date has passed this year, use next year
            if (targetDate < now) {
                targetDate.setFullYear(now.getFullYear() + 1);
            }
            console.log(`📅 Parsed ${dateStr}: ${targetDate.toISOString().split('T')[0]}`);
            return targetDate.toISOString().split('T')[0];
        } catch (error) {
            console.error('Invalid date:', month, day);
            return now.toISOString().split('T')[0];
        }
    }
    
    // Handle ISO date format (YYYY-MM-DD)
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return dateStr;
    }
    
    // Default to today if nothing matches
    console.log('📅 Defaulting to today for unrecognized format:', dateStr);
    return now.toISOString().split('T')[0];
}

// Enhanced time conversion with relative time support
function convertTimeTo24h(timeStr, currentDateTime) {
    if (!timeStr) return null;
    
    const now = currentDateTime || new Date();
    timeStr = timeStr.toLowerCase().trim();
    console.log('🕐 Converting time:', timeStr);
    
    // Handle "in X hours/minutes" format
    if (timeStr.includes('in ') && (timeStr.includes('hour') || timeStr.includes('minute'))) {
        const calculatedTime = new Date(now);
        
        if (timeStr.includes('hour')) {
            const hours = parseInt(timeStr.match(/\d+/)?.[0] || '1');
            calculatedTime.setHours(calculatedTime.getHours() + hours);
            const result = `${calculatedTime.getHours().toString().padStart(2, '0')}:${calculatedTime.getMinutes().toString().padStart(2, '0')}`;
            console.log(`⏰ Calculated time for "${timeStr}": ${result}`);
            return result;
        } else if (timeStr.includes('minute')) {
            const minutes = parseInt(timeStr.match(/\d+/)?.[0] || '30');
            calculatedTime.setMinutes(calculatedTime.getMinutes() + minutes);
            const result = `${calculatedTime.getHours().toString().padStart(2, '0')}:${calculatedTime.getMinutes().toString().padStart(2, '0')}`;
            console.log(`⏰ Calculated time for "${timeStr}": ${result}`);
            return result;
        }
    }
    
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
        
        const result = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        console.log(`🕐 Converted "${timeStr}" to: ${result}`);
        return result;
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
            console.error('Error parsing time:', e);
        }
    }
    
    // Default times for common words
    if (timeStr.includes('morning')) return "09:00";
    if (timeStr.includes('afternoon')) return "14:00";
    if (timeStr.includes('evening')) return "18:00";
    if (timeStr.includes('night')) return "20:00";
    
    return null;
}

// Enhanced reminder processing with better error handling
async function processReminderData(reminderData, userId, sessionId, originalMessage) {
    console.log('🔍 Processing enhanced reminder data:', { reminderData, userId, sessionId });
    
    const currentDateTime = getCurrentDateTimeContext();
    
    // Validate input data
    if (!reminderData || !reminderData.title) {
        console.log('⚠️ Invalid reminder data, creating fallback');
        reminderData = {
            title: originalMessage.substring(0, 50) + '...',
            date: 'today',
            time: null,
            description: `Auto-extracted from: ${originalMessage}`
        };
    }
    
    // Enhanced date/time processing
    let isoDate, convertedTime;
    
    try {
        // Use enhanced conversion functions with current time context
        isoDate = convertDateToISO(reminderData.date, currentDateTime.dateObject);
        convertedTime = convertTimeTo24h(reminderData.time, currentDateTime.dateObject);
        
        console.log(`📅 Enhanced conversion result - Date: ${isoDate}, Time: ${convertedTime}`);
    } catch (conversionError) {
        console.error('❌ Date/time conversion error:', conversionError);
        // Fallback to today
        isoDate = currentDateTime.isoDate;
        convertedTime = null;
    }
    
    console.log(`📅 Creating reminder: "${reminderData.title}" on ${isoDate} at ${convertedTime || 'default time'}`);
    
    // Create reminder time with validation
    let reminderTime;
    try {
        if (convertedTime) {
            reminderTime = new Date(`${isoDate}T${convertedTime}:00`);
        } else {
            // Default to 9 AM if no time specified
            reminderTime = new Date(`${isoDate}T09:00:00`);
        }
        
        // Validate the date is not in the past (except for today)
        const now = new Date();
        if (reminderTime < now && isoDate !== currentDateTime.isoDate) {
            console.log('⚠️ Date is in the past, adjusting to next occurrence');
            reminderTime.setFullYear(now.getFullYear() + 1);
        }
        
    } catch (dateError) {
        console.error('❌ Error creating reminder date:', dateError);
        // Fallback to tomorrow at 9 AM
        reminderTime = new Date();
        reminderTime.setDate(reminderTime.getDate() + 1);
        reminderTime.setHours(9, 0, 0, 0);
    }
    
    // Validate userId
    if (!userId) {
        throw new Error('UserId is required for reminder creation');
    }
    
    console.log('👤 Creating reminder for userId:', userId);
    
    // Create reminder document with enhanced validation
    const reminderDoc = {
        sessionId: sessionId,
        userId: new mongoose.Types.ObjectId(userId),
        title: reminderData.title.trim(),
        description: (reminderData.description || '').trim(),
        reminderTime: reminderTime,
        isRecurring: false,
        status: 'pending',
        priority: 'medium',
        createdAt: new Date(),
        updatedAt: new Date()
    };
    
    console.log('💾 Saving enhanced reminder document:', {
        title: reminderDoc.title,
        reminderTime: reminderDoc.reminderTime,
        userId: reminderDoc.userId
    });
    
    // Save with retry logic
    let savedReminder;
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const reminder = new Reminder(reminderDoc);
            savedReminder = await reminder.save();
            console.log(`✅ Reminder saved successfully on attempt ${attempt}`);
            break;
        } catch (saveError) {
            console.error(`❌ Save attempt ${attempt} failed:`, saveError.message);
            if (attempt === maxRetries) {
                throw saveError;
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 100 * attempt));
        }
    }
    
    // Verification
    const verifyReminder = await Reminder.findById(savedReminder._id);
    if (!verifyReminder || !verifyReminder.userId) {
        throw new Error('Reminder was not saved properly with userId');
    }
    
    console.log('✅ Enhanced reminder saved and verified with ID:', savedReminder._id);
    
    // Update user stats
    try {
        await User.findByIdAndUpdate(userId, {
            $inc: { 'stats.totalReminders': 1 },
            $set: { 'stats.lastActiveAt': new Date() }
        });
    } catch (statsError) {
        console.error('⚠️ Failed to update user stats:', statsError.message);
        // Don't fail the whole operation for stats update
    }
    
    return {
        id: savedReminder._id,
        title: savedReminder.title,
        date: isoDate,
        time: convertedTime,
        description: savedReminder.description,
        reminderTime: savedReminder.reminderTime,
        status: savedReminder.status,
        verified: true,
        originalMessage: originalMessage,
        currentDateTime: currentDateTime.readable
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

// ============= ENHANCED CHAT ENDPOINT =============
app.post('/api/chat', authenticateToken, async (req, res) => {
    try {
        const { message, conversationId } = req.body;
        const userId = req.user._id;
        let userSessionId = req.sessionId;

        if (!message) {
            return res.status(400).json({ 
                error: 'Message is required',
                success: false 
            });
        }

        console.log('💬 Processing message:', message, 'for user:', userId, 'conversation:', conversationId);

        // Get comprehensive current date/time context
        const currentDateTime = getCurrentDateTimeContext();
        console.log('🕒 Current context:', currentDateTime);

        // Find existing conversation or create new one
        let conversation;
        let isNewConversation = false;
        
        if (conversationId) {
            conversation = await Conversation.findOne({ 
                _id: conversationId,
                userId: userId 
            });
            if (conversation) {
                userSessionId = conversation.sessionId;
                console.log('📖 Found existing conversation:', conversation.title);
            }
        }

        if (!conversation) {
            // Create new conversation
            userSessionId = `session-${userId}-${Date.now()}`;
            conversation = new Conversation({
                userId: userId,
                sessionId: userSessionId,
                title: 'New Conversation', // Will be updated with AI-generated title
                messages: [],
                context: {
                    keyTopics: [],
                    lastActivity: new Date()
                },
                isActive: true
            });
            isNewConversation = true;
            console.log('🆕 Creating new conversation');
        }

        // Build enhanced conversation context with complete previous messages
        const recentMessages = conversation.messages.slice(-20); // Increased for better context
        let contextPrompt = `CURRENT DATE AND TIME CONTEXT:
Date: ${currentDateTime.readable}
Day of Week: ${currentDateTime.dayOfWeek}
ISO Date: ${currentDateTime.isoDate}
24-hour Time: ${currentDateTime.time24}
Current Hour: ${currentDateTime.hour}
Current Minute: ${currentDateTime.minute}
Unix Timestamp: ${currentDateTime.timestamp}

IMPORTANT: Use this exact date and time information for all calculations. When user says "today" use ${currentDateTime.isoDate}, when they say "tomorrow" use the next day, etc.

`;
        
        if (recentMessages.length > 0) {
            contextPrompt += '\nPREVIOUS CONVERSATION CONTEXT:\n';
            recentMessages.forEach((msg, index) => {
                const msgTime = new Date(msg.timestamp).toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });
                contextPrompt += `[${msgTime}] ${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
            });
            contextPrompt += '\n--- END OF PREVIOUS CONTEXT ---\n\n';
        }
        
        contextPrompt += `CURRENT USER MESSAGE: ${message}`;

        // Enhanced Chat API prompt with better context awareness
        const ENHANCED_CHAT_PROMPT = `
You are remindME, a helpful AI personal assistant specialized in reminders, scheduling, and answering questions with full conversation context.

${contextPrompt}

CRITICAL INSTRUCTIONS:
1. ALWAYS consider the full conversation context above when responding
2. If the user refers to previous messages (like "what does he do" after asking about a CEO), use the context to understand the reference
3. Use the EXACT current date/time provided above for all time-based responses and calculations
4. Remember what was discussed earlier in this conversation and maintain continuity
5. For follow-up questions, refer back to previous context to provide accurate answers

RESPONSE REQUIREMENTS:
Analyze the user's current message and respond in JSON format:
{
    "message": "Your helpful response considering full conversation context",
    "trigger": true/false${isNewConversation ? ',\n    "title": "Brief 4-6 word conversation title"' : ''}
}

TRIGGER RULES (set to true if user wants to):
- Set a reminder (words: remind, reminder, remember, schedule, appointment, meeting, alert, notify)
- Create tasks with specific times/dates
- Set alarms or notifications
- Use phrases like "remind me", "don't forget", "set reminder", "in X hours", etc.

TRIGGER EXAMPLES:
✅ TRUE: "remind me to call John", "meeting tomorrow at 3pm", "in 2 hours remind me", "schedule appointment"
❌ FALSE: general questions, explanations, casual conversation, asking for information

${isNewConversation ? '\nSince this is a NEW conversation, also provide a brief, descriptive title (4-6 words) that captures the main topic.' : ''}

CONTEXT AWARENESS EXAMPLES:
- If previously discussed "OpenAI CEO" and user asks "what does he do", you should know they mean the CEO of OpenAI
- If user mentioned a project name and later asks "how's it going", refer to that project
- Maintain conversation flow and remember previous topics
`;

        // Enhanced data extraction prompt with comprehensive time context
        const ENHANCED_DATA_PROMPT = `
CURRENT DATE/TIME CONTEXT FOR REMINDER EXTRACTION:
Date: ${currentDateTime.readable}
Day: ${currentDateTime.dayOfWeek}
ISO Date: ${currentDateTime.isoDate}
Current Time (24h): ${currentDateTime.time24}
Current Hour: ${currentDateTime.hour}
Current Minute: ${currentDateTime.minute}
Unix Timestamp: ${currentDateTime.timestamp}

USER MESSAGE: "${message}"

PREVIOUS CONVERSATION CONTEXT:
${recentMessages.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n')}

EXTRACTION INSTRUCTIONS:
1. Use the EXACT current date/time above for all calculations
2. For relative times like "in 2 hours", calculate based on current time (${currentDateTime.time24})
3. For relative dates like "tomorrow", use the day after ${currentDateTime.isoDate}
4. If user says "today", use ${currentDateTime.isoDate}
5. Consider conversation context for understanding references

TIME CALCULATION EXAMPLES:
- "in 2 hours" = current time (${currentDateTime.time24}) + 2 hours
- "tomorrow at 3pm" = ${currentDateTime.isoDate} + 1 day + 15:00
- "next Monday" = calculate next Monday from ${currentDateTime.dayOfWeek}
- "in 30 minutes" = current time + 30 minutes

RESPONSE FORMAT (JSON only):
{
    "title": "Clear action description (required)",
    "date": "YYYY-MM-DD format or 'today'/'tomorrow'",
    "time": "HH:MM in 24-hour format or null",
    "description": "Additional context from message"
}

CRITICAL: For relative times, calculate the EXACT datetime based on the current timestamp ${currentDateTime.timestamp} provided above.
`;

        // API call with enhanced retry logic
        async function callGeminiWithRetry(prompt, maxRetries = 3) {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    console.log(`🤖 Gemini API call attempt ${attempt}/${maxRetries}`);
                    
                    const model = genAI.getGenerativeModel({ 
                        model: 'gemini-1.5-flash',
                        generationConfig: {
                            maxOutputTokens: 600,
                            temperature: 0.7,
                        }
                    });

                    const result = await model.generateContent(prompt);
                    const response = result.response.text();
                    console.log(`✅ Gemini API success on attempt ${attempt}`);
                    return response;
                    
                } catch (error) {
                    console.error(`❌ Gemini API attempt ${attempt} failed:`, error.message);
                    
                    if (error.message.includes('429') || error.message.includes('quota') || error.message.includes('rate limit')) {
                        console.log(`⏰ Rate limit hit, attempt ${attempt}/${maxRetries}`);
                        
                        if (attempt === maxRetries) {
                            return getFallbackResponse(message, isNewConversation, recentMessages);
                        }
                        
                        const waitTime = Math.pow(2, attempt) * 1000;
                        console.log(`⏳ Waiting ${waitTime}ms before retry...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }
                    
                    if (attempt === maxRetries) {
                        return getFallbackResponse(message, isNewConversation, recentMessages);
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }

        // Enhanced fallback response
        function getFallbackResponse(message, isNewConversation, recentMessages) {
            console.log('🔄 Using enhanced fallback response');
            
            const triggerWords = ['remind', 'reminder', 'remember', 'schedule', 'appointment', 'meeting', 'in ', ' at ', 'tomorrow', 'today', 'next week', 'alert'];
            const hasTrigger = triggerWords.some(word => message.toLowerCase().includes(word));
            
            // Try to maintain context in fallback
            let contextualResponse = `I understand you want me to help with: "${message}".`;
            
            if (recentMessages.length > 0) {
                const lastMessage = recentMessages[recentMessages.length - 2]; // Last user message
                if (lastMessage && lastMessage.role === 'user') {
                    contextualResponse = `I understand your follow-up about "${message}" in context of our previous discussion about "${lastMessage.content}".`;
                }
            }
            
            if (hasTrigger) {
                contextualResponse += " I'll help you set up that reminder.";
            } else {
                contextualResponse += " How can I assist you further?";
            }
            
            const fallbackResponse = {
                message: contextualResponse,
                trigger: hasTrigger
            };
            
            if (isNewConversation) {
                fallbackResponse.title = message.substring(0, 30).trim() + '...';
            }
            
            return JSON.stringify(fallbackResponse);
        }

        // Step 1: Enhanced Chat API with context
        const chatResponse = await callGeminiWithRetry(ENHANCED_CHAT_PROMPT);
        const chatData = parseJsonResponse(chatResponse);
        
        if (!chatData) {
            console.error('❌ Failed to parse chat response, using fallback');
            return res.status(500).json({
                error: 'Failed to process your message. Please try again.',
                success: false
            });
        }

        // Update conversation title if new
        if (isNewConversation && chatData.title) {
            conversation.title = chatData.title;
            console.log('📝 Set conversation title:', chatData.title);
        }

        const responseData = {
            response: chatData.message || 'I understand your message.',
            trigger: chatData.trigger || false,
            conversationId: conversation._id,
            sessionId: userSessionId,
            success: true,
            reminder_created: null,
            processing_status: 'completed',
            isNewConversation: isNewConversation,
            conversationTitle: conversation.title,
            currentDateTime: currentDateTime.readable
        };

        console.log('🎯 AI Response generated, trigger detected:', chatData.trigger);

        // Step 2: Enhanced reminder processing
        if (chatData.trigger) {
            console.log('🔄 Trigger detected, extracting reminder details with enhanced parsing...');
            responseData.processing_status = 'processing_reminder';
            
            try {
                const dataResponse = await callGeminiWithRetry(ENHANCED_DATA_PROMPT);
                const reminderData = parseJsonResponse(dataResponse);
                
                console.log('📊 Enhanced Data API response:', reminderData);
                
                if (reminderData && reminderData.title) {
                    let storedReminder = null;
                    let attempts = 0;
                    const maxAttempts = 3;
                    
                    while (!storedReminder && attempts < maxAttempts) {
                        attempts++;
                        try {
                            console.log(`🔄 Attempt ${attempts} to create reminder with enhanced processing...`);
                            storedReminder = await processReminderData(reminderData, userId, userSessionId, message);
                            
                            if (storedReminder && storedReminder.verified) {
                                responseData.reminder_created = storedReminder;
                                responseData.processing_status = 'reminder_created';
                                console.log(`✅ Enhanced reminder created successfully: ${storedReminder.title}`);
                                break;
                            }
                        } catch (reminderError) {
                            console.error(`❌ Reminder creation attempt ${attempts} failed:`, reminderError.message);
                            if (attempts === maxAttempts) {
                                responseData.processing_status = 'reminder_failed';
                                responseData.error = `Failed to create reminder: ${reminderError.message}`;
                            }
                            await new Promise(resolve => setTimeout(resolve, 100 * attempts));
                        }
                    }
                } else {
                    console.log('❌ Failed to parse reminder data or missing title');
                    responseData.processing_status = 'parsing_failed';
                    responseData.error = 'Could not extract reminder details. Please try with more specific information like "remind me to call John at 3pm tomorrow".';
                }
                
            } catch (dataError) {
                console.error('❌ Data API error:', dataError.message);
                responseData.processing_status = 'data_api_failed';
                responseData.error = 'Failed to process reminder. Please try again with more specific time details.';
            }
        }

        // Save conversation with enhanced context tracking
        conversation.messages.push(
            { role: 'user', content: message, timestamp: new Date() },
            { 
                role: 'assistant', 
                content: responseData.response, 
                timestamp: new Date(),
                metadata: {
                    intentClassification: chatData.trigger ? 'set_reminder' : 'general',
                    hasContext: recentMessages.length > 0,
                    contextLength: recentMessages.length,
                    currentDateTime: currentDateTime.readable
                }
            }
        );

        // Update conversation topics and activity
        if (conversation.messages.length <= 6) {
            const topics = extractTopics(message);
            conversation.context.keyTopics = [...new Set([...conversation.context.keyTopics, ...topics])];
        }
        
        conversation.context.lastActivity = new Date();
        await conversation.save();

        // Mark this conversation as active
        if (isNewConversation) {
            await Conversation.updateMany(
                { userId: userId, _id: { $ne: conversation._id } },
                { $set: { isActive: false } }
            );
        }

        return res.json(responseData);

    } catch (error) {
        console.error('❌ Enhanced Chat error:', error.message);
        
        if (error.message.includes('429') || error.message.includes('quota')) {
            res.status(429).json({ 
                error: 'API rate limit reached. Please wait a minute and try again.',
                success: false,
                retryAfter: 60
            });
        } else {
            res.status(500).json({ 
                error: 'Service temporarily unavailable. Please try again.',
                success: false
            });
        }
    }
});

// ============= NEW ENDPOINTS =============

// GET CURRENT CHAT ID ENDPOINT
app.get('/api/current-chat', authenticateToken, async (req, res) => {
    try {
        const userId = req.user._id;
        
        const activeConversation = await Conversation.findOne({
            userId: userId,
            isActive: true
        }).select('_id title sessionId createdAt context.lastActivity messageCount');
        
        if (activeConversation) {
            res.json({
                success: true,
                chatId: activeConversation._id,
                title: activeConversation.title,
                sessionId: activeConversation.sessionId,
                createdAt: activeConversation.createdAt,
                lastActivity: activeConversation.context.lastActivity,
                messageCount: activeConversation.messageCount
            });
        } else {
            res.json({
                success: true,
                chatId: null,
                message: 'No active conversation'
            });
        }
    } catch (error) {
        console.error('Error getting current chat:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get current chat ID'
        });
    }
});

// ============= EXISTING ENDPOINTS (ENHANCED) =============

app.post('/api/new-chat', authenticateToken, async (req, res) => {
    try {
        const userId = req.user._id;
        
        await Conversation.updateMany(
            { userId: userId, isActive: true },
            { $set: { isActive: false } }
        );

        console.log('✅ Started new chat session for user:', userId);
        
        res.json({
            success: true,
            message: 'New chat session started',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('New chat error:', error);
        res.status(500).json({ 
            error: 'Failed to start new chat',
            success: false 
        });
    }
});

app.get('/api/conversations', authenticateToken, async (req, res) => {
    try {
        const userId = req.user._id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        console.log('📚 Fetching conversation history for user:', userId);

        const conversations = await Conversation.find({ 
            userId: userId,
            messageCount: { $gt: 0 }
        })
        .select('title createdAt updatedAt messageCount context.lastActivity isActive')
        .sort({ 'context.lastActivity': -1 })
        .skip(skip)
        .limit(limit)
        .lean();

        const totalConversations = await Conversation.countDocuments({ 
            userId: userId,
            messageCount: { $gt: 0 }
        });

        console.log(`📊 Found ${conversations.length} conversations for user ${userId}`);

        res.json({
            success: true,
            conversations: conversations.map(conv => ({
                id: conv._id,
                title: conv.title,
                messageCount: conv.messageCount,
                lastActivity: conv.context?.lastActivity || conv.createdAt,
                createdAt: conv.createdAt,
                isActive: conv.isActive
            })),
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalConversations / limit),
                totalConversations: totalConversations,
                hasNext: skip + conversations.length < totalConversations,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('❌ Get conversations error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch conversation history',
            error: error.message 
        });
    }
});

app.get('/api/conversations/:conversationId', authenticateToken, async (req, res) => {
    try {
        const userId = req.user._id;
        const conversationId = req.params.conversationId;

        console.log('📖 Loading conversation:', conversationId, 'for user:', userId);

        const conversation = await Conversation.findOne({
            _id: conversationId,
            userId: userId
        }).lean();

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'Conversation not found'
            });
        }

        await Conversation.updateMany(
            { userId: userId },
            { $set: { isActive: false } }
        );
        
        await Conversation.findByIdAndUpdate(conversationId, {
            $set: { isActive: true, 'context.lastActivity': new Date() }
        });

        res.json({
            success: true,
            conversation: {
                id: conversation._id,
                title: conversation.title,
                messages: conversation.messages,
                sessionId: conversation.sessionId,
                messageCount: conversation.messageCount,
                createdAt: conversation.createdAt,
                lastActivity: conversation.context?.lastActivity || conversation.createdAt
            }
        });

    } catch (error) {
        console.error('❌ Load conversation error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load conversation',
            error: error.message
        });
    }
});

// ============= UTILITY FUNCTIONS =============
function extractTopics(message) {
    const words = message.toLowerCase().split(/\s+/);
    const topics = words.filter(word => 
        word.length > 4 && 
        !['remind', 'please', 'could', 'would', 'should', 'tomorrow', 'today', 'hello', 'thanks'].includes(word)
    );
    return topics.slice(0, 3);
}

// ============= KEEP ALL OTHER EXISTING ENDPOINTS =============
// [File upload, reminders, health check, etc. - keep as they were in your original code]

// Get reminders (enhanced with better formatting)
app.get('/api/reminders', authenticateToken, async (req, res) => {
    try {
        const userId = req.user._id;
        console.log('📋 Fetching reminders for userId:', userId);
        
        res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        
        const today = new Date();
        const nextWeek = new Date(today.getTime() + (7 * 24 * 60 * 60 * 1000));

        const allReminders = await Reminder.find({ 
            userId: new mongoose.Types.ObjectId(userId),
            status: { $ne: 'completed' }
        }).sort({ reminderTime: 1 }).lean();

        console.log(`📊 Found ${allReminders.length} reminders for user ${userId}`);

        const todayReminders = allReminders.filter(reminder => {
            const reminderDate = new Date(reminder.reminderTime);
            return reminderDate.toDateString() === today.toDateString();
        });

        const upcomingReminders = allReminders.filter(reminder => {
            const reminderDate = new Date(reminder.reminderTime);
            return reminderDate >= today && reminderDate <= nextWeek;
        });

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
                console.error('Error formatting reminder:', error);
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

// [Keep all other existing endpoints like file upload, manual reminder creation, health check, etc.]

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

// Health check
app.get('/api/health', async (req, res) => {
    try {
        const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        const geminiConfigured = !!GEMINI_API_KEY;
        
        const totalUsers = await User.countDocuments();
        const totalConversations = await Conversation.countDocuments();
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
                totalReminders,
                uptime: process.uptime()
            },
            version: '3.0.0 - Enhanced Context & Time Parsing',
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
    console.log(`🆔 Current Chat: http://localhost:${PORT}/api/current-chat`);
    console.log('🤖 Using Enhanced Dual API System with Full Context Management');
});

module.exports = app;