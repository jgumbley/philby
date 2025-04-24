#!/usr/bin/env python3
import sys
import time
import threading
import signal

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
    
    print(f"Output written to {output_file}", file=sys.stderr)

if __name__ == "__main__":
    main()