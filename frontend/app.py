import os
import json
import time
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS
import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Configure both API keys
CHAT_API_KEY = os.getenv('GEMINI_CHAT_API_KEY')
DATA_API_KEY = os.getenv('GEMINI_DATA_API_KEY')

if not CHAT_API_KEY or not DATA_API_KEY:
    raise ValueError("Both GEMINI_CHAT_API_KEY and GEMINI_DATA_API_KEY must be set in environment variables")

# Configuration for free API usage
generation_config = {
    "temperature": 0.7,
    "top_p": 0.95,
    "top_k": 40,
    "max_output_tokens": 1024,
}

# Safety settings for free API
safety_settings = [
    {
        "category": "HARM_CATEGORY_HARASSMENT",
        "threshold": "BLOCK_MEDIUM_AND_ABOVE"
    },
    {
        "category": "HARM_CATEGORY_HATE_SPEECH",
        "threshold": "BLOCK_MEDIUM_AND_ABOVE"
    },
    {
        "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "threshold": "BLOCK_MEDIUM_AND_ABOVE"
    },
    {
        "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
        "threshold": "BLOCK_MEDIUM_AND_ABOVE"
    }
]

# Initialize Chat Model
genai.configure(api_key=CHAT_API_KEY)
chat_model = genai.GenerativeModel(
    model_name="gemini-1.5-flash",
    generation_config=generation_config,
    safety_settings=safety_settings
)

# Initialize Data Model
genai.configure(api_key=DATA_API_KEY)
data_model = genai.GenerativeModel(
    model_name="gemini-1.5-flash",
    generation_config=generation_config,
    safety_settings=safety_settings
)

# Store chat sessions and reminders
chat_sessions = {}
reminders_storage = []

# Chat API Prompt - Returns JSON with message and trigger
CHAT_ANALYSIS_PROMPT = '''
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
'''

# Data API Prompt - Extracts reminder details
DATA_EXTRACTION_PROMPT = '''
Extract reminder details from this message and respond in JSON format.

User message: "{message}"

Respond ONLY in this JSON format:
{{
    "title": "Brief title for the reminder",
    "date": "YYYY-MM-DD format or 'today' or 'tomorrow'",
    "time": "HH:MM format in 24-hour or null if no specific time",
    "description": "Additional details if any"
}}

Examples:
- "Remind me to call John at 3 PM" → {{"title": "Call John", "date": "today", "time": "15:00", "description": ""}}
- "Meeting with team tomorrow at 10 AM" → {{"title": "Meeting with team", "date": "tomorrow", "time": "10:00", "description": ""}}
- "Doctor appointment Friday 2 PM" → {{"title": "Doctor appointment", "date": "friday", "time": "14:00", "description": ""}}
'''

def safe_api_call(model, prompt, max_retries=2):
    """Safe API call with retry logic"""
    for attempt in range(max_retries):
        try:
            response = model.generate_content(prompt)
            return response.text
        except Exception as e:
            if attempt == max_retries - 1:
                raise e
            time.sleep(1)

def parse_json_response(response_text):
    """Parse JSON from API response"""
    try:
        # Clean the response
        clean_text = response_text.strip()
        if clean_text.startswith('```json'):
            clean_text = clean_text[7:-3]
        elif clean_text.startswith('```'):
            clean_text = clean_text[3:-3]
        
        return json.loads(clean_text.strip())
    except:
        return None

def convert_date_to_iso(date_str):
    """Convert date string to ISO format"""
    today = datetime.now().date()
    
    if date_str.lower() == 'today':
        return today.isoformat()
    elif date_str.lower() == 'tomorrow':
        return (today + timedelta(days=1)).isoformat()
    elif date_str.lower() == 'friday':
        days_ahead = 4 - today.weekday()
        if days_ahead <= 0:
            days_ahead += 7
        return (today + timedelta(days_ahead)).isoformat()
    # Add more day parsing as needed
    else:
        try:
            # Try to parse as ISO date
            datetime.fromisoformat(date_str)
            return date_str
        except:
            return today.isoformat()

def process_reminder_data(reminder_data):
    """Process and store reminder data"""
    if not reminder_data:
        return None
    
    # Convert date to ISO format
    iso_date = convert_date_to_iso(reminder_data.get('date', 'today'))
    
    reminder = {
        'id': len(reminders_storage) + 1,
        'title': reminder_data.get('title', 'Reminder'),
        'date': iso_date,
        'time': reminder_data.get('time'),
        'description': reminder_data.get('description', ''),
        'completed': False,
        'created_at': datetime.now().isoformat()
    }
    
    reminders_storage.append(reminder)
    return reminder

