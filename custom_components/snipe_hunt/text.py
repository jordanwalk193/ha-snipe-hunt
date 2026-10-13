"""List settings for Snipe Hunt, edited as comma-separated text."""
from __future__ import annotations

from homeassistant.components.text import TextEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import SnipeHuntConfigEntry
from .entity import SnipeHuntSettingEntity

TEXTS = ("sellers", "extra_searches")


async def async_setup_entry(
    hass: HomeAssistant, entry: SnipeHuntConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities(SnipeHuntText(entry.runtime_data, key) for key in TEXTS)


class SnipeHuntText(SnipeHuntSettingEntity, TextEntity):
    """A list the bot searches eBay with: watched sellers or extra search terms."""

    _attr_entity_category = EntityCategory.CONFIG
    _attr_native_max = 255

    @property
    def native_value(self) -> str | None:
        value = self.setting
        return ", ".join(value) if isinstance(value, list) else None

    async def async_set_value(self, value: str) -> None:
        await self.async_save([part.strip() for part in value.split(",") if part.strip()])
