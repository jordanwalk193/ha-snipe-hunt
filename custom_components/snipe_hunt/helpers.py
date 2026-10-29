"""Find a running Snipe Hunt coordinator. More than one bot can be set up (one
per player or collection); each is its own config entry, named after the bot."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .const import DOMAIN
from .coordinator import SnipeHuntCoordinator

DEFAULT_NAME = "Snipe Hunt"


def loaded_entries(hass: HomeAssistant) -> list[ConfigEntry]:
    """Every bot that is set up and answering, oldest first."""
    return [entry for entry in hass.config_entries.async_entries(DOMAIN)
            if entry.state is ConfigEntryState.LOADED]


def get_coordinator(hass: HomeAssistant, entry: str | None = None) -> SnipeHuntCoordinator:
    """The coordinator for one bot: by entry id or name (case doesn't matter),
    or the first bot set up when none is named. Or an error a person can act on."""
    entries = loaded_entries(hass)
    if entry:
        wanted = entry.strip()
        for candidate in entries:
            if candidate.entry_id == wanted or candidate.title.lower() == wanted.lower():
                return candidate.runtime_data
        names = ", ".join(c.title for c in entries) or "none"
        raise HomeAssistantError(f"No Snipe Hunt bot called {wanted!r} is running (set up: {names})")
    if entries:
        return entries[0].runtime_data
    raise HomeAssistantError("Snipe Hunt isn't set up, or can't reach the bot right now")


def bot_name(snapshot: dict | None) -> str:
    """What the bot calls itself (`profile.app_name`), or the integration's name."""
    profile = (snapshot or {}).get("profile") or {}
    name = str(profile.get("app_name") or "").strip()
    return name or DEFAULT_NAME
