"""Constants for the Walker Scout integration."""
from __future__ import annotations

DOMAIN = "walker_scout"
API_VERSION = 1

CONF_URL = "url"
CONF_TOKEN = "token"

OPT_SCAN_INTERVAL = "scan_interval"
OPT_ACCENT = "accent_color"
OPT_PICKS_PER_PAGE = "picks_per_page"
OPT_TABS = "tabs"
OPT_EVENT_TIERS = "event_tiers"
OPT_REPORT_URL = "report_url"

TABS = ["today", "picks", "gixen", "collection", "bot"]
TIERS = ["fire", "green", "yellow"]
DEFAULT_OPTIONS = {
    OPT_SCAN_INTERVAL: 30,
    OPT_ACCENT: [196, 30, 58],   # Cardinals red
    OPT_PICKS_PER_PAGE: 25,
    OPT_TABS: TABS,
    OPT_EVENT_TIERS: TIERS,
    OPT_REPORT_URL: "",
}

EVENT_NEW_PICK = "walker_scout_new_pick"
FRONTEND_URL = "/walker_scout/walker-scout.js"
