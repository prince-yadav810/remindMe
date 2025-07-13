// ============= backend/server.js (EXACT PYTHON EQUIVALENT) =============
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

require('dotenv').config();

// ============= DUAL API CONFIGURATION (EXACTLY LIKE PYTHON) =============
const CHAT_API_KEY = process.env.GEMINI_CHAT_API_KEY;
const DATA_API_KEY = process.env.GEMINI_DATA_API_KEY;

if (!CHAT_API_KEY || !DATA_API_KEY) {
    console.error('❌ Both GEMINI_CHAT_API_KEY and GEMINI_DATA_API_KEY must be set in .env file');
    process.exit(1);
}

console.log('🔑 Chat API Key loaded:', CHAT_API_KEY ? 'YES' : 'NO');
console.log('🔑 Data API Key loaded:', DATA_API_KEY ? 'YES' : 'NO');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration for free API usage (same as Python)
const generationConfig = {
    temperature: 0.7,
    top_p: 0.95,
    top_k: 40,
    max_output_tokens: 1024,
};

const safetySettings = [
    {
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_MEDIUM_AND_ABOVE"
    },
    {
        category: "HARM_CATEGORY_HATE_SPEECH", 
        threshold: "BLOCK_MEDIUM_AND_ABOVE"
    },
    {
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_MEDIUM_AND_ABOVE"
    },
    {
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold: "BLOCK_MEDIUM_AND_ABOVE"
    }
];

// Initialize Chat Model (exactly like Python)
const chatGenAI = new GoogleGenerativeAI(CHAT_API_KEY);
const chatModel = chatGenAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig,
    safetySettings
});

// Initialize Data Model (exactly like Python)
const dataGenAI = new GoogleGenerativeAI(DATA_API_KEY);
const dataModel = dataGenAI.getGenerativeModel({
    model: 'gemini-1.5-flash', 
    generationConfig,
    safetySettings
});

// ============= EXACT SAME PROMPTS AS PYTHON =============
const CHAT_ANALYSIS_PROMPT = `
Analyze the user's message and respond in JSON format. You should:
1. Provide a helpful response to the user
2. Determine if the message contains reminder/scheduling information

User message: "{message}"

Respond ONLY in this JSON format:
{{
    "message": "Your helpful response to the user",
    "trigger": true/false
}}

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

const DATA_EXTRACTION_PROMPT = `
Extract reminder details from this message. Handle conflicting date information intelligently.

User message: "{message}"

Instructions:
- If multiple dates are mentioned, prioritize specific dates over relative dates
- Extract the main task/action clearly
- For dates: prefer specific dates like "July 13" over "today" if both are present
- For times: extract any time mentioned
- Always provide a title even if you need to infer it

Respond ONLY in this JSON format:
{{
    "title": "Brief action to remember (required)",
    "date": "specific date like 'july 13' or relative like 'today/tomorrow'",
    "time": "HH:MM in 24-hour format or null",
    "description": "Additional context if any"
}}

Date priority rules:
- Specific dates (July 13, Dec 25, 2024-07-13) take priority over relative dates
- If only relative dates (today, tomorrow), use those
- If no date mentioned, default to "today"

Examples:
- "meeting today at 3 PM" → {{"title": "Meeting", "date": "today", "time": "15:00", "description": ""}}
- "meeting today at 3 PM at 13 july" → {{"title": "Meeting", "date": "july 13", "time": "15:00", "description": ""}}
- "call John at 2 PM on Monday" → {{"title": "Call John", "date": "monday", "time": "14:00", "description": ""}}
- "submit report by Friday morning" → {{"title": "Submit report", "date": "friday", "time": "09:00", "description": "Deadline"}}
`;

// ============= EXACT PYTHON UTILITY FUNCTIONS =============

async function safeApiCall(model, prompt, maxRetries = 2) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await model.generateContent(prompt);
            return response.response.text();
        } catch (error) {
            if (attempt === maxRetries - 1) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

function parseJsonResponse(responseText) {
    try {
        let cleanText = responseText.trim();
        if (cleanText.startsWith('```json')) {
            cleanText = cleanText.substring(7, cleanText.length - 3);
        } else if (cleanText.startsWith('```')) {
            cleanText = cleanText.substring(3, cleanText.length - 3);
        }
        
        // Remove any extra text before/after JSON
        const jsonMatch = cleanText.match(/\{.*\}/s);
        if (jsonMatch) {
            cleanText = jsonMatch[0];
        }
        
        return JSON.parse(cleanText.trim());
    } catch (error) {
        console.error(`JSON parsing error: ${error}, text: ${responseText.substring(0, 200)}`);
        return null;
    }
}

