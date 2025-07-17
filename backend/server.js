// ============= UPDATED SERVER.JS - CALLS PYTHON SERVICE, KEEPS ALL EXISTING FUNCTIONALITY =============
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
const axios = require('axios'); // For calling Python service

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

// Python AI service URL (your working app.py)
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:4000';

console.log('🔗 Python AI Service URL:', AI_SERVICE_URL);
console.log('🐍 Will call your working Python app.py for AI processing');

// ============= UTILITY FUNCTIONS (PRESERVED FROM ORIGINAL) =============

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

// Call your working Python AI Service
async function callWorkingPythonService(message, sessionId, userId, conversationHistory, isNewConversation) {
    try {
        console.log(`🐍 Calling your working Python service at ${AI_SERVICE_URL}/api/chat`);
        
        const response = await axios.post(`${AI_SERVICE_URL}/api/chat`, {
            message: message,
            session_id: sessionId,
            user_id: userId,
            conversation_history: conversationHistory || [],
            current_datetime: getCurrentDateTimeContext(),
            is_new_conversation: isNewConversation
        }, {
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ Python service response received');
        return response.data;
        
    } catch (error) {
        console.error(`❌ Python service error:`, error.message);
        
        if (error.code === 'ECONNREFUSED') {
            throw new Error('Python AI service is not running! Please start: python app.py');
        }
        
        throw new Error(`Python service failed: ${error.message}`);
    }
}

// Enhanced reminder processing (PRESERVED FROM ORIGINAL)
async function processReminderData(reminderData, userId, sessionId, originalMessage) {
    console.log('🔍 Processing reminder data from Python service:', { reminderData, userId, sessionId });
    
    if (!reminderData || !reminderData.title) {
        console.log('⚠️ Invalid reminder data from Python service');
        throw new Error('Invalid reminder data received from AI service');
    }
    
    // The Python service already processed the date/time, just use it
    let reminderTime;
    try {
        if (reminderData.time && reminderData.date) {
            reminderTime = new Date(`${reminderData.date}T${reminderData.time}:00`);
        } else if (reminderData.date) {
            reminderTime = new Date(`${reminderData.date}T09:00:00`);
        } else {
            reminderTime = new Date();
            reminderTime.setHours(9, 0, 0, 0);
        }
    } catch (dateError) {
        console.error('❌ Error creating reminder date:', dateError);
        reminderTime = new Date();
        reminderTime.setDate(reminderTime.getDate() + 1);
        reminderTime.setHours(9, 0, 0, 0);
    }
    
    // Validate userId
    if (!userId) {
        throw new Error('UserId is required for reminder creation');
    }
    
    console.log('👤 Creating reminder for userId:', userId);
    
    // Create reminder document
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
    
    console.log('💾 Saving reminder document:', {
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
            await new Promise(resolve => setTimeout(resolve, 100 * attempt));
        }
    }
    
    // Verification
    const verifyReminder = await Reminder.findById(savedReminder._id);
    if (!verifyReminder || !verifyReminder.userId) {
        throw new Error('Reminder was not saved properly with userId');
    }
    
    console.log('✅ Reminder saved and verified with ID:', savedReminder._id);
    
    // Update user stats
    try {
        await User.findByIdAndUpdate(userId, {
            $inc: { 'stats.totalReminders': 1 },
            $set: { 'stats.lastActiveAt': new Date() }
        });
    } catch (statsError) {
        console.error('⚠️ Failed to update user stats:', statsError.message);
    }
    
    return {
        id: savedReminder._id,
        title: savedReminder.title,
        date: reminderData.date,
        time: reminderData.time,
        description: savedReminder.description,
        reminderTime: savedReminder.reminderTime,
        status: savedReminder.status,
        verified: true,
        originalMessage: originalMessage,
        currentDateTime: getCurrentDateTimeContext().readable
    };
}

// ============= MIDDLEWARE SETUP (PRESERVED FROM ORIGINAL) =============
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

// ============= AUTHENTICATION ROUTES (PRESERVED FROM ORIGINAL) =============
app.use('/auth', authRouter);

// Serve auth page
app.get('/auth', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/auth.html'));
});

// Serve forgot password page (PRESERVED FROM ORIGINAL)
app.get('/forgot-password', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/forgot-password.html'));
});

// Serve reset password page (PRESERVED FROM ORIGINAL) 
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

