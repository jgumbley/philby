#!/usr/bin/env python3
import sys
import os
import datetime
import xml.dom.minidom as md
import xml.etree.ElementTree as ET

def read_file_content(filename):
    """Read file content or return empty string if file doesn't exist"""
    try:
        with open(filename, 'r') as f:
            return f.read()
    except FileNotFoundError:
        return ""

def create_entry(task_content, observations_content, thinking_content, action_content):
    """Create an XML entry with the provided content"""
    root = ET.Element("entry")
    root.set("timestamp", datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    
    # Add task
    task = ET.SubElement(root, "task")
    task.text = task_content
    
    # Add observations if not empty
    if observations_content.strip():
        observations = ET.SubElement(root, "observations")
        observations.text = observations_content
    
    # Add thinking if not empty
    if thinking_content.strip():
        thinking = ET.SubElement(root, "thinking")
        thinking.text = thinking_content
    
    # Add action if not empty
    if action_content.strip():
        action = ET.SubElement(root, "action")
        action.text = action_content
    
    return root

def append_to_history(entry, history_file):
    """Append entry to history file, ensuring proper XML structure"""
    # Create root element if file doesn't exist
    if not os.path.exists(history_file):
        root = ET.Element("history")
        root.append(entry)
    else:
        try:
            # Parse existing file
            tree = ET.parse(history_file)
            root = tree.getroot()
            
            # Append new entry to existing root
            root.append(entry)
        except ET.ParseError:
            # File exists but is not valid XML, create new root with this entry
            root = ET.Element("history")
            root.append(entry)
    
    # Pretty print XML
    xmlstr = md.parseString(ET.tostring(root)).toprettyxml(indent="  ")
    
    # Write back to file
    with open(history_file, 'w') as f:
        f.write(xmlstr)

def main():
    # Read from stdin
    stdin_content = ""
    if not sys.stdin.isatty():
        stdin_content = sys.stdin.read()
    
    # Get file paths from command line or use defaults
    task_file = sys.argv[1] if len(sys.argv) > 1 else "task.txt"
    observations_file = sys.argv[2] if len(sys.argv) > 2 else "observations.txt"
    thinking_file = sys.argv[3] if len(sys.argv) > 3 else "thinking.txt"
    action_file = sys.argv[4] if len(sys.argv) > 4 else "action.txt"
    history_file = sys.argv[5] if len(sys.argv) > 5 else "history.xml"
    
    # Read content from files
    task_content = read_file_content(task_file)
    observations_content = read_file_content(observations_file)
    thinking_content = read_file_content(thinking_file)
    action_content = read_file_content(action_file)
    
    # If stdin has content, use it as thinking content
    if stdin_content.strip():
        thinking_content = stdin_content
    
    # Create entry
    entry = create_entry(task_content, observations_content, thinking_content, action_content)
    
    # Append to history
    append_to_history(entry, history_file)
    
    # Output XML to stdout
    xmlstr = md.parseString(ET.tostring(entry)).toprettyxml(indent="  ")
    print(xmlstr)

if __name__ == "__main__":
    main()