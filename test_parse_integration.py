#!/usr/bin/env python3
"""
Integration test for parse.py - validates current file-based behavior.
This test ensures the DSPy port maintains identical file system contracts.
"""

import os
import sys
import json
import tempfile
import subprocess
import shutil
from pathlib import Path
from contextlib import contextmanager

class ParseIntegrationTest:
    """Test harness for parse.py file-based behavior"""
    
    def __init__(self, use_dspy_version=False):
        self.test_dir = None
        self.original_dir = os.getcwd()
        self.parser_script = "parse_dspy.py" if use_dspy_version else "parse.py"
        self.version_name = "DSPy" if use_dspy_version else "original"
        
    def setup(self):
        """Create isolated test environment"""
        self.test_dir = tempfile.mkdtemp(prefix="philby_parse_test_")
        os.chdir(self.test_dir)
        
        # Copy parser script and decision_schema.py to test directory
        script_dir = Path(self.original_dir)
        shutil.copy(script_dir / self.parser_script, self.test_dir)
        shutil.copy(script_dir / "decision_schema.py", self.test_dir)
        
    def teardown(self):
        """Clean up test environment"""
        os.chdir(self.original_dir)
        if self.test_dir:
            shutil.rmtree(self.test_dir)
            
    @contextmanager
    def test_environment(self):
        """Context manager for test isolation"""
        try:
            self.setup()
            yield self
        finally:
            self.teardown()
    
    def run_parse(self, input_text):
        """Run parse.py with given input, return (success, decision_content, stderr)"""
        # Clean up any existing decision.txt before test
        if os.path.exists("decision.txt"):
            os.remove("decision.txt")
            
        try:
            process = subprocess.run(
                [sys.executable, "parse.py"],
                input=input_text,
                text=True,
                capture_output=True,
                timeout=10
            )
            
            decision_content = None
            if os.path.exists("decision.txt"):
                with open("decision.txt", 'r') as f:
                    decision_content = f.read()
                    
            return process.returncode == 0, decision_content, process.stderr
        except subprocess.TimeoutExpired:
            return False, None, "Process timed out"
    
    def test_basic_tool_call_json_block(self):
        """Test extraction from ```json code block"""
        input_text = '''Some thinking text here...

PREDICTIONS:
- This will work
- File will be read successfully

DECISION_JSON:

```json
{
  "tool_call": {
    "name": "read_file",
    "args": {"file_path": "test.txt"}
  }
}
```
'''
        success, decision_content, stderr = self.run_parse(input_text)
        
        assert success, f"Parse failed: {stderr}"
        assert decision_content is not None, "No decision.txt created"
        
        # Validate JSON structure
        decision_data = json.loads(decision_content)
        assert "tool_call" in decision_data
        assert decision_data["tool_call"]["name"] == "read_file"
        assert decision_data["tool_call"]["args"]["file_path"] == "test.txt"
        assert "timestamp" in decision_data
        
        print("✓ Basic tool call JSON block test passed")
        
    def test_plain_json_no_code_block(self):
        """Test extraction from pure JSON input (no surrounding text)"""
        input_text = '''{
  "tool_call": {
    "name": "write_file", 
    "args": {"file_path": "output.txt", "content": "Hello world"}
  }
}'''
        success, decision_content, stderr = self.run_parse(input_text)
        
        assert success, f"Parse failed: {stderr}"
        decision_data = json.loads(decision_content)
        assert decision_data["tool_call"]["name"] == "write_file"
        assert decision_data["tool_call"]["args"]["content"] == "Hello world"
        
        print("✓ Plain JSON test passed")
        
    def test_legacy_format_conversion(self):
        """Test conversion from legacy tool_name/parameters format"""
        input_text = '''Thinking about the task...

```json
{
  "tool_name": "list_files",
  "parameters": {"directory": "/home/user"}
}
```
'''
        success, decision_content, stderr = self.run_parse(input_text)
        
        assert success, f"Parse failed: {stderr}"
        decision_data = json.loads(decision_content)
        
        # Should be converted to new format
        assert "tool_call" in decision_data
        assert decision_data["tool_call"]["name"] == "list_files"
        assert decision_data["tool_call"]["args"]["directory"] == "/home/user"
        
        print("✓ Legacy format conversion test passed")
        
    def test_ask_handler(self):
        """Test ask_handler decision type"""
        input_text = '''Need to ask the user something...

```json
{
  "ask_handler": {
    "prompt": "Do you want to proceed with this action?"
  }
}
```
'''
        success, decision_content, stderr = self.run_parse(input_text)
        
        assert success, f"Parse failed: {stderr}"
        decision_data = json.loads(decision_content)
        assert "ask_handler" in decision_data
        assert decision_data["ask_handler"]["prompt"] == "Do you want to proceed with this action?"
        
        print("✓ Ask handler test passed")
        
    def test_malformed_json_failure(self):
        """Test that malformed JSON fails gracefully"""
        input_text = '''Bad JSON coming up...

```json
{
  "tool_call": {
    "name": "read_file"
    "args": {"file_path": "test.txt"}  // missing comma
  }
}
```
'''
        success, decision_content, stderr = self.run_parse(input_text)
        
        assert not success, "Should fail on malformed JSON"
        assert decision_content is None, "No decision.txt should be created on failure"
        assert ("Could not extract valid JSON" in stderr or "Expecting" in stderr)
        
        print("✓ Malformed JSON failure test passed")
        
    def test_invalid_schema_failure(self):
        """Test that JSON not matching Decision schema fails"""
        input_text = '''Invalid schema...

```json
{
  "tool_call": {
    "name": "read_file"
  }
}
```
'''
        success, decision_content, stderr = self.run_parse(input_text)
        
        assert not success, "Should fail on invalid schema"
        assert decision_content is None
        assert ("does not match Decision schema" in stderr or "validation error for Decision" in stderr)
        
        print("✓ Invalid schema failure test passed")
        
    def test_no_json_found_failure(self):
        """Test failure when no JSON is found in input"""
        input_text = '''Just some thinking text with no JSON at all.
This should fail because there's no decision to extract.
'''
        success, decision_content, stderr = self.run_parse(input_text)
        
        assert not success, "Should fail when no JSON found"
        assert decision_content is None
        assert ("Could not extract valid JSON" in stderr or "Expecting value" in stderr)
        
        print("✓ No JSON found failure test passed")
        
    def test_timestamp_added(self):
        """Test that timestamp is automatically added"""
        input_text = '''Simple decision:

```json
{
  "tool_call": {
    "name": "read_file",
    "args": {"file_path": "test.txt"}
  }
}
```
'''
        success, decision_content, stderr = self.run_parse(input_text)
        
        assert success, f"Parse failed: {stderr}"
        decision_data = json.loads(decision_content)
        assert "timestamp" in decision_data
        
        # Validate timestamp format (ISO format with Z suffix)
        timestamp = decision_data["timestamp"]
        assert timestamp.endswith("Z")
        assert "T" in timestamp  # ISO format has T separator
        
        print("✓ Timestamp addition test passed")
        
    def test_file_creation_behavior(self):
        """Test that decision.txt is created in current directory"""
        input_text = '''Simple test:

```json
{"tool_call": {"name": "read_file", "args": {"file_path": "test.txt"}}}
```
'''
        # Ensure decision.txt doesn't exist before test
        if os.path.exists("decision.txt"):
            os.remove("decision.txt")
            
        success, decision_content, stderr = self.run_parse(input_text)
        
        assert success, f"Parse failed: {stderr}"
        assert os.path.exists("decision.txt"), "decision.txt should be created"
        
        # Verify file content matches returned content
        with open("decision.txt", 'r') as f:
            file_content = f.read()
        assert file_content == decision_content
        
        print("✓ File creation behavior test passed")

def run_all_tests():
    """Run all integration tests"""
    test_suite = ParseIntegrationTest()
    
    with test_suite.test_environment():
        print("Running parse.py integration tests...\n")
        
        # Run all test methods (filter out non-callable attributes)
        test_methods = [method for method in dir(test_suite) 
                       if method.startswith('test_') and callable(getattr(test_suite, method))]
        
        for test_method in test_methods:
            try:
                getattr(test_suite, test_method)()
            except Exception as e:
                print(f"✗ {test_method} failed: {e}")
                raise
                
        print(f"\n✓ All {len(test_methods)} integration tests passed!")
        print("Current parse.py behavior validated.")

if __name__ == "__main__":
    run_all_tests()