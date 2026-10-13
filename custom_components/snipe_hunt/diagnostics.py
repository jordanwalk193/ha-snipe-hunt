"""Diagnostics for Snipe Hunt: sizes and health, not the collection itself."""
from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant

from .const import CONF_URL
from .coordinator import SnipeHuntConfigEntry


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: SnipeHuntConfigEntry
) -> dict[str, Any]:
    data = entry.runtime_data.data
    return {
        "url": entry.data[CONF_URL],
        "options": dict(entry.options),
        "last_update_success": entry.runtime_data.last_update_success,
        "api": data.get("api"),
        "generated": data.get("generated"),
        "status": data.get("status"),
        "settings": data.get("settings"),
        "counts": {key: len(data.get(key) or []) for key in ("picks", "cards", "wantlist")},
        "gixen": {key: (data.get("gixen") or {}).get(key)
                  for key in ("available", "problem", "read_at")},
    }
