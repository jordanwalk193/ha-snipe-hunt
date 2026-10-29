"""An event entity that fires for each new pick, so automations can pick it in the UI."""
from __future__ import annotations

from homeassistant.components.event import EventEntity
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import EVENT_NEW_PICK, TIERS
from .coordinator import SnipeHuntConfigEntry
from .entity import SnipeHuntEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: SnipeHuntConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([SnipeHuntNewPick(entry.runtime_data, "new_pick")])


class SnipeHuntNewPick(SnipeHuntEntity, EventEntity):
    """Fires with the pick's tier as the event type and the pick as its attributes."""

    _attr_event_types = TIERS

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(self.hass.bus.async_listen(EVENT_NEW_PICK, self._new_pick))

    @callback
    def _new_pick(self, event: Event) -> None:
        """Only this bot's picks: with several bots, each event entity is its own."""
        if event.data.get("entry_id") not in (None, self.coordinator.config_entry.entry_id):
            return
        if event.data.get("tier") in TIERS:
            self._trigger_event(event.data["tier"], dict(event.data))
            self.async_write_ha_state()
