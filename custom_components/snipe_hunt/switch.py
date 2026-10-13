"""On/off settings for Snipe Hunt."""
from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import SnipeHuntConfigEntry
from .entity import SnipeHuntSettingEntity

SWITCHES = ("alerts_enabled", "alert_fire", "alert_green", "alert_cheap_yellow",
            "quiet_hours", "gixen_enabled")


async def async_setup_entry(
    hass: HomeAssistant, entry: SnipeHuntConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities(SnipeHuntSwitch(entry.runtime_data, key) for key in SWITCHES)


class SnipeHuntSwitch(SnipeHuntSettingEntity, SwitchEntity):
    """Turns one of the bot's behaviours on or off."""

    _attr_entity_category = EntityCategory.CONFIG

    @property
    def is_on(self) -> bool | None:
        return self.setting

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.async_save(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.async_save(False)
