"""Set up Snipe Hunt from the UI, and change how it looks and polls."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    ColorRGBSelector,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .api import SnipeHuntAuthError, SnipeHuntClient, SnipeHuntError
from .helpers import bot_name
from .const import (
    CONF_TOKEN,
    CONF_URL,
    DEFAULT_OPTIONS,
    DOMAIN,
    OPT_ACCENT,
    OPT_EVENT_TIERS,
    OPT_PICKS_PER_PAGE,
    OPT_REPORT_URL,
    OPT_SCAN_INTERVAL,
    OPT_SOON_MINUTES,
    OPT_TABS,
    TABS,
    TIERS,
)

PASSWORD = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))
URL = TextSelector(TextSelectorConfig(type=TextSelectorType.URL))

OPTIONS_SCHEMA = vol.Schema({
    vol.Required(OPT_SCAN_INTERVAL): NumberSelector(NumberSelectorConfig(
        min=10, max=600, step=5, unit_of_measurement="s", mode=NumberSelectorMode.BOX)),
    vol.Required(OPT_TABS): SelectSelector(SelectSelectorConfig(
        options=TABS, multiple=True, translation_key="tabs")),
    vol.Required(OPT_PICKS_PER_PAGE): NumberSelector(NumberSelectorConfig(
        min=5, max=200, step=5, mode=NumberSelectorMode.BOX)),
    vol.Required(OPT_ACCENT): ColorRGBSelector(),
    vol.Required(OPT_EVENT_TIERS): SelectSelector(SelectSelectorConfig(
        options=TIERS, multiple=True, translation_key="tiers")),
    vol.Required(OPT_SOON_MINUTES): NumberSelector(NumberSelectorConfig(
        min=1, max=720, step=1, unit_of_measurement="min", mode=NumberSelectorMode.BOX)),
    vol.Optional(OPT_REPORT_URL): URL,
})


def _clean_url(url: str) -> str:
    url = url.strip().rstrip("/")
    return url if "://" in url else f"http://{url}"


class SnipeHuntConfigFlow(ConfigFlow, domain=DOMAIN):
    """Ask where the bot is and check that it answers."""

    VERSION = 1

    async def _async_check(self, url: str, token: str) -> tuple[str | None, dict]:
        """An error key, or None and the snapshot if the bot answered."""
        client = SnipeHuntClient(async_get_clientsession(self.hass), url, token)
        try:
            snapshot = await client.async_snapshot()
        except SnipeHuntAuthError:
            return "invalid_auth", {}
        except SnipeHuntError as err:
            return ("unsupported" if "API version" in str(err) else "cannot_connect"), {}
        return None, snapshot

    def _taken(self, url: str, except_entry: ConfigEntry | None = None) -> bool:
        """Is this bot address already set up as another entry?"""
        return any(entry.data.get(CONF_URL) == url
                   for entry in self._async_current_entries(include_ignore=False)
                   if except_entry is None or entry.entry_id != except_entry.entry_id)

    def _schema(self, defaults: Mapping[str, Any]) -> vol.Schema:
        return self.add_suggested_values_to_schema(
            vol.Schema({vol.Required(CONF_URL): URL, vol.Required(CONF_TOKEN): PASSWORD}),
            {CONF_URL: defaults.get(CONF_URL, "http://")},
        )

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            data = {CONF_URL: _clean_url(user_input[CONF_URL]),
                    CONF_TOKEN: user_input[CONF_TOKEN].strip()}
            # One entry per bot address. Several bots (one per player or
            # collection) are fine; the same bot twice is not.
            await self.async_set_unique_id(data[CONF_URL])
            self._abort_if_unique_id_configured()
            if self._taken(data[CONF_URL]):   # set up before addresses were unique ids
                return self.async_abort(reason="already_configured")
            error, snapshot = await self._async_check(data[CONF_URL], data[CONF_TOKEN])
            if error is None:
                return self.async_create_entry(title=bot_name(snapshot), data=data)
            errors["base"] = error
        return self.async_show_form(
            step_id="user", data_schema=self._schema(user_input or {}), errors=errors
        )

    async def async_step_reconfigure(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """The bot moved, or its token changed."""
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            data = {CONF_URL: _clean_url(user_input[CONF_URL]),
                    CONF_TOKEN: user_input[CONF_TOKEN].strip()}
            error, _ = await self._async_check(data[CONF_URL], data[CONF_TOKEN])
            if error is None and self._taken(data[CONF_URL], except_entry=entry):
                error = "already_configured"
            if error is None:
                return self.async_update_reload_and_abort(
                    entry, data=data, unique_id=data[CONF_URL])
            errors["base"] = error
        return self.async_show_form(
            step_id="reconfigure", data_schema=self._schema(user_input or entry.data),
            errors=errors,
        )

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """The bot stopped accepting the token."""
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            token = user_input[CONF_TOKEN].strip()
            error, _ = await self._async_check(entry.data[CONF_URL], token)
            if error is None:
                return self.async_update_reload_and_abort(
                    entry, data_updates={CONF_TOKEN: token}
                )
            errors["base"] = error
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({vol.Required(CONF_TOKEN): PASSWORD}),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> SnipeHuntOptionsFlow:
        return SnipeHuntOptionsFlow()


class SnipeHuntOptionsFlow(OptionsFlow):
    """How often to poll, and how the dashboard looks."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            user_input[OPT_SCAN_INTERVAL] = int(user_input[OPT_SCAN_INTERVAL])
            user_input[OPT_PICKS_PER_PAGE] = int(user_input[OPT_PICKS_PER_PAGE])
            user_input[OPT_SOON_MINUTES] = int(user_input[OPT_SOON_MINUTES])
            return self.async_create_entry(data=user_input)
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(
                OPTIONS_SCHEMA, {**DEFAULT_OPTIONS, **self.config_entry.options}
            ),
        )
