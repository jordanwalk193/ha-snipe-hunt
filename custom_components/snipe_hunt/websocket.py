"""Websocket commands the dashboard cards use."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

from .const import OPT_ACCENT, OPT_PICKS_PER_PAGE, OPT_REPORT_URL, OPT_TABS
from .coordinator import SnipeHuntCoordinator, options
from .helpers import get_coordinator


def _card_options(coordinator: SnipeHuntCoordinator) -> dict[str, Any]:
    """The integration options the cards and the dashboard strategy care about."""
    opts = options(coordinator.config_entry)
    red, green, blue = (int(v) for v in opts[OPT_ACCENT])
    return {
        "accent": f"#{red:02x}{green:02x}{blue:02x}",
        "picks_per_page": int(opts[OPT_PICKS_PER_PAGE]),
        "tabs": list(opts[OPT_TABS]),
        "report_url": opts[OPT_REPORT_URL],
    }


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_subscribe)
    websocket_api.async_register_command(hass, ws_options)
    websocket_api.async_register_command(hass, ws_action)


@websocket_api.websocket_command({vol.Required("type"): "snipe_hunt/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Send the snapshot now and again every time it changes."""
    try:
        coordinator = get_coordinator(hass)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "not_ready", str(err))
        return

    @callback
    def forward() -> None:
        connection.send_message(websocket_api.event_message(msg["id"], {
            "snapshot": coordinator.data,
            "ok": coordinator.last_update_success,
            "options": _card_options(coordinator),
        }))

    connection.subscriptions[msg["id"]] = coordinator.async_add_listener(forward)
    connection.send_result(msg["id"])
    forward()


@websocket_api.websocket_command({vol.Required("type"): "snipe_hunt/options"})
@callback
def ws_options(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """The dashboard options, for the strategy that lays the dashboard out."""
    try:
        connection.send_result(msg["id"], _card_options(get_coordinator(hass)))
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "not_ready", str(err))


@websocket_api.websocket_command({
    vol.Required("type"): "snipe_hunt/action",
    vol.Required("action"): str,
    vol.Optional("data", default=dict): dict,
})
@websocket_api.async_response
async def ws_action(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
    """Run a bot action for a dashboard button. The bot decides what is allowed."""
    try:
        message = await get_coordinator(hass).async_action(msg["action"], **msg["data"])
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "action_failed", str(err))
        return
    connection.send_result(msg["id"], {"message": message})
