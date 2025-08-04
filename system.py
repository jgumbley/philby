#!/usr/bin/env python3

import dspy
import os

def main():
    # Configure DSPy with local OpenAI-compatible model
    lm = dspy.LM(
        model="openai/qwen3-30b-a3b-instruct-2507/model.gguf",
        api_base="http://hal:8080/v1",
        api_key="123",
        max_tokens=100
    )
    
    # Set as default language model
    dspy.configure(lm=lm)
    
    # Create a simple signature for hello world
    class HelloWorld(dspy.Signature):
        """Generate a hello world message"""
        message: str = dspy.OutputField(desc="A friendly hello world message")
    
    # Create a predictor
    hello_predictor = dspy.Predict(HelloWorld)
    
    try:
        # Generate hello world message
        result = hello_predictor()
        print(f"DSPy Hello World: {result.message}")
    except Exception as e:
        print(f"Error calling local model: {e}")
        print("Make sure your local OpenAI-compatible server is running on http://hal:8080")

if __name__ == "__main__":
    main()