import os
import logging
import sys
from typing import Optional
from colorama import Fore, Back, Style, init

init(autoreset=True)


class ColoredFormatter(logging.Formatter):
    """Custom formatter with color coordination for different log levels."""

    COLORS = {
        "DEBUG": Fore.CYAN,
        "INFO": Fore.GREEN,
        "WARNING": Fore.YELLOW,
        "ERROR": Fore.RED,
        "CRITICAL": Fore.RED + Back.WHITE + Style.BRIGHT,
    }

    def format(self, record):
        log_message = super().format(record)
        color = self.COLORS.get(record.levelname, "")
        if color:
            log_message = f"{color}{log_message}{Style.RESET_ALL}"

        return log_message


class TradingLogger:
    """Centralized logging utility for the trading system."""

    _instance: Optional["TradingLogger"] = None
    _logger: Optional[logging.Logger] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(TradingLogger, cls).__new__(cls)
        return cls._instance

    def __init__(self):
        if self._logger is None:
            self._setup_logger()

    def _setup_logger(self):
        """Setup the logger with proper configuration."""
        log_level_str = os.getenv("LOG_LEVEL", "INFO").upper()
        log_level = getattr(logging, log_level_str, logging.INFO)

        self._logger = logging.getLogger("trading_system")
        self._logger.setLevel(log_level)

        self._logger.handlers.clear()

        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(log_level)

        formatter = ColoredFormatter(
            fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

        console_handler.setFormatter(formatter)
        self._logger.addHandler(console_handler)

        self._logger.info(f"Logger initialized with level: {log_level_str}")

    def get_logger(self, name: str = None) -> logging.Logger:
        """Get a logger instance with optional name."""
        if name:
            return logging.getLogger(f"trading_system.{name}")
        return self._logger

    def debug(self, message: str, logger_name: str = None):
        """Log debug message."""
        self.get_logger(logger_name).debug(message)

    def info(self, message: str, logger_name: str = None):
        """Log info message."""
        self.get_logger(logger_name).info(message)

    def warning(self, message: str, logger_name: str = None):
        """Log warning message."""
        self.get_logger(logger_name).warning(message)

    def error(self, message: str, logger_name: str = None):
        """Log error message."""
        self.get_logger(logger_name).error(message)

    def critical(self, message: str, logger_name: str = None):
        """Log critical message."""
        self.get_logger(logger_name).critical(message)


logger = TradingLogger()


def get_logger(name: str = None) -> logging.Logger:
    """Convenience function to get a logger instance."""
    return logger.get_logger(name)
