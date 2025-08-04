"""
Minimal chat interface with todo tools.
"""

import os
import json
import re
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


def execute_tool(response: str) -> str:
    """Extract and execute tool calls from response"""
    # Look for JSON in the response
    json_match = re.search(r'\{.*?"name".*?\}', response)
    print(f"[DEBUG] JSON match: {json_match}")
    if not json_match:
        return ""
    
    try:
        tool_data = json.loads(json_match.group())
        print(f"[DEBUG] Parsed tool data: {tool_data}")
        tool_name = tool_data.get("name", "")
        args = tool_data.get("arguments", {})
        
        if tool_name == "add_todo":
            return add_todo(args.get("item", ""))
        elif tool_name == "list_todos":
            return list_todos()
        else:
            return f"Unknown tool: {tool_name}"
    except Exception as e:
        print(f"[DEBUG] Tool execution error: {e}")
        return ""


def setup_dspy():
    """Setup DSPy"""
    lm = dspy.LM(
        model="openai/qwen3-30b-a3b-instruct-2507/model.gguf",
        api_base="http://hal:8080/v1",
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
    
    print("🤖 Simple Chat")
    print("Type /quit to exit")
    print("-" * 30)
    
    while True:
        try:
            user_input = input("\nYou: ").strip()
            
            if user_input == "/quit":
                break
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