"""Structured logging setup with JSON support and env configuration."""

import json
import logging
import os
import sys
from datetime import datetime


LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
LOG_FORMAT = os.getenv("LOG_FORMAT", "text")
LOG_FILE = os.getenv("LOG_FILE", "competencia.log")


class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_entry = {
            "timestamp": datetime.fromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0]:
            log_entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_entry, ensure_ascii=False)


TEXT_FORMAT = "%(asctime)s [%(levelname)s] %(name)s.%(funcName)s:%(lineno)d — %(message)s"
STREAM_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"


def setup_logging():
    level = getattr(logging, LOG_LEVEL, logging.INFO)
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()

    file_fmt = JSONFormatter() if LOG_FORMAT == "json" else logging.Formatter(TEXT_FORMAT)
    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setFormatter(file_fmt)
    root.addHandler(fh)

    sh = logging.StreamHandler(sys.__stdout__)
    sh.setFormatter(logging.Formatter(STREAM_FORMAT))
    root.addHandler(sh)

    return root
