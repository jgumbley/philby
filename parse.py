#!/usr/bin/env python3
"""
DSPy-enhanced version of parse.py with MCP-style context management.
Maintains file-based interface while adding structured output capabilities.
"""

import sys
import time
import threading
import signal
import json
import re
from typing import Optional, Dict, Any, Union
from datetime import datetime

import dspy
from decision_schema import Decision, ToolCall, AskHandler


class JSONExtractionSignature(dspy.Signature):
    """Extract and validate JSON decision from thinking text with MCP-style context awareness"""
    
    # Input context
    thinking_text = dspy.InputField(desc="The raw thinking text containing decision JSON")
    available_context = dspy.InputField(desc="Available context types for MCP requests", default="file_content, history_turns")
    
    # Outputs
    extracted_json = dspy.OutputField(desc="The extracted JSON decision object", format="json")
    confidence = dspy.OutputField(desc="Confidence in extraction (0.0-1.0)", format="float")
    context_requests = dspy.OutputField(desc="MCP-style context requests if needed", default="none")


class MCPParsingModule(dspy.Module):
    """DSPy module for parsing with MCP-style context management"""
    
    def __init__(self):
        super().__init__()
        self.extractor = dspy.ChainOfThought(JSONExtractionSignature)
        
    def forward(self, thinking_text: str) -> Dict[str, Any]:
        """
        Extract JSON decision from thinking text.
        Returns dict with 'success', 'decision', 'confidence', 'context_requests'
        """
        try:
            # First attempt: Let DSPy try to extract structured JSON
            result = self.extractor(
                thinking_text=thinking_text,
                available_context="file_content, history_turns, tool_documentation"
            )
            
            # Parse the extracted JSON
            if isinstance(result.extracted_json, str):
                decision_data = json.loads(result.extracted_json)
            else:
                decision_data = result.extracted_json
                
            # Handle legacy format conversion (maintain backward compatibility)
            if "tool_name" in decision_data and "parameters" in decision_data:
                tool_call = {
                    "name": decision_data["tool_name"], 
                    "args": decision_data["parameters"]
                }
                decision_data = {"tool_call": tool_call}
            
            # Validate against Pydantic schema
            decision = Decision(**decision_data)
            
            return {
                "success": True,
                "decision": decision,
                "confidence": float(result.confidence),
                "context_requests": result.context_requests,
                "raw_json": decision.model_dump_json(indent=2)
            }
            
        except json.JSONDecodeError as e:
            return {
                "success": False,
                "error": f"Invalid JSON structure: {e}",
                "confidence": 0.0
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"Schema validation failed: {e}",
                "confidence": 0.0
            }


class FallbackRegexParser:
    """Fallback parser using original regex logic for compatibility"""
    
    @staticmethod
    def extract_json(input_data: str) -> Dict[str, Any]:
        """Extract JSON using original regex approach"""
        # Try to find JSON content between triple backticks first
        json_match = re.search(r'```json\s*(.*?)\s*```', input_data, re.DOTALL)
        
        if json_match:
            json_str = json_match.group(1).strip()
        else:
            # Try to find anything that looks like JSON (pure JSON input)
            json_str = input_data.strip()
            
        try:
            json_data = json.loads(json_str)
            
            # Handle legacy format conversion
            if "tool_name" in json_data and "parameters" in json_data:
                tool_call = {"name": json_data["tool_name"], "args": json_data["parameters"]}
                json_data = {"tool_call": tool_call}
            
            # Validate with Pydantic
            decision = Decision(**json_data)
            return {
                "success": True,
                "decision": decision,
                "raw_json": decision.model_dump_json(indent=2)
            }
            
        except (json.JSONDecodeError, Exception) as e:
            return {
                "success": False,
                "error": str(e)
            }


def spinner_thread(stop_event):
    """Display a spinning animation in the terminal with MCP-style icons"""
    # MCP-inspired spinner with context/protocol icons
    spinner = ['🔄', '📡', '🔍', '⚡', '🎯', '✨']
    message = "Processing with DSPy+MCP..."
    sleep_time = 0.15
    
    i = 0
    while not stop_event.is_set():
        sys.stderr.write(f"\r[{spinner[i % len(spinner)]}] {message}")
        sys.stderr.flush()
        i += 1
        time.sleep(sleep_time)
    # Clear the spinner line when done
    sys.stderr.write("\r" + " " * (len(message) + 10) + "\r")
    sys.stderr.flush()


def signal_handler(sig, frame):
    """Handle Ctrl+C gracefully"""
    print("\nInterrupted by user. Exiting DSPy+MCP parser...", file=sys.stderr)
    sys.exit(1)


def main():
    """Main parser with DSPy+MCP capabilities and fallback"""
    signal.signal(signal.SIGINT, signal_handler)
    
    # Create and start the enhanced spinner thread
    stop_spinner = threading.Event()
    spinner = threading.Thread(target=spinner_thread, args=(stop_spinner,))
    spinner.daemon = True
    spinner.start()
    
    try:
        # Read all input
        input_data = sys.stdin.read()
    except KeyboardInterrupt:
        stop_spinner.set()
        spinner.join()
        print("\nInterrupted by user. Exiting...", file=sys.stderr)
        sys.exit(1)
    
    # Stop the spinner
    stop_spinner.set()
    spinner.join()
    
    # Parse with DSPy+MCP
    try:
        # TODO: Initialize DSPy with proper LLM configuration
        # dspy_parser = MCPParsingModule()
        # result = dspy_parser.forward(input_data)
        
        # For now, use fallback but with DSPy structure ready
        print("DSPy+MCP parser ready (using fallback logic)", file=sys.stderr)
        fallback_parser = FallbackRegexParser()
        result = fallback_parser.extract_json(input_data)
        
        # Handle results
        if result["success"]:
            # Write the validated JSON to decision.txt
            with open("decision.txt", 'w') as f:
                f.write(result["raw_json"])
            
            print("Decision validated and saved to decision.txt (DSPy+MCP)", file=sys.stderr)
            sys.exit(0)
        else:
            print(f"Error: {result['error']}", file=sys.stderr)
            sys.exit(1)
            
    except Exception as e:
        print(f"DSPy+MCP parser error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