function convertDateToIso(dateStr) {
    const today = new Date();
    const currentYear = today.getFullYear();
    
    if (!dateStr) {
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
        // Handle day names
        const days = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
        const targetDay = days[dateStr];
        const currentDay = today.getDay() === 0 ? 6 : today.getDay() - 1; // Convert Sunday=0 to Monday=0
        let daysAhead = targetDay - currentDay;
        if (daysAhead <= 0) {
            daysAhead += 7;
        }
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + daysAhead);
        return targetDate.toISOString().split('T')[0];
    } else {
        try {
            // Handle month day formats like "july 13", "dec 25", etc.
            const monthDayMatch = dateStr.match(/(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})/);
            
            if (monthDayMatch) {
                const monthStr = monthDayMatch[1];
                const day = parseInt(monthDayMatch[2]);
                
                // Convert month name to number
                const monthMap = {
                    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
                    april: 4, apr: 4, may: 5, june: 6, jun: 6,
                    july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9,
                    october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12
                };
                
                const month = monthMap[monthStr] || today.getMonth() + 1;
                
                // Create the date - if the date has passed this year, assume next year
                try {
                    let targetDate = new Date(currentYear, month - 1, day);
                    if (targetDate < today) {
                        targetDate = new Date(currentYear + 1, month - 1, day);
                    }
                    return targetDate.toISOString().split('T')[0];
                } catch (error) {
                    console.log(`Invalid date: ${month}/${day}, defaulting to today`);
                    return today.toISOString().split('T')[0];
                }
            }
            
            // Try to parse as ISO date
            if (dateStr.length === 10 && dateStr.includes('-')) {
                const parsedDate = new Date(dateStr);
                return parsedDate.toISOString().split('T')[0];
            } else {
                console.log(`Warning: Could not parse complex date '${dateStr}', defaulting to today`);
                return today.toISOString().split('T')[0];
            }
        } catch (error) {
            console.log(`Warning: Could not parse date '${dateStr}' (error: ${error}), defaulting to today`);
            return today.toISOString().split('T')[0];
        }
    }
}

function convertTimeTo24h(timeStr) {
    if (!timeStr) {
        return null;
    }
    
    timeStr = timeStr.toLowerCase().trim();
    
    // Handle 12 AM/PM specifically
    if (timeStr.includes('12 am') || timeStr.includes('12am')) {
        return "00:00";  // 12 AM = midnight = 00:00
    } else if (timeStr.includes('12 pm') || timeStr.includes('12pm')) {
        return "12:00";  // 12 PM = noon = 12:00
    }
    
    // Handle other AM/PM cases
    const timeMatch = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/);
    if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        const minute = parseInt(timeMatch[2]) || 0;
        const isPm = timeMatch[3] === 'pm';
        
        // Convert to 24-hour format
        if (isPm && hour !== 12) {
            hour += 12;
        } else if (!isPm && hour === 12) {
            hour = 0;
        }
        
        return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }
    
    // Handle 24-hour format or other formats
    if (timeStr.includes(':')) {
        const parts = timeStr.split(':');
        try {
            const hour = parseInt(parts[0]);
            const minute = parseInt(parts[1]) || 0;
            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
            }
        } catch (error) {
            // Continue to default cases
        }
    }
    
    // Default times for common words
    if (timeStr.includes('morning')) {
        return "09:00";
    } else if (timeStr.includes('afternoon')) {
        return "14:00";
    } else if (timeStr.includes('evening')) {
        return "18:00";
    } else if (timeStr.includes('night')) {
        return "20:00";
    }
    
    return null;
}

