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

# Enhanced Data API Prompt - Better date handling
DATA_EXTRACTION_PROMPT = '''
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
    """Parse JSON from API response with better error handling"""
    try:
        # Clean the response
        clean_text = response_text.strip()
        if clean_text.startswith('```json'):
            clean_text = clean_text[7:-3]
        elif clean_text.startswith('```'):
            clean_text = clean_text[3:-3]
        
        # Remove any extra text before/after JSON
        import re
        json_match = re.search(r'\{.*\}', clean_text, re.DOTALL)
        if json_match:
            clean_text = json_match.group(0)
        
        return json.loads(clean_text.strip())
    except Exception as e:
        print(f"JSON parsing error: {e}, text: {response_text[:200]}")
        return None
    """Validate and fix reminder data with fallbacks"""
    if not reminder_data or not isinstance(reminder_data, dict):
        print("Invalid reminder data, creating fallback")
        # Create a basic reminder from the original message
        return create_fallback_reminder(original_message)
    
    # Ensure we have a title
    if not reminder_data.get('title'):
        # Try to extract action from original message
        import re
        # Look for action patterns
        action_patterns = [
            r'remind me to (.+?)(?:\s+at|\s+on|\s*$)',
            r'(?:call|meet|visit|buy|do|check|submit|send|email)(.+?)(?:\s+at|\s+on|\s*$)',
            r'(?:appointment|meeting|deadline)(?:\s+with|\s+for)?\s+(.+?)(?:\s+at|\s+on|\s*$)',
            r'(.+?)(?:\s+at|\s+on|\s+tomorrow|\s+today|\s*$)'
        ]
        
        title = None
        for pattern in action_patterns:
            match = re.search(pattern, original_message, re.IGNORECASE)
            if match:
                title = match.group(1).strip()
                break
        
        reminder_data['title'] = title or "Reminder"
    
    # Ensure we have a date
    if not reminder_data.get('date'):
        reminder_data['date'] = 'today'
    
    # Clean up the title
    title = reminder_data['title'].strip()
    if len(title) > 100:
        title = title[:100] + "..."
    reminder_data['title'] = title
    
    return reminder_data

def create_fallback_reminder(message):
    """Create a basic reminder when extraction fails"""
    import re
    
    # Try to extract basic info with regex
    title = "Reminder"
    date = "today"
    time = None
    
    # Simple patterns for fallback
    if "tomorrow" in message.lower():
        date = "tomorrow"
    elif any(day in message.lower() for day in ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]):
        for day in ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]:
            if day in message.lower():
                date = day
                break
    
    # Try to extract time using the improved function
    time = convert_time_to_24h(message)
    
    # Try to extract action
    action_patterns = [
        r'remind me (?:tomorrow )?(?:i have to |to )?(.+?)(?:\s+by\s+\d|\s+at\s+\d|\s*$)',
        r'(?:need to|have to|must) (.+?)(?:\s+by\s+\d|\s+at\s+\d|\s*$)',
        r'(?:submit|send|call|meet|visit|buy|do|check) (.+?)(?:\s+by\s+\d|\s+at\s+\d|\s*$)',
        r'(.+?) (?:by|at) \d'
    ]
    
    for pattern in action_patterns:
        match = re.search(pattern, message, re.IGNORECASE)
        if match:
            title = match.group(1).strip()
            # Clean up the title
            title = re.sub(r'\s+', ' ', title)  # Remove extra spaces
            break
    
    # If still no good title, try to extract the main content
    if title == "Reminder":
        # Remove common reminder phrases and extract the core task
        cleaned = re.sub(r'remind me (?:tomorrow )?(?:i have to |to )?', '', message, flags=re.IGNORECASE)
        cleaned = re.sub(r'\s+by\s+\d.*', '', cleaned)  # Remove time parts
        cleaned = re.sub(r'\s+at\s+\d.*', '', cleaned)  # Remove time parts
        if len(cleaned.strip()) > 0:
            title = cleaned.strip()
    
    return {
        'title': title,
        'date': date,
        'time': time,
        'description': f"Auto-extracted from: {message[:50]}..."
    }

def convert_date_to_iso(date_str):
    """Convert date string to ISO format with better handling"""
    today = datetime.now().date()
    current_year = today.year
    
    if not date_str:
        return today.isoformat()
        
    date_str = date_str.lower().strip()
    
    if date_str in ['today', '']:
        return today.isoformat()
    elif date_str == 'tomorrow':
        return (today + timedelta(days=1)).isoformat()
    elif date_str in ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']:
        # Handle day names
        days = {'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3, 
                'friday': 4, 'saturday': 5, 'sunday': 6}
        target_day = days[date_str]
        days_ahead = target_day - today.weekday()
        if days_ahead <= 0:
            days_ahead += 7
        return (today + timedelta(days_ahead)).isoformat()
    else:
        try:
            # Handle month day formats like "july 13", "dec 25", etc.
            import re
            month_day_match = re.search(r'(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})', date_str)
            
            if month_day_match:
                month_str = month_day_match.group(1)
                day = int(month_day_match.group(2))
                
                # Convert month name to number
                month_map = {
                    'january': 1, 'jan': 1, 'february': 2, 'feb': 2, 'march': 3, 'mar': 3,
                    'april': 4, 'apr': 4, 'may': 5, 'june': 6, 'jun': 6,
                    'july': 7, 'jul': 7, 'august': 8, 'aug': 8, 'september': 9, 'sep': 9,
                    'october': 10, 'oct': 10, 'november': 11, 'nov': 11, 'december': 12, 'dec': 12
                }
                
                month = month_map.get(month_str, today.month)
                
                # Create the date - if the date has passed this year, assume next year
                try:
                    target_date = datetime(current_year, month, day).date()
                    if target_date < today:
                        target_date = datetime(current_year + 1, month, day).date()
                    return target_date.isoformat()
                except ValueError:
                    # Invalid date (like Feb 30), default to today
                    print(f"Invalid date: {month}/{day}, defaulting to today")
                    return today.isoformat()
            
            # Try to parse as ISO date
            elif len(date_str) == 10 and '-' in date_str:  # YYYY-MM-DD format
                parsed_date = datetime.fromisoformat(date_str).date()
                return parsed_date.isoformat()
            else:
                # Try basic parsing
                print(f"Warning: Could not parse complex date '{date_str}', defaulting to today")
                return today.isoformat()
        except Exception as e:
            # If all parsing fails, default to today
            print(f"Warning: Could not parse date '{date_str}' (error: {e}), defaulting to today")
            return today.isoformat()

def convert_time_to_24h(time_str):
    """Convert time string to 24-hour format with better AM/PM handling"""
    if not time_str:
        return None
    
    time_str = time_str.lower().strip()
    
    # Handle 12 AM/PM specifically
    if '12 am' in time_str or '12am' in time_str:
        return "00:00"  # 12 AM = midnight = 00:00
    elif '12 pm' in time_str or '12pm' in time_str:
        return "12:00"  # 12 PM = noon = 12:00
    
    # Handle other AM/PM cases
    import re
    time_match = re.search(r'(\d{1,2}):?(\d{2})?\s*(am|pm)', time_str)
    if time_match:
        hour = int(time_match.group(1))
        minute = int(time_match.group(2)) if time_match.group(2) else 0
        is_pm = time_match.group(3) == 'pm'
        
        # Convert to 24-hour format
        if is_pm and hour != 12:
            hour += 12
        elif not is_pm and hour == 12:
            hour = 0
            
        return f"{hour:02d}:{minute:02d}"
    
    # Handle 24-hour format or other formats
    if ':' in time_str:
        parts = time_str.split(':')
        try:
            hour = int(parts[0])
            minute = int(parts[1]) if len(parts) > 1 else 0
            if 0 <= hour <= 23 and 0 <= minute <= 59:
                return f"{hour:02d}:{minute:02d}"
        except:
            pass
    
    # Default times for common words
    if 'morning' in time_str:
        return "09:00"
    elif 'afternoon' in time_str:
        return "14:00"
    elif 'evening' in time_str:
        return "18:00"
    elif 'night' in time_str:
        return "20:00"
    
    return None

def process_reminder_data(reminder_data):
    """Process and store reminder data with improved parsing"""
    if not reminder_data:
        return None
    
    print(f"Processing reminder data: {reminder_data}")
    
    # Convert date to ISO format
    original_date = reminder_data.get('date', 'today')
    iso_date = convert_date_to_iso(original_date)
    print(f"Date conversion: '{original_date}' -> '{iso_date}'")
    
    # Convert time to 24-hour format
    original_time = reminder_data.get('time')
    converted_time = convert_time_to_24h(original_time)
    print(f"Time conversion: '{original_time}' -> '{converted_time}'")
    
    reminder = {
        'id': len(reminders_storage) + 1,
        'title': reminder_data.get('title', 'Reminder'),
        'date': iso_date,
        'time': converted_time,
        'description': reminder_data.get('description', ''),
        'completed': False,
        'created_at': datetime.now().isoformat()
    }
    
    reminders_storage.append(reminder)
    print(f"Reminder stored successfully: {reminder}")  # Debug log
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
    """Get upcoming reminders (today + next 7 days)"""
    try:
        today = datetime.now().date()
        next_week = today + timedelta(days=7)
        
        today_reminders = []
        upcoming_reminders = []
        
        print(f"Fetching reminders from {today} to {next_week}")
        print(f"Total reminders in storage: {len(reminders_storage)}")
        
        for reminder in reminders_storage:
            print(f"Checking reminder: {reminder}")
            if not reminder.get('completed'):
                try:
                    if reminder.get('date'):
                        # Handle both ISO format and plain date strings
                        if 'T' in reminder['date']:
                            reminder_date = datetime.fromisoformat(reminder['date'].split('T')[0]).date()
                        else:
                            reminder_date = datetime.fromisoformat(reminder['date']).date()
                        
                        print(f"Reminder date: {reminder_date}, Today: {today}")
                        
                        # Add to today's reminders
                        if reminder_date == today:
                            today_reminders.append(reminder)
                            print(f"Added to today's reminders: {reminder['title']}")
                        
                        # Add to upcoming reminders (today + next 7 days)
                        if today <= reminder_date <= next_week:
                            upcoming_reminders.append(reminder)
                            print(f"Added to upcoming reminders: {reminder['title']} on {reminder_date}")
                            
                except Exception as e:
                    print(f"Error parsing reminder date: {e}, reminder: {reminder}")
                    continue
        
        print(f"Found {len(today_reminders)} reminders for today")
        print(f"Found {len(upcoming_reminders)} upcoming reminders")
        
        return jsonify({
            'today_reminders': today_reminders,
            'upcoming_reminders': upcoming_reminders,  # New field for sidebar
            'all_reminders': reminders_storage
        })
    
    except Exception as e:
        print(f"Error in get_reminders: {e}")
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
        'total_reminders': len(reminders_storage),
        'reminders_sample': reminders_storage[-3:] if len(reminders_storage) > 0 else []  # Show last 3 reminders for debugging
    })

@app.route('/api/debug/reminders', methods=['GET'])
def debug_reminders():
    """Debug endpoint to see all reminders"""
    return jsonify({
        'all_reminders': reminders_storage,
        'total_count': len(reminders_storage),
        'current_date': datetime.now().date().isoformat()
    })

if __name__ == '__main__':
    print("Starting remindME Server with Clean Dual API...")
    print(f"Chat API Key loaded: {'✓' if CHAT_API_KEY else '✗'}")
    print(f"Data API Key loaded: {'✓' if DATA_API_KEY else '✗'}")
    print("Architecture: Chat API → JSON → Data API (if triggered)")
    app.run(debug=True, host='0.0.0.0', port=4000)