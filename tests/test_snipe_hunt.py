"""The integration against a pretend bot."""
from __future__ import annotations

import pytest

from homeassistant.config_entries import SOURCE_USER, ConfigEntryState
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er

from custom_components.snipe_hunt.api import SnipeHuntAuthError, SnipeHuntError
from custom_components.snipe_hunt.const import CONF_TOKEN, CONF_URL, DOMAIN, EVENT_NEW_PICK

from .conftest import PICK, FakeBot


def state(hass, entry, domain: str, key: str):
    entity_id = er.async_get(hass).async_get_entity_id(domain, DOMAIN, f"{entry.entry_id}_{key}")
    assert entity_id, f"no {domain} entity for {key}"
    return hass.states.get(entity_id)


async def test_user_flow_checks_the_bot_before_saving(hass, bot):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.FORM

    bot.error = SnipeHuntAuthError("no")
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: "bot.test:8766/", CONF_TOKEN: "bad"})
    assert result["errors"] == {"base": "invalid_auth"}

    bot.error = SnipeHuntError("down")
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: "bot.test:8766/", CONF_TOKEN: "t"})
    assert result["errors"] == {"base": "cannot_connect"}

    bot.error = None
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: "bot.test:8766/", CONF_TOKEN: " t "})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {CONF_URL: "http://bot.test:8766", CONF_TOKEN: "t"}


async def test_top_pick_is_the_best_steal_and_never_a_one_star_pick(hass, entry, bot):
    bot.snapshot["picks"] = [
        {**PICK, "item_id": "1", "card": "about the going rate", "deal": 1, "value": 19.0},
        {**PICK, "item_id": "2", "card": "good", "tier": "green", "deal": 3, "value": 30.0},
        {**PICK, "item_id": "3", "card": "best", "deal": 4, "value": 40.0},
        {**PICK, "item_id": "4", "card": "bid past its max", "deal": 5, "value": 90.0,
         "bid_now": 20.0},
        {**PICK, "item_id": "5", "card": "cheap card", "tier": "yellow", "deal": 5},
        {**PICK, "item_id": "6", "card": "guessed price", "tier": "green", "deal": 5,
         "value": 99.0, "unverified": True, "is_auction": False}]
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert state(hass, entry, "sensor", "top_pick").state == "best"
    bot.snapshot["picks"][2]["snipe"] = {"max": 12.12}      # covered: on to the next steal
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert state(hass, entry, "sensor", "top_pick").state == "good"
    bot.snapshot["picks"] = bot.snapshot["picks"][:1]       # only the one-star pick is left
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert state(hass, entry, "sensor", "top_pick").state == "unknown"


async def test_scorecard_sensors_wait_for_a_bot_that_keeps_sold_prices(hass, entry, bot):
    assert state(hass, entry, "sensor", "sold_prices").state == "unknown"
    assert state(hass, entry, "sensor", "calls_under_max").state == "unknown"
    bot.snapshot["market"] = {"count": 40, "count_7d": 12, "calls": 8, "under_max": 6,
                              "over_max": 2, "value_gap_pct": 14, "value_bias_pct": 6,
                              "sold": []}
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    sold = state(hass, entry, "sensor", "sold_prices")
    assert sold.state == "40" and sold.attributes["last_7_days"] == 12
    under = state(hass, entry, "sensor", "calls_under_max")
    assert under.state == "75" and under.attributes["over_max"] == 2


async def test_entities_reflect_the_snapshot(hass, entry):
    assert entry.state is ConfigEntryState.LOADED
    assert state(hass, entry, "sensor", "status").state == "ok"
    assert state(hass, entry, "sensor", "live_picks").state == "1"
    assert state(hass, entry, "sensor", "need_snipe").attributes["item_ids"] == ["111111111111"]
    top = state(hass, entry, "sensor", "top_pick")
    assert top.state == PICK["card"] and top.attributes["max"] == 12.12
    assert state(hass, entry, "sensor", "gixen_snipes").state == "1"
    assert state(hass, entry, "sensor", "next_snipe").state.startswith("2099-01-03T02:00")
    assert state(hass, entry, "sensor", "budget_left").state == "98.0"
    assert state(hass, entry, "sensor", "win_rate").state == "50"
    assert state(hass, entry, "sensor", "claude_cost_month").state == "11.37"
    assert state(hass, entry, "sensor", "claude_cost_today").attributes["calls"] == 19
    assert state(hass, entry, "binary_sensor", "problem").state == "off"
    assert state(hass, entry, "binary_sensor", "over_budget").state == "off"
    assert state(hass, entry, "binary_sensor", "gixen_connected").state == "on"


