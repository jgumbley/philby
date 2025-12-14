"""Lightweight DSPy compatibility shim for offline development."""
from dataclasses import dataclass
from typing import Any


class LM:
    def __init__(self, **kwargs: Any):
        self.config = kwargs


class Signature:
    """Placeholder base class for DSPy signatures."""


@dataclass
class _Field:
    desc: str | None = None
    default: Any = None
    format: str | None = None


def InputField(desc: str | None = None, default: Any = None, format: str | None = None):
    return _Field(desc=desc, default=default, format=format)


def OutputField(desc: str | None = None, default: Any = None, format: str | None = None):
    return _Field(desc=desc, default=default, format=format)


class Predict:
    def __init__(self, signature_cls: type[Signature]):
        self.signature_cls = signature_cls

    def __call__(self, **kwargs: Any):
        class Result:
            pass

        sig_name = getattr(self.signature_cls, "__name__", "")
        if "ToolCall" in sig_name:
            setattr(Result, "tool_call", '{"name":"noop","arguments":{}}')
        elif "Purpose" in sig_name:
            setattr(Result, "purpose", kwargs.get("request", ""))
        return Result()


class ChainOfThought:
    def __init__(self, signature_cls: type[Signature]):
        self.signature_cls = signature_cls

    def __call__(self, **kwargs: Any):
        class Result:
            pass

        setattr(Result, "extracted_json", kwargs.get("thinking_text", "{}"))
        setattr(Result, "confidence", 1.0)
        setattr(Result, "context_requests", "none")
        return Result()


class Module:
    def __init__(self):
        pass


def configure(*, lm: LM | None = None):
    return lm
