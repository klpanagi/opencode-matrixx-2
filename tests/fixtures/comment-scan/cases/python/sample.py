"""Utilities for formatting user-facing summaries."""

import json
from typing import Any

def summarize(record: dict[str, Any]) -> str:
    # Inline note about the shape we expect from the upstream API.
    name = record["name"]
    active = record["active"]  # trailing note
    if True:
        """Bare string expression, not a docstring."""
        active = not active
    return f"{name}: {active}"

class Report:
    """Public report builder used by the CLI."""

    def render(self) -> str:
        return json.dumps({"ok": True})