async def test_settings_show_only_what_the_bot_exposes(hass, entry, bot):
    assert state(hass, entry, "switch", "alerts_enabled").state == "on"
    assert state(hass, entry, "time", "quiet_start").state == "23:00:00"
    assert state(hass, entry, "number", "monthly_budget").state == "100.0"
    assert state(hass, entry, "text", "sellers").state == "a, b"
    # The pretend bot doesn't expose these, so they must not pretend to work.
    assert state(hass, entry, "switch", "quiet_hours").state == "unavailable"
    assert state(hass, entry, "number", "urgent_hours").state == "unavailable"

    budget = state(hass, entry, "number", "monthly_budget").entity_id
    await hass.services.async_call("number", "set_value",
                                   {"entity_id": budget, "value": 150}, blocking=True)
    alerts = state(hass, entry, "switch", "alerts_enabled").entity_id
    await hass.services.async_call("switch", "turn_off", {"entity_id": alerts}, blocking=True)
    sellers = state(hass, entry, "text", "sellers").entity_id
    await hass.services.async_call("text", "set_value",
                                   {"entity_id": sellers, "value": "a, c ,"}, blocking=True)
    quiet = state(hass, entry, "time", "quiet_start").entity_id
    await hass.services.async_call("time", "set_value",
                                   {"entity_id": quiet, "time": "22:30:00"}, blocking=True)
    assert bot.settings == [{"monthly_budget": 150.0}, {"alerts_enabled": False},
                            {"sellers": ["a", "c"]}, {"quiet_start": "22:30"}]
    assert state(hass, entry, "switch", "alerts_enabled").state == "off"
    assert state(hass, entry, "sensor", "budget_left").state == "148.0"


async def test_buttons_and_services_reach_the_bot(hass, entry, bot):
    button = state(hass, entry, "button", "gixen_sign_in").entity_id
    await hass.services.async_call("button", "press", {"entity_id": button}, blocking=True)
    await hass.services.async_call(DOMAIN, "skip_pick", {"item_id": "111111111111"},
                                   blocking=True)
    response = await hass.services.async_call(
        DOMAIN, "mark_filed", {"ids": ["1", "2"]}, blocking=True, return_response=True)
    assert response == {"message": "Done."}
    assert bot.actions == [
        {"action": "gixen_refresh", "login": True},
        {"action": "skip", "item_id": "111111111111"},
        {"action": "filed", "ids": ["1", "2"]},
    ]
    with pytest.raises(Exception):   # not an item number: refused before the bot sees it
        await hass.services.async_call(DOMAIN, "skip_pick", {"item_id": "x"}, blocking=True)
    assert len(bot.actions) == 3


async def test_guess_and_seller_settings_are_numbers(hass, entry, bot):
    bot.snapshot["settings"].update(estimate_bin_cap=25.0, min_seller_feedback=100)
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    cap = state(hass, entry, "number", "estimate_bin_cap")
    assert cap.state == "25.0"
    assert state(hass, entry, "number", "min_seller_feedback").state == "100"
    await hass.services.async_call("number", "set_value",
                                   {"entity_id": cap.entity_id, "value": 40}, blocking=True)
    assert bot.settings[-1] == {"estimate_bin_cap": 40.0}


async def test_pick_feedback_reaches_the_bot_with_a_reason_and_note(hass, entry, bot):
    await hass.services.async_call(
        DOMAIN, "pick_feedback",
        {"item_id": "111111111111", "reason": "overvalued", "note": "signed base, ~$25"},
        blocking=True)
    await hass.services.async_call(
        DOMAIN, "pick_feedback", {"item_id": "111111111111", "reason": "good_pick"},
        blocking=True)
    assert bot.actions == [
        {"action": "feedback", "item_id": "111111111111", "reason": "overvalued",
         "note": "signed base, ~$25"},
        {"action": "feedback", "item_id": "111111111111", "reason": "good_pick", "note": ""},
    ]
    for bad in ({"item_id": "111111111111", "reason": "meh"},
                {"item_id": "111111111111", "reason": "other", "note": "x" * 201},
                {"item_id": "x", "reason": "other"}):
        with pytest.raises(Exception):   # refused before the bot sees it
            await hass.services.async_call(DOMAIN, "pick_feedback", bad, blocking=True)
    assert len(bot.actions) == 2


async def test_new_picks_fire_an_event_once(hass, entry, bot):
    events = []
    hass.bus.async_listen(EVENT_NEW_PICK, events.append)
    coordinator = entry.runtime_data
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    assert events == []   # the pick was there from the start

    bot.snapshot["picks"].append({**PICK, "item_id": "333333333333", "tier": "green"})
    bot.snapshot["picks"].append({**PICK, "item_id": "444444444444", "tier": "yellow"})
    hass.config_entries.async_update_entry(entry, options={"event_tiers": ["fire", "green"]})
    await hass.async_block_till_done()   # options changed: the entry reloads
    coordinator = entry.runtime_data
    bot.snapshot["picks"].append({**PICK, "item_id": "555555555555", "tier": "green"})
    await coordinator.async_refresh()
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    assert [e.data["item_id"] for e in events] == ["555555555555"]


