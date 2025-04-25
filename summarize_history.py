#!/usr/bin/env python3
import sys
import os
import subprocess
import json
import datetime

def run_git_command(cmd, cwd="memory"):
    """Run a git command and return the output"""
    try:
        result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, shell=True)
        if result.returncode != 0:
            return None
        return result.stdout.strip()
    except Exception as e:
        print(f"Error running git command: {cmd} - {str(e)}", file=sys.stderr)
        return None

def get_commit_list(limit=20, cwd="memory"):
    """Get list of commits from the memory repository"""
    cmd = f"git log --pretty=format:'%H|%at|%s' -n {limit}"
    output = run_git_command(cmd, cwd)
    
    if not output:
        return []
    
    commits = []
    for line in output.split('\n'):
        if not line.strip():
            continue
        
        try:
            parts = line.split('|', 2)
            if len(parts) < 3:
                continue
                
            commit_hash, timestamp, message = parts
            timestamp = int(timestamp)
            
            commits.append({
                'hash': commit_hash,
                'timestamp': timestamp,
                'date': datetime.datetime.fromtimestamp(timestamp).strftime('%Y-%m-%d %H:%M:%S'),
                'message': message
            })
        except Exception as e:
            print(f"Error parsing commit line: {line} - {str(e)}", file=sys.stderr)
    
    return commits

def get_commit_files(commit_hash, cwd="memory"):
    """Get list of files in a commit"""
    cmd = f"git ls-tree --name-only -r {commit_hash}"
    output = run_git_command(cmd, cwd)
    
    if not output:
        return []
        
    return [f for f in output.split('\n') if f.strip()]

def get_file_content(commit_hash, file_path, cwd="memory"):
    """Get content of a file at a specific commit"""
    cmd = f"git show {commit_hash}:{file_path}"
    return run_git_command(cmd, cwd)

def extract_core_task(task_content):
    """Extract the core task from task.txt content"""
    if not task_content:
        return "No task specified"
        
    task_lines = task_content.split('\n')
    core_task = task_lines[-1] if len(task_lines) > 0 else task_content
    
    if "---This is your task---" in task_content:
        for j, line in enumerate(task_lines):
            if "---This is your task---" in line and j+1 < len(task_lines):
                core_task = task_lines[j+1]
                break
                
    return core_task

def summarize_commit(commit, cwd="memory"):
    """Create a summary for a single commit"""
    commit_hash = commit['hash']
    files = get_commit_files(commit_hash, cwd)
    
    summary = []
    summary.append(f"## Step {commit_hash[:8]}: {commit['message']}")
    summary.append(f"Time: {commit['date']}")
    
    # Extract task
    if 'task.txt' in files:
        task_content = get_file_content(commit_hash, 'task.txt', cwd)
        if task_content:
            core_task = extract_core_task(task_content)
            summary.append(f"Task: {core_task}")
    
    # Summarize thinking
    if 'thinking.txt' in files:
        thinking_content = get_file_content(commit_hash, 'thinking.txt', cwd)
        if thinking_content:
            thinking_lines = thinking_content.split('\n')
            thinking_summary = []
            line_count = 0
            for line in thinking_lines:
                if line.strip() and line_count < 2:  # Limit to 2 non-empty lines
                    thinking_summary.append(line.strip())
                    line_count += 1
            if thinking_summary:
                summary.append("Thinking: " + " ".join(thinking_summary))
    
    # Summarize action
    if 'action.txt' in files:
        action_content = get_file_content(commit_hash, 'action.txt', cwd)
        if action_content:
            action_lines = action_content.split('\n')
            action_summary = action_lines[0] if action_lines else ""
            if action_summary:
                summary.append("Action: " + action_summary)
    
    return summary

def create_history_summary(memory_dir="memory", limit=20):
    """Create a summary of the task history from git repository"""
    # Check if memory dir exists and is a git repo
    if not os.path.exists(memory_dir) or not os.path.exists(os.path.join(memory_dir, '.git')):
        return ["# Task History Summary", "", "No history available yet."]
    
    # Start building the summary
    summary = ["# Task History Summary", ""]
    
    # Get commit list
    commits = get_commit_list(limit, memory_dir)
    
    if not commits:
        summary.append("No history available yet.")
        return summary
    
    # Process each commit
    for commit in commits:
        commit_summary = summarize_commit(commit, memory_dir)
        summary.extend(commit_summary)
        summary.append("")  # Add blank line between entries
    
    return summary

def main():
    memory_dir = sys.argv[1] if len(sys.argv) > 1 else "memory"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    
    try:
        summary = create_history_summary(memory_dir, limit)
        print("\n".join(summary))
    except Exception as e:
        print(f"# Task History Summary\n\nError creating history summary: {str(e)}")

if __name__ == "__main__":
    main()