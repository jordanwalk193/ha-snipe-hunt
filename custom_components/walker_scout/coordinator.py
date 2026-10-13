"""Polls the bot and hands its snapshot to the entities and dashboard cards."""
from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import WalkerScoutAuthError, WalkerScoutClient, WalkerScoutError
from .const import (
    CONF_TOKEN,
    CONF_URL,
    DEFAULT_OPTIONS,
    DOMAIN,
    EVENT_NEW_PICK,
    OPT_EVENT_TIERS,
    OPT_SCAN_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)

type WalkerScoutConfigEntry = ConfigEntry[WalkerScoutCoordinator]


def options(entry: ConfigEntry) -> dict[str, Any]:
    """The entry's options with defaults filled in."""
    return {**DEFAULT_OPTIONS, **entry.options}


class WalkerScoutCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """One snapshot of the bot, refreshed on a timer and after every action."""

    config_entry: WalkerScoutConfigEntry

    def __init__(self, hass: HomeAssistant, entry: WalkerScoutConfigEntry) -> None:
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=DOMAIN,
            update_interval=timedelta(seconds=options(entry)[OPT_SCAN_INTERVAL]),
        )
        self.client = WalkerScoutClient(
            async_get_clientsession(hass), entry.data[CONF_URL], entry.data[CONF_TOKEN]
        )
        self._known_picks: set[str] | None = None

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            data = await self.client.async_snapshot()
        except WalkerScoutAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except WalkerScoutError as err:
            raise UpdateFailed(str(err)) from err
        self._announce_new_picks(data)
        return data

    def _announce_new_picks(self, data: dict[str, Any]) -> None:
        """Fire an event for each pick not seen before, for automations."""
        picks = {p["item_id"]: p for p in data.get("picks", [])}
        if self._known_picks is not None:
            tiers = options(self.config_entry)[OPT_EVENT_TIERS]
            for item_id in picks.keys() - self._known_picks:
                if picks[item_id].get("tier") in tiers:
                    self.hass.bus.async_fire(EVENT_NEW_PICK, picks[item_id])
            # Remember ended picks too, so un-skipping one doesn't announce it again.
            self._known_picks |= picks.keys()
        else:
            self._known_picks = set(picks)

    async def _async_send(self, call, payload: dict[str, Any]) -> str:
        try:
            result = await call(payload)
        except WalkerScoutError as err:
            raise HomeAssistantError(str(err)) from err
        if isinstance(result.get("snapshot"), dict):
            self._announce_new_picks(result["snapshot"])
            self.async_set_updated_data(result["snapshot"])
        if not result.get("ok"):
            raise HomeAssistantError(result.get("message") or "The bot refused")
        return result.get("message") or "Done"

    async def async_action(self, action: str, **data: Any) -> str:
        """Run a bot action and show its result everywhere at once."""
        return await self._async_send(self.client.async_action, {"action": action, **data})

    async def async_set_setting(self, key: str, value: Any) -> None:
        """Change one bot setting."""
        await self._async_send(self.client.async_settings, {key: value})