async def test_dashboard_websocket(hass, entry, bot, hass_ws_client):
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "snipe_hunt/subscribe"})
    assert (await client.receive_json())["success"]
    event = (await client.receive_json())["event"]
    assert event["snapshot"]["picks"][0]["item_id"] == "111111111111"
    assert event["options"]["accent"] == "#c41e3a" and event["options"]["tabs"][0] == "tonight"

    await client.send_json_auto_id(
        {"type": "snipe_hunt/action", "action": "skip", "data": {"item_id": "111111111111"}})
    messages = [await client.receive_json(), await client.receive_json()]
    assert any(m.get("result") == {"message": "Done."} for m in messages)
    assert any(m["type"] == "event" for m in messages)   # the fresh snapshot is pushed too

    await client.send_json_auto_id({"type": "snipe_hunt/action", "action": "buy"})
    reply = await client.receive_json()
    while reply["type"] == "event":
        reply = await client.receive_json()
    assert not reply["success"] and "Unknown action" in reply["error"]["message"]

    await client.send_json_auto_id({"type": "snipe_hunt/options"})
    reply = await client.receive_json()
    while reply["type"] == "event":
        reply = await client.receive_json()
    assert reply["result"]["picks_per_page"] == 25


async def test_bot_going_away_makes_entities_unavailable(hass, entry, bot):
    bot.error = SnipeHuntError("down")
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert state(hass, entry, "sensor", "status").state == "unavailable"
    button = state(hass, entry, "button", "search_now").entity_id
    assert hass.states.get(button).state == "unavailable"


async def test_options_flow_and_unload(hass, entry):
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(result["flow_id"], {
        "scan_interval": 60, "tabs": ["tonight", "stats"], "picks_per_page": 10,
        "accent_color": [0, 0, 255], "event_tiers": ["fire"],
        "ending_soon_minutes": 45})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    assert entry.runtime_data.update_interval.total_seconds() == 60
    assert await hass.config_entries.async_unload(entry.entry_id)
    with pytest.raises(HomeAssistantError):
        await hass.services.async_call(DOMAIN, "refresh", {}, blocking=True)


async def test_calendar_event_entity_and_ending_soon(hass, entry, bot, hass_client):
    from datetime import timedelta

    from homeassistant.util import dt as dt_util

    calendar = state(hass, entry, "calendar", "auctions")
    assert calendar.attributes["message"].startswith("⚠️ No snipe: 2023 Topps Chrome")
    client = await hass_client()
    resp = await client.get(f"/api/calendars/{calendar.entity_id}"
                            "?start=2099-01-01T00:00:00Z&end=2099-01-04T00:00:00Z")
    summaries = [e["summary"] for e in await resp.json()]
    assert len(summaries) == 2 and summaries[1].startswith("🎯 Snipe 8.08")

    assert state(hass, entry, "binary_sensor", "unsniped_ending_soon").state == "off"
    soon = (dt_util.now() + timedelta(minutes=10)).isoformat(timespec="minutes")
    bot.snapshot["picks"].append({**PICK, "item_id": "666666666666", "tier": "green",
                                  "end_time": soon})
    bot.snapshot["status"]["need_snipe"].append("666666666666")
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    ending = state(hass, entry, "binary_sensor", "unsniped_ending_soon")
    assert ending.state == "on" and ending.attributes["item_id"] == "666666666666"
    new_pick = state(hass, entry, "event", "new_pick")
    assert new_pick.attributes["event_type"] == "green"
    assert new_pick.attributes["item_id"] == "666666666666"


def test_old_tab_names_are_upgraded():
    from custom_components.snipe_hunt.const import TABS, upgrade_tabs
    assert upgrade_tabs(["today", "picks", "gixen", "collection", "bot"]) == TABS
    assert upgrade_tabs(["collection", "gixen", "bot"]) == ["collection", "stats"]
    assert upgrade_tabs(["nope"]) == TABS


