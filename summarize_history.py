#!/usr/bin/env python3
import sys
import os
import xml.etree.ElementTree as ET
import datetime

def summarize_history(history_file, output_file):
    """
    Create a summary of the task history from history.xml
    Formats it in a way that is easily parsable by an LLM
    """
    if not os.path.exists(history_file):
        with open(output_file, 'w') as f:
            f.write("No history available yet.")
        return
    
    try:
        # Parse the XML history file
        tree = ET.parse(history_file)
        root = tree.getroot()
        
        # Start building the summary
        summary = ["# Task History Summary", ""]
        
        # Process each entry
        for i, entry in enumerate(root.findall('entry')):
            # Get entry attributes
            timestamp = entry.get('timestamp', 'Unknown time')
            entry_id = entry.get('id', f'Step {i+1}')
            sequence = entry.get('sequence', str(i+1))
            
            # Get entry content
            task_elem = entry.find('task')
            task = task_elem.text.strip() if task_elem is not None and task_elem.text else "No task specified"
            
            # Extract just the core task text, removing metadata lines
            task_lines = task.split('\n')
            core_task = task_lines[-1] if len(task_lines) > 0 else task
            if "---This is your task---" in task:
                for j, line in enumerate(task_lines):
                    if "---This is your task---" in line and j+1 < len(task_lines):
                        core_task = task_lines[j+1]
                        break
            
            # Add entry header
            summary.append(f"## Step {sequence}: {core_task}")
            summary.append(f"Time: {timestamp}")
            
            # Summarize thinking
            thinking_elem = entry.find('thinking')
            if thinking_elem is not None and thinking_elem.text:
                thinking_text = thinking_elem.text.strip()
                thinking_lines = thinking_text.split('\n')
                # Get the first few non-empty lines as a summary
                thinking_summary = []
                line_count = 0
                for line in thinking_lines:
                    if line.strip() and line_count < 2:  # Limit to 2 non-empty lines
                        thinking_summary.append(line.strip())
                        line_count += 1
                if thinking_summary:
                    summary.append("Thinking: " + " ".join(thinking_summary))
            
            # Summarize action
            action_elem = entry.find('action')
            if action_elem is not None and action_elem.text:
                action_text = action_elem.text.strip()
                action_lines = action_text.split('\n')
                # Get just the first line or two
                action_summary = action_lines[0] if action_lines else ""
                if action_summary:
                    summary.append("Action: " + action_summary)
            
            summary.append("")  # Add blank line between entries
        
        # Write the summary to the output file
        with open(output_file, 'w') as f:
            f.write("\n".join(summary))
            
    except Exception as e:
        # Handle any errors
        with open(output_file, 'w') as f:
            f.write(f"Error creating history summary: {str(e)}")

def fix_malformed_xml(xml_file):
    """Try to fix malformed XML by reading and cleaning it"""
    try:
        with open(xml_file, 'r') as f:
            content = f.read()
            
        # Find the first complete entry
        if '<entry' in content and '</entry>' in content:
            start = content.find('<entry')
            end = content.find('</entry>') + len('</entry>')
            fixed_content = content[start:end]
            
            # Wrap in a root element if needed
            if not fixed_content.startswith('<history>'):
                fixed_content = f"<history>{fixed_content}</history>"
                
            return fixed_content
    except:
        pass
    
    return None

if __name__ == "__main__":
    history_file = sys.argv[1] if len(sys.argv) > 1 else "history.xml"
    
    if not os.path.exists(history_file):
        print("No history available yet.")
    else:
        try:
            # Try to parse the XML file
            try:
                tree = ET.parse(history_file)
                root = tree.getroot()
            except ET.ParseError:
                # Try to fix malformed XML
                fixed_xml = fix_malformed_xml(history_file)
                if fixed_xml:
                    root = ET.fromstring(fixed_xml)
                else:
                    raise Exception("Could not parse or fix XML")
            
            # Start building the summary
            summary = ["# Task History Summary", ""]
            
            # Process each entry
            for i, entry in enumerate(root.findall('entry')):
                # Get entry attributes
                timestamp = entry.get('timestamp', 'Unknown time')
                entry_id = entry.get('id', f'Step {i+1}')
                sequence = entry.get('sequence', str(i+1))
                
                # Get entry content
                task_elem = entry.find('task')
                task = task_elem.text.strip() if task_elem is not None and task_elem.text else "No task specified"
                
                # Extract just the core task text, removing metadata lines
                task_lines = task.split('\n')
                core_task = task_lines[-1] if len(task_lines) > 0 else task
                if "---This is your task---" in task:
                    for j, line in enumerate(task_lines):
                        if "---This is your task---" in line and j+1 < len(task_lines):
                            core_task = task_lines[j+1]
                            break
                
                # Add entry header
                summary.append(f"## Step {sequence}: {core_task}")
                summary.append(f"Time: {timestamp}")
                
                # Summarize thinking
                thinking_elem = entry.find('thinking')
                if thinking_elem is not None and thinking_elem.text:
                    thinking_text = thinking_elem.text.strip()
                    thinking_lines = thinking_text.split('\n')
                    # Get the first few non-empty lines as a summary
                    thinking_summary = []
                    line_count = 0
                    for line in thinking_lines:
                        if line.strip() and line_count < 2:  # Limit to 2 non-empty lines
                            thinking_summary.append(line.strip())
                            line_count += 1
                    if thinking_summary:
                        summary.append("Thinking: " + " ".join(thinking_summary))
                
                # Summarize action
                action_elem = entry.find('action')
                if action_elem is not None and action_elem.text:
                    action_text = action_elem.text.strip()
                    action_lines = action_text.split('\n')
                    # Get just the first line or two
                    action_summary = action_lines[0] if action_lines else ""
                    if action_summary:
                        summary.append("Action: " + action_summary)
                
                summary.append("")  # Add blank line between entries
            
            # Print the summary to stdout for piping
            print("\n".join(summary))
                
        except Exception as e:
            # Handle any errors
            print(f"Error creating history summary: {str(e)}")