function createFallbackReminder(message) {
    let title = "Reminder";
    let date = "today";
    let time = null;
    
    // Simple patterns for fallback
    if (message.toLowerCase().includes("tomorrow")) {
        date = "tomorrow";
    } else {
        const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
        for (const day of days) {
            if (message.toLowerCase().includes(day)) {
                date = day;
                break;
            }
        }
    }
    
    // Try to extract time
    time = convertTimeTo24h(message);
    
    // Try to extract action
    const actionPatterns = [
        /remind me (?:tomorrow )?(?:i have to |to )?(.+?)(?:\s+by\s+\d|\s+at\s+\d|\s*$)/i,
        /(?:need to|have to|must) (.+?)(?:\s+by\s+\d|\s+at\s+\d|\s*$)/i,
        /(?:submit|send|call|meet|visit|buy|do|check) (.+?)(?:\s+by\s+\d|\s+at\s+\d|\s*$)/i,
        /(.+?) (?:by|at) \d/i
    ];
    
    for (const pattern of actionPatterns) {
        const match = message.match(pattern);
        if (match) {
            title = match[1].trim().replace(/\s+/g, ' ');
            break;
        }
    }
    
    // If still no good title, try to extract the main content
    if (title === "Reminder") {
        let cleaned = message.replace(/remind me (?:tomorrow )?(?:i have to |to )?/i, '');
        cleaned = cleaned.replace(/\s+by\s+\d.*/i, '');
        cleaned = cleaned.replace(/\s+at\s+\d.*/i, '');
        if (cleaned.trim().length > 0) {
            title = cleaned.trim();
        }
    }
    
    return {
        title: title,
        date: date,
        time: time,
        description: `Auto-extracted from: ${message.substring(0, 50)}...`
    };
}

function validateAndFixReminderData(reminderData, originalMessage) {
    if (!reminderData || typeof reminderData !== 'object') {
        console.log("Invalid reminder data, creating fallback");
        return createFallbackReminder(originalMessage);
    }
    
    // Ensure we have a title
    if (!reminderData.title) {
        const fallback = createFallbackReminder(originalMessage);
        reminderData.title = fallback.title;
    }
    
    // Ensure we have a date
    if (!reminderData.date) {
        reminderData.date = 'today';
    }
    
    // Clean up the title
    let title = reminderData.title.trim();
    if (title.length > 100) {
        title = title.substring(0, 100) + "...";
    }
    reminderData.title = title;
    
    return reminderData;
}

async function processReminderData(reminderData, userId) {
    if (!reminderData) {
        return null;
    }
    
    console.log(`Processing reminder data: ${JSON.stringify(reminderData)}`);
    
    // Convert date to ISO format
    const originalDate = reminderData.date || 'today';
    const isoDate = convertDateToIso(originalDate);
    console.log(`Date conversion: '${originalDate}' -> '${isoDate}'`);
    
    // Convert time to 24-hour format
    const originalTime = reminderData.time;
    const convertedTime = convertTimeTo24h(originalTime);
    console.log(`Time conversion: '${originalTime}' -> '${convertedTime}'`);
    
    const reminder = new Reminder({
        userId: userId,
        sessionId: `session-${userId}-${Date.now()}`,
        title: reminderData.title || 'Reminder',
        description: reminderData.description || '',
        reminderTime: new Date(`${isoDate}T${convertedTime || '09:00'}:00`),
        isRecurring: false,
        status: 'pending',
        priority: 'medium'
    });
    
    await reminder.save();
    console.log(`Reminder stored successfully: ${reminder.title}`);
    
    return {
        id: reminder._id,
        title: reminder.title,
        date: isoDate,
        time: convertedTime,
        description: reminder.description,
        completed: false,
        created_at: new Date().toISOString()
    };
}

