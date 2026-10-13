<p align="center"><img src="docs/logo.png" width="120" alt="Snipe Hunt logo"></p>

# Snipe Hunt for Home Assistant

[![HACS: custom](https://img.shields.io/badge/HACS-custom-41BDF5.svg)](https://hacs.xyz)
[![Validate](https://github.com/jordanwalk193/ha-snipe-hunt/actions/workflows/validate.yml/badge.svg)](https://github.com/jordanwalk193/ha-snipe-hunt/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Home Assistant integration for [**Snipe Hunt**](https://github.com/jordanwalk193/snipe-hunt), a self-hosted bot that hunts eBay for underpriced cards of the player you collect. The bot runs on its own machine; this integration shows what it knows, lets you steer it, and ships the dashboard.

Snipe Hunt only recommends. Nothing in this integration can bid, buy, make an offer or change a Gixen snipe, because the bot has no way to do any of those.

![The Today tab: what needs a snipe, the top pick, your snipes ending today and what to pay](docs/today.png)

<p>
<img src="docs/picks.png" width="62%" alt="Every live pick with filters and deal ratings">
<img src="docs/phone.png" width="24%" alt="The dashboard on a phone">
</p>

<sub>Screenshots show the bot's built-in demo data. Every card, price and seller in them is made up.</sub>

## What you get

- **Entities** on one "Snipe Hunt" device: live picks, what needs a snipe, the top pick, Gixen snipes and the next one to end, win rate, collection size and spend, budget left, what's waiting to be paid or filed, and bot health.
- **Settings as entities**: whichever settings the bot exposes show up as switches, numbers, times and text boxes (monthly budget, the "needs a snipe" window, which tiers alert, the minimum deal rating worth an alert, quiet hours, watched sellers, extra searches). A setting the bot doesn't expose shows as unavailable instead of pretending to work.
- **Buttons and services**: search now, refresh, re-read Gixen, sign in to Gixen, restore skipped picks, send a test alert, skip a pick, mark cards filed.
- **Deal ratings and running cost**: every pick shows one to five stars for how far under the going rate you would pay, and two sensors track what Claude has cost today and this month.
- **A dashboard**: one card type with sixteen panels (including a Top 10 deals ranking, best steal first), and a dashboard strategy that lays them out in five tabs. No other custom cards are needed.
- **An auctions calendar**: when each Gixen snipe ends, and good auctions that still have no snipe.
- **Automation hooks**: a "New pick" event entity (and the raw `snipe_hunt_new_pick` event), plus an "Unsniped auction ending soon" sensor that turns on when a good auction with no snipe is about to end.

## Install

1. In HACS, open the menu, choose **Custom repositories**, add `https://github.com/jordanwalk193/ha-snipe-hunt` as an **Integration**, then download **Snipe Hunt**.
2. Restart Home Assistant.
3. Go to **Settings → Devices & services → Add integration → Snipe Hunt**. No bot yet? Start one in [demo mode](https://github.com/jordanwalk193/snipe-hunt#try-it-in-two-minutes) to look around first.

   Then, with a real bot: Enter the bot's address (for example `http://192.0.2.10:8766`) and the `API_TOKEN` from the bot's env file.

## Dashboard

Create a dashboard (**Settings → Dashboards → Add dashboard → New dashboard from scratch**), open it, choose **Edit → Raw configuration editor**, and replace everything with:

```yaml
strategy:
  type: custom:snipe-hunt
```

The tabs, their order, the accent colour and how many picks show before "Show all" are set under **Settings → Devices & services → Snipe Hunt → Configure**. To override the tabs for one dashboard:

```yaml
strategy:
  type: custom:snipe-hunt
  title: Cards
  tabs: [today, picks, collection]
```

### Building your own layout

Any panel can go on any dashboard:

```yaml
type: custom:snipe-hunt-card
panel: need_snipe
title: Snipe these      # optional
accent: "#c41e3a"       # optional
```

| Panel | Shows |
|---|---|
| `summary` | The four numbers that matter today, plus Search and Refresh |
| `top_deals` | The ten best steals, ranked: most deal stars, then brag tier, then dollars under the going rate (`count:` changes the ten) |
| `top_pick` | The best pick you haven't sniped yet |
| `need_snipe` | Good auctions ending soon with no snipe |
| `snipes_today` | Your Gixen snipes ending in the next 24 hours |
| `pay` | Wins waiting on payment, grouped by seller |
| `all_picks` | Every live pick, with filters and sorting |
| `wantlist` | Chase targets and price ceilings |
| `gixen` | Every scheduled snipe |
| `gixen_gap` | Good auctions with no snipe (same list as `need_snipe`, no intro) |
| `record` | Win rate and the ones that got away |
| `collection` | Collection stats and this month's spend against the budget |
| `to_file` | Delivered cards to put in the binder, with Filed buttons |
| `on_the_way` | Cards in the mail and wins not yet shipped |
| `binder` | A searchable list of every card |
| `health` | Bot health and its buttons |

## Options

**Configure** on the integration sets how often Home Assistant checks the bot (30 seconds by default), the dashboard tabs, picks per page, the accent colour, which tiers fire the new-pick event, how many minutes count as "ending soon", and an optional web address for the weekly reports folder.

## Automations

```yaml
triggers:
  - trigger: event
    event_type: snipe_hunt_new_pick
    event_data:
      tier: fire
actions:
  - action: light.turn_on
    target:
      entity_id: light.office_lamp
    data:
      color_name: red
```

Or get told when a good auction is about to end with no snipe on it:

```yaml
triggers:
  - trigger: state
    entity_id: binary_sensor.snipe_hunt_unsniped_auction_ending_soon
    to: "on"
actions:
  - action: notify.mobile_app_your_phone
    data:
      title: No snipe yet
      message: "{{ state_attr(trigger.entity_id, 'card') }} ends soon. Max {{ state_attr(trigger.entity_id, 'max') }}"
      data:
        url: "{{ state_attr(trigger.entity_id, 'url') }}"
```

The event carries the pick: `item_id`, `card`, `tier`, `price`, `shipping`, `total`, `max`, `max_basis`, `value`, `deal` (1 to 5 stars), `deal_pct`, `is_auction`, `end_time`, `seller`, `why`, `url`, `image`.

Services: `snipe_hunt.search_now`, `refresh`, `skip_pick` (`item_id`), `restore_skipped`, `mark_filed` (`ids`), `gixen_refresh` (`login`), `send_test_alert`.

## The bot's API

[Snipe Hunt](https://github.com/jordanwalk193/snipe-hunt) serves this out of the box. The integration expects the bot to serve, behind a bearer token:

- `GET /api/snapshot`: one JSON object with `api: 1`, `status`, `picks`, `gixen`, `cards`, `collection`, `pipeline`, `record`, `wantlist`, `settings` and `last_action`.
- `POST /api/action`: `{"action": "...", ...}`; answers `{"ok", "message", "snapshot"}`.
- `POST /api/settings`: `{"setting": value, ...}`; same answer.

## License

MIT. See `LICENSE`.

## Development

```
pip install pytest-homeassistant-custom-component
pytest
```

## Support

This integration is free. If it finds you a steal and you'd like to say thanks:

[![Donate with PayPal](https://img.shields.io/badge/Donate-PayPal-00457C?logo=paypal&logoColor=white)](https://paypal.me/jordanwalker1531)
