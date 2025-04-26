import sys
import time
import threading
import signal
import json
from decision_schema import Decision

def spinner_thread(stop_event):
    """Display a spinning animation in the terminal."""
    spinner = ['|', '/', '-', '\\']
    i = 0
    while not stop_event.is_set():
        sys.stderr.write(f"\r[{spinner[i % len(spinner)]}] Processing...")
        sys.stderr.flush()
        i += 1
        time.sleep(0.1)
    # Clear the spinner line when done
    sys.stderr.write("\r" + " " * 30 + "\r")
    sys.stderr.flush()

def signal_handler(sig, frame):
    """Handle Ctrl+C gracefully."""
    print("\nInterrupted by user. Exiting...", file=sys.stderr)
    sys.exit(1)

def main():
    signal.signal(signal.SIGINT, signal_handler)
    
    # Create and start the spinner thread
    stop_spinner = threading.Event()
    spinner = threading.Thread(target=spinner_thread, args=(stop_spinner,))
    spinner.daemon = True
    spinner.start()
    
    # Read all input as a single string
    try:
        input_data = sys.stdin.read()
    except KeyboardInterrupt:
        stop_spinner.set()
        spinner.join()
        print("\nInterrupted by user. Exiting...", file=sys.stderr)
        sys.exit(1)
    
    # Stop the spinner
    stop_spinner.set()
    spinner.join()
    
    # Try to extract JSON from input (even if embedded in other text)
    try:
        # Try to find JSON content between triple backticks or regular JSON
        import re
        json_match = re.search(r'```json\s*(.*?)\s*```', input_data, re.DOTALL)
        
        if json_match:
            json_str = json_match.group(1).strip()
        else:
            # Try to find anything that looks like JSON
            json_str = input_data.strip()
            
        json_data = json.loads(json_str)
        
        # Be more permissive by handling variations in input format
        if "tool_name" in json_data and "parameters" in json_data:
            # Convert from the format in thinking.txt to the expected format
            tool_call = {"name": json_data["tool_name"], "args": json_data["parameters"]}
            json_data = {"tool_call": tool_call}
        
        decision = Decision(**json_data)
        
        # Use the validated JSON string for saving
        validated_json_str = json_str
            
    except json.JSONDecodeError:
        print("Error: Could not extract valid JSON from input", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: Input does not match Decision schema: {str(e)}", file=sys.stderr)
        sys.exit(1)
    
    # Write validated JSON to decision.txt
    with open("decision.txt", 'w') as f:
        f.write(validated_json_str)
    
    print("Decision validated and saved to decision.txt", file=sys.stderr)

if __name__ == "__main__":
    main()
