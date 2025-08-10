"""
Tool calling logic for Philby chat.
"""

import os
import json
import subprocess


def _call_make(target: str, extra_args: list = None) -> str:
    """Prototype make caller for kong operations"""
    try:
        # Create a copy of current environment
        env = os.environ.copy()
        # Remove any virtual env variables that might interfere
        env.pop('VIRTUAL_ENV', None)
        env.pop('CONDA_DEFAULT_ENV', None)
        
        # Build command
        cmd = ['make', '-C', '../kong', target]
        if extra_args:
            cmd.extend(extra_args)
        
        # Execute with clean environment
        result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            return f"Make {target} complete:\n{result.stdout}"
        else:
            return f"Make {target} failed (code {result.returncode}):\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            
    except subprocess.TimeoutExpired:
        return f"Make {target} timed out"
    except Exception as e:
        return f"Failed to run make {target}: {str(e)}"


def add_todo(item: str) -> str:
    """Add item to todo list"""
    with open("todo.txt", 'a') as f:
        f.write(f"{item}\n")
    return f"Added '{item}' to todo list"


def list_todos() -> str:
    """List all todo items"""
    if not os.path.exists("todo.txt"):
        return "Todo list is empty"
    
    with open("todo.txt", 'r') as f:
        lines = [line.strip() for line in f.readlines() if line.strip()]
    
    if not lines:
        return "Todo list is empty"
    
    result = "Todo List:\n"
    for i, item in enumerate(lines, 1):
        result += f"{i}. {item}\n"
    return result.strip()


def make_wiretaps() -> str:
    """Analyze data for suspicious patterns using prototype caller"""
    return _call_make("wiretaps")


def make_wiretap(wiretap_id: str) -> str:
    """Analyze specific wiretap by ID using prototype caller"""
    if not wiretap_id:
        return "Error: wiretap_id is required"
    
    return _call_make("wiretap", [wiretap_id])


def execute_tool(response: str) -> str:
    """Extract and execute tool calls from response"""
    response = response.strip()
    
    # If response looks like JSON, try to parse it directly
    if response.startswith('{') and response.endswith('}'):
        try:
            tool_data = json.loads(response)
            print(f"[DEBUG] Parsed tool data: {tool_data}")
            
            tool_name = tool_data.get("name", "")
            args = tool_data.get("arguments", {})
            
            if tool_name == "add_todo":
                return add_todo(args.get("item", ""))
            elif tool_name == "list_todos":
                return list_todos()
            elif tool_name == "make_wiretaps":
                return make_wiretaps()
            elif tool_name == "make_wiretap":
                return make_wiretap(args.get("wiretap_id", ""))
            else:
                return f"Unknown tool: {tool_name}"
        except Exception as e:
            print(f"[DEBUG] Tool execution error: {e}")
    
    return ""