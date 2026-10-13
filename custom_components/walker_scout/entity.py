"""Base entity for Walker Scout."""
from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import WalkerScoutCoordinator


class WalkerScoutEntity(CoordinatorEntity[WalkerScoutCoordinator]):
    """An entity fed by the bot's snapshot."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: WalkerScoutCoordinator, key: str) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._attr_translation_key = key
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Walker Scout Bot",
            manufacturer="Walker Scout",
            model="Card steal-finder bot",
            entry_type=DeviceEntryType.SERVICE,
        )


class WalkerScoutSettingEntity(WalkerScoutEntity):
    """An entity that shows and changes one of the bot's settings."""

    def __init__(self, coordinator: WalkerScoutCoordinator, key: str) -> None:
        super().__init__(coordinator, key)
        self._setting = key

    @property
    def available(self) -> bool:
        return super().available and self._setting in self.coordinator.data["settings"]

    @property
    def setting(self):
        return self.coordinator.data["settings"].get(self._setting)

    async def async_save(self, value) -> None:
        await self.coordinator.async_set_setting(self._setting, value)
