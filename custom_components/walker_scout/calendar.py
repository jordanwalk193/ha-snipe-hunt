"""A calendar of auction endings: your Gixen snipes and good auctions with no snipe."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .coordinator import WalkerScoutConfigEntry
from .entity import WalkerScoutEntity

LENGTH = timedelta(minutes=5)   # an ending is a moment; show it as its last minutes


def _events(data: dict[str, Any]) -> list[CalendarEvent]:
    """One event per auction ending, soonest first."""
    events: list[CalendarEvent] = []

    def add(end_time: str | None, summary: str, lines: list[str], item_id: str) -> None:
        end = dt_util.parse_datetime(end_time) if end_time else None
        if end is not None:
            events.append(CalendarEvent(
                start=end - LENGTH, end=end, summary=summary,
                description="\n".join(lines + [f"https://www.ebay.com/itm/{item_id}"]),
                uid=item_id,
            ))

    gixen = data.get("gixen") or {}
    sniped = set()
    for snipe in gixen.get("snipes", []) if gixen.get("available") else []:
        sniped.add(snipe["item_id"])
        state = "Over your max" if snipe.get("outbid") else "Snipe"
        add(snipe.get("end_time"), f"🎯 {state} {snipe.get('max_bid')}: {snipe.get('title')}",
            [f"Your max {snipe.get('max_bid')}, bid now {snipe.get('current_bid')}",
             f"Seller {snipe.get('seller')}", f"Item {snipe['item_id']}"], snipe["item_id"])
    wanted = set(data["status"].get("need_snipe", []))
    for pick in data.get("picks", []):
        if pick["item_id"] in wanted and pick["item_id"] not in sniped:
            add(pick.get("end_time"), f"⚠️ No snipe: {pick.get('card')}",
                [f"Bot max {pick.get('max')} ({pick.get('max_basis') or 'estimate'})",
                 pick.get("why") or "", f"Item {pick['item_id']}"], pick["item_id"])
    return sorted(events, key=lambda e: e.end)


async def async_setup_entry(
    hass: HomeAssistant, entry: WalkerScoutConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([WalkerScoutCalendar(entry.runtime_data, "auctions")])


class WalkerScoutCalendar(WalkerScoutEntity, CalendarEntity):
    """Auction endings worth knowing about."""

    @property
    def event(self) -> CalendarEvent | None:
        now = dt_util.utcnow()
        return next((e for e in _events(self.coordinator.data) if e.end > now), None)

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        return [e for e in _events(self.coordinator.data)
                if e.end > start_date and e.start < end_date]
