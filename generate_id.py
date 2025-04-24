#!/usr/bin/env python3
import sys
import os
import uuid
import time
import json
from argon2 import PasswordHasher

class AgentGraphID:
    """Generates and manages graph-based IDs for agent workflow steps"""
    
    def __init__(self, id_file="id.txt"):
        self.id_file = id_file
        self.id_data = self._load_id_data()
    
    def _load_id_data(self):
        """Load existing ID data or create new"""
        if os.path.exists(self.id_file):
            try:
                with open(self.id_file, 'r') as f:
                    return json.loads(f.read())
            except (json.JSONDecodeError, FileNotFoundError):
                pass
        
        # Default structure for new workflow
        return {
            "workflow_id": self._generate_argon2_hash(),
            "sequence": 0,
            "steps": {},
            "graph": {
                "nodes": [],
                "edges": []
            }
        }
    
    def _generate_argon2_hash(self):
        """Generate an Argon2 hash from a unique input"""
        unique_input = f"{uuid.uuid4()}-{time.time()}"
        ph = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1, hash_len=16)
        return ph.hash(unique_input)
    
    def next_id(self, parent_id=None):
        """
        Generate next ID in the sequence with optional parent relationship
        
        Args:
            parent_id: Optional parent step ID to create a graph relationship
        
        Returns:
            Dict containing the new ID information
        """
        # Increment sequence
        self.id_data["sequence"] += 1
        sequence = self.id_data["sequence"]
        
        # Generate new step ID
        step_id = f"{self.id_data['workflow_id']}::{sequence}"
        
        # Create node data
        node_data = {
            "id": step_id,
            "sequence": sequence,
            "timestamp": time.time()
        }
        
        # Add to nodes
        self.id_data["graph"]["nodes"].append(node_data)
        self.id_data["steps"][str(sequence)] = step_id
        
        # Add edge if parent exists
        if parent_id and parent_id in [node["id"] for node in self.id_data["graph"]["nodes"]]:
            self.id_data["graph"]["edges"].append({
                "source": parent_id,
                "target": step_id,
                "type": "follows"
            })
        
        # Save updated data
        self._save_id_data()
        
        return {
            "step_id": step_id,
            "sequence": sequence,
            "workflow_id": self.id_data["workflow_id"]
        }
    
    def _save_id_data(self):
        """Save ID data to file"""
        with open(self.id_file, 'w') as f:
            f.write(json.dumps(self.id_data, indent=2))
    
    def get_current_id(self):
        """Get the most recent ID"""
        if self.id_data["sequence"] == 0:
            return self.next_id()
        
        sequence = self.id_data["sequence"]
        return {
            "step_id": self.id_data["steps"][str(sequence)],
            "sequence": sequence,
            "workflow_id": self.id_data["workflow_id"]
        }

def main():
    """Main function to generate and save ID"""
    id_file = sys.argv[1] if len(sys.argv) > 1 else "id.txt"
    
    # Initialize ID manager
    id_manager = AgentGraphID(id_file)
    
    # Get parent ID if provided
    parent_id = sys.argv[2] if len(sys.argv) > 2 else None
    
    # Generate next ID
    id_info = id_manager.next_id(parent_id)
    
    # Print ID information
    print(json.dumps(id_info, indent=2))

if __name__ == "__main__":
    main()