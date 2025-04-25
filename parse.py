#!/usr/bin/env python3
import sys
import time
import threading
import signal
import re
import json

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

def process_tool_calls(content):
    """Process any tool calls found in the content."""
    text = ''.join(content)
    
    # Look for tool calls in format <toolName>...</toolName>
    tool_pattern = r"<(\w+)>(.*?)</\1>"
    matches = re.findall(tool_pattern, text, flags=re.DOTALL)
    
    for (tool_name, raw_json) in matches:
        print(f"Found tool call: {tool_name}", file=sys.stderr)
        
        # Attempt to parse the contents between the tags as JSON
        try:
            metadata = json.loads(raw_json)
        except json.JSONDecodeError:
            print(f"Could not parse tool metadata as JSON: {raw_json}", file=sys.stderr)
            continue
        
        # Handle specific tool calls
        if tool_name == "mark_task_done":
            reason = metadata.get("reason", "task complete")
            with open("done.txt", "w", encoding="utf-8") as f:
                f.write(reason + "\n")
            print(f"Task marked done: {reason}", file=sys.stderr)

def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <output_file>", file=sys.stderr)
        sys.exit(1)
    
    output_file = sys.argv[1]
    signal.signal(signal.SIGINT, signal_handler)
    
    # Create and start the spinner thread
    stop_spinner = threading.Event()
    spinner = threading.Thread(target=spinner_thread, args=(stop_spinner,))
    spinner.daemon = True
    spinner.start()
    
    # Process the input stream and save to output file
    content = []
    try:
        for line in sys.stdin:
            content.append(line)
    except KeyboardInterrupt:
        stop_spinner.set()
        spinner.join()
        print("\nInterrupted by user. Exiting...", file=sys.stderr)
        sys.exit(1)
    
    # Stop the spinner
    stop_spinner.set()
    spinner.join()
    
    # Write content to output file
    with open(output_file, 'w') as f:
        f.writelines(content)
    
    # Process any tool calls in the content
    process_tool_calls(content)
    
    print(f"Output written to {output_file}", file=sys.stderr)

if __name__ == "__main__":
    main()