#!/usr/bin/env python3

import dspy
import os

class PhilbySignature(dspy.Signature):
    """Given a task and context, reason step-by-step, predict outcomes, and decide on an action."""
    
    # Inputs
    task = dspy.InputField(desc="The current task to accomplish")
    context = dspy.InputField(desc="Previous thinking, actions, and results")
    available_tools = dspy.InputField(desc="List of tool names and their descriptions")
    
    # Reasoning outputs
    reasoning = dspy.OutputField(desc="Step-by-step thinking about the task")
    information_needed = dspy.OutputField(desc="What information would help (file paths, context)", default="none")
    
    # Philby core outputs
    predictions = dspy.OutputField(desc="Specific predictions about what will happen")
    decision = dspy.OutputField(desc="JSON object with tool_call or ask_handler", format=dict)

def main():
    # Configure DSPy with local OpenAI-compatible model
    lm = dspy.LM(
        model="openai/qwen3-30b-a3b-instruct-2507/model.gguf",
        api_base=os.getenv("PHILBY_API_BASE"),
        api_key="123",
        max_tokens=16384,
        timeout=10,
        connect_timeout=1
    )
    
    # Set as default language model
    dspy.configure(lm=lm)
    
    # Create a signature for fibonacci code generation
    class FibonacciGenerator(dspy.Signature):
        """Generate a Python script that calculates fibonacci numbers with optimizations"""
        requirements: str = dspy.InputField(desc="Requirements for the fibonacci implementation")
        code: str = dspy.OutputField(desc="Complete Python script with fibonacci implementation")
        explanation: str = dspy.OutputField(desc="Explanation of the algorithm and optimizations used")
    
    # Create a predictor
    fib_predictor = dspy.Predict(FibonacciGenerator)
    
    try:
        # Generate fibonacci implementation
        requirements = """Create a Python script that:
1. Implements fibonacci calculation with memoization for efficiency
2. Includes both recursive and iterative approaches
3. Has error handling for invalid inputs
4. Includes timing comparisons between approaches
5. Has a command-line interface to specify which fibonacci number to calculate
6. Includes docstrings and type hints"""
        
        result = fib_predictor(requirements=requirements)
        print("=== Generated Fibonacci Code ===")
        print(result.code)
        print("\n=== Explanation ===")
        print(result.explanation)
    except Exception as e:
        print(f"Error calling local model: {e}")
        api_base = os.getenv("PHILBY_API_BASE")
        print(f"Make sure your local OpenAI-compatible server is running on {api_base}")

if __name__ == "__main__":
    main()