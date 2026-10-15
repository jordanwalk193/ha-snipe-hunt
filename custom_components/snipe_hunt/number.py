"""Number settings for Snipe Hunt."""
from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberEntityDescription, NumberMode
from homeassistant.const import EntityCategory, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import SnipeHuntConfigEntry
from .entity import SnipeHuntSettingEntity

NUMBERS: tuple[NumberEntityDescription, ...] = (
    NumberEntityDescription(key="monthly_budget", native_min_value=0, native_max_value=5000,
                            native_step=5, native_unit_of_measurement="USD"),
    NumberEntityDescription(key="yellow_max_total", native_min_value=0, native_max_value=25,
                            native_step=0.25, native_unit_of_measurement="USD"),
    NumberEntityDescription(key="alert_min_stars", native_min_value=1, native_max_value=5,
                            native_step=1),
    NumberEntityDescription(key="price_lookups", native_min_value=0, native_max_value=12,
                            native_step=1),
    NumberEntityDescription(key="estimate_bin_cap", native_min_value=0, native_max_value=1000,
                            native_step=1, native_unit_of_measurement="USD"),
    NumberEntityDescription(key="min_seller_feedback", native_min_value=0,
                            native_max_value=100000, native_step=10, mode=NumberMode.BOX),
    NumberEntityDescription(key="urgent_hours", native_min_value=0, native_max_value=24,
                            native_step=0.5, native_unit_of_measurement=UnitOfTime.HOURS),
    NumberEntityDescription(key="need_snipe_hours", native_min_value=1, native_max_value=168,
                            native_step=1, native_unit_of_measurement=UnitOfTime.HOURS),
    NumberEntityDescription(key="gixen_relogin_minutes", native_min_value=0,
                            native_max_value=1440, native_step=15,
                            native_unit_of_measurement=UnitOfTime.MINUTES),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: SnipeHuntConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities(SnipeHuntNumber(entry.runtime_data, d) for d in NUMBERS)


class SnipeHuntNumber(SnipeHuntSettingEntity, NumberEntity):
    """A number the bot uses when alerting or building the dashboard."""

    _attr_entity_category = EntityCategory.CONFIG
    _attr_mode = NumberMode.BOX

    def __init__(self, coordinator, description: NumberEntityDescription) -> None:
        super().__init__(coordinator, description.key)
        self.entity_description = description

    @property
    def native_value(self) -> float | None:
        return self.setting

    async def async_set_native_value(self, value: float) -> None:
        await self.async_save(value)
