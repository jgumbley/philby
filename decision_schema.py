from typing import Dict, Any, Optional
from datetime import datetime
from pydantic import BaseModel, Field


class ToolCall(BaseModel):
    name: str
    args: Dict[str, Any]


class AskHandler(BaseModel):
    prompt: str


class Decision(BaseModel):
    tool_call: Optional[ToolCall] = None
    ask_handler: Optional[AskHandler] = None
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat(timespec="seconds") + "Z")