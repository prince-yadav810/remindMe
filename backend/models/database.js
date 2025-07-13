const mongoose = require('mongoose');

// ============= UPLOADED FILES SCHEMA =============
const uploadedFileSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  fileType: { type: String, required: true }, // 'pdf', 'docx', 'image', 'txt', etc.
  fileSize: { type: Number, required: true },
  filePath: { type: String, required: true },
  mimeType: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
  processingStatus: { 
    type: String, 
    enum: ['pending', 'processing', 'completed', 'failed'], 
    default: 'pending' 
  },
  extractedText: { type: String }, // Extracted text content
  metadata: {
    pages: { type: Number },
    wordCount: { type: Number },
    language: { type: String },
    keywords: [String]
  },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 35 * 24 * 60 * 60 * 1000) } // 35 days
});

// ============= MEMORIES SCHEMA (Processed Information) =============
const memorySchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  sourceType: { type: String, enum: ['file', 'conversation', 'manual'], required: true },
  sourceId: { type: String, required: true }, // fileId or conversationId
  title: { type: String, required: true },
  content: { type: String, required: true },
  summary: { type: String },
  categories: [String], // Simplified for now
  tags: [String],
  importance: { type: Number, min: 1, max: 5, default: 3 },
  relevanceScore: { type: Number, default: 0 },
  
  // Context information
  context: {
    dateRelevant: { type: Date },
    location: { type: String },
    people: [String],
    projects: [String]
  },
  
  // AI processing metadata
  aiProcessing: {
    sentiment: { type: String, enum: ['positive', 'negative', 'neutral'] },
    actionItems: [String],
    keyPhrases: [String],
    entities: [String]
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 35 * 24 * 60 * 60 * 1000) }
});

// ============= REMINDERS SCHEMA =============
const reminderSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  description: { type: String },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reminderTime: { type: Date, required: true },
  isRecurring: { type: Boolean, default: false },
  recurrencePattern: {
    type: { type: String, enum: ['daily', 'weekly', 'monthly', 'yearly'] },
    interval: { type: Number, default: 1 },
    endDate: { type: Date }
  },
  
  // Link to source information
  sourceMemory: { type: mongoose.Schema.Types.ObjectId, ref: 'Memory' },
  sourceConversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
  
  status: { type: String, enum: ['pending', 'completed', 'snoozed', 'cancelled'], default: 'pending' },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  
  completedAt: { type: Date },
  snoozedUntil: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// ============= ENHANCED CONVERSATION SCHEMA =============
const conversationSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  title: { type: String, default: 'New Conversation' },
  
  messages: [{
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    
    // Enhanced message metadata
    metadata: {
      intentClassification: { type: String, enum: ['question', 'store_info', 'set_reminder', 'search', 'general'] },
      extractedEntities: [String],
      referencedMemories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Memory' }],
      createdReminders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Reminder' }],
      attachedFiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'UploadedFile' }]
    }
  }],
  
  // Context for this conversation
  context: {
    referencedFiles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'UploadedFile' }],
    keyTopics: [String]
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 35 * 24 * 60 * 60 * 1000) }
});

// ============= INDEXES FOR PERFORMANCE =============
conversationSchema.index({ sessionId: 1 });
conversationSchema.index({ createdAt: -1 });
memorySchema.index({ sessionId: 1, sourceType: 1 });
memorySchema.index({ sessionId: 1, relevanceScore: -1 });
reminderSchema.index({ sessionId: 1, reminderTime: 1 });
reminderSchema.index({ sessionId: 1, status: 1 });
uploadedFileSchema.index({ sessionId: 1, uploadedAt: -1 });

// TTL indexes for automatic cleanup
conversationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
memorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
uploadedFileSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ============= EXPORT MODELS =============
const UploadedFile = mongoose.model('UploadedFile', uploadedFileSchema);
const Memory = mongoose.model('Memory', memorySchema);
const Reminder = mongoose.model('Reminder', reminderSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = {
  UploadedFile,
  Memory,
  Reminder,
  Conversation
};