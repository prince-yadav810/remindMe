import os
import json
from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS
import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Configure Gemini API
API_KEY = os.getenv('GEMINI_API_KEY')
if not API_KEY:
    raise ValueError("GEMINI_API_KEY not found in environment variables")

genai.configure(api_key=API_KEY)

# Configuration for free API usage
generation_config = {
    "temperature": 0.7,
    "top_p": 0.95,
    "top_k": 40,
    "max_output_tokens": 2048,
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

# Initialize the model
model = genai.GenerativeModel(
    model_name="gemini-1.5-flash",  # Free model
    generation_config=generation_config,
    safety_settings=safety_settings
)

# Store chat sessions (in production, use a database)
chat_sessions = {}

@app.route('/')
def index():
    # Serve your existing index.html
    return render_template_string(open('index.html').read())

@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        data = request.get_json()
        message = data.get('message', '')
        session_id = data.get('session_id', 'default')
        
        if not message:
            return jsonify({'error': 'Message is required'}), 400
        
        # Get or create chat session
        if session_id not in chat_sessions:
            chat_sessions[session_id] = model.start_chat(history=[])
        
        chat_session = chat_sessions[session_id]
        
        # Send message and get response
        response = chat_session.send_message(message)
        
        return jsonify({
            'response': response.text,
            'session_id': session_id
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/new-chat', methods=['POST'])
def new_chat():
    try:
        data = request.get_json()
        session_id = data.get('session_id', 'default')
        
        # Create new chat session
        chat_sessions[session_id] = model.start_chat(history=[])
        
        return jsonify({
            'message': 'New chat session created',
            'session_id': session_id
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'model': 'gemini-1.5-flash'})

if __name__ == '__main__':
    print("Starting Botiverse Server...")
    print(f"API Key loaded: {'✓' if API_KEY else '✗'}")
    app.run(debug=True, host='0.0.0.0', port=4000)