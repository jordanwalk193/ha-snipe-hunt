"""Quiet-hours times for Snipe Hunt."""
from __future__ import annotations

from datetime import time

from homeassistant.components.time import TimeEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import SnipeHuntConfigEntry
from .entity import SnipeHuntSettingEntity

TIMES = ("quiet_start", "quiet_end")


async def async_setup_entry(
    hass: HomeAssistant, entry: SnipeHuntConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities(SnipeHuntTime(entry.runtime_data, key) for key in TIMES)


class SnipeHuntTime(SnipeHuntSettingEntity, TimeEntity):
    """When phone alerts go quiet and when they start again (bot's time zone)."""

    _attr_entity_category = EntityCategory.CONFIG

    @property
    def native_value(self) -> time | None:
        try:
            hour, minute = str(self.setting).split(":")[:2]
            return time(int(hour), int(minute))
        except ValueError:
            return None

    async def async_set_value(self, value: time) -> None:
        await self.async_save(value.strftime("%H:%M"))
