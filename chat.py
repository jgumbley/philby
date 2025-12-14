"""
Minimal chat interface with todo tools.
"""

import os
import sys
import json
import re
import random
import dspy
from tools import execute_tool, list_todos


def setup_dspy():
    """Setup DSPy"""
    lm = dspy.LM(
        model="openai/llama",
        api_base=os.getenv("PHILBY_API_BASE"),
        api_key="123",
        max_tokens=4000,
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


class PurposeSignature(dspy.Signature):
    """State purpose for requested action"""
    request = dspy.InputField()
    purpose = dspy.OutputField()

class ToolCallSignature(dspy.Signature):
    """Generate tool call JSON after approval"""  
    request = dspy.InputField(desc="[[ ## request ## ]]")
    approval = dspy.InputField(desc="[[ ## approval ## ]]") 
    tool_call = dspy.OutputField(desc='JSON format: {"name":"make_wiretaps","arguments":{}}')

def chat_with_llm(message: str, conversation_history: list = None) -> str:
    """LLM call using DSPy signatures for tool execution"""
    if conversation_history is None:
        conversation_history = []
    
    # Build the full context for the LLM
    context_parts = []
    for msg in conversation_history:
        role = msg.get('role', 'unknown')
        content = msg.get('content', '')
        context_parts.append(f"{role}: {content}")
    
    if message:
        context_parts.append(f"user: {message}")
    
    full_context = "\n".join(context_parts)
    
    # Check if context shows approval pattern for tool execution
    has_approval = any(msg.get('content') == 'approved' for msg in conversation_history if msg.get('role') == 'user')
    
    if has_approval:
        # Use DSPy ToolCallSignature to generate tool call with full context
        tool_call_module = dspy.Predict(ToolCallSignature)
        result = tool_call_module(request=full_context, approval="approved")
        return result.tool_call
    else:
        # Use PurposeSignature to understand what the user wants
        purpose_module = dspy.Predict(PurposeSignature)
        result = purpose_module(request=full_context)
        return result.purpose


def red_bubble(text: str) -> str:
    """Create a red bubble for tool calls"""
    import re
    import textwrap
    
    # Red ANSI color codes
    BRIGHT_RED = '\033[31m'
    RESET = '\033[0m'
    BOLD = '\033[1m'
    
    # Function to strip ANSI codes for length calculation
    def strip_ansi(text):
        ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
        return ansi_escape.sub('', text)
    
    # Wrap text to reasonable width (80 chars max)
    wrapped_lines = []
    for line in text.split('\n'):
        if len(strip_ansi(line)) > 80:
            wrapped_lines.extend(textwrap.wrap(line, width=80, break_long_words=False, break_on_hyphens=False))
        else:
            wrapped_lines.append(line)
    
    # Create bubble border
    max_len = max(len(strip_ansi(line)) for line in wrapped_lines) if wrapped_lines else 0
    
    # Top border
    bubble = f"{BRIGHT_RED}╭{'─' * (max_len + 2)}╮{RESET}\n"
    
    # Content lines
    for line in wrapped_lines:
        visible_len = len(strip_ansi(line))
        padding = ' ' * (max_len - visible_len)
        bubble += f"{BRIGHT_RED}│ {BOLD}{line}{RESET}{BRIGHT_RED}{padding} │{RESET}\n"
    
    # Bottom border
    bubble += f"{BRIGHT_RED}╰{'─' * (max_len + 2)}╯{RESET}"
    
    return bubble

def purple_dream_bubble(text: str) -> str:
    """Create a clean purple speech bubble"""
    import re
    import textwrap
    
    # Purple/magenta ANSI color codes
    BRIGHT_PURPLE = '\033[35m'
    RESET = '\033[0m'
    BOLD = '\033[1m'
    
    # Function to strip ANSI codes for length calculation
    def strip_ansi(text):
        ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
        return ansi_escape.sub('', text)
    
    # Wrap text to reasonable width (80 chars max)
    wrapped_lines = []
    for line in text.split('\n'):
        if len(strip_ansi(line)) > 80:
            wrapped_lines.extend(textwrap.wrap(line, width=80, break_long_words=False, break_on_hyphens=False))
        else:
            wrapped_lines.append(line)
    
    # Create bubble border
    max_len = max(len(strip_ansi(line)) for line in wrapped_lines) if wrapped_lines else 0
    
    # Top border
    bubble = f"{BRIGHT_PURPLE}╭{'─' * (max_len + 2)}╮{RESET}\n"
    
    # Content lines
    for line in wrapped_lines:
        visible_len = len(strip_ansi(line))
        padding = ' ' * (max_len - visible_len)
        bubble += f"{BRIGHT_PURPLE}│ {BOLD}{line}{RESET}{BRIGHT_PURPLE}{padding} │{RESET}\n"
    
    # Bottom border
    bubble += f"{BRIGHT_PURPLE}╰{'─' * (max_len + 2)}╯{RESET}"
    
    return bubble


def build_initial_context() -> list:
    """Build initial conversation context with system prompt and pre-approval flow"""
    system_message = {
        "role": "system",
        "content": """You are an agent that must first among everything adapt to failure and keep making progress. There is a step-wise ladder and you must represent the opportunity of progressing. You acknowledge the human is in control and may have a different understanding than you. Your first principal is to ensure you are aligned with the user. You should ask questions and seek consent before taking actions."""
    }
    
    # Pre-built conversation showing the approval pattern
    purpose_message = {
        "role": "assistant", 
        "content": "My purpose is to find the suspicious wiretap and report its identifier"
    }
    
    approval_message = {
        "role": "user",
        "content": "approved"
    }
    
    return [system_message, purpose_message, approval_message]

def main():
    """Main chat loop"""
    setup_dspy()
    
    # Random philby icon selection like in Makefile
    icons = ["🕵️", "🔒", "📡", "🗝️", "🥃"]
    icon = random.choice(icons)
    
    print(f"{icon} Philby Chat")
    print("Press Ctrl-C to exit")
    print("-" * 30)
    
    # Start with pre-built conversation context
    conversation_history = build_initial_context()
    
    # Context ends with "approved" - assistant should respond with tool call immediately
    response = chat_with_llm("", conversation_history)
    print(red_bubble("tool call"))
    tool_result = execute_tool(response)
    if tool_result:
        print(purple_dream_bubble(tool_result))
        # Add tool result to conversation history so LLM can continue processing
        conversation_history.append({"role": "assistant", "content": tool_result})
        # Send tool result to LLM immediately for follow-up processing
        followup_response = chat_with_llm("", conversation_history)
        print(purple_dream_bubble(followup_response))
        conversation_history.append({"role": "assistant", "content": followup_response})
    else:
        print(purple_dream_bubble(response))
        conversation_history.append({"role": "assistant", "content": response})
    
    while True:
        try:
            # Random emoji for each user input
            user_emoji = random.choice(icons)
            user_input = input(f"\n{user_emoji} > ").strip()
            if user_input == "/todos":
                print(purple_dream_bubble(list_todos()))
                continue
            
            # Get LLM response with conversation history
            response = chat_with_llm(user_input, conversation_history)
            
            # Try to execute any tools
            tool_result = execute_tool(response)
            
            # Update conversation history
            conversation_history.append({"role": "user", "content": user_input})
            
            if tool_result:
                conversation_history.append({"role": "assistant", "content": tool_result})
                print(purple_dream_bubble(tool_result))
            else:
                conversation_history.append({"role": "assistant", "content": response})
                print(purple_dream_bubble(response))
                
        except KeyboardInterrupt:
            break
        except EOFError:
            break
    
    print("\nGoodbye!")


def run_non_interactive_demo() -> None:
    """Run a short, non-interactive chat demo for automation."""
    setup_dspy()
    conversation_history = build_initial_context()
    response = chat_with_llm("", conversation_history)
    print(purple_dream_bubble(response))


if __name__ == "__main__":
    if os.getenv("PHILBY_NON_INTERACTIVE"):
        run_non_interactive_demo()
        sys.exit(0)

    main()
