"""Buttons for Walker Scout. None of them can bid, buy or change a snipe."""
from __future__ import annotations

from typing import Any

from homeassistant.components.button import ButtonEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import WalkerScoutConfigEntry
from .entity import WalkerScoutEntity

# key: (bot action, extra data, entity category)
BUTTONS: dict[str, tuple[str, dict[str, Any], EntityCategory | None]] = {
    "search_now": ("search", {}, None),
    "refresh": ("refresh", {}, EntityCategory.DIAGNOSTIC),
    "gixen_reread": ("gixen_refresh", {}, None),
    "gixen_sign_in": ("gixen_refresh", {"login": True}, EntityCategory.CONFIG),
    "restore_skipped": ("unskip_all", {}, EntityCategory.CONFIG),
    "test_alert": ("test_alert", {}, EntityCategory.DIAGNOSTIC),
}


async def async_setup_entry(
    hass: HomeAssistant, entry: WalkerScoutConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities(WalkerScoutButton(entry.runtime_data, key) for key in BUTTONS)


class WalkerScoutButton(WalkerScoutEntity, ButtonEntity):
    """Asks the bot to do one thing."""

    def __init__(self, coordinator, key: str) -> None:
        super().__init__(coordinator, key)
        self._action, self._data, self._attr_entity_category = BUTTONS[key]

    async def async_press(self) -> None:
        await self.coordinator.async_action(self._action, **self._data)
