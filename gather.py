#!/usr/bin/env python3
import sys

def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <output_file>", file=sys.stderr)
        sys.exit(1)
        
    output_file = sys.argv[1]
    
    # Read from stdin (piped content)
    content = sys.stdin.read()
    
    # Write to output file
    with open(output_file, 'w') as f:
        f.write(content)
    
    print(f"Thinking written to {output_file}", file=sys.stderr)

if __name__ == "__main__":
    main()