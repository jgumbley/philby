# parse_llm_tool_call.py
import sys
import re
import json

def main():
    # Collect the entire LLM response from stdin
    llm_output = sys.stdin.read()

    print("----- LLM OUTPUT START -----")
    print(llm_output)
    print("----- LLM OUTPUT END -------\n")

    # 1. Look for a <toolName>...</toolName> pattern or parse out JSON
    #    Here's a naive example for <read_file>{"filepath": "foo.txt"}</read_file>
    tool_pattern = r"<(\w+)>(.*?)</\1>"
    matches = re.findall(tool_pattern, llm_output, flags=re.DOTALL)

    if not matches:
        print("No tool calls found. Exiting.")
        return

    # If multiple tool calls, handle them in sequence (or however you prefer).
    for (tool_name, raw_json) in matches:
        print(f"philby requested tool: {tool_name}")
        print(f"Metadata (raw): {raw_json}")

        # Attempt to parse the contents between the tags as JSON
        try:
            metadata = json.loads(raw_json)
        except json.JSONDecodeError:
            print("Could not parse tool metadata as JSON. Skipping.")
            continue

        # 3. Execute the tool without confirmation (automated workflow)
        #    This is where you'd dispatch to your actual tool logic
        #    (like read_file, write_file, etc.)
        result = run_tool(tool_name, metadata)

        # 4. Provide result or error
        print("Tool result:")
        print(result)

def run_tool(tool_name, metadata):
    """
    Dispatch to actual tool logic. 
    Could call your specialized 'read_file.py' or other scripts,
    or do the work inline here.
    """
    # Primary workflow tools
    if tool_name == "ANALYZE":
        filepath = metadata.get("filepath")
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            return f"Error reading {filepath}: {e}"

    elif tool_name == "SELECT":
        filepath = metadata.get("filepath")
        content = metadata.get("content", "")
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            return f"Successfully wrote to {filepath}"
        except Exception as e:
            return f"Error writing {filepath}: {e}"
    
    # MCP operation tools
    elif tool_name == "mcp__ask_user":
        question = metadata.get("question", "")
        return f"Question sent to user: {question}"
        
    elif tool_name == "mcp__get_env":
        var_name = metadata.get("var_name", "")
        return f"Environment variable: {var_name}"
        
    elif tool_name == "mcp__web_search":
        query = metadata.get("query", "")
        return f"Web search performed for: {query}"
        
    elif tool_name == "mcp__download_file":
        url = metadata.get("url", "")
        output_path = metadata.get("output_path", "")
        return f"Downloaded file from {url} to {output_path}"

    # ... handle other tools ...
    else:
        return f"Unknown tool: {tool_name}"

if __name__ == "__main__":
    main()
