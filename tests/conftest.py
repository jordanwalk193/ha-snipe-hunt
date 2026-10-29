"""Fixtures: a pretend bot, so no test needs the real one."""
from __future__ import annotations

import copy
from unittest.mock import patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.snipe_hunt.const import CONF_TOKEN, CONF_URL, DOMAIN

PICK = {
    "item_id": "111111111111", "card": "2023 Topps Chrome Refractor /99", "tier": "fire",
    "price": 5.0, "shipping": 1.0, "total": 6.0, "max": 12.12, "max_basis": "sales",
    "is_auction": True, "best_offer": False, "end_time": "2099-01-01T21:00-05:00",
    "seller": "someseller", "why": "Sells for $25", "image": "https://example.com/1.jpg",
    "url": "https://www.ebay.com/itm/111111111111", "snipe": None, "bid_now": None,
}
SNAPSHOT = {
    "api": 1,
    "generated": "2026-10-12T18:00:00-04:00",
    "status": {
        "state": "ok", "failing": [], "last_ok": "2026-10-12T17:03:00-04:00",
        "last_ok_job": "hourly", "last_search": "2026-10-12T17:01:00-04:00",
        "listings": 600, "seen_total": 900, "new_24h": 40, "scored_24h": 40,
        "picks_24h": 6, "alerts_24h": 3, "live_picks": 1, "auctions": 1, "buy_now": 0,
        "fire": 1, "green": 0, "yellow": 0, "sales_based": 1, "held_overnight": 0,
        "searching": False, "skipped": 0, "last_report": "2026-10-11.md",
        "need_snipe": ["111111111111"], "cost_today": 0.84, "calls_today": 19,
        "cost_month": 11.37,
    },
    "picks": [PICK],
    "gixen": {"available": True, "problem": None, "read_at": "2026-10-12T17:55:00-04:00",
              "snipes": [{"item_id": "222222222222", "end_time": "2099-01-02T21:00-05:00",
                          "max_bid": 8.08, "current_bid": 2.0, "outbid": False,
                          "title": "2022 Bowman Chrome", "seller": "x", "bot_max": None,
                          "tier": None, "url": "https://www.ebay.com/itm/222222222222"}],
              "outbid_count": 0, "committed": 8.08},
    "cards": [{"id": "1", "n": "2023 Topps #1", "s": "Delivered", "p": 2.0,
               "d": "2026-10-01", "pg": "page 3", "f": "R", "sl": "x"}],
    "collection": {"cards": 1, "spent": 2.0, "avg_paid": 2.0, "month": "2026-10",
                   "month_cards": 1, "month_spent": 2.0, "by_status": {"Delivered": 1},
                   "by_year": {"2023": 1}, "rookies": 1, "autos": 0, "relics": 0,
                   "numbered": 0, "graded": 0, "front_page": 0, "dupes": 0, "priciest": []},
    "pipeline": {"unpaid": [], "unpaid_total": 0.0, "unpaid_cards": 0, "in_transit": 0,
                 "to_file": 1},
    "record": {"rate": 50, "days": 30, "wins": 1, "losses": 1, "gixen_wins": 1,
               "gixen_losses": 1, "wins_week": 0, "losses_week": 0, "recent_losses": []},
    "wantlist": [{"target": "2020 Bowman Chrome auto", "ceiling": "$60", "notes": ""}],
    "settings": {"alerts_enabled": True, "quiet_start": "23:00", "monthly_budget": 100.0,
                 "sellers": ["a", "b"]},
    "last_action": None,
}


class FakeBot:
    """Stands in for the API client; remembers what it was asked to do."""

    def __init__(self) -> None:
        self.snapshot = copy.deepcopy(SNAPSHOT)
        self.actions: list[dict] = []
        self.settings: list[dict] = []
        self.error: Exception | None = None
        self.by_url: dict[str, FakeBot] = {}   # other pretend bots, by address

    def __call__(self, session, url: str = "", token: str = "") -> "FakeBot":
        return self.by_url.get(url, self)

    async def async_snapshot(self) -> dict:
        if self.error:
            raise self.error
        return copy.deepcopy(self.snapshot)

    async def async_action(self, data: dict) -> dict:
        self.actions.append(data)
        ok = data["action"] != "buy"
        return {"ok": ok, "message": "Done." if ok else "Unknown action 'buy'",
                "snapshot": copy.deepcopy(self.snapshot)}

    async def async_settings(self, changes: dict) -> dict:
        self.settings.append(changes)
        self.snapshot["settings"].update(changes)
        return {"ok": True, "message": "Saved.", "snapshot": copy.deepcopy(self.snapshot)}


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Let Home Assistant load the integration under test."""


@pytest.fixture
def bot():
    fake = FakeBot()
    with (
        patch("custom_components.snipe_hunt.coordinator.SnipeHuntClient", fake),
        patch("custom_components.snipe_hunt.config_flow.SnipeHuntClient", fake),
    ):
        yield fake


@pytest.fixture
async def entry(hass, bot):
    entry = MockConfigEntry(domain=DOMAIN, title="Snipe Hunt",
                            data={CONF_URL: "http://bot.test:8766", CONF_TOKEN: "t"})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry
