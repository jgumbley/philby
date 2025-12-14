"""Syslog-to-Redis stream bridge using Redis Streams and a minimal syslog parser."""

import argparse
import json
import re
import socketserver
from datetime import datetime
from typing import Any, Dict, Tuple

import redis

SYSLOG_PATTERN = re.compile(
    r"^<(?P<pri>\d+)>(?P<timestamp>\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(?P<host>\S+)\s+(?P<tag>[^:]+):\s?(?P<body>.*)$"
)


MONTH_DAY_TIME_FORMAT = "%b %d %H:%M:%S"


def _decode_pri(pri: int) -> Tuple[int, int]:
    """Return (facility, severity) tuple from a PRI value."""
    facility = pri // 8
    severity = pri % 8
    return facility, severity


def _parse_timestamp(timestamp: str) -> str:
    """Parse RFC 3164-style timestamp and return ISO-8601 with best-effort year."""
    current_utc = datetime.utcnow()
    try:
        dt = datetime.strptime(f"{current_utc.year} {timestamp}", f"%Y {MONTH_DAY_TIME_FORMAT}")
        # Syslog timestamps lack a year; if the parsed datetime is in the future,
        # roll back one year to handle Dec/Jan boundaries.
        if dt > current_utc:
            dt = dt.replace(year=dt.year - 1)
        return dt.isoformat() + "Z"
    except ValueError:
        return ""


def parse_syslog_message(message: str) -> Dict[str, Any]:
    """Parse a single syslog line into a structured dictionary.

    This is a pragmatic parser for classic RFC 3164-style messages. Fields that
    cannot be parsed will be omitted, but the raw message is always included.
    """

    parsed: Dict[str, Any] = {"raw": message}
    match = SYSLOG_PATTERN.match(message)
    if not match:
        return parsed

    pri = int(match.group("pri"))
    facility, severity = _decode_pri(pri)
    timestamp = _parse_timestamp(match.group("timestamp"))

    parsed.update(
        {
            "pri": pri,
            "facility": facility,
            "severity": severity,
            "timestamp": timestamp or None,
            "host": match.group("host"),
            "tag": match.group("tag"),
            "message": match.group("body"),
        }
    )
    return parsed


class RedisStreamWriter:
    """Append syslog events to a Redis Stream."""

    def __init__(self, redis_url: str, stream_name: str) -> None:
        self.redis = redis.from_url(redis_url, decode_responses=True)
        self.stream_name = stream_name

    def write(self, event: Dict[str, Any]) -> str:
        payload = {}
        for key, value in event.items():
            if value is None:
                continue
            if isinstance(value, (dict, list)):
                payload[key] = json.dumps(value)
            else:
                payload[key] = str(value)
        return self.redis.xadd(self.stream_name, payload)


class RedisSyslogUDPHandler(socketserver.BaseRequestHandler):
    """UDP handler that parses syslog messages and emits them to Redis Streams."""

    def handle(self) -> None:
        data = self.request[0]
        message = data.decode("utf-8", errors="replace").strip()
        event = parse_syslog_message(message)
        event["received_at"] = datetime.utcnow().isoformat() + "Z"
        self.server.stream_writer.write(event)


class RedisSyslogUDPServer(socketserver.ThreadingUDPServer):
    """UDP syslog server that bridges messages into Redis Streams."""

    allow_reuse_address = True

    def __init__(self, host: str, port: int, stream_writer: RedisStreamWriter) -> None:
        super().__init__((host, port), RedisSyslogUDPHandler)
        self.stream_writer = stream_writer


def main() -> None:
    parser = argparse.ArgumentParser(description="Push syslog messages into a Redis Stream")
    parser.add_argument("--redis-url", default="redis://localhost:6379/0", help="Redis connection URL")
    parser.add_argument("--stream", default="syslog", help="Redis Stream name to append to")
    parser.add_argument("--host", default="0.0.0.0", help="UDP listen address")
    parser.add_argument("--port", type=int, default=5514, help="UDP listen port")
    args = parser.parse_args()

    stream_writer = RedisStreamWriter(args.redis_url, args.stream)
    server = RedisSyslogUDPServer(args.host, args.port, stream_writer)

    print(f"Listening for syslog on udp://{args.host}:{args.port} → Redis Stream '{args.stream}' at {args.redis_url}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down syslog listener")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
