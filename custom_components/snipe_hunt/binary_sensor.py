"""Binary sensors for Snipe Hunt."""
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

from homeassistant.util import dt as dt_util

from .const import OPT_SOON_MINUTES
from .coordinator import SnipeHuntConfigEntry, options
from .entity import SnipeHuntEntity


@dataclass(frozen=True, kw_only=True)
class SnipeHuntBinarySensor(BinarySensorEntityDescription):
    """A binary sensor and where its value comes from in the snapshot."""

    value: Callable[[dict[str, Any]], bool | None]


def _over_budget(data: dict[str, Any]) -> bool | None:
    budget = data["settings"].get("monthly_budget") or 0
    return data["collection"]["month_spent"] > budget if budget else None


BINARY_SENSORS: tuple[SnipeHuntBinarySensor, ...] = (
    SnipeHuntBinarySensor(key="searching", device_class=BinarySensorDeviceClass.RUNNING,
                            value=lambda d: d["status"]["searching"]),
    SnipeHuntBinarySensor(key="problem", device_class=BinarySensorDeviceClass.PROBLEM,
                            entity_category=EntityCategory.DIAGNOSTIC,
                            value=lambda d: d["status"]["state"] != "ok"),
    SnipeHuntBinarySensor(
        key="gixen_connected", device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
        value=lambda d: None if d.get("gixen") is None
        else bool(d["gixen"]["available"] and not d["gixen"]["problem"]),
    ),
    SnipeHuntBinarySensor(key="over_budget", device_class=BinarySensorDeviceClass.PROBLEM,
                            value=_over_budget),
)


def ending_soon(data: dict[str, Any], minutes: int) -> list[dict[str, Any]]:
    """Good auctions with no snipe that end within `minutes`, soonest first."""
    wanted = set(data["status"].get("need_snipe", []))
    now = dt_util.utcnow()
    out = []
    for pick in data.get("picks", []):
        end = dt_util.parse_datetime(pick.get("end_time") or "")
        if pick["item_id"] in wanted and end and 0 < (end - now).total_seconds() <= minutes * 60:
            out.append(pick)
    return sorted(out, key=lambda p: dt_util.parse_datetime(p["end_time"]))


async def async_setup_entry(
    hass: HomeAssistant, entry: SnipeHuntConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([
        *(SnipeHuntBinarySensorEntity(entry.runtime_data, d) for d in BINARY_SENSORS),
        SnipeHuntEndingSoon(entry.runtime_data, "unsniped_ending_soon"),
    ])


class SnipeHuntEndingSoon(SnipeHuntEntity, BinarySensorEntity):
    """On while a good auction with no snipe is about to end. Made for automations."""

    def _soon(self) -> list[dict[str, Any]]:
        minutes = options(self.coordinator.config_entry)[OPT_SOON_MINUTES]
        return ending_soon(self.coordinator.data, minutes)

    @property
    def is_on(self) -> bool:
        return bool(self._soon())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        soon = self._soon()
        first = soon[0] if soon else {}
        return {
            "count": len(soon),
            "within_minutes": options(self.coordinator.config_entry)[OPT_SOON_MINUTES],
            **{k: first.get(k) for k in ("item_id", "card", "tier", "max", "end_time", "url")},
        }


class SnipeHuntBinarySensorEntity(SnipeHuntEntity, BinarySensorEntity):
    """A yes/no fact from the bot's snapshot."""

    entity_description: SnipeHuntBinarySensor

    def __init__(self, coordinator, description: SnipeHuntBinarySensor) -> None:
        super().__init__(coordinator, description.key)
        self.entity_description = description

    @property
    def is_on(self) -> bool | None:
        return self.entity_description.value(self.coordinator.data)