async def test_several_bots_each_get_their_own_entities_events_and_dashboard(
    hass, entry, bot, hass_ws_client
):
    """A second bot (another player or collection) is its own entry, named after
    the bot, with its own entity ids; cards, services and events name the bot."""
    monday = FakeBot()
    monday.snapshot["profile"] = {"app_name": "Monday Hunt", "player": "Rick Monday"}
    monday.snapshot["picks"] = [{**PICK, "item_id": "999999999999", "card": "1967 Topps #542"}]
    bot.by_url["http://monday.test:8767"] = monday

    # The entry from before there could be several bots gets its address as unique id.
    assert entry.unique_id == "http://bot.test:8766"
    # The same bot twice is refused; a second bot at its own address is named after itself.
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: "http://bot.test:8766/", CONF_TOKEN: "t"})
    assert result["type"] is FlowResultType.ABORT and result["reason"] == "already_configured"
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_URL: "monday.test:8767", CONF_TOKEN: "m"})
    assert result["type"] is FlowResultType.CREATE_ENTRY and result["title"] == "Monday Hunt"
    await hass.async_block_till_done()
    second = result["result"]
    assert second.state is ConfigEntryState.LOADED

    # Each bot's entities carry its own name, so the ids don't collide.
    assert state(hass, entry, "sensor", "live_picks").entity_id == "sensor.snipe_hunt_live_picks"
    picks = state(hass, second, "sensor", "live_picks")
    assert picks.entity_id == "sensor.monday_hunt_live_picks" and picks.state == "1"
    assert state(hass, second, "sensor", "top_pick").state == "1967 Topps #542"

    # The dashboard asks for a bot by name (any case) or entry id; unnamed, the first bot answers.
    client = await hass_ws_client(hass)
    for who, item in (({}, "111111111111"), ({"entry": "monday hunt"}, "999999999999"),
                      ({"entry": second.entry_id}, "999999999999")):
        await client.send_json_auto_id({"type": "snipe_hunt/subscribe", **who})
        assert (await client.receive_json())["success"]
        event = (await client.receive_json())["event"]
        assert event["snapshot"]["picks"][0]["item_id"] == item
        if who:
            assert event["options"]["name"] == "Monday Hunt"
            assert event["options"]["entry_id"] == second.entry_id
    assert [b["name"] for b in event["options"]["bots"]] == ["Snipe Hunt", "Monday Hunt"]
    assert event["options"]["gixen_account"] is True   # a bot that doesn't say has one
    monday.snapshot["gixen_account"] = False
    await second.runtime_data.async_refresh()
    await client.send_json_auto_id({"type": "snipe_hunt/options", "entry": "Monday Hunt"})
    reply = await client.receive_json()
    while reply["type"] == "event":
        reply = await client.receive_json()
    assert reply["result"]["gixen_account"] is False
    await client.send_json_auto_id({"type": "snipe_hunt/options", "entry": "Nobody"})
    reply = await client.receive_json()
    while reply["type"] == "event":
        reply = await client.receive_json()
    assert not reply["success"] and "Nobody" in reply["error"]["message"]

    # Buttons and services reach the bot they name.
    await client.send_json_auto_id({"type": "snipe_hunt/action", "action": "skip",
                                    "data": {"item_id": "999999999999"}, "entry": "Monday Hunt"})
    reply = await client.receive_json()
    while reply["type"] == "event":
        reply = await client.receive_json()
    assert reply["success"]
    await hass.services.async_call(DOMAIN, "search_now", {"entry": second.entry_id}, blocking=True)
    await hass.services.async_call(DOMAIN, "search_now", {}, blocking=True)
    assert monday.actions == [{"action": "skip", "item_id": "999999999999"}, {"action": "search"}]
    assert bot.actions == [{"action": "search"}]

    # A new pick says which bot found it, and only that bot's event entity fires.
    events = []
    hass.bus.async_listen(EVENT_NEW_PICK, events.append)
    monday.snapshot["picks"].append({**PICK, "item_id": "888888888888", "card": "1969 Topps #105"})
    await second.runtime_data.async_refresh()
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert [(e.data["item_id"], e.data["bot"], e.data["entry_id"]) for e in events] == [
        ("888888888888", "Monday Hunt", second.entry_id)]
    assert state(hass, second, "event", "new_pick").attributes["card"] == "1969 Topps #105"
    assert state(hass, entry, "event", "new_pick").state == "unknown"


async def test_a_tap_on_an_alert_button_reaches_the_bot(hass, entry, bot):
    from custom_components.snipe_hunt import NOTIFICATION_EVENT
    hass.bus.async_fire(NOTIFICATION_EVENT, {"action": "SNIPE_HUNT_SNIPED_111111111111"})
    hass.bus.async_fire(NOTIFICATION_EVENT, {"action": "SNIPE_HUNT_SKIP_111111111111"})
    hass.bus.async_fire(NOTIFICATION_EVENT, {"action": "SNIPE_HUNT_NOPE_111111111111"})   # unknown op
    hass.bus.async_fire(NOTIFICATION_EVENT, {"action": "SOMETHING_ELSE"})
    await hass.async_block_till_done()
    assert bot.actions == [{"action": "sniped", "item_id": "111111111111"},
                           {"action": "skip", "item_id": "111111111111"}]
