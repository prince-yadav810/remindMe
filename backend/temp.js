// ============= ENHANCED TIME UTILITIES FOR server.js =============
// ADD these functions to your server.js file

// Enhanced date conversion with relative time support
function convertDateToISO(dateStr, currentDateTime = new Date()) {
    console.log('🕒 Converting date:', dateStr, 'with current time:', currentDateTime);
    
    if (!dateStr || dateStr === '' || dateStr === 'null' || dateStr === 'undefined') {
        console.log('🗓️ No date provided, defaulting to today');
        return currentDateTime.toISOString().split('T')[0];
    }
    
    dateStr = dateStr.toLowerCase().trim();
    
    // Handle relative dates
    if (dateStr === 'today') {
        return currentDateTime.toISOString().split('T')[0];
    } else if (dateStr === 'tomorrow') {
        const tomorrow = new Date(currentDateTime);
        tomorrow.setDate(currentDateTime.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
    } else if (dateStr === 'yesterday') {
        const yesterday = new Date(currentDateTime);
        yesterday.setDate(currentDateTime.getDate() - 1);
        return yesterday.toISOString().split('T')[0];
    }
    
    // Handle "in X hours/minutes/days" calculations
    if (dateStr.includes('in ') && (dateStr.includes('hour') || dateStr.includes('minute') || dateStr.includes('day'))) {
        const now = new Date(currentDateTime);
        
        if (dateStr.includes('hour')) {
            const hours = parseInt(dateStr.match(/\d+/)?.[0] || '1');
            now.setHours(now.getHours() + hours);
            console.log(`⏰ Added ${hours} hours: ${now.toISOString()}`);
            return now.toISOString().split('T')[0];
        } else if (dateStr.includes('minute')) {
            const minutes = parseInt(dateStr.match(/\d+/)?.[0] || '30');
            now.setMinutes(now.getMinutes() + minutes);
            console.log(`⏰ Added ${minutes} minutes: ${now.toISOString()}`);
            return now.toISOString().split('T')[0];
        } else if (dateStr.includes('day')) {
            const days = parseInt(dateStr.match(/\d+/)?.[0] || '1');
            now.setDate(now.getDate() + days);
            console.log(`📅 Added ${days} days: ${now.toISOString()}`);
            return now.toISOString().split('T')[0];
        }
    }
    
    // Handle day names
    if (['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(dateStr)) {
        const days = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
        const targetDay = days[dateStr];
        const currentDay = currentDateTime.getDay();
        let daysAhead = targetDay - currentDay;
        if (daysAhead <= 0) daysAhead += 7;
        
        const targetDate = new Date(currentDateTime);
        targetDate.setDate(currentDateTime.getDate() + daysAhead);
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
            const targetDate = new Date(currentDateTime.getFullYear(), month, day);
            if (targetDate < currentDateTime) {
                targetDate.setFullYear(currentDateTime.getFullYear() + 1);
            }
            console.log(`📅 Parsed ${dateStr}: ${targetDate.toISOString().split('T')[0]}`);
            return targetDate.toISOString().split('T')[0];
        } catch (error) {
            console.error('Invalid date:', month, day);
            return currentDateTime.toISOString().split('T')[0];
        }
    }
    
    // Handle ISO date format (YYYY-MM-DD)
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return dateStr;
    }
    
    // Default to today if nothing matches
    console.log('📅 Defaulting to today for unrecognized format:', dateStr);
    return currentDateTime.toISOString().split('T')[0];
}

