import sys
import time
import threading
import itertools

def spinner_thread(stop_event):
    # Final Fantasy/Persona 3 inspired spinner frames
    frames = ["✨", "🌙", "⚔️", "🔮", "💫", "⭐", "🌟", "🪄"]
    for frame in itertools.cycle(frames):
        if stop_event.is_set():
            break
        sys.stderr.write(f"\r[{frame}] Gathering wisdom... ")
        sys.stderr.flush()
        time.sleep(0.2)
    sys.stderr.write("\r                          \r")
    sys.stderr.flush()

def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <output_file>", file=sys.stderr)
        sys.exit(1)
        
    output_file = sys.argv[1]
    
    # Start the spinner in a separate thread
    stop_spinner = threading.Event()
    spinner = threading.Thread(target=spinner_thread, args=(stop_spinner,))
    spinner.start()
    
    try:
        # Read from stdin (piped content)
        content = sys.stdin.read()
        
        # Write to output file
        with open(output_file, 'w') as f:
            f.write(content)
    finally:
        # Stop the spinner
        stop_spinner.set()
        spinner.join()
    
if __name__ == "__main__":
    main()
