"""Client for the Snipe Hunt bot's local API."""
from __future__ import annotations

import asyncio
from typing import Any

import aiohttp

from .const import API_VERSION

TIMEOUT = aiohttp.ClientTimeout(total=45)   # filing cards waits on a git pull


class SnipeHuntError(Exception):
    """The bot could not be reached or answered with an error."""


class SnipeHuntAuthError(SnipeHuntError):
    """The bot rejected the token."""


class SnipeHuntClient:
    """Talks to src/api.py on the machine the bot runs on."""

    def __init__(self, session: aiohttp.ClientSession, url: str, token: str) -> None:
        self._session = session
        self._url = url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}

    async def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        try:
            async with self._session.request(
                method, self._url + path, json=body, headers=self._headers,
                timeout=TIMEOUT,
            ) as resp:
                if resp.status == 401:
                    raise SnipeHuntAuthError("The bot rejected the token")
                data = await resp.json(content_type=None)
                if resp.status >= 400:
                    message = data.get("message") if isinstance(data, dict) else None
                    raise SnipeHuntError(message or f"The bot answered {resp.status}")
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise SnipeHuntError(f"Can't reach the bot: {err or type(err).__name__}") from err
        except ValueError as err:
            raise SnipeHuntError("The bot's answer wasn't JSON") from err
        if not isinstance(data, dict):
            raise SnipeHuntError("The bot's answer wasn't an object")
        return data

    async def async_snapshot(self) -> dict[str, Any]:
        """Everything the bot knows right now."""
        return check_snapshot(await self._request("GET", "/api/snapshot"))

    async def async_action(self, data: dict[str, Any]) -> dict[str, Any]:
        """Run one of the bot's actions. Returns ok, message and a fresh snapshot."""
        return await self._request("POST", "/api/action", data)

    async def async_settings(self, changes: dict[str, Any]) -> dict[str, Any]:
        """Change bot settings. Returns ok, message and a fresh snapshot."""
        return await self._request("POST", "/api/settings", changes)


def check_snapshot(data: dict[str, Any]) -> dict[str, Any]:
    """Make sure the bot speaks the version of the API this integration knows."""
    if data.get("api") != API_VERSION or "status" not in data:
        raise SnipeHuntError(
            f"The bot speaks API version {data.get('api')!r}; this integration "
            f"needs version {API_VERSION}. Update whichever is older."
        )
    return data
