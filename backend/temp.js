// ============= OPTIMIZED SERVER.JS - RELIABLE REMINDER CREATION =============

// Updated processReminderData function with better error handling and confirmation
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

// Enhanced chat endpoint with better reminder creation flow
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

// Enhanced reminders endpoint with better caching and debugging
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

// ============= OPTIMIZED FRONTEND JAVASCRIPT FOR INDEX.HTML =============

// Enhanced reminder management with better state tracking
class ReminderManager {
    constructor() {
        this.isLoading = false;
        this.lastLoadTime = 0;
        this.loadingTimeout = null;
        this.reminderCount = 0;
    }

    // Debounced load function to prevent multiple rapid calls
    async loadReminders(force = false) {
        const now = Date.now();
        
        // Prevent multiple rapid calls unless forced
        if (!force && this.isLoading) {
            console.log('⏳ Reminder loading already in progress, skipping...');
            return;
        }
        
        // Debounce: Don't reload if we just loaded recently (unless forced)
        if (!force && (now - this.lastLoadTime) < 1000) {
            console.log('⏳ Recent load detected, debouncing...');
            return;
        }

        this.isLoading = true;
        this.lastLoadTime = now;
        
        try {
            console.log('🔄 Loading reminders from API...');
            
            // Add cache-busting timestamp
            const response = await fetch(`/api/reminders?t=${now}`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('📥 Received reminders:', data);
            
            // Update reminder count
            this.reminderCount = data.total_count || 0;
            
            // Use upcoming_reminders for sidebar (includes today + next 7 days)
            if (data.upcoming_reminders && data.upcoming_reminders.length > 0) {
                console.log(`✅ Found ${data.upcoming_reminders.length} upcoming reminders`);
                this.displayReminders(data.upcoming_reminders);
            } else if (data.today_reminders && data.today_reminders.length > 0) {
                console.log(`✅ Found ${data.today_reminders.length} today's reminders`);
                this.displayReminders(data.today_reminders);
            } else {
                console.log('ℹ️  No reminders found');
                this.displayReminders([]);
            }
            
            // Show success feedback
            this.showLoadingFeedback('✅ Reminders updated', 'success');
            
        } catch (error) {
            console.error('❌ Error loading reminders:', error);
            this.showLoadingFeedback('❌ Failed to load reminders', 'error');
            this.displayReminders([]); // Show empty state
        } finally {
            this.isLoading = false;
        }
    }

    // Enhanced display function with better error handling
    displayReminders(reminders) {
        console.log('🎨 Displaying reminders:', reminders);
        
        const reminderList = document.getElementById('reminderList');
        const noReminders = reminderList?.querySelector('.no-reminders');
        
        if (!reminderList) {
            console.error('❌ reminderList element not found!');
            return;
        }
        
        // Clear existing reminders
        const existingReminders = reminderList.querySelectorAll('.reminder-item');
        existingReminders.forEach(item => item.remove());
        
        if (!reminders || reminders.length === 0) {
            console.log('📝 No reminders to display, showing no-reminders message');
            if (noReminders) {
                noReminders.style.display = 'block';
            }
            return;
        }
        
        // Hide no-reminders message
        if (noReminders) {
            noReminders.style.display = 'none';
        }
        
        // Add reminders with enhanced error handling
        console.log(`📋 Adding ${reminders.length} reminders to sidebar`);
        reminders.forEach((reminder, index) => {
            try {
                this.createReminderElement(reminder, index, reminderList, noReminders);
            } catch (error) {
                console.error(`❌ Error creating reminder element ${index}:`, error, reminder);
            }
        });
        
        console.log('✅ All reminders displayed successfully');
    }

    createReminderElement(reminder, index, reminderList, noReminders) {
        console.log(`📝 Adding reminder ${index + 1}: ${reminder.title} at ${reminder.time} on ${reminder.date}`);
        
        const timeFormatted = this.formatTime12Hour(reminder.time);
        const dateFormatted = this.formatDateForReminder(reminder.date);
        
        const reminderItem = document.createElement('div');
        reminderItem.className = 'reminder-item';
        reminderItem.dataset.reminderId = reminder.id;
        reminderItem.style.cssText = `
            background-color: #222121;
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 8px;
            transition: all 0.2s ease;
            display: flex;
            flex-direction: column;
            opacity: 0;
            transform: translateY(10px);
        `;
        
        // Create header with time on left and date on right
        const headerDiv = document.createElement('div');
        headerDiv.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        `;
        
        const timeSpan = document.createElement('span');
        timeSpan.className = 'reminder-time';
        timeSpan.style.cssText = `
            font-size: 12px;
            color: #4accd1;
            font-weight: 500;
            font-family: 'Inter', sans-serif;
        `;
        timeSpan.textContent = timeFormatted;
        
        const dateSpan = document.createElement('span');
        dateSpan.className = 'reminder-date';
        dateSpan.style.cssText = `
            font-size: 11px;
            color: #8a8a88;
            font-weight: 400;
            font-family: 'Inter', sans-serif;
        `;
        dateSpan.textContent = dateFormatted !== 'Today' ? dateFormatted : '';
        
        headerDiv.appendChild(timeSpan);
        headerDiv.appendChild(dateSpan);
        
        // Create title
        const titleDiv = document.createElement('div');
        titleDiv.className = 'reminder-text';
        titleDiv.style.cssText = `
            font-size: 13px;
            color: #e8e8e3;
            line-height: 1.4;
            font-family: 'Inter', sans-serif;
            margin-top: 2px;
        `;
        titleDiv.textContent = reminder.title;
        
        // Add description if exists
        if (reminder.description) {
            const descriptionDiv = document.createElement('div');
            descriptionDiv.className = 'reminder-description';
            descriptionDiv.style.cssText = `
                font-size: 12px;
                color: #8a8a88;
                margin-top: 4px;
                font-family: 'Inter', sans-serif;
            `;
            descriptionDiv.textContent = reminder.description;
            reminderItem.appendChild(descriptionDiv);
        }
        
        // Assemble the reminder item
        reminderItem.appendChild(headerDiv);
        reminderItem.appendChild(titleDiv);
        
        // Add hover effects
        reminderItem.addEventListener('mouseenter', function() {
            this.style.backgroundColor = '#213031';
        });
        reminderItem.addEventListener('mouseleave', function() {
            this.style.backgroundColor = '#222121';
        });
        
        // Add to DOM
        if (noReminders) {
            reminderList.insertBefore(reminderItem, noReminders);
        } else {
            reminderList.appendChild(reminderItem);
        }
        
        // Animate in
        requestAnimationFrame(() => {
            reminderItem.style.opacity = '1';
            reminderItem.style.transform = 'translateY(0)';
        });
    }

    // Reliable refresh after chat with multiple strategies
    async refreshAfterChat(data) {
        console.log('🔄 Refreshing reminders after chat response...', data);
        
        if (data.reminder_created || data.trigger || data.processing_status === 'reminder_created') {
            // Show immediate feedback
            this.showLoadingFeedback('🔄 Updating reminders...', 'info');
            
            // Strategy 1: Immediate refresh
            setTimeout(() => this.loadReminders(true), 500);
            
            // Strategy 2: Delayed refresh (in case of database delays)
            setTimeout(() => this.loadReminders(true), 1500);
            
            // Strategy 3: Final confirmation refresh
            setTimeout(() => this.loadReminders(true), 3000);
        }
    }

    // Visual feedback for loading states
    showLoadingFeedback(message, type = 'info') {
        const reminderList = document.getElementById('reminderList');
        if (!reminderList) return;
        
        // Remove existing feedback
        const existingFeedback = reminderList.querySelector('.loading-feedback');
        if (existingFeedback) {
            existingFeedback.remove();
        }
        
        // Create feedback element
        const feedback = document.createElement('div');
        feedback.className = 'loading-feedback';
        feedback.style.cssText = `
            background-color: ${type === 'success' ? '#1dd1a1' : type === 'error' ? '#ff6b6b' : '#4accd1'};
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            text-align: center;
            margin-bottom: 8px;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        feedback.textContent = message;
        
        reminderList.insertBefore(feedback, reminderList.firstChild);
        
        // Animate in
        requestAnimationFrame(() => {
            feedback.style.opacity = '1';
        });
        
        // Auto remove after delay
        setTimeout(() => {
            if (feedback.parentNode) {
                feedback.style.opacity = '0';
                setTimeout(() => {
                    if (feedback.parentNode) {
                        feedback.parentNode.removeChild(feedback);
                    }
                }, 300);
            }
        }, 2000);
    }

    // Helper functions
    formatTime12Hour(time24) {
        if (!time24) return 'All day';
        
        const [hours, minutes] = time24.split(':');
        const hour = parseInt(hours);
        const minute = minutes;
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        
        return `${hour12}:${minute} ${ampm}`;
    }

    formatDateForReminder(dateStr) {
        if (!dateStr) return '';
        
        const reminderDate = new Date(dateStr);
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        
        const reminderDateOnly = new Date(reminderDate.getFullYear(), reminderDate.getMonth(), reminderDate.getDate());
        const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const tomorrowOnly = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
        
        if (reminderDateOnly.getTime() === todayOnly.getTime()) {
            return 'Today';
        } else if (reminderDateOnly.getTime() === tomorrowOnly.getTime()) {
            return 'Tomorrow';
        } else {
            const options = reminderDate.getFullYear() !== today.getFullYear() 
                ? { month: 'short', day: 'numeric', year: 'numeric' }
                : { month: 'short', day: 'numeric' };
            return reminderDate.toLocaleDateString('en-US', options);
        }
    }
}

// Initialize the reminder manager
const reminderManager = new ReminderManager();

// Enhanced sendMessage function with reliable reminder refresh
async function sendMessage() {
    // ... your existing sendMessage code until the fetch part ...
    
    fetch('/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: messageText,
            session_id: sessionId
        })
    })
    .then(response => response.json())
    .then(data => {
        // Remove loading indicator
        loadingDiv.remove();
        
        if (data.error) {
            throw new Error(data.error);
        }

        console.log('API Response:', data);

        // Create bot response with formatting
        var formattedResponse = formatBotResponse(data.message || data.response);
        var botMessage = `<strong>remindME:</strong><br>${formattedResponse}`;
        
        // Check if trigger was activated
        if (data.trigger) {
            console.log('Trigger activated - processing reminder...');
            
            // Show trigger indicator in chat
            botMessage += '<br><div class="status-indicator trigger" style="background-color: #c96342; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin: 8px 0; display: inline-block;"><i class="fas fa-cogs fa-spin"></i> Processing reminder...</div>';
        }
        
        // Create bot message container and display
        var botMessageContainer = document.createElement('div');
        botMessageContainer.classList.add('message-container');
        // ... rest of your bot message creation code ...

        // ENHANCED: Handle reminder creation with better feedback
        if (data.reminder_created) {
            console.log('✅ Reminder successfully created:', data.reminder_created);
            
            // Update status indicator
            setTimeout(() => {
                const statusIndicator = botMessageDiv.querySelector('.status-indicator.trigger');
                if (statusIndicator) {
                    statusIndicator.innerHTML = '<i class="fas fa-check"></i> Reminder created successfully!';
                    statusIndicator.style.backgroundColor = '#4accd1';
                }
                
                // Refresh reminders with visual feedback
                reminderManager.refreshAfterChat(data);
                
            }, 500);
            
        } else if (data.trigger && !data.reminder_created) {
            console.log('❌ Trigger detected but reminder creation failed');
            setTimeout(() => {
                const statusIndicator = botMessageDiv.querySelector('.status-indicator.trigger');
                if (statusIndicator) {
                    statusIndicator.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Could not create reminder';
                    statusIndicator.style.backgroundColor = '#ff6b6b';
                }
            }, 1000);
        }

        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
    })
    .catch(error => {
        // ... your existing error handling ...
    })
    .finally(() => {
        isLoading = false;
    });
}

// Auto-load reminders when page loads and set up intervals
document.addEventListener('DOMContentLoaded', function() {
    // Initial load
    reminderManager.loadReminders(true);
    
    // Set up periodic refresh (every 2 minutes)
    setInterval(() => {
        reminderManager.loadReminders();
    }, 2 * 60 * 1000);
    
    // Refresh on window focus
    window.addEventListener('focus', () => {
        reminderManager.loadReminders();
    });
});

// Global functions for backward compatibility
window.loadReminders = () => reminderManager.loadReminders(true);
window.displayReminders = (reminders) => reminderManager.displayReminders(reminders);