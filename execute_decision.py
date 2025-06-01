#!/usr/bin/env python3
import json
import logging
import os
import sys
from typing import Dict, Any, Optional
from pydantic import ValidationError

from decision_schema import Decision, ToolCall, AskHandler

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class MCPServer:
    """
    MCP Server implementation that processes decision files
    and executes the appropriate actions.
    """
    
    def __init__(self, decision_file_path: str = "decision.txt"):
        """
        Initialize the MCP Server.
        
        Args:
            decision_file_path: Path to the decision file (default: decision.txt)
        """
        self.decision_file_path = decision_file_path
        logger.info(f"Initialized MCP Server with decision file: {decision_file_path}")
    
    def read_decision_file(self) -> Optional[Dict[str, Any]]:
        """
        Read and parse the decision file.
        
        Returns:
            Parsed JSON content or None if file doesn't exist or is invalid
        """
        try:
            if not os.path.exists(self.decision_file_path):
                logger.error(f"Decision file not found: {self.decision_file_path}")
                return None
                
            with open(self.decision_file_path, 'r') as f:
                content = f.read().strip()
                if not content:
                    logger.error("Decision file is empty")
                    return None
                
                return json.loads(content)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse decision file: {e}")
            return None
        except Exception as e:
            logger.error(f"Error reading decision file: {e}")
            return None
    
    def process_decision(self) -> Optional[str]:
        """
        Process the decision from the decision file.
        
        Returns:
            Result of the decision processing or None if processing failed
        """
        decision_data = self.read_decision_file()
        if not decision_data:
            return None
        
        try:
            # Parse the decision data into a Decision object
            decision = Decision(
                tool_call=ToolCall(
                    name=decision_data.get("tool_name", ""),
                    args=decision_data.get("tool_arguments", {})
                ) if decision_data.get("decision_type") == "Tool Call" else None,
                
                ask_handler=AskHandler(
                    prompt=decision_data.get("prompt", "")
                ) if decision_data.get("decision_type") == "Ask Handler" else None
            )
            
            # Process the decision
            result = self._execute_decision(decision)
            logger.info(f"Decision processed: {result}")
            return result
            
        except ValidationError as e:
            logger.error(f"Invalid decision format: {e}")
            return None
        except Exception as e:
            logger.error(f"Error processing decision: {e}")
            return None
    
    def _execute_decision(self, decision: Decision) -> str:
        """
        Execute the decision based on its type.
        
        Args:
            decision: The Decision object to execute
            
        Returns:
            Result of the executed decision
            
        Raises:
            ValueError: If the decision is invalid
        """
        if decision.tool_call:
            # Execute tool call
            tool_name = decision.tool_call.name
            tool_args = decision.tool_call.args
            
            logger.info(f"Executing tool: {tool_name} with args: {tool_args}")
            
            # Here we would implement the actual tool execution
            # For now, we'll just return a placeholder result
            if tool_name == "read_file":
                return self._execute_read_file(tool_args)
            else:
                return f"Tool '{tool_name}' executed with args: {tool_args}"
            
        elif decision.ask_handler:
            # Handle ask_handler
            prompt = decision.ask_handler.prompt
            logger.info(f"Handling prompt: {prompt}")
            return f"Prompt handled: {prompt}"
            
        else:
            error_msg = "Decision object must contain either tool_call or ask_handler"
            logger.error(error_msg)
            raise ValueError(error_msg)
    
    def _execute_read_file(self, args: Dict[str, Any]) -> str:
        """
        Execute the read_file tool.
        
        Args:
            args: Arguments for the read_file tool
            
        Returns:
            Content of the file or error message
        """
        file_path = args.get("file_path")
        if not file_path:
            return "Error: file_path is required"
        
        try:
            if not os.path.exists(file_path):
                return f"Error: File not found: {file_path}"
                
            with open(file_path, 'r') as f:
                content = f.read()
                return content
        except Exception as e:
            error_msg = f"Error reading file {file_path}: {e}"
            logger.error(error_msg)
            return error_msg
    
    def handle_decision_file(self, output_file: Optional[str] = "action.txt") -> bool:
        """
        Process the decision file and write the result to an output file.
        
        Args:
            output_file: Path to the output file (default: action.txt)
            
        Returns:
            True if the decision was processed successfully, False otherwise
        """
        result = self.process_decision()
        
        if result is None:
            logger.error("Failed to process decision")
            if output_file:
                with open(output_file, 'w') as f:
                    f.write("Failed to process decision")
            return False
        
        # Write the result to the output file if provided
        if output_file:
            with open(output_file, 'w') as f:
                f.write(result)
            logger.info(f"Result written to {output_file}")
            
        return True

def main():
    """
    Main entry point for the MCP Server.
    """
    # Check if an output file was specified
    output_file = None
    if len(sys.argv) > 1:
        decision_file = sys.argv[1]
    else:
        decision_file = "decision.txt"
        
    if len(sys.argv) > 2:
        output_file = sys.argv[2]
        
    server = MCPServer(decision_file)
    success = server.handle_decision_file(output_file)
    
    if not output_file:
        # If no output file was specified, print the result to stdout
        result = server.process_decision()
        if result:
            print(result)
        else:
            print("Failed to process decision")
    
    # Exit with appropriate status code
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()