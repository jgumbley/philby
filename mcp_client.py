from fastmcp import FastMCPClient
from decision_schema import Decision
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize the FastMCP client
client = FastMCPClient()


def process_decision(decision: Decision) -> str:
    """
    Process a Decision object by either:
    - Forwarding tool_call to FastMCP
    - Displaying ask_handler prompt
    
    Args:
        decision: Decision object containing either tool_call or ask_handler
        
    Returns:
        String result from the MCP call or prompt
    """
    if decision.tool_call:
        # Forward the tool call to FastMCP
        result = client.call_tool(
            decision.tool_call.name,
            decision.tool_call.args
        )
        logger.info(f"MCP tool call result: {result}")
        return result
    
    elif decision.ask_handler:
        # Log the prompt that would be sent to the handler
        prompt = decision.ask_handler.prompt
        logger.info(f"Ask handler prompt: {prompt}")
        return prompt
    
    else:
        error_msg = "Decision object must contain either tool_call or ask_handler"
        logger.error(error_msg)
        raise ValueError(error_msg)