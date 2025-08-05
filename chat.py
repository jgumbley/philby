"""
Minimal chat interface with todo tools.
"""

import os
import json
import re
import random
import dspy


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


def run_make_target(target: str) -> str:
    """Run a Makefile target"""
    import subprocess
    try:
        result = subprocess.run(['make', target], capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            return f"Successfully ran 'make {target}'\nOutput: {result.stdout}"
        else:
            return f"Error running 'make {target}'\nError: {result.stderr}"
    except subprocess.TimeoutExpired:
        return f"Timeout running 'make {target}'"
    except Exception as e:
        return f"Failed to run 'make {target}': {str(e)}"


def make_sparkle() -> str:
    """Clean cache files"""
    return run_make_target("sparkle")


def make_log() -> str:
    """Show llm logs"""
    return run_make_target("log")


def make_loop() -> str:
    """Run main processing loop"""
    return run_make_target("loop")


def make_new() -> str:
    """Clean task.txt for new task"""
    return run_make_target("new")


def make_fix() -> str:
    """Run claude to fix makefile issues"""
    return run_make_target("fix")


def make_digest() -> str:
    """Show project file contents"""
    return run_make_target("digest")


def make_ingest() -> str:
    """Copy digest to clipboard"""
    return run_make_target("ingest")


def make_system() -> str:
    """Run system.py"""
    return run_make_target("system")


def make_clean() -> str:
    """Remove venv and cache"""
    return run_make_target("clean")


def list_files(path: str = ".") -> str:
    """List files in directory"""
    import subprocess
    try:
        result = subprocess.run(['ls', '-la', path], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return f"Files in {path}:\n{result.stdout}"
        else:
            return f"Error listing files in {path}: {result.stderr}"
    except subprocess.TimeoutExpired:
        return f"Timeout listing files in {path}"
    except Exception as e:
        return f"Failed to list files in {path}: {str(e)}"


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
            elif tool_name == "make_sparkle":
                return make_sparkle()
            elif tool_name == "make_log":
                return make_log()
            elif tool_name == "make_loop":
                return make_loop()
            elif tool_name == "make_new":
                return make_new()
            elif tool_name == "make_fix":
                return make_fix()
            elif tool_name == "make_digest":
                return make_digest()
            elif tool_name == "make_ingest":
                return make_ingest()
            elif tool_name == "make_system":
                return make_system()
            elif tool_name == "make_clean":
                return make_clean()
            elif tool_name == "list_files":
                return list_files(args.get("path", "."))
            else:
                return f"Unknown tool: {tool_name}"
        except Exception as e:
            print(f"[DEBUG] Tool execution error: {e}")
    
    return ""


def setup_dspy():
    """Setup DSPy"""
    lm = dspy.LM(
        model="openai/llama",
        api_base=os.getenv("PHILBY_API_BASE"),
        api_key="123",
        max_tokens=200,
        timeout=10
    )
    dspy.configure(lm=lm)


def load_system_prompt() -> str:
    """Load system prompt from file"""
    try:
        with open("system_prompt.txt", 'r') as f:
            return f.read().strip()
    except FileNotFoundError:
        return "You are a helpful assistant with todo tools."


def chat_with_llm(message: str) -> str:
    """Simple LLM call"""
    system_prompt = load_system_prompt()
    
    # Simple prompt format
    prompt = f"System: {system_prompt}\n\nUser: {message}\n\nAssistant:"
    
    # Direct LLM call
    response = dspy.settings.lm(prompt)
    
    # Handle list response
    if isinstance(response, list):
        return response[0] if response else ""
    return str(response)


def main():
    """Main chat loop"""
    setup_dspy()
    
    # Random philby icon selection like in Makefile
    icons = ["🕵️", "🔒", "📡", "🗝️", "🥃"]
    icon = random.choice(icons)
    
    print(f"{icon} Philby Chat")
    print("Press Ctrl-C to exit")
    print("-" * 30)
    
    while True:
        try:
            # Random emoji for each user input
            user_emoji = random.choice(icons)
            user_input = input(f"\n{user_emoji} > ").strip()
            if user_input == "/todos":
                print("Assistant:", list_todos())
                continue
            
            # Get LLM response
            response = chat_with_llm(user_input)
            
            # Show raw response
            print(f"[RAW LLM RESPONSE]: {repr(response)}")
            
            # Try to execute any tools
            tool_result = execute_tool(response)
            
            if tool_result:
                print("Assistant:", tool_result)
            else:
                print("Assistant:", response)
                
        except KeyboardInterrupt:
            break
        except EOFError:
            break
    
    print("\nGoodbye!")


if __name__ == "__main__":
    main()
