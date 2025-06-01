#!/usr/bin/env python3
import json
import sys
import os

try:
    if len(sys.argv) < 3:
        print("Usage: python execute_decision.py <decision_file> <output_file>")
        sys.exit(1)
    
    decision_file = sys.argv[1]
    output_file = sys.argv[2]
    
    # Read the decision file
    with open(decision_file, 'r') as f:
        decision_data = json.loads(f.read().strip())
    
    # Execute the decision
    result = ""
    
    # Handle the current decision format
    if decision_data.get("decision_type") == "Tool Call":
        tool_name = decision_data.get("tool_name")
        tool_args = decision_data.get("tool_arguments", {})
        
        if tool_name == "read_file":
            file_path = tool_args.get("file_path", "")
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"File {file_path} not found")
            with open(file_path, 'r') as f:
                result = f.read()
        
        elif tool_name == "write_file":
            file_path = tool_args.get("file_path", "")
            content = tool_args.get("content", "")
            with open(file_path, 'w') as f:
                f.write(content)
            result = f"Successfully wrote to {file_path}"
        
        elif tool_name == "list_files":
            directory = tool_args.get("directory", ".")
            files = os.listdir(directory)
            result = "\n".join(files)
        
        else:
            raise ValueError(f"Unknown tool: {tool_name}")
    
    elif decision_data.get("decision_type") == "Ask Handler":
        prompt = decision_data.get("prompt", "")
        result = f"Prompt: {prompt}"
    
    else:
        raise ValueError("Decision must contain either tool_call or ask_handler")
    
    # Only write result to output file if we reach here (no exceptions)
    with open(output_file, 'w') as f:
        f.write(result)

except Exception as e:
    # Log error to console and exit with error code
    print(f"Error: {e}")
    sys.exit(1)