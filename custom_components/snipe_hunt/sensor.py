"""Sensors for Snipe Hunt."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import PERCENTAGE, EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .coordinator import SnipeHuntConfigEntry
from .entity import SnipeHuntEntity

Data = dict[str, Any]
MEASUREMENT = SensorStateClass.MEASUREMENT
DIAGNOSTIC = EntityCategory.DIAGNOSTIC


@dataclass(frozen=True, kw_only=True)
class SnipeHuntSensor(SensorEntityDescription):
    """A sensor and where its value comes from in the snapshot."""

    value: Callable[[Data], Any]
    attrs: Callable[[Data], dict[str, Any]] | None = None


def _when(text: str | None) -> datetime | None:
    return dt_util.parse_datetime(text) if text else None


def _gixen(data: Data) -> Data:
    """The Gixen list, or nothing when it is off or has never been read."""
    gixen = data.get("gixen") or {}
    return gixen if gixen.get("available") else {}


def _top_pick(data: Data) -> Data:
    """The best pick without a snipe yet; if they are all covered, the best one."""
    good = [p for p in data["picks"] if p.get("tier") in ("fire", "green")]
    return next((p for p in good if p.get("snipe") is None), good[0] if good else {})


def _next_snipe(data: Data) -> datetime | None:
    ends = [_when(s["end_time"]) for s in _gixen(data).get("snipes", [])
            if not s.get("outbid")]
    now = dt_util.utcnow()
    return min((e for e in ends if e and e > now), default=None)


def _budget_left(data: Data) -> float | None:
    budget = data["settings"].get("monthly_budget") or 0
    return round(budget - data["collection"]["month_spent"], 2) if budget else None


def _pick(*keys: str) -> Callable[[Data], Data]:
    return lambda d: {k: d.get(k) for k in keys}


SENSORS: tuple[SnipeHuntSensor, ...] = (
    SnipeHuntSensor(
        key="status", device_class=SensorDeviceClass.ENUM,
        options=["ok", "stale", "failing"],
        value=lambda d: d["status"]["state"],
        attrs=lambda d: _pick("failing", "last_ok_job", "last_report")(d["status"]),
    ),
    SnipeHuntSensor(
        key="live_picks", state_class=MEASUREMENT,
        value=lambda d: d["status"]["live_picks"],
        attrs=lambda d: _pick("fire", "green", "yellow", "sales_based", "skipped")(d["status"]),
    ),
    SnipeHuntSensor(key="auction_picks", state_class=MEASUREMENT,
                      value=lambda d: d["status"]["auctions"]),
    SnipeHuntSensor(key="buy_now_picks", state_class=MEASUREMENT,
                      value=lambda d: d["status"]["buy_now"]),
    SnipeHuntSensor(
        key="need_snipe", state_class=MEASUREMENT,
        value=lambda d: len(d["status"]["need_snipe"]),
        attrs=lambda d: {"item_ids": d["status"]["need_snipe"],
                         "within_hours": d["settings"].get("need_snipe_hours")},
    ),
    SnipeHuntSensor(
        key="top_pick",
        value=lambda d: (_top_pick(d).get("card") or "")[:255] or None,
        attrs=lambda d: _pick("item_id", "tier", "price", "shipping", "total", "max",
                              "max_basis", "value", "deal", "deal_pct", "end_time", "seller", "url",
                              "snipe")(_top_pick(d)),
    ),
    SnipeHuntSensor(key="listings", state_class=MEASUREMENT,
                      value=lambda d: d["status"]["listings"]),
    SnipeHuntSensor(key="new_listings", state_class=MEASUREMENT, entity_category=DIAGNOSTIC,
                      value=lambda d: d["status"]["new_24h"]),
    SnipeHuntSensor(key="alerts_sent", state_class=MEASUREMENT, entity_category=DIAGNOSTIC,
                      value=lambda d: d["status"]["alerts_24h"],
                      attrs=lambda d: {"held_overnight": d["status"]["held_overnight"]}),
    SnipeHuntSensor(key="last_search", device_class=SensorDeviceClass.TIMESTAMP,
                      entity_category=DIAGNOSTIC,
                      value=lambda d: _when(d["status"]["last_search"])),
    SnipeHuntSensor(key="last_good_run", device_class=SensorDeviceClass.TIMESTAMP,
                      entity_category=DIAGNOSTIC,
                      value=lambda d: _when(d["status"]["last_ok"]),
                      attrs=lambda d: {"job": d["status"]["last_ok_job"]}),
    SnipeHuntSensor(
        key="last_action", entity_category=DIAGNOSTIC,
        value=lambda d: ((d.get("last_action") or {}).get("message") or "")[:255] or None,
        attrs=lambda d: _pick("ok", "action", "at")(d.get("last_action") or {}),
    ),
    SnipeHuntSensor(
        key="gixen_snipes", state_class=MEASUREMENT,
        value=lambda d: len(_gixen(d)["snipes"]) if _gixen(d) else None,
        attrs=lambda d: _pick("problem", "read_at")(d.get("gixen") or {}),
    ),
    SnipeHuntSensor(key="gixen_over_max", state_class=MEASUREMENT,
                      value=lambda d: _gixen(d).get("outbid_count")),
    SnipeHuntSensor(key="gixen_committed", device_class=SensorDeviceClass.MONETARY,
                      native_unit_of_measurement="USD", suggested_display_precision=2,
                      value=lambda d: _gixen(d).get("committed")),
    SnipeHuntSensor(key="next_snipe", device_class=SensorDeviceClass.TIMESTAMP,
                      value=_next_snipe),
    SnipeHuntSensor(
        key="win_rate", native_unit_of_measurement=PERCENTAGE, state_class=MEASUREMENT,
        value=lambda d: d["record"]["rate"],
        attrs=lambda d: _pick("days", "wins", "losses", "gixen_wins", "gixen_losses",
                              "wins_week", "losses_week")(d["record"]),
    ),
    SnipeHuntSensor(
        key="collection", state_class=MEASUREMENT,
        value=lambda d: d["collection"]["cards"],
        attrs=lambda d: _pick("rookies", "autos", "relics", "numbered", "graded",
                              "front_page", "dupes", "avg_paid", "by_status",
                              "by_year")(d["collection"]),
    ),
    SnipeHuntSensor(key="collection_spent", device_class=SensorDeviceClass.MONETARY,
                      state_class=SensorStateClass.TOTAL,
                      native_unit_of_measurement="USD", suggested_display_precision=2,
                      value=lambda d: d["collection"]["spent"]),
    SnipeHuntSensor(
        key="month_spend", device_class=SensorDeviceClass.MONETARY,
        state_class=SensorStateClass.TOTAL,
        native_unit_of_measurement="USD", suggested_display_precision=2,
        value=lambda d: d["collection"]["month_spent"],
        attrs=lambda d: {"month": d["collection"]["month"],
                         "cards": d["collection"]["month_cards"]},
    ),
    SnipeHuntSensor(key="budget_left", device_class=SensorDeviceClass.MONETARY,
                      native_unit_of_measurement="USD", suggested_display_precision=2,
                      value=_budget_left),
    SnipeHuntSensor(
        key="to_pay", device_class=SensorDeviceClass.MONETARY,
        native_unit_of_measurement="USD", suggested_display_precision=2,
        value=lambda d: d["pipeline"]["unpaid_total"],
        attrs=lambda d: {"cards": d["pipeline"]["unpaid_cards"],
                         "sellers": [g["seller"] for g in d["pipeline"]["unpaid"]]},
    ),
    SnipeHuntSensor(key="in_transit", state_class=MEASUREMENT,
                      value=lambda d: d["pipeline"]["in_transit"]),
    SnipeHuntSensor(key="to_file", state_class=MEASUREMENT,
                      value=lambda d: d["pipeline"]["to_file"]),
    SnipeHuntSensor(key="want_list", value=lambda d: len(d["wantlist"])),
)


async def async_setup_entry(
    hass: HomeAssistant, entry: SnipeHuntConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities(SnipeHuntSensorEntity(entry.runtime_data, d) for d in SENSORS)


class SnipeHuntSensorEntity(SnipeHuntEntity, SensorEntity):
    """One number or fact from the bot's snapshot."""

    entity_description: SnipeHuntSensor

    def __init__(self, coordinator, description: SnipeHuntSensor) -> None:
        super().__init__(coordinator, description.key)
        self.entity_description = description

    @property
    def native_value(self):
        return self.entity_description.value(self.coordinator.data)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        if self.entity_description.attrs is None:
            return None
        return self.entity_description.attrs(self.coordinator.data)

    @property
    def entity_picture(self) -> str | None:
        if self.entity_description.key == "top_pick":
            return _top_pick(self.coordinator.data).get("image")
        return None
