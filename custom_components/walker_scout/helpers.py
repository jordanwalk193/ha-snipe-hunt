"""Find the running Walker Scout coordinator."""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .const import DOMAIN
from .coordinator import WalkerScoutCoordinator


def get_coordinator(hass: HomeAssistant) -> WalkerScoutCoordinator:
    """The one coordinator, or an error a person can act on."""
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.state is ConfigEntryState.LOADED:
            return entry.runtime_data
    raise HomeAssistantError("Walker Scout isn't set up, or can't reach the bot right now")
