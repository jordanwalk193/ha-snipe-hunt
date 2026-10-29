"""Services for automations and scripts. Each one maps to a bot action."""
from __future__ import annotations

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN
from .helpers import get_coordinator

ITEM_ID = vol.All(cv.string, vol.Match(r"^\d{9,14}$"))
# Which bot, when more than one is set up: its config entry id or its name.
ENTRY = vol.Optional("entry")
# "Bad pick" reasons, then "good call". The bot checks these again and cleans the note.
REASONS = ["overvalued", "wrong_card", "bad_seller", "dont_want_this_type",
           "already_have", "other", "good_pick"]

# service: (bot action, schema)
SERVICES: dict[str, tuple[str, vol.Schema]] = {
    "search_now": ("search", vol.Schema({})),
    "refresh": ("refresh", vol.Schema({})),
    "skip_pick": ("skip", vol.Schema({vol.Required("item_id"): ITEM_ID})),
    "pick_feedback": ("feedback", vol.Schema({
        vol.Required("item_id"): ITEM_ID,
        vol.Required("reason"): vol.In(REASONS),
        vol.Optional("note", default=""): vol.All(cv.string, vol.Length(max=200)),
    })),
    "restore_skipped": ("unskip_all", vol.Schema({})),
    "mark_filed": ("filed", vol.Schema({
        vol.Required("ids"): vol.All(cv.ensure_list, [cv.string], vol.Length(min=1, max=200))
    })),
    "gixen_refresh": ("gixen_refresh", vol.Schema({vol.Optional("login", default=False): cv.boolean})),
    "send_test_alert": ("test_alert", vol.Schema({})),
}


def async_setup_services(hass: HomeAssistant) -> None:
    """Register every service once, when the integration loads."""

    async def handle(call: ServiceCall) -> ServiceResponse:
        action = SERVICES[call.service][0]
        data = dict(call.data)
        coordinator = get_coordinator(hass, data.pop("entry", None))
        message = await coordinator.async_action(action, **data)
        return {"message": message} if call.return_response else None

    for name, (_, schema) in SERVICES.items():
        hass.services.async_register(
            DOMAIN, name, handle, schema=schema.extend({ENTRY: cv.string}),
            supports_response=SupportsResponse.OPTIONAL,
        )
