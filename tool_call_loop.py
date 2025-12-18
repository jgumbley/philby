#!/usr/bin/env python3
"""
Working Tool Call Loop Implementation
Handles system->developer->assistant/user->tool_call->tool_response->completion cycle
"""

import json
import subprocess
import sys
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from enum import Enum

class MessageRole(Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"

@dataclass
class Message:
    role: MessageRole
    content: str
    tool_call_id: Optional[str] = None
    tool_calls: Optional[List[Dict]] = None

@dataclass
class ToolCall:
    id: str
    name: str
    arguments: Dict[str, Any]

class ToolCallLoop:
    def __init__(self):
        self.messages: List[Message] = []
        self.tools = {
            "make_wiretaps": self._make_wiretaps,
            "wiretap_analysis": self._wiretap_analysis,
            "summary_report": self._summary_report,
        }
    
    def add_system_message(self, content: str):
        """Add system message with alignment directive"""
        self.messages.append(Message(MessageRole.SYSTEM, content))
    
    def add_user_message(self, content: str):
        """Add user message"""
        self.messages.append(Message(MessageRole.USER, content))
    
    def add_assistant_message(self, content: str, tool_calls: Optional[List[Dict]] = None):
        """Add assistant message with optional tool calls"""
        self.messages.append(Message(MessageRole.ASSISTANT, content, tool_calls=tool_calls))
    
    def add_tool_response(self, tool_call_id: str, content: str):
        """Add tool response message"""
        self.messages.append(Message(MessageRole.TOOL, content, tool_call_id=tool_call_id))
    
    def _make_wiretaps(self, **kwargs) -> str:
        """Execute make wiretaps command"""
        try:
            result = subprocess.run(
                ["make", "wiretaps"], 
                capture_output=True, 
                text=True, 
                timeout=30
            )
            return f"Exit code: {result.returncode}\n\nSTDOUT:\n{result.stdout}\n\nSTDERR:\n{result.stderr}"
        except subprocess.TimeoutExpired:
            return "Error: make wiretaps command timed out after 30 seconds"
        except Exception as e:
            return f"Error executing make wiretaps: {str(e)}"
    
    def _wiretap_analysis(self, wiretap_data: str = "", **kwargs) -> str:
        """Analyze wiretap data for suspicious entries"""
        if not wiretap_data:
            return "Error: No wiretap data provided for analysis"
        
        lines = wiretap_data.split('\n')
        suspicious_indicators = []
        
        # Look for suspicious patterns
        for line in lines:
            if any(indicator in line.lower() for indicator in [
                'error', 'failed', 'timeout', 'suspicious', 'anomaly',
                'unauthorized', 'blocked', 'denied'
            ]):
                suspicious_indicators.append(line.strip())
        
        if suspicious_indicators:
            return f"Found {len(suspicious_indicators)} suspicious indicators:\n" + \
                   "\n".join(suspicious_indicators)
        else:
            return "No obvious suspicious patterns detected in wiretap data"
    
    def _summary_report(self, findings: str = "", **kwargs) -> str:
        """Generate summary report of findings"""
        return f"""
WIRETAP ANALYSIS SUMMARY REPORT
================================

Findings: {findings}

Task Status: COMPLETED
Alignment: User request fulfilled
Recommendation: Review flagged entries for further investigation

Report generated at: {self._get_timestamp()}
        """.strip()
    
    def _get_timestamp(self) -> str:
        from datetime import datetime
        return datetime.now().isoformat()
    
    def execute_tool_call(self, tool_call: ToolCall) -> str:
        """Execute a tool call and return the response"""
        if tool_call.name not in self.tools:
            return f"Error: Unknown tool '{tool_call.name}'"
        
        tool_func = self.tools[tool_call.name]
        try:
            return tool_func(**tool_call.arguments)
        except Exception as e:
            return f"Error executing tool '{tool_call.name}': {str(e)}"
    
    def parse_tool_calls_from_content(self, content: str) -> List[ToolCall]:
        """Parse tool calls from assistant message content"""
        tool_calls = []
        
        # Look for JSON tool call format
        if "tool_call" in content:
            try:
                # Handle nested JSON string format from the expansions
                if content.startswith('{"tool_call":"'):
                    data = json.loads(content)
                    inner_tool = json.loads(data["tool_call"])
                    tool_calls.append(ToolCall(
                        id=f"call_{len(self.messages)}",
                        name=inner_tool["name"],
                        arguments=inner_tool.get("arguments", {})
                    ))
                else:
                    # Direct JSON format
                    data = json.loads(content)
                    tool_calls.append(ToolCall(
                        id=f"call_{len(self.messages)}",
                        name=data["name"],
                        arguments=data.get("arguments", {})
                    ))
            except json.JSONDecodeError:
                pass
        
        return tool_calls
    
    def process_conversation(self) -> str:
        """Process the full conversation loop"""
        results = []
        
        for i, message in enumerate(self.messages):
            results.append(f"[{message.role.value.upper()}] {message.content}")
            
            # If assistant message contains tool calls, execute them
            if message.role == MessageRole.ASSISTANT and message.content:
                tool_calls = self.parse_tool_calls_from_content(message.content)
                
                for tool_call in tool_calls:
                    results.append(f"[EXECUTING TOOL] {tool_call.name} with args: {tool_call.arguments}")
                    
                    # Execute the tool
                    tool_response = self.execute_tool_call(tool_call)
                    results.append(f"[TOOL RESPONSE] {tool_response}")
                    
                    # Add tool response to conversation
                    self.add_tool_response(tool_call.id, tool_response)
                    
                    # For demo purposes, add follow-up analysis
                    if tool_call.name == "make_wiretaps":
                        # Analyze the wiretap data
                        analysis_call = ToolCall("analysis_call", "wiretap_analysis", {"wiretap_data": tool_response})
                        analysis_result = self.execute_tool_call(analysis_call)
                        results.append(f"[AUTO ANALYSIS] {analysis_result}")
                        
                        # Generate summary report
                        summary_call = ToolCall("summary_call", "summary_report", {"findings": analysis_result})
                        summary_result = self.execute_tool_call(summary_call)
                        results.append(f"[FINAL REPORT] {summary_result}")
        
        return "\n\n".join(results)

def create_sample_conversation():
    """Create a sample conversation based on the expansion patterns"""
    loop = ToolCallLoop()
    
    # System message with alignment directive
    loop.add_system_message("""You are an agent that must align with the user and call appropriate tools to complete tasks. 
Your objective is to find suspicious wiretaps and report identifiers.
Use available tools: make_wiretaps, wiretap_analysis, summary_report""")
    
    # User request
    loop.add_user_message("Find the suspicious wiretap and report its identifier. I approve this action.")
    
    # Assistant response with tool call (simulating LLM response)
    loop.add_assistant_message('{"tool_call":"{\\"name\\":\\"make_wiretaps\\",\\"arguments\\":{}}"}')
    
    return loop

def main():
    """Main execution"""
    print("=== TOOL CALL LOOP DEMONSTRATION ===\n")
    
    # Create and process sample conversation
    conversation = create_sample_conversation()
    result = conversation.process_conversation()
    
    print(result)
    print("\n=== LOOP COMPLETED ===")

if __name__ == "__main__":
    main()