"""Binary sensors for Walker Scout."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
    BinarySensorEntityDescription,
)
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .coordinator import WalkerScoutConfigEntry
from .entity import WalkerScoutEntity


@dataclass(frozen=True, kw_only=True)
class WalkerScoutBinarySensor(BinarySensorEntityDescription):
    """A binary sensor and where its value comes from in the snapshot."""

    value: Callable[[dict[str, Any]], bool | None]


def _over_budget(data: dict[str, Any]) -> bool | None:
    budget = data["settings"].get("monthly_budget") or 0
    return data["collection"]["month_spent"] > budget if budget else None


BINARY_SENSORS: tuple[WalkerScoutBinarySensor, ...] = (
    WalkerScoutBinarySensor(key="searching", device_class=BinarySensorDeviceClass.RUNNING,
                            value=lambda d: d["status"]["searching"]),
    WalkerScoutBinarySensor(key="problem", device_class=BinarySensorDeviceClass.PROBLEM,
                            entity_category=EntityCategory.DIAGNOSTIC,
                            value=lambda d: d["status"]["state"] != "ok"),
    WalkerScoutBinarySensor(
        key="gixen_connected", device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
        value=lambda d: None if d.get("gixen") is None
        else bool(d["gixen"]["available"] and not d["gixen"]["problem"]),
    ),
    WalkerScoutBinarySensor(key="over_budget", device_class=BinarySensorDeviceClass.PROBLEM,
                            value=_over_budget),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: WalkerScoutConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities(
        WalkerScoutBinarySensorEntity(entry.runtime_data, d) for d in BINARY_SENSORS
    )


class WalkerScoutBinarySensorEntity(WalkerScoutEntity, BinarySensorEntity):
    """A yes/no fact from the bot's snapshot."""

    entity_description: WalkerScoutBinarySensor

    def __init__(self, coordinator, description: WalkerScoutBinarySensor) -> None:
        super().__init__(coordinator, description.key)
        self.entity_description = description

    @property
    def is_on(self) -> bool | None:
        return self.entity_description.value(self.coordinator.data)
