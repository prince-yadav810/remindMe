class RemindMeApp {
    constructor() {
        this.sessionId = this.generateSessionId();
        this.messageCount = 0;
        this.sessionStartTime = Date.now();
        this.isTyping = false;
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.setupTheme();
        this.updateDateTime();
        this.setupAutoResize();
        this.loadConversationHistory();
        
        // Update session time every minute
        setInterval(() => this.updateSessionTime(), 60000);
    }
    
    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    setupEventListeners() {
        const messageInput = document.getElementById('message-input');
        const sendButton = document.getElementById('send-button');
        const sidebarToggle = document.getElementById('sidebar-toggle');
        const sidebarClose = document.getElementById('sidebar-close');
        const themeToggle = document.getElementById('theme-toggle');
        const newChatButton = document.getElementById('new-chat');
        const attachFileButton = document.getElementById('attach-file');
        const fileInput = document.getElementById('file-input');
        
        // Send message on button click
        sendButton.addEventListener('click', () => this.sendMessage());
        
        // Send message on Enter key (but not Shift+Enter)
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Enable/disable send button and update character count
        messageInput.addEventListener('input', () => {
            const text = messageInput.value.trim();
            const hasText = text.length > 0;
            sendButton.disabled = !hasText || this.isTyping;
            
            // Update character count
            this.updateCharacterCount(messageInput.value.length);
            
            // Update send button styling
            this.updateSendButton();
        });
        
        // Sidebar toggle
        sidebarToggle.addEventListener('click', () => this.toggleSidebar());
        sidebarClose.addEventListener('click', () => this.closeSidebar());
        
        // Theme toggle
        themeToggle.addEventListener('click', () => this.toggleTheme());
        
        // New chat button
        newChatButton.addEventListener('click', () => this.startNewChat());
        
        // File attachment
        attachFileButton.addEventListener('click', () => {
            fileInput.click();
        });
        
        fileInput.addEventListener('change', (e) => {
            this.handleFileUpload(e.target.files);
        });
        
        // Close sidebar when clicking outside
        document.addEventListener('click', (e) => {
            const sidebar = document.getElementById('sidebar');
            const sidebarToggle = document.getElementById('sidebar-toggle');
            
            if (!sidebar.contains(e.target) && !sidebarToggle.contains(e.target)) {
                this.closeSidebar();
            }
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + K for new chat
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this.startNewChat();
            }
            
            // Ctrl/Cmd + B for sidebar toggle
            if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
                e.preventDefault();
                this.toggleSidebar();
            }
        });
    }
    
    setupAutoResize() {
        const messageInput = document.getElementById('message-input');
        
        messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
        });
    }
    
    async sendMessage() {
        const messageInput = document.getElementById('message-input');
        const message = messageInput.value.trim();
        
        if (!message || this.isTyping) return;
        
        // Clear input and disable send button
        messageInput.value = '';
        messageInput.style.height = 'auto';
        this.isTyping = true;
        this.updateSendButton();
        
        // Add user message to chat
        this.addMessage('user', message);
        
        // Show typing indicator
        this.showTypingIndicator();
        
        try {
            // Send message to backend
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    sessionId: this.sessionId
                })
            });
            
            const data = await response.json();
            
            // Hide typing indicator
            this.hideTypingIndicator();
            
            if (response.ok) {
                // Add AI response to chat
                this.addMessage('assistant', data.response);
            } else {
                // Handle error
                this.addMessage('assistant', 'Sorry, I encountered an error. Please try again.');
                console.error('Chat error:', data.error);
            }
            
        } catch (error) {
            console.error('Network error:', error);
            this.hideTypingIndicator();
            this.addMessage('assistant', 'Sorry, I couldn\'t connect to the server. Please check your connection and try again.');
        }
        
        this.isTyping = false;
        this.updateSendButton();
        
        // Focus back on input
        messageInput.focus();
    }
    
    addMessage(role, content) {
        const messagesContainer = document.getElementById('messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message-animation';
        
        const isUser = role === 'user';
        
        messageDiv.innerHTML = `
            <div class="flex items-start space-x-4">
                <div class="w-8 h-8 ${isUser ? 'bg-gray-500' : 'bg-gradient-to-r from-orange-500 to-red-500'} rounded-full flex items-center justify-center flex-shrink-0">
                    <span class="text-white font-semibold text-xs">${isUser ? 'U' : 'AI'}</span>
                </div>
                <div class="${isUser ? 'user-message' : 'ai-message'} rounded-xl px-4 py-3 message-bubble">
                    <div class="claude-text leading-relaxed">${this.formatMessage(content)}</div>
                </div>
            </div>
        `;
        
        messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
        
        // Update message count
        this.messageCount++;
        this.updateMessageCount();
    }
    
    formatMessage(content) {
        // Basic formatting - can be enhanced later
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }
    
    showTypingIndicator() {
        const messagesContainer = document.getElementById('messages');
        const typingDiv = document.createElement('div');
        typingDiv.id = 'typing-indicator';
        typingDiv.className = 'message-animation';
        
        typingDiv.innerHTML = `
            <div class="flex items-start space-x-4">
                <div class="w-8 h-8 bg-gradient-to-r from-orange-500 to-red-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <span class="text-white font-semibold text-xs">AI</span>
                </div>
                <div class="ai-message rounded-xl px-4 py-3">
                    <div class="flex space-x-1">
                        <div class="typing-indicator"></div>
                        <div class="typing-indicator"></div>
                        <div class="typing-indicator"></div>
                    </div>
                </div>
            </div>
        `;
        
        messagesContainer.appendChild(typingDiv);
        this.scrollToBottom();
    }
    
    hideTypingIndicator() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }
    
    scrollToBottom() {
        const chatContainer = document.getElementById('chat-container');
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
    
    updateSendButton() {
        const sendButton = document.getElementById('send-button');
        const messageInput = document.getElementById('message-input');
        const hasText = messageInput.value.trim().length > 0;
        
        sendButton.disabled = !hasText || this.isTyping;
        
        // Update button styling based on state
        if (hasText && !this.isTyping) {
            sendButton.className = 'claude-send-button absolute right-2 bottom-2 p-2 rounded-lg transition-colors';
        } else {
            sendButton.className = 'claude-send-button absolute right-2 bottom-2 p-2 rounded-lg transition-colors opacity-50 cursor-not-allowed';
        }
    }
    
    updateCharacterCount(count) {
        const charCount = document.getElementById('char-count');
        charCount.textContent = count;
    }
    
    startNewChat() {
        // Clear current conversation
        const messagesContainer = document.getElementById('messages');
        messagesContainer.innerHTML = '';
        
        // Reset counters
        this.messageCount = 0;
        this.sessionStartTime = Date.now();
        
        // Generate new session ID
        this.sessionId = this.generateSessionId();
        
        // Add welcome message
        this.addWelcomeMessage();
        
        // Update UI
        this.updateMessageCount();
        this.updateSessionTime();
        this.updateDateTime();
        
        // Focus input
        const messageInput = document.getElementById('message-input');
        messageInput.focus();
    }
    
    addWelcomeMessage() {
        const messagesContainer = document.getElementById('messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message-animation';
        
        messageDiv.innerHTML = `
            <div class="flex items-start space-x-4">
                <div class="w-8 h-8 bg-gradient-to-r from-orange-500 to-red-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <span class="text-white font-semibold text-xs">AI</span>
                </div>
                <div class="ai-message rounded-xl px-4 py-3 message-bubble">
                    <p class="claude-text leading-relaxed">
                        Hi! I'm your AI assistant. I can help you manage reminders, answer questions, and organize your information. What would you like to do today?
                    </p>
                </div>
            </div>
        `;
        
        messagesContainer.appendChild(messageDiv);
    }
    
    handleFileUpload(files) {
        if (files.length === 0) return;
        
        // For now, show a message about file upload (to be implemented later)
        const fileNames = Array.from(files).map(file => file.name).join(', ');
        this.addMessage('user', `📎 Selected files: ${fileNames}`);
        this.addMessage('assistant', 'File upload functionality will be available soon! For now, you can describe what you\'d like to do with these files.');
        
        // Clear the file input
        document.getElementById('file-input').value = '';
    }
    
    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const isOpen = !sidebar.classList.contains('translate-x-full');
        
        if (isOpen) {
            this.closeSidebar();
        } else {
            this.openSidebar();
        }
    }
    
    openSidebar() {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.remove('translate-x-full');
    }
    
    closeSidebar() {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.add('translate-x-full');
    }
    
    setupTheme() {
        // Check for saved theme preference or default to light mode
        const savedTheme = localStorage.getItem('theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            document.documentElement.classList.add('dark');
        }
    }
    
    toggleTheme() {
        const isDark = document.documentElement.classList.contains('dark');
        
        if (isDark) {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        } else {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        }
    }
    
    updateDateTime() {
        const currentDate = document.getElementById('current-date');
        const now = new Date();
        const options = { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        };
        
        currentDate.textContent = now.toLocaleDateString('en-US', options);
    }
    
    updateMessageCount() {
        const messageCountElement = document.getElementById('message-count');
        messageCountElement.textContent = this.messageCount;
    }
    
    updateSessionTime() {
        const sessionTimeElement = document.getElementById('session-time');
        const minutes = Math.floor((Date.now() - this.sessionStartTime) / 60000);
        sessionTimeElement.textContent = `${minutes}m`;
    }
    
    async loadConversationHistory() {
        try {
            const response = await fetch(`/api/conversation/${this.sessionId}`);
            const data = await response.json();
            
            if (response.ok && data.messages && data.messages.length > 0) {
                // Clear welcome message
                const messagesContainer = document.getElementById('messages');
                messagesContainer.innerHTML = '';
                
                // Add previous messages
                data.messages.forEach(msg => {
                    this.addMessage(msg.role, msg.content);
                });
                
                this.messageCount = data.messages.length;
                this.updateMessageCount();
            }
        } catch (error) {
            console.error('Failed to load conversation history:', error);
        }
    }
    
    // Health check method
    async checkHealth() {
        try {
            const response = await fetch('/api/health');
            const data = await response.json();
            console.log('Health check:', data);
            return data;
        } catch (error) {
            console.error('Health check failed:', error);
            return null;
        }
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.remindMeApp = new RemindMeApp();
    
    // Perform health check
    window.remindMeApp.checkHealth().then(health => {
        if (health && !health.geminiConfigured) {
            console.warn('⚠️ Gemini API key not configured. Please set GEMINI_API_KEY in your environment variables.');
        }
    });
});

// Export for debugging
window.RemindMeApp = RemindMeApp;