// Enhanced time conversion with relative time support
function convertTimeTo24h(timeStr, currentDateTime = new Date()) {
    if (!timeStr) return null;
    
    timeStr = timeStr.toLowerCase().trim();
    console.log('🕐 Converting time:', timeStr);
    
    // Handle "in X hours/minutes" format
    if (timeStr.includes('in ') && (timeStr.includes('hour') || timeStr.includes('minute'))) {
        const now = new Date(currentDateTime);
        
        if (timeStr.includes('hour')) {
            const hours = parseInt(timeStr.match(/\d+/)?.[0] || '1');
            now.setHours(now.getHours() + hours);
            const result = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            console.log(`⏰ Calculated time for "${timeStr}": ${result}`);
            return result;
        } else if (timeStr.includes('minute')) {
            const minutes = parseInt(timeStr.match(/\d+/)?.[0] || '30');
            now.setMinutes(now.getMinutes() + minutes);
            const result = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
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

// Enhanced reminder data processing
async function processReminderData(reminderData, userId, sessionId, originalMessage) {
    console.log('🔍 Processing enhanced reminder data:', { reminderData, userId, sessionId });
    
    const currentDateTime = new Date();
    
    if (!reminderData || !reminderData.title) {
        console.log('Invalid reminder data, creating fallback');
        reminderData = {
            title: originalMessage.substring(0, 50) + '...',
            date: 'today',
            time: null,
            description: `Auto-extracted from: ${originalMessage}`
        };
    }
    
    // Enhanced date/time processing
    let isoDate, convertedTime;
    
    // Check if we have a calculated datetime from the AI
    if (reminderData.calculatedDateTime) {
        const calcDate = new Date(reminderData.calculatedDateTime);
        isoDate = calcDate.toISOString().split('T')[0];
        convertedTime = `${calcDate.getHours().toString().padStart(2, '0')}:${calcDate.getMinutes().toString().padStart(2, '0')}`;
        console.log('📅 Using AI calculated datetime:', isoDate, convertedTime);
    } else {
        // Use enhanced conversion functions
        isoDate = convertDateToISO(reminderData.date, currentDateTime);
        convertedTime = convertTimeTo24h(reminderData.time, currentDateTime);
        console.log('📅 Using enhanced conversion:', isoDate, convertedTime);
    }
    
    console.log(`📅 Creating reminder: "${reminderData.title}" on ${isoDate} at ${convertedTime || 'no time'}`);
    
    // Create reminder time
    let reminderTime;
    if (convertedTime) {
        reminderTime = new Date(`${isoDate}T${convertedTime}:00`);
    } else {
        reminderTime = new Date(`${isoDate}T09:00:00`);
    }
    
    // Ensure userId is valid
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
    
    console.log('💾 Saving enhanced reminder document:', reminderDoc);
    
    const reminder = new Reminder(reminderDoc);
    const savedReminder = await reminder.save();
    
    // Verification
    const verifyReminder = await Reminder.findById(savedReminder._id);
    if (!verifyReminder || !verifyReminder.userId) {
        throw new Error('Reminder was not saved properly with userId');
    }
    
    console.log('✅ Enhanced reminder saved and verified with ID:', savedReminder._id);
    
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
        verified: true,
        originalMessage: originalMessage,
        calculationMethod: reminderData.calculatedDateTime ? 'AI_calculated' : 'enhanced_parsing'
    };
}

// ============= ENHANCED FRONTEND ERROR HANDLING =============
// ADD this to your index.html JavaScript section

// Enhanced error handling for the frontend
function handleApiError(error, data) {
    console.error('❌ API Error:', error, data);
    
    if (data?.error) {
        if (data.error.includes('rate limit') || data.error.includes('quota')) {
            showNotification('⏳ API rate limit reached. Please wait a minute and try again.', 'error');
            return 'rate_limit';
        } else if (data.error.includes('reminder')) {
            showNotification('⚠️ Could not create reminder. Please try with more specific time details like "remind me in 2 hours" or "tomorrow at 3pm".', 'error');
            return 'reminder_error';
        } else {
            showNotification(`❌ ${data.error}`, 'error');
            return 'general_error';
        }
    }
    
    showNotification('❌ Something went wrong. Please try again.', 'error');
    return 'unknown_error';
}

// Enhanced sendMessage function with better error handling
// REPLACE your sendMessage function in index.html with this:
async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const messageText = messageInput.textContent.trim();
    
    if (messageText !== '' && !isLoading) {
        isLoading = true;
        
        console.log('📤 Sending message:', messageText);
        console.log('🔗 Current conversation ID:', currentConversationId);

        // Display user message immediately
        displayMessage(messageText, 'user', true);

        // Clear input
        messageInput.textContent = '';

        // Show enhanced loading indicator
        const chatContainer = document.querySelector('.chat-container');
        const loadingDiv = document.createElement('div');
        loadingDiv.classList.add('loading');
        loadingDiv.innerHTML = '<i class="fas fa-brain fa-pulse" style="margin-right: 8px; color: #4accd1;"></i>Processing with context...';
        chatContainer.appendChild(loadingDiv);
        loadingDiv.style.display = 'block';

        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;

        // Prepare request with enhanced context
        const requestBody = {
            message: messageText,
            timestamp: new Date().toISOString(),
            clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
        
        // Include conversation ID for context
        if (currentConversationId && !isNewConversation) {
            requestBody.conversationId = currentConversationId;
            console.log('📎 Adding conversation context for:', currentConversationId);
        }

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });
            
            const data = await response.json();
            
            // Remove loading indicator
            loadingDiv.remove();
            
            // Enhanced error handling
            if (!response.ok || data.error) {
                const errorType = handleApiError(response, data);
                
                if (errorType === 'rate_limit') {
                    // Show helpful message for rate limits
                    const helpDiv = document.createElement('div');
                    helpDiv.classList.add('error-message');
                    helpDiv.innerHTML = `
                        <i class="fas fa-clock"></i> 
                        <strong>Rate limit reached</strong><br>
                        The AI service has reached its daily limit. Please try again in a few minutes, or try:
                        <ul style="margin: 8px 0; padding-left: 20px;">
                            <li>Use more specific times: "remind me at 3pm tomorrow"</li>
                            <li>Create reminders manually using the + button</li>
                        </ul>
                    `;
                    chatContainer.appendChild(helpDiv);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                    return;
                }
                
                throw new Error(data.error || 'Request failed');
            }

            console.log('✅ API Response:', data);

            // Update conversation tracking
            if (data.conversationId) {
                if (!currentConversationId || isNewConversation) {
                    currentConversationId = data.conversationId;
                    sessionId = data.sessionId;
                    isNewConversation = false;
                    console.log('🆕 New conversation created:', currentConversationId);
                    
                    if (data.conversationTitle) {
                        console.log('📝 Conversation titled:', data.conversationTitle);
                    }
                } else {
                    console.log('📝 Continuing conversation:', currentConversationId);
                }
            }

            // Display bot response
            let botResponse = data.message || data.response;
            
            // Enhanced reminder processing feedback
            if (data.trigger) {
                console.log('🎯 Trigger activated - processing reminder...');
                showReminderProcessingAnimation();
                botResponse += '<br><div class="status-indicator trigger" style="background-color: #c96342; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin: 8px 0; display: inline-block;"><i class="fas fa-cogs fa-spin"></i> Processing reminder with enhanced time parsing...</div>';
            }
            
            displayMessage(botResponse, 'assistant', true);

            // Enhanced reminder creation feedback
            if (data.trigger) {
                if (data.reminder_created) {
                    console.log('✅ Reminder successfully created:', data.reminder_created);
                    
                    setTimeout(() => {
                        removeReminderProcessingAnimation();
                        loadReminders();
                        
                        // Enhanced success message
                        const method = data.reminder_created.calculationMethod === 'AI_calculated' ? 'AI-calculated' : 'parsed';
                        showNotification(`✅ Reminder created (${method}): ${data.reminder_created.title}`, 'success');
                        
                        const statusIndicator = document.querySelector('.status-indicator.trigger');
                        if (statusIndicator) {
                            statusIndicator.innerHTML = '<i class="fas fa-check"></i> Reminder created with enhanced time parsing!';
                            statusIndicator.style.backgroundColor = '#4accd1';
                        }
                    }, 800);
                    
                } else {
                    setTimeout(() => {
                        removeReminderProcessingAnimation();
                        
                        // More helpful error message
                        const helpText = 'Try more specific formats like: "remind me in 2 hours", "tomorrow at 3pm", or "next Monday at 10am"';
                        showNotification('⚠️ Could not create reminder. ' + helpText, 'error');
                        
                        const statusIndicator = document.querySelector('.status-indicator.trigger');
                        if (statusIndicator) {
                            statusIndicator.innerHTML = '<i class="fas fa-info-circle"></i> Try more specific time format';
                            statusIndicator.style.backgroundColor = '#ff9800';
                        }
                    }, 1500);
                }
            }

            // Scroll to bottom
            chatContainer.scrollTop = chatContainer.scrollHeight;
            
        } catch (error) {
            loadingDiv.remove();
            removeReminderProcessingAnimation();
            
            const errorDiv = document.createElement('div');
            errorDiv.classList.add('error-message');
            errorDiv.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Error: ${error.message}`;
            chatContainer.appendChild(errorDiv);
            
            console.error('❌ Error:', error);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        } finally {
            isLoading = false;
        }
    }
}