@app.route('/')
def index():
    return render_template_string(open('index.html').read())

@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        data = request.get_json()
        message = data.get('message', '')
        session_id = data.get('session_id', 'default')
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        print(f"Processing message: {message}")
        
        # Step 1: Get response from Chat API
        genai.configure(api_key=CHAT_API_KEY)
        if session_id not in chat_sessions:
            chat_sessions[session_id] = chat_model.start_chat(history=[])
        
        chat_session = chat_sessions[session_id]
        
        # Get JSON response from chat API
        chat_prompt = CHAT_ANALYSIS_PROMPT.format(message=message)
        chat_response = safe_api_call(chat_model, chat_prompt)
        chat_data = parse_json_response(chat_response)
        
        if not chat_data:
            # Fallback if JSON parsing fails
            regular_response = chat_session.send_message(message)
            return jsonify({
                'message': regular_response.text,
                'trigger': False,
                'session_id': session_id
            })
        
        response_data = {
            'message': chat_data.get('message', 'I understand your message.'),
            'trigger': chat_data.get('trigger', False),
            'session_id': session_id
        }
        
        # Step 2: If trigger is true, process with Data API
        if chat_data.get('trigger'):
            print("Trigger detected, processing with Data API...")
            
            try:
                # Switch to Data API
                genai.configure(api_key=DATA_API_KEY)
                
                # Extract reminder details
                data_prompt = DATA_EXTRACTION_PROMPT.format(message=message)
                data_response = safe_api_call(data_model, data_prompt)
                reminder_data = parse_json_response(data_response)
                
                if reminder_data:
                    # Store the reminder
                    stored_reminder = process_reminder_data(reminder_data)
                    if stored_reminder:
                        response_data['reminder_created'] = stored_reminder
                        print(f"Reminder created: {stored_reminder['title']} on {stored_reminder['date']}")
                    
            except Exception as e:
                print(f"Data API error: {e}")
                # Continue without reminder creation
        
        return jsonify(response_data)
    
    except Exception as e:
        print(f"Chat error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/new-chat', methods=['POST'])
def new_chat():
    try:
        data = request.get_json()
        session_id = data.get('session_id', 'default')
        
        # Create new chat session
        genai.configure(api_key=CHAT_API_KEY)
        chat_sessions[session_id] = chat_model.start_chat(history=[])
        
        return jsonify({
            'message': 'New chat session created',
            'session_id': session_id
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/reminders', methods=['GET'])
def get_reminders():
    """Get today's reminders"""
    try:
        today = datetime.now().date()
        today_reminders = []
        
        for reminder in reminders_storage:
            if not reminder.get('completed'):
                try:
                    reminder_date = datetime.fromisoformat(reminder['date']).date()
                    if reminder_date == today:
                        today_reminders.append(reminder)
                except:
                    continue
        
        return jsonify({
            'today_reminders': today_reminders,
            'all_reminders': reminders_storage
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/reminders', methods=['POST'])
def create_manual_reminder():
    """Manually create a reminder from sidebar"""
    try:
        data = request.get_json()
        
        reminder = {
            'id': len(reminders_storage) + 1,
            'title': data.get('title', ''),
            'date': data.get('date', datetime.now().date().isoformat()),
            'time': data.get('time'),
            'description': data.get('description', ''),
            'completed': False,
            'created_at': datetime.now().isoformat()
        }
        
        reminders_storage.append(reminder)
        
        return jsonify({
            'message': 'Reminder created successfully',
            'reminder': reminder
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy', 
        'chat_model': 'gemini-1.5-flash',
        'data_model': 'gemini-1.5-flash',
        'total_reminders': len(reminders_storage)
    })

if __name__ == '__main__':
    print("Starting remindME Server with Clean Dual API...")
    print(f"Chat API Key loaded: {'✓' if CHAT_API_KEY else '✗'}")
    print(f"Data API Key loaded: {'✓' if DATA_API_KEY else '✗'}")
    print("Architecture: Chat API → JSON → Data API (if triggered)")
    app.run(debug=True, host='0.0.0.0', port=4000)