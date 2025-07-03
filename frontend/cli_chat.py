import os
import google.generativeai as genai
from dotenv import load_dotenv

def main():
    # Load environment variables
    load_dotenv()
    
    # Get API key
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        print("❌ GEMINI_API_KEY not found!")
        print("Please create a .env file with your API key:")
        print("GEMINI_API_KEY=your_api_key_here")
        return
    
    # Configure Gemini
    genai.configure(api_key=api_key)
    
    # Configuration for free API
    generation_config = {
        "temperature": 0.7,
        "top_p": 0.95,
        "top_k": 40,
        "max_output_tokens": 2048,
    }
    
    # Initialize model
    model = genai.GenerativeModel(
        model_name="gemini-1.5-flash",
        generation_config=generation_config
    )
    
    # Start chat
    chat = model.start_chat(history=[])
    
    print("🤖 Botiverse CLI - Powered by Gemini")
    print("=" * 40)
    print("Type 'quit', 'exit', or 'bye' to end the chat")
    print("Type 'clear' to start a new conversation")
    print("=" * 40)
    
    while True:
        try:
            # Get user input
            user_input = input("\n💬 You: ").strip()
            
            # Check for exit commands
            if user_input.lower() in ['quit', 'exit', 'bye', 'q']:
                print("\n👋 Goodbye!")
                break
            
            # Check for clear command
            if user_input.lower() == 'clear':
                chat = model.start_chat(history=[])
                print("\n🔄 New conversation started!")
                continue
            
            # Skip empty input
            if not user_input:
                continue
            
            # Send message and get response
            print("\n🤖 Bot: ", end="", flush=True)
            response = chat.send_message(user_input)
            print(response.text)
            
        except KeyboardInterrupt:
            print("\n\n👋 Goodbye!")
            break
        except Exception as e:
            print(f"\n❌ Error: {e}")
            print("Please try again or type 'quit' to exit.")

if __name__ == "__main__":
    main()