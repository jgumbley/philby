#!/usr/bin/env python3
import sys
import os
import datetime
import html
import xml.etree.ElementTree as ET

def read_file_content(filename):
    try:
        with open(filename, 'r') as f:
            return f.read()
    except FileNotFoundError:
        return ""

def sanitize_for_xml(text):
    return html.escape(text)

def create_entry(task_content, observations_content, thinking_content, action_content):
    root = ET.Element("entry")
    root.set("timestamp", datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    
    task = ET.SubElement(root, "task")
    task.text = sanitize_for_xml(task_content)
    
    if observations_content.strip():
        observations = ET.SubElement(root, "observations")
        observations.text = sanitize_for_xml(observations_content)
    
    if thinking_content.strip():
        thinking = ET.SubElement(root, "thinking")
        thinking.text = sanitize_for_xml(thinking_content)
    
    if action_content.strip():
        action = ET.SubElement(root, "action")
        action.text = sanitize_for_xml(action_content)
    
    return root

def create_history_xml(entry):
    root = ET.Element("history")
    root.append(entry)
    return root

def write_to_file(root, filename):
    xml_str = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="utf-8").decode('utf-8')
    with open(filename, 'w', encoding="utf-8") as f:
        f.write(xml_str)
    return xml_str

def main():
    stdin_content = ""
    if not sys.stdin.isatty():
        stdin_content = sys.stdin.read()
    
    task_file = sys.argv[1] if len(sys.argv) > 1 else "task.txt"
    observations_file = sys.argv[2] if len(sys.argv) > 2 else "observations.txt"
    thinking_file = sys.argv[3] if len(sys.argv) > 3 else "thinking.txt"
    action_file = sys.argv[4] if len(sys.argv) > 4 else "action.txt"
    history_file = sys.argv[5] if len(sys.argv) > 5 else "history.xml"
    
    task_content = read_file_content(task_file)
    observations_content = read_file_content(observations_file)
    thinking_content = read_file_content(thinking_file)
    action_content = read_file_content(action_file)
    
    if stdin_content.strip():
        thinking_content = stdin_content
    
    entry = create_entry(task_content, observations_content, thinking_content, action_content)
    history_root = create_history_xml(entry)
    
    write_to_file(history_root, history_file)
    write_to_file(entry, "/dev/stdout")

if __name__ == "__main__":
    main()