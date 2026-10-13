"""Snipe Hunt: a card steal-finder bot, shown and steered from Home Assistant.

The bot runs on its own machine and serves a small local API. This integration
polls it, turns what it knows into entities, exposes its settings and buttons,
and ships the dashboard cards. It never bids, buys or changes a snipe; the bot
has no way to.
"""
from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import DOMAIN, FRONTEND_URL
from .coordinator import SnipeHuntConfigEntry, SnipeHuntCoordinator
from .services import async_setup_services
from .websocket import async_setup_websocket

PLATFORMS = [
    Platform.BINARY_SENSOR,
    Platform.BUTTON,
    Platform.CALENDAR,
    Platform.EVENT,
    Platform.NUMBER,
    Platform.SENSOR,
    Platform.SWITCH,
    Platform.TEXT,
    Platform.TIME,
]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the dashboard cards, the services and the websocket commands."""
    integration = await async_get_integration(hass, DOMAIN)
    script = Path(__file__).parent / "frontend" / "snipe-hunt.js"
    await hass.http.async_register_static_paths([
        StaticPathConfig(FRONTEND_URL, str(script), False)
    ])
    # The version and the file's own date in the URL make browsers fetch the
    # new cards after any update, even one that kept the version number.
    changed = int((await hass.async_add_executor_job(script.stat)).st_mtime)
    frontend.add_extra_js_url(hass, f"{FRONTEND_URL}?v={integration.version}-{changed}")
    async_setup_services(hass)
    async_setup_websocket(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: SnipeHuntConfigEntry) -> bool:
    coordinator = SnipeHuntCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_options_changed))
    return True


async def _async_options_changed(hass: HomeAssistant, entry: SnipeHuntConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: SnipeHuntConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
