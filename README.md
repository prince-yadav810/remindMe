# 🧠 remindME - AI Personal Assistant

A Claude-inspired AI-powered personal assistant that helps you manage reminders, tasks, and information with natural conversation.

## ✨ Features

- **Claude-like Chat Interface**: Familiar, clean UI with smooth animations
- **Gemini AI Integration**: Powered by Google's Gemini AI with conversation memory
- **Context Awareness**: Remembers previous conversations in the same session
- **Dark/Light Theme**: Automatic theme detection with manual toggle
- **Responsive Design**: Works on desktop, tablet, and mobile
- **Real-time Interaction**: Typing indicators and smooth message flow
- **Smart Sidebar**: Overview of today's activities and stats
- **MongoDB Storage**: Persistent conversation history

## 🚀 Quick Start

### Prerequisites

- Node.js (v16 or higher)
- MongoDB (local or Atlas)
- Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd remindme-app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your Gemini API key:
   ```
   GEMINI_API_KEY=your_actual_gemini_api_key_here
   ```

4. **Start MongoDB**
   ```bash
   # If using local MongoDB
   mongod
   
   # Or use MongoDB Atlas and update MONGODB_URI in .env
   ```

5. **Start the application**
   ```bash
   # Development mode (auto-restart on changes)
   npm run dev
   
   # Or production mode
   npm start
   ```

6. **Open your browser**
   Navigate to `http://localhost:3000`

## 📁 Project Structure

```
remindme-app/
├── backend/
│   └── server.js          # Express server with Gemini integration
├── frontend/
│   ├── index.html         # Main HTML file
│   ├── app.js            # Frontend JavaScript
│   └── styles.css        # Additional styles (if needed)
├── .env.example          # Environment variables template
├── package.json          # Dependencies and scripts
└── README.md            # This file
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `MONGODB_URI` | MongoDB connection string | mongodb://localhost:27017/remindme |
| `GEMINI_API_KEY` | Google Gemini API key | Required |
| `FRONTEND_URL` | Frontend URL for CORS | http://localhost:3000 |

### Getting Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Create a new API key
4. Copy the key and add it to your `.env` file

## 🎨 UI Features

### Chat Interface
- **Claude-inspired design** with Inter font family
- **Smooth animations** for message appearance
- **Auto-resizing input** that grows with content
- **Typing indicators** during AI response
- **Message formatting** with basic markdown support

### Sidebar
- **Today's overview** with date and stats
- **Session statistics** (message count, time)
- **Collapsible design** that slides in/out
- **Future integration points** for reminders and tasks

### Theme System
- **Auto-detection** of system preference
- **Manual toggle** between light and dark modes
- **Persistent storage** of user preference
- **Smooth transitions** between themes

## 🔌 API Endpoints

### Chat API
- **POST** `/api/chat` - Send message to AI
  ```json
  {
    "message": "Hello, how are you?",
    "sessionId": "session_12345"
  }
  ```

### Conversation API
- **GET** `/api/conversation/:sessionId` - Get conversation history

### Health Check
- **GET** `/api/health` - Check server status and configuration

## 🛠️ Technical Details

### Backend Architecture
- **Express.js** server with security middleware
- **MongoDB** with Mongoose ODM
- **Rate limiting** to prevent API abuse
- **CORS** configured for frontend
- **Error handling** with proper HTTP status codes

### Frontend Architecture
- **Vanilla JavaScript** with ES6 classes
- **Tailwind CSS** for responsive styling
- **Local storage** for theme preferences
- **Fetch API** for backend communication
- **Event-driven** architecture for UI interactions

### AI Integration
- **Google Gemini Pro** model
- **Conversation history** maintained in database
- **Context-aware responses** using chat history
- **Error handling** for API failures
- **Rate limiting** to respect API quotas

## 🔐 Security Features

- **Helmet.js** for security headers
- **Rate limiting** on API endpoints
- **Input validation** and sanitization
- **CORS** protection
- **Environment variable** protection

## 🚀 Development

### Running in Development Mode
```bash
npm run dev
```
This uses nodemon to automatically restart the server when you make changes.

### Testing the Application
1. Open `http://localhost:3000`
2. Check the browser console for any errors
3. Test the `/api/health` endpoint
4. Send a few messages to test AI integration

### Adding New Features
The application is designed with extensibility in mind:
- Add new API endpoints in `server.js`
- Extend the frontend class in `app.js`
- Add new UI components in `index.html`
- Use the existing MongoDB schema or extend it

## 📊 Next Steps

This is the foundation for the remindME application. Future enhancements include:

1. **File upload system** for documents and images
2. **Data categorization** API for organizing information
3. **Reminder scheduling** with notifications
4. **User authentication** and multi-user support
5. **Advanced AI features** like intent classification
6. **Mobile app** development
7. **Calendar integration**
8. **Data export/import** functionality

## 🐛 Troubleshooting

### Common Issues

1. **"Cannot connect to MongoDB"**
   - Ensure MongoDB is running locally or your Atlas connection string is correct

2. **"Gemini API key not configured"**
   - Check that `GEMINI_API_KEY` is set in your `.env` file

3. **"Port already in use"**
   - Change the `PORT` in `.env` or kill the process using the port

4. **"Failed to load conversation history"**
   - Check MongoDB connection and ensure the database exists

### Debug Mode
The application includes debugging features:
- Check browser console for frontend errors
- Server logs show detailed error information
- Health check endpoint provides system status

## 📝 License

This project is licensed under the MIT License. See the LICENSE file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

**Built with ❤️ for productive conversations with AI**