// ============= MIDDLEWARE AND SETUP =============
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

// ============= DUAL API CHAT ENDPOINT (EXACTLY LIKE PYTHON) =============
app.post('/api/chat', authenticateToken, async (req, res) => {
    try {
        const { message } = req.body;
        const userId = req.user._id;
        const sessionId = req.sessionId;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        console.log(`Processing message: ${message}`);
        
        // Step 1: Get response from Chat API (exactly like Python)
        const chatPrompt = CHAT_ANALYSIS_PROMPT.replace('{message}', message);
        const chatResponse = await safeApiCall(chatModel, chatPrompt);
        const chatData = parseJsonResponse(chatResponse);
        
        if (!chatData) {
            // Fallback if JSON parsing fails
            return res.json({
                message: 'I understand your message.',
                trigger: false,
                session_id: sessionId
            });
        }
        
        const responseData = {
            message: chatData.message || 'I understand your message.',
            trigger: chatData.trigger || false,
            session_id: sessionId
        };
        
        // Step 2: If trigger is true, process with Data API (exactly like Python)
        if (chatData.trigger) {
            console.log("Trigger detected, processing with Data API...");
            
            try {
                // Extract reminder details using Data API
                const dataPrompt = DATA_EXTRACTION_PROMPT.replace('{message}', message);
                const dataResponse = await safeApiCall(dataModel, dataPrompt);
                let reminderData = parseJsonResponse(dataResponse);
                
                if (reminderData) {
                    // Validate and fix reminder data
                    reminderData = validateAndFixReminderData(reminderData, message);
                    
                    // Store the reminder
                    const storedReminder = await processReminderData(reminderData, userId);
                    if (storedReminder) {
                        responseData.reminder_created = storedReminder;
                        console.log(`Reminder created: ${storedReminder.title} on ${storedReminder.date}`);
                        
                        // Update user stats
                        await User.findByIdAndUpdate(userId, {
                            $inc: { 'stats.totalReminders': 1 },
                            $set: { 'stats.lastActiveAt': new Date() }
                        });
                    }
                }
                
            } catch (error) {
                console.error(`Data API error: ${error}`);
                // Continue without reminder creation
            }
        }
        
        // Save conversation to database
        try {
            let conversation = await Conversation.findOne({ 
                sessionId: sessionId,
                userId: userId 
            });
            
            if (!conversation) {
                conversation = new Conversation({ 
                    sessionId: sessionId, 
                    userId: userId,
                    messages: [] 
                });
            }
            
            conversation.messages.push(
                { role: 'user', content: message, timestamp: new Date() },
                { role: 'assistant', content: responseData.message, timestamp: new Date() }
            );
            
            await conversation.save();
        } catch (dbError) {
            console.log('Database save failed:', dbError.message);
        }
        
        return res.json(responseData);
        
    } catch (error) {
        console.error(`Chat error: ${error}`);
        return res.status(500).json({ error: error.message });
    }
});

// ============= EXACT SAME ENDPOINTS AS PYTHON =============

// Get reminders (exactly like Python)
app.get('/api/reminders', authenticateToken, async (req, res) => {
    try {
        const userId = req.user._id;
        const today = new Date();
        const nextWeek = new Date(today.getTime() + (7 * 24 * 60 * 60 * 1000));
        
        console.log(`Fetching reminders from ${today.toISOString().split('T')[0]} to ${nextWeek.toISOString().split('T')[0]}`);
        
        const allReminders = await Reminder.find({ 
            userId: userId,
            status: { $ne: 'completed' }
        }).sort({ reminderTime: 1 });
        
        const todayReminders = [];
        const upcomingReminders = [];
        
        console.log(`Total reminders in storage: ${allReminders.length}`);
        
        for (const reminder of allReminders) {
            try {
                const reminderDate = new Date(reminder.reminderTime);
                const reminderDateOnly = reminderDate.toISOString().split('T')[0];
                const todayOnly = today.toISOString().split('T')[0];
                
                console.log(`Checking reminder: ${reminder.title}, date: ${reminderDateOnly}`);
                
                const formattedReminder = {
                    id: reminder._id,
                    title: reminder.title,
                    description: reminder.description,
                    time: reminderDate.toTimeString().slice(0, 5),
                    date: reminderDateOnly,
                    completed: reminder.status === 'completed'
                };
                
                // Add to today's reminders
                if (reminderDateOnly === todayOnly) {
                    todayReminders.push(formattedReminder);
                    console.log(`Added to today's reminders: ${reminder.title}`);
                }
                
                // Add to upcoming reminders (today + next 7 days)
                if (reminderDate >= today && reminderDate <= nextWeek) {
                    upcomingReminders.push(formattedReminder);
                    console.log(`Added to upcoming reminders: ${reminder.title} on ${reminderDateOnly}`);
                }
                
            } catch (error) {
                console.error(`Error parsing reminder date: ${error}, reminder: ${reminder}`);
                continue;
            }
        }
        
        console.log(`Found ${todayReminders.length} reminders for today`);
        console.log(`Found ${upcomingReminders.length} upcoming reminders`);
        
        return res.json({
            today_reminders: todayReminders,
            upcoming_reminders: upcomingReminders,
            all_reminders: allReminders.map(r => ({
                id: r._id,
                title: r.title,
                description: r.description,
                time: new Date(r.reminderTime).toTimeString().slice(0, 5),
                date: new Date(r.reminderTime).toISOString().split('T')[0],
                completed: r.status === 'completed'
            }))
        });
        
    } catch (error) {
        console.error(`Error in get_reminders: ${error}`);
        return res.status(500).json({ error: error.message });
    }
});

// Create manual reminder (exactly like Python)
app.post('/api/reminders', authenticateToken, async (req, res) => {
    try {
        const { title, time, date, description } = req.body;
        const userId = req.user._id;
        
        const reminderData = {
            title: title || '',
            date: date || new Date().toISOString().split('T')[0],
            time: time,
            description: description || ''
        };
        
        const storedReminder = await processReminderData(reminderData, userId);
        
        return res.json({
            message: 'Reminder created successfully',
            reminder: storedReminder
        });
        
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// New chat endpoint (exactly like Python)
app.post('/api/new-chat', authenticateToken, async (req, res) => {
    try {
        const { session_id } = req.body;
        const sessionId = session_id || req.sessionId;
        
        return res.json({
            message: 'New chat session created',
            session_id: sessionId
        });
        
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// Health check (exactly like Python)
app.get('/api/health', async (req, res) => {
    try {
        const totalReminders = await Reminder.countDocuments();
        const sampleReminders = await Reminder.find().sort({ createdAt: -1 }).limit(3);
        
        res.json({
            status: 'healthy',
            chat_model: 'gemini-1.5-flash',
            data_model: 'gemini-1.5-flash',
            total_reminders: totalReminders,
            reminders_sample: sampleReminders.map(r => ({
                title: r.title,
                date: new Date(r.reminderTime).toISOString().split('T')[0],
                time: new Date(r.reminderTime).toTimeString().slice(0, 5)
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Debug reminders endpoint (exactly like Python)
app.get('/api/debug/reminders', async (req, res) => {
    try {
        const allReminders = await Reminder.find();
        return res.json({
            all_reminders: allReminders,
            total_count: allReminders.length,
            current_date: new Date().toISOString().split('T')[0]
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Starting remindME Server with Clean Dual API...`);
    console.log(`Chat API Key loaded: ${CHAT_API_KEY ? '✓' : '✗'}`);
    console.log(`Data API Key loaded: ${DATA_API_KEY ? '✓' : '✗'}`);
    console.log(`Architecture: Chat API → JSON → Data API (if triggered)`);
    console.log(`📱 Auth Page: http://localhost:${PORT}/auth`);
    console.log(`📱 Main App: http://localhost:${PORT}/app`);
    console.log(`🔌 API Health: http://localhost:${PORT}/api/health`);
});

module.exports = app;