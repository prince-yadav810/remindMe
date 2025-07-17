import os
import json
import time
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
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

Current date: {current_date}
Current time: {current_time}

{context_info}

User message: "{message}"

CRITICAL: Your response message must be PLAIN TEXT ONLY for a text-based chat interface.
ABSOLUTELY NO HTML TAGS: No <br>, no <div>, no <span>, no <i>, no status indicators, no styling.
NO PROCESSING MESSAGES: Don't mention "processing" or "enhanced parsing" or status updates.
SIMPLE CONVERSATIONAL TEXT ONLY.

Respond ONLY in this JSON format:
{{
    "message": "Your helpful response (PLAIN TEXT ONLY - NO HTML WHATSOEVER)",
    "trigger": true/false{title_field}
}}

Set trigger to true if the user wants to:
- Set a reminder
- Schedule something
- Remember to do something
- Has appointment/meeting information
- Mentions specific dates/times for tasks

Set trigger to false for general questions, greetings, or casual conversation.

GOOD EXAMPLES:
- "Remind me to call John at 3 PM" → {{"message": "I'll set a reminder for you to call John at 3 PM.", "trigger": true}}
- "I have a meeting tomorrow at 10 AM" → {{"message": "I'll create a reminder for your meeting tomorrow at 10 AM.", "trigger": true}}
- "What's the weather like?" → {{"message": "I don't have access to current weather information, but you can check a weather app for the latest forecast.", "trigger": false}}
- "Hello, how are you?" → {{"message": "Hello! I'm doing well, thank you. How can I help you today?", "trigger": false}}

BAD EXAMPLES (DON'T DO THIS):
- "I'll set a reminder.<br><div class='status'>Processing...</div>" ← NEVER INCLUDE HTML
- "Setting reminder... <i class='icon'></i>" ← NEVER INCLUDE ICONS OR TAGS
- "Processing reminder with enhanced parsing..." ← DON'T MENTION PROCESSING
'''

# Enhanced Data API Prompt - Better date handling
DATA_EXTRACTION_PROMPT = '''
Extract reminder details from this message with enhanced validation.

Current date: {current_date}
Current time: {current_time}

User message: "{message}"

IMPORTANT VALIDATION RULES:
1. Parse dates in various formats: "16 july", "july 16", "jul 16", "today", "tomorrow"
2. Calculate relative times accurately (like "in 3 hours", "next 5 days")
3. Check if date/time is in the past - if yes, set error message
4. For same day reminders, only check if the TIME is in the past, not the date

DATE PARSING EXAMPLES:
- "16 july" → extract as July 16th of current year
- "july 16" → extract as July 16th of current year
- "today at 10pm" → use current date with 22:00 time
- "tomorrow at 9am" → use next day with 09:00 time

TIME PARSING EXAMPLES:
- "10pm" → "22:00"
- "10 pm" → "22:00"
- "9am" → "09:00"
- "9 am" → "09:00"

Respond ONLY in this JSON format:
{{
    "title": "Brief action to remember (required)",
    "date": "YYYY-MM-DD format or relative like 'today'/'tomorrow'",
    "time": "HH:MM in 24-hour format or null",
    "description": "Additional context if any",
    "error": "Error message if validation fails, null if valid"
}}

Examples:
- "playing bgmi at 10pm at 16 july" → {{"title": "Playing BGMI", "date": "16 july", "time": "22:00", "description": "", "error": null}}
- "meeting today at 3 PM" → {{"title": "Meeting", "date": "today", "time": "15:00", "description": "", "error": null}}
- "remind me yesterday" → {{"title": "Reminder", "date": "yesterday", "time": null, "description": "", "error": "Cannot set reminder for past date"}}
- "call mom in 5 hours" → {{"title": "Call mom", "date": "today", "time": "calculated_time", "description": "", "error": null}}
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

def strip_html_tags(text):
    """Remove HTML tags from text as a safety measure"""
    import re
    if not text:
        return text
    
    # Remove HTML tags
    clean_text = re.sub(r'<[^>]+>', '', text)
    
    # Remove extra whitespace that might be left
    clean_text = re.sub(r'\s+', ' ', clean_text).strip()
    
    return clean_text

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
        
        parsed_data = json.loads(clean_text.strip())
        
        # CRITICAL: Strip HTML from the message as safety measure
        if 'message' in parsed_data and parsed_data['message']:
            original_message = parsed_data['message']
            clean_message = strip_html_tags(original_message)
            
            if original_message != clean_message:
                print(f"⚠️ Stripped HTML from AI response:")
                print(f"   Original: {original_message[:100]}...")
                print(f"   Cleaned:  {clean_message[:100]}...")
            
            parsed_data['message'] = clean_message
        
        return parsed_data
        
    except Exception as e:
        print(f"JSON parsing error: {e}, text: {response_text[:200]}")
        return None

def convert_date_to_iso(date_str, current_datetime):
    """Convert date string to ISO format with better handling"""
    today_str = current_datetime.get('isoDate', datetime.now().date().isoformat())
    today = datetime.fromisoformat(today_str).date()
    current_year = today.year
    
    if not date_str:
        return today.isoformat()
        
    date_str = date_str.lower().strip()
    
    if date_str in ['today', '']:
        return today.isoformat()
    elif date_str == 'tomorrow':
        return (today + timedelta(days=1)).isoformat()
    elif date_str == 'yesterday':
        return (today - timedelta(days=1)).isoformat()
    elif date_str in ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']:
        # Handle day names
        days = {'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3, 
                'friday': 4, 'saturday': 5, 'sunday': 6}
        target_day = days[date_str]
        days_ahead = target_day - today.weekday()
        if days_ahead <= 0:
            days_ahead += 7
        return (today + timedelta(days_ahead)).isoformat()
    
    # Handle relative dates like "next 3 days", "in 5 days"
    if 'next' in date_str or 'in' in date_str:
        import re
        number_match = re.search(r'(\d+)', date_str)
        if number_match:
            number = int(number_match.group(1))
            if 'day' in date_str:
                return (today + timedelta(days=number)).isoformat()
            elif 'week' in date_str:
                return (today + timedelta(weeks=number)).isoformat()
    
    # Handle formats like "16 july", "july 16", "jul 16", "16 jul"
    import re
    # Pattern for "16 july" or "july 16"
    month_day_patterns = [
        r'(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)',
        r'(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})'
    ]
    
    for pattern in month_day_patterns:
        match = re.search(pattern, date_str)
        if match:
            if pattern.startswith(r'(\d'):  # "16 july" format
                day = int(match.group(1))
                month_str = match.group(2)
            else:  # "july 16" format
                month_str = match.group(1)
                day = int(match.group(2))
            
            # Convert month name to number
            month_map = {
                'january': 1, 'jan': 1, 'february': 2, 'feb': 2, 'march': 3, 'mar': 3,
                'april': 4, 'apr': 4, 'may': 5, 'june': 6, 'jun': 6,
                'july': 7, 'jul': 7, 'august': 8, 'aug': 8, 'september': 9, 'sep': 9,
                'october': 10, 'oct': 10, 'november': 11, 'nov': 11, 'december': 12, 'dec': 12
            }
            
            month = month_map.get(month_str, today.month)
            
            try:
                # Try current year first
                target_date = datetime(current_year, month, day).date()
                
                # If the date has passed this year and it's a different date than today, use next year
                # But if it's today, keep it as today regardless of time
                if target_date < today:
                    target_date = datetime(current_year + 1, month, day).date()
                
                print(f"📅 Parsed '{date_str}' as {target_date.isoformat()}")
                return target_date.isoformat()
            except ValueError:
                print(f"Invalid date: {month}/{day}, defaulting to today")
                return today.isoformat()
    
    # Try to parse as ISO date
    if len(date_str) == 10 and '-' in date_str:
        try:
            parsed_date = datetime.fromisoformat(date_str).date()
            return parsed_date.isoformat()
        except:
            pass
    
    # Default to today if nothing matches
    print(f"📅 Could not parse '{date_str}', defaulting to today")
    return today.isoformat()

def convert_time_to_24h(time_str, current_datetime):
    """Convert time string to 24-hour format with better AM/PM handling"""
    if not time_str:
        return None
    
    current_hour = current_datetime.get('hour', datetime.now().hour)
    current_minute = current_datetime.get('minute', datetime.now().minute)
    
    time_str = time_str.lower().strip()
    
    # Handle relative time like "next 3 hours", "in 5 hours"
    if 'next' in time_str or 'in' in time_str:
        import re
        number_match = re.search(r'(\d+)', time_str)
        if number_match:
            number = int(number_match.group(1))
            if 'hour' in time_str:
                new_hour = (current_hour + number) % 24
                return f"{new_hour:02d}:{current_minute:02d}"
            elif 'minute' in time_str:
                total_minutes = current_minute + number
                new_hour = (current_hour + (total_minutes // 60)) % 24
                new_minute = total_minutes % 60
                return f"{new_hour:02d}:{new_minute:02d}"
    
    # Handle 12 AM/PM specifically
    if '12 am' in time_str or '12am' in time_str:
        return "00:00"
    elif '12 pm' in time_str or '12pm' in time_str:
        return "12:00"
    
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

def validate_datetime(date_str, time_str, current_datetime):
    """Validate that the reminder date/time is not in the past"""
    try:
        # Get current datetime
        current_date_str = current_datetime.get('isoDate', datetime.now().date().isoformat())
        current_date = datetime.fromisoformat(current_date_str).date()
        current_hour = current_datetime.get('hour', datetime.now().hour)
        current_minute = current_datetime.get('minute', datetime.now().minute)
        current_time = datetime.min.time().replace(hour=current_hour, minute=current_minute)
        current_dt = datetime.combine(current_date, current_time)
        
        # Parse reminder datetime
        reminder_date = datetime.fromisoformat(date_str).date()
        if time_str:
            time_parts = time_str.split(':')
            reminder_hour = int(time_parts[0])
            reminder_minute = int(time_parts[1])
            reminder_time = datetime.min.time().replace(hour=reminder_hour, minute=reminder_minute)
        else:
            # Default to 9 AM if no time specified
            reminder_time = datetime.min.time().replace(hour=9, minute=0)
        
        reminder_dt = datetime.combine(reminder_date, reminder_time)
        
        print(f"🕐 Validation check:")
        print(f"   Current: {current_dt.strftime('%Y-%m-%d %H:%M')}")
        print(f"   Reminder: {reminder_dt.strftime('%Y-%m-%d %H:%M')}")
        
        # Check if in the past
        # For same day, check if the time has passed
        # For different days, check if the date has passed
        if reminder_dt <= current_dt:
            if reminder_date == current_date:
                # Same day - check if time has passed
                if reminder_time <= current_time:
                    return f"Cannot set reminder for past time. Current time is {current_dt.strftime('%H:%M')} and you're trying to set it for {reminder_time.strftime('%H:%M')}."
            else:
                # Different day - date has passed
                return f"Cannot set reminder for past date. Today is {current_date.strftime('%Y-%m-%d')} and you're trying to set it for {reminder_date.strftime('%Y-%m-%d')}."
        
        print(f"✅ Validation passed - reminder is in the future")
        return None
        
    except Exception as e:
        print(f"❌ Validation error: {str(e)}")
        return f"Invalid date/time format: {str(e)}"

def process_reminder_data(reminder_data, current_datetime):
    """Process and store reminder data with improved parsing"""
    if not reminder_data:
        return None
    
    print(f"📋 Processing reminder data: {reminder_data}")
    print(f"🕒 Current datetime context: {current_datetime}")
    
    # Check for validation errors from AI
    if reminder_data.get('error'):
        print(f"❌ AI validation error: {reminder_data['error']}")
        return {
            'error': reminder_data['error'],
            'title': reminder_data.get('title', 'Invalid Reminder'),
            'date': None,
            'time': None,
            'description': reminder_data.get('description', ''),
            'created_at': datetime.now().isoformat()
        }
    
    # Convert date to ISO format
    original_date = reminder_data.get('date', 'today')
    iso_date = convert_date_to_iso(original_date, current_datetime)
    print(f"📅 Date conversion: '{original_date}' -> '{iso_date}'")
    
    # Convert time to 24-hour format
    original_time = reminder_data.get('time')
    converted_time = convert_time_to_24h(original_time, current_datetime)
    print(f"🕐 Time conversion: '{original_time}' -> '{converted_time}'")
    
    # Validate that the datetime is not in the past
    validation_error = validate_datetime(iso_date, converted_time, current_datetime)
    if validation_error:
        print(f"❌ Validation error: {validation_error}")
        return {
            'error': validation_error,
            'title': reminder_data.get('title', 'Invalid Reminder'),
            'date': iso_date,
            'time': converted_time,
            'description': reminder_data.get('description', ''),
            'created_at': datetime.now().isoformat()
        }
    
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
    print(f"✅ Reminder stored successfully: {reminder}")
    return reminder

@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        data = request.get_json()
        message = data.get('message', '')
        session_id = data.get('session_id', 'default')
        user_id = data.get('user_id', 'anonymous')
        conversation_history = data.get('conversation_history', [])
        current_datetime = data.get('current_datetime', {})
        is_new_conversation = data.get('is_new_conversation', False)
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        print(f"📥 Processing message: {message}")
        print(f"👤 User: {user_id}, Session: {session_id}")
        print(f"📚 Conversation history length: {len(conversation_history)}")
        print(f"🆕 Is new conversation: {is_new_conversation}")
        
        # Build context info
        context_info = ""
        if conversation_history and len(conversation_history) > 0:
            context_info = "\nPrevious conversation context:\n"
            for msg in conversation_history[-5:]:
                context_info += f"{msg['role'].title()}: {msg['content']}\n"
        
        # Build chat prompt
        current_date = current_datetime.get('isoDate', 'unknown')
        current_time = current_datetime.get('time24', 'unknown')
        
        title_field = ', "title": "Brief conversation title"' if is_new_conversation else ''
        
        chat_prompt = CHAT_ANALYSIS_PROMPT.format(
            current_date=current_date,
            current_time=current_time,
            context_info=context_info,
            message=message,
            title_field=title_field
        )
        
        # Step 1: Get response from Chat API
        genai.configure(api_key=CHAT_API_KEY)
        if session_id not in chat_sessions:
            chat_sessions[session_id] = chat_model.start_chat(history=[])
        
        chat_response = safe_api_call(chat_model, chat_prompt)
        chat_data = parse_json_response(chat_response)
        
        if not chat_data:
            # Fallback if JSON parsing fails
            fallback_message = f"I understand your message: '{message}'. How can I help you?"
            
            # Ensure fallback is also clean
            fallback_message = strip_html_tags(fallback_message)
            
            fallback_response = {
                'message': fallback_message,
                'trigger': any(word in message.lower() for word in ['remind', 'reminder', 'remember', 'schedule', 'appointment', 'meeting']),
                'session_id': session_id
            }
            if is_new_conversation:
                words = message.split()[:4]
                fallback_response['title'] = ' '.join(words) if words else 'New Chat'
            return jsonify(fallback_response)
        
        # Clean the AI response message
        ai_message = chat_data.get('message', 'I understand your message.')
        clean_message = strip_html_tags(ai_message)
        
        response_data = {
            'message': clean_message,
            'trigger': chat_data.get('trigger', False),
            'session_id': session_id
        }
        
        # Add title for new conversations
        if is_new_conversation and chat_data.get('title'):
            response_data['title'] = chat_data['title']
            print(f"📝 AI generated title: {chat_data['title']}")
        elif is_new_conversation:
            words = message.split()[:4]
            response_data['title'] = ' '.join(words) if words else 'New Chat'
            print(f"📝 Fallback title: {response_data['title']}")
        
        print(f"🎯 Chat response - Trigger: {response_data['trigger']}")
        
        # Step 2: If trigger is true, process with Data API
        if chat_data.get('trigger'):
            print("🔄 Trigger detected, processing with Data API...")
            
            try:
                # Switch to Data API
                genai.configure(api_key=DATA_API_KEY)
                
                # Build data prompt
                data_prompt = DATA_EXTRACTION_PROMPT.format(
                    current_date=current_date,
                    current_time=current_time,
                    message=message
                )
                
                # Extract reminder details
                data_response = safe_api_call(data_model, data_prompt)
                reminder_data = parse_json_response(data_response)
                
                print(f"📊 Data API response: {reminder_data}")
                
                if reminder_data:
                    # Process the reminder
                    processed_reminder = process_reminder_data(reminder_data, current_datetime)
                    
                    if processed_reminder:
                        if processed_reminder.get('error'):
                            # Return error to user
                            response_data['message'] = f"Sorry, I couldn't set that reminder: {processed_reminder['error']}"
                            response_data['trigger'] = False
                            response_data['error'] = processed_reminder['error']
                            print(f"❌ Reminder failed: {processed_reminder['error']}")
                        else:
                            # Success
                            response_data['reminder_created'] = processed_reminder
                            print(f"✅ Reminder created: {processed_reminder['title']} on {processed_reminder['date']}")
                    else:
                        print("❌ Failed to process reminder data")
                        
            except Exception as e:
                print(f"❌ Data API error: {e}")
        
        return jsonify(response_data)
    
    except Exception as e:
        print(f"❌ Chat error: {e}")
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
            'upcoming_reminders': upcoming_reminders,
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
        'chat_api_configured': bool(CHAT_API_KEY),
        'data_api_configured': bool(DATA_API_KEY),
        'version': '2.0.0 - Clean Working Version'
    })

@app.route('/api/test-connection', methods=['GET'])
def test_connection():
    """Test endpoint for server.js to verify connection"""
    return jsonify({
        'status': 'connected',
        'message': 'Python AI service is running perfectly',
        'timestamp': datetime.now().isoformat(),
        'service': 'remindME AI Microservice'
    })

@app.route('/', methods=['GET'])
def root():
    """Root endpoint"""
    return jsonify({
        'service': 'remindME AI Microservice',
        'status': 'running',
        'version': '2.0.0 - Clean Working Version',
        'message': 'Clean, working Python functionality'
    })

if __name__ == '__main__':
    print("🚀 Starting remindME AI Microservice (CLEAN VERSION)...")
    print(f"🔑 Chat API Key loaded: {'✓' if CHAT_API_KEY else '✗'}")
    print(f"🔑 Data API Key loaded: {'✓' if DATA_API_KEY else '✗'}")
    print("✅ Clean, simplified code structure!")
    print("✅ All function signatures match!")
    print("✅ Enhanced validation and relative time!")
    print("✅ No HTML in responses!")
    print("📡 Ready to receive requests on http://localhost:4000")
    app.run(debug=True, host='0.0.0.0', port=4000)