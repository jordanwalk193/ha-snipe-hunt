"""Constants for the Snipe Hunt integration."""
from __future__ import annotations

DOMAIN = "snipe_hunt"
API_VERSION = 1

CONF_URL = "url"
CONF_TOKEN = "token"

OPT_SCAN_INTERVAL = "scan_interval"
OPT_ACCENT = "accent_color"
OPT_PICKS_PER_PAGE = "picks_per_page"
OPT_TABS = "tabs"
OPT_EVENT_TIERS = "event_tiers"
OPT_REPORT_URL = "report_url"
OPT_SOON_MINUTES = "ending_soon_minutes"

TABS = ["today", "picks", "gixen", "collection", "bot"]
TIERS = ["fire", "green", "yellow"]
DEFAULT_OPTIONS = {
    OPT_SCAN_INTERVAL: 30,
    OPT_ACCENT: [196, 30, 58],   # Cardinals red
    OPT_PICKS_PER_PAGE: 25,
    OPT_TABS: TABS,
    OPT_EVENT_TIERS: TIERS,
    OPT_REPORT_URL: "",
    OPT_SOON_MINUTES: 30,
}

EVENT_NEW_PICK = "snipe_hunt_new_pick"
FRONTEND_URL = "/snipe_hunt/snipe-hunt.js"