// ============= CHAT ENDPOINT - NOW CALLS PYTHON SERVICE =============
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

        // Get current date/time context
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
            userSessionId = `session-${userId}-${Date.now()}`;
            conversation = new Conversation({
                userId: userId,
                sessionId: userSessionId,
                title: 'New Conversation',
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

        // Build conversation context
        const recentMessages = conversation.messages.slice(-20);
        
        console.log('🤖 Calling your working Python AI service...');

        // Call your working Python AI service
        const pythonResponse = await callWorkingPythonService(
            message,
            userSessionId,
            userId,
            recentMessages.map(msg => ({
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp
            })),
            isNewConversation
        );

        console.log('🎯 Python AI Response received:', {
            trigger: pythonResponse.trigger,
            hasReminder: !!pythonResponse.reminder_created,
            hasTitle: !!pythonResponse.title
        });

        // Prepare response data
        const responseData = {
            response: pythonResponse.message || 'I understand your message.',
            trigger: pythonResponse.trigger || false,
            conversationId: conversation._id,
            sessionId: userSessionId,
            success: true,
            reminder_created: null,
            processing_status: 'completed',
            isNewConversation: isNewConversation,
            conversationTitle: conversation.title,
            currentDateTime: currentDateTime.readable
        };

        // Add title to response for new conversations
        if (isNewConversation && pythonResponse.title) {
            responseData.title = pythonResponse.title;
        }

        // Update conversation title if new and AI generated one
        if (isNewConversation && pythonResponse.title) {
            conversation.title = pythonResponse.title;
            responseData.conversationTitle = pythonResponse.title;
            console.log('📝 Set AI-generated conversation title:', pythonResponse.title);
        } else if (isNewConversation) {
            // Fallback title if Python didn't generate one
            const fallbackTitle = message.substring(0, 30).trim() || 'New Conversation';
            conversation.title = fallbackTitle;
            responseData.conversationTitle = fallbackTitle;
            console.log('📝 Set fallback conversation title:', fallbackTitle);
        }

        // Process reminder if created by Python service
        if (pythonResponse.reminder_created) {
            console.log('📋 Processing reminder from Python service...');
            try {
                const storedReminder = await processReminderData(
                    pythonResponse.reminder_created, 
                    userId, 
                    userSessionId, 
                    message
                );
                
                if (storedReminder && storedReminder.verified) {
                    responseData.reminder_created = storedReminder;
                    responseData.processing_status = 'reminder_created';
                    console.log('✅ Reminder stored in database:', storedReminder.title);
                }
            } catch (reminderError) {
                console.error('❌ Reminder storage failed:', reminderError.message);
                responseData.processing_status = 'reminder_failed';
                responseData.error = `Failed to store reminder: ${reminderError.message}`;
            }
        }

        // Save conversation
        conversation.messages.push(
            { role: 'user', content: message, timestamp: new Date() },
            { 
                role: 'assistant', 
                content: responseData.response, 
                timestamp: new Date(),
                metadata: {
                    intentClassification: pythonResponse.trigger ? 'set_reminder' : 'general',
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
        console.error('❌ Chat error:', error.message);
        
        if (error.message.includes('Python AI service is not running')) {
            res.status(503).json({ 
                error: 'AI service is currently unavailable. Please ensure the Python AI service is running.',
                success: false,
                suggestion: 'Run: python app.py in a separate terminal'
            });
        } else if (error.message.includes('429') || error.message.includes('quota')) {
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

// ============= ALL OTHER EXISTING ENDPOINTS (PRESERVED EXACTLY) =============

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

// Get reminders (PRESERVED FROM ORIGINAL)
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

// Health check (updated to show Python service status)
app.get('/api/health', async (req, res) => {
    try {
        const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        
        // Check Python AI service health
        let pythonServiceStatus = 'unknown';
        try {
            const pythonHealth = await axios.get(`${AI_SERVICE_URL}/api/health`, { timeout: 5000 });
            pythonServiceStatus = pythonHealth.data.status === 'healthy' ? 'connected' : 'error';
        } catch (pythonError) {
            pythonServiceStatus = 'disconnected';
        }
        
        const totalUsers = await User.countDocuments();
        const totalConversations = await Conversation.countDocuments();
        const totalReminders = await Reminder.countDocuments();
        
        res.json({ 
            status: 'OK',
            timestamp: new Date().toISOString(),
            services: {
                database: mongoStatus,
                python_ai_service: pythonServiceStatus,
                authentication: 'active'
            },
            stats: {
                totalUsers,
                totalConversations,
                totalReminders,
                uptime: process.uptime()
            },
            version: '4.0.0 - Calls Working Python Service',
            environment: process.env.NODE_ENV || 'development',
            python_service_url: AI_SERVICE_URL
        });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({ status: 'ERROR', timestamp: new Date().toISOString(), error: 'Health check failed' });
    }
});

// ============= UTILITY FUNCTIONS (PRESERVED FROM ORIGINAL) =============
function extractTopics(message) {
    const words = message.toLowerCase().split(/\s+/);
    const topics = words.filter(word => 
        word.length > 4 && 
        !['remind', 'please', 'could', 'would', 'should', 'tomorrow', 'today', 'hello', 'thanks'].includes(word)
    );
    return topics.slice(0, 3);
}

// Error handling middleware (PRESERVED FROM ORIGINAL)
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
    console.log(`📱 Forgot Password: http://localhost:${PORT}/forgot-password`);
    console.log(`📱 Reset Password: http://localhost:${PORT}/reset-password`);
    console.log(`📱 Main App: http://localhost:${PORT}/app`);
    console.log(`🔌 API Health: http://localhost:${PORT}/api/health`);
    console.log(`🆔 Current Chat: http://localhost:${PORT}/api/current-chat`);
    console.log('🤖 Using Your Working Python AI Service');
    console.log('🐍 IMPORTANT: Make sure to start your Python service: python app.py');
});

module.exports = app;