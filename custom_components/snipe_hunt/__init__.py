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
import logging

_LOGGER = logging.getLogger(__name__)

from .const import CONF_URL, DOMAIN, FRONTEND_URL, OPT_TABS, upgrade_tabs
from .helpers import loaded_entries
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
    tabs = entry.options.get(OPT_TABS)
    if tabs and upgrade_tabs(tabs) != list(tabs):   # saved before the tabs were renamed
        hass.config_entries.async_update_entry(
            entry, options={**entry.options, OPT_TABS: upgrade_tabs(tabs)})
    if entry.unique_id is None:   # set up before 2.21: the bot's address tells entries apart
        hass.config_entries.async_update_entry(entry, unique_id=entry.data[CONF_URL])
    coordinator = SnipeHuntCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    _listen_for_notification_taps(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_options_changed))
    return True


# The bot's alerts carry buttons (notify.pick_actions): "SNIPE_HUNT_SNIPED_<item>" and
# "SNIPE_HUNT_SKIP_<item>". The companion app fires this event when one is tapped.
NOTIFICATION_EVENT = "mobile_app_notification_action"
ACTION_PREFIX = "SNIPE_HUNT_"
TAP_ACTIONS = {"SNIPED": "sniped", "SKIP": "skip"}
LISTENER_KEY = "notification_tap_listener"


def _listen_for_notification_taps(hass: HomeAssistant) -> None:
    """One listener for all bots: a tap on an alert button becomes the bot's action."""
    store = hass.data.setdefault(DOMAIN, {})
    if store.get(LISTENER_KEY):
        return

    async def tapped(event) -> None:
        action = str(event.data.get("action") or "")
        if not action.startswith(ACTION_PREFIX):
            return
        op, _, item_id = action[len(ACTION_PREFIX):].rpartition("_")
        bot_action = TAP_ACTIONS.get(op)
        if not bot_action or not item_id.isdigit():
            return
        coordinator = _bot_showing(hass, item_id)
        if coordinator is None:
            return
        try:
            await coordinator.async_action(bot_action, item_id=item_id)
        except Exception as err:  # noqa: BLE001  a tap must never raise into the event loop
            _LOGGER.warning("Snipe Hunt: %s on %s from a notification failed: %s", bot_action, item_id, err)

    store[LISTENER_KEY] = hass.bus.async_listen(NOTIFICATION_EVENT, tapped)


def _bot_showing(hass: HomeAssistant, item_id: str):
    """The bot whose snapshot has this item (the first bot when none does)."""
    entries = loaded_entries(hass)
    for entry in entries:
        data = entry.runtime_data.data or {}
        for key in ("picks", "jackpots", "bid_now"):
            if any(str(p.get("item_id")) == item_id for p in data.get(key) or []):
                return entry.runtime_data
    return entries[0].runtime_data if entries else None


async def _async_options_changed(hass: HomeAssistant, entry: SnipeHuntConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: SnipeHuntConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
