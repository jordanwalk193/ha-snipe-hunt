/* Snipe Hunt dashboard cards and dashboard strategy.
 *
 * One card type, `custom:snipe-hunt-card`, draws any of the panels below
 * (`panel: summary`, `panel: all_picks`, ...). The strategy
 * `custom:snipe-hunt` lays the panels out as a ready-made dashboard.
 *
 * Data comes from the integration over one websocket subscription shared by
 * every card on the page; buttons go back through `snipe_hunt/action`.
 * Nothing here can bid, buy or change a snipe.
 */
const DOMAIN = 'snipe_hunt';
const GIXEN_URL = 'https://www.gixen.com/main/home_2.php';
// Auctions for the bot's player, ending soonest.
const ebayUrl = d => 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(((d.profile || {}).player || 'sports cards').toLowerCase()) + '&_sop=1&LH_Auction=1';
const HOUR = 3600e3;

// ---------------------------------------------------------------- data feed
// One feed per bot. More than one bot can be set up (one per player or
// collection); a card or dashboard names its bot with `entry` (the config
// entry id or the bot's name). Without it, the first bot set up answers.
const makeFeed = entry => ({
  entry, data: null, options: {}, ok: true, error: null,
  cards: new Set(), connection: null, started: false,
  start(hass) {
    if (this.started && this.connection === hass.connection) return;
    this.started = true;
    this.connection = hass.connection;
    hass.connection.subscribeMessage(msg => {
      this.data = msg.snapshot; this.options = msg.options || {}; this.ok = msg.ok; this.error = null;
      this.redraw();
    }, {type: DOMAIN + '/subscribe', ...(this.entry ? {entry: this.entry} : {})}).catch(err => {
      this.error = (err && err.message) || 'Snipe Hunt is not set up';
      this.started = false;
      this.redraw();
      setTimeout(() => this.cards.size && this.start(hass), 15000);
    });
  },
  redraw() { this.cards.forEach(card => card.draw()); },
});
const feeds = {};
const feedFor = entry => {
  const key = String(entry || '').trim();
  return feeds[key] || (feeds[key] = makeFeed(key));
};

// ------------------------------------------------------------------ helpers
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const money = v => v == null ? '?' : '$' + Number(v).toFixed(2);
const cents = v => Number(v).toFixed(2);
const TIER = {fire: ['🔥', '#ff7043'], green: ['🟢', '#43a047'], yellow: ['🟡', '#f9a825'], drop: ['⏰', '#8e24aa']};
const GOOD = ['fire', 'green'];
const msLeft = iso => new Date(iso) - Date.now();
const left = iso => {
  const ms = msLeft(iso);
  if (ms <= 0) return 'ended';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  if (m < 60) return m + 'm';
  if (h < 48) return h + 'h ' + (m % 60) + 'm';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
};
const when = iso => new Date(iso).toLocaleString([], {weekday: 'short', hour: 'numeric', minute: '2-digit'});
const ago = iso => {
  if (!iso) return 'never';
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  if (m < 2880) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm ago';
  return Math.floor(m / 1440) + ' days ago';
};
// Filter choices live in memory first, so the buttons work even where the browser
// won't keep anything (a private window, strict privacy settings, some phone app
// web views); localStorage only carries them over to the next visit.
const memory = {};
// With several bots set up, each bot's dashboard keeps its own choices: `scope`
// is the bot whose panel is being drawn (set by the card before it draws).
let scope = '';
const scoped = key => (scope ? scope + ':' : '') + key;
const store = (key, def) => {
  key = scoped(key);
  if (key in memory) return memory[key];
  try { return localStorage.getItem('ws_' + key) ?? def; } catch (e) { return def; }
};
const remember = (key, value) => {
  if (key === 'binder_reset') { ['status', 'binder_kind', 'binder_year'].forEach(k => remember(k, 'all')); return; }   // the binder's ✕ Clear filters
  key = scoped(key);
  memory[key] = value;
  try { localStorage.setItem('ws_' + key, value); } catch (e) { /* not kept past this visit */ }
};
const arg = o => esc(JSON.stringify(o));

const cap = text => `<div class="cap">${text}</div>`;
const pill = (text, color) => `<span class="pill" style="background:${color}">${text}</span>`;
const tpill = (text, color, title) => `<span class="pill" style="background:${color}" title="${esc(title)}">${text}</span>`;
const empty = text => `<div class="muted empty">${text}</div>`;
const stat = (label, value, color, icon) => `<div class="stat" style="background:${color}22;border-color:${color}55">
  <div class="stat-icon">${icon}</div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
const grid = (cols, cells) => `<div class="grid" style="grid-template-columns:repeat(${cols},1fr)">${cells.join('')}</div>`;
const tint = color => color ? `background:${color};color:#fff` : '';
const linkBtn = (label, url, color) => `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener" style="${tint(color)}">${label}</a>`;
// One tap to snipe: copies the item # and opens Gixen. With a max, the button
// then turns into "Copy max", so the second paste is one more tap on return.
const snipeBtn = (id, max, label = '🎯 Snipe ↗', color = '#6a1b9a') => `<span class="btn snipe-go" role="button" data-do="snipe" data-text="${esc(id)}"${max == null ? '' : ` data-max="${esc(cents(max))}"`} style="${tint(color)}" title="Copies item # ${esc(id)} and opens Gixen">${label}</span>`;
// Copies text inside the tap itself (no await before it), so phone browsers
// and the companion app allow it; the textarea route covers plain-http pages.
const copyText = text => {
  const legacy = () => {
    const t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = 0;
    document.body.appendChild(t); t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* nothing else to try */ }
    t.remove();
    return ok;
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(legacy);
    return true;
  }
  return legacy();
};
const copyBtn = (label, text) => `<span class="btn" role="button" data-do="copy" data-text="${esc(text)}">${label}</span>`;
// A button that asks the bot to do something. `confirm` makes it a two-tap
// button; `hide` removes the row it sits in straight away.
const act = (label, data, o = {}) => `<span class="btn" role="button" data-do="act" data-payload="${arg(data)}"${o.busy ? ` data-busy="${esc(o.busy)}"` : ''}${o.confirm ? ` data-confirm="${esc(o.confirm)}"` : ''}${o.hide ? ' data-hide' : ''} style="${tint(o.color)}">${label}</span>`;
// Moves to another tab of this dashboard, the way Home Assistant's own links do.
const navBtn = (label, path, color) => `<span class="btn" role="button" data-do="nav" data-path="${esc(path)}" style="${tint(color)}">${label}</span>`;
const setBtn = (label, key, value, color) => `<span class="btn" role="button" data-do="set" data-key="${esc(key)}" data-value="${esc(value)}" style="${tint(color)}">${label}</span>`;
const chips = (key, def, options, current = store(key, def)) => `<div class="row">` + options.map(([value, label]) =>
  `<span class="btn${current === value ? ' on' : ''}" role="button" data-do="set" data-key="${esc(key)}" data-value="${esc(value)}">${label}</span>`).join('') + `</div>`;
const shipTxt = p => p.shipping == null ? 'ship ?' : (p.shipping == 0 ? 'free ship' : money(p.shipping) + ' ship');
// ★★★★☆ 42% under $25 value. For an auction that is at the bot's max, shipping included.
const worth = v => '$' + (Number(v) >= 10 ? Math.round(v) : Number(v).toFixed(2));
const deal = p => {
  if (!p.deal) return '';
  const color = p.deal >= 4 ? '#43a047' : (p.deal === 3 ? '#f9a825' : '#78909c');
  const text = p.deal_pct ? p.deal_pct + '% under ' + worth(p.value) + ' value' + (p.is_auction ? ' at max' : '') : 'about its ' + worth(p.value) + ' value';
  return `<span class="deal" title="How far under its going rate you would pay, shipping included"><span style="color:${color};letter-spacing:1px">${'★'.repeat(p.deal)}<span style="opacity:.3">${'★'.repeat(5 - p.deal)}</span></span> ${text}</span>`;
};
const room = p => p.max == null ? -999 : Number(p.max) - Number(p.bid_now ?? p.price);
// Dollars under the going rate you would pay, shipping included: the asking
// price for Buy It Now, the bot's max for an auction (the same sum the stars use).
const saved = p => p.value == null ? 0 : Number(p.value) - (Number(p.is_auction ? p.max : p.price) + Number(p.shipping ?? 5));
// Steals first: most deal stars, then cards that slipped through the cracks,
// then the brag tier, then the most dollars saved.
// Left out: picks with no rating, ones under 10% below value (one star), and
// auctions already bid past the bot's max.
const TIER_RANK = {fire: 0, green: 1, yellow: 2};
// Sweep focus (the bot's sweep.toml): why a pick is worth a look, what it costs
// delivered, and its sweep score. Highest score first, then the cheapest delivered.
const LABEL = {PRIORITY: ['🎯 Case hit', '#6a1b9a'], VAGUE: ['🕵️ Vague title', '#455a64'], ODDBALL: ['🦄 Oddball', '#00897b'], TYPO: ['✏️ Typo', '#5e35b1'], 'NEW-CARD': ['🆕 New card', '#2e7d32'],
  AUTO: ['✍️ Auto', '#c62828'], 'LOW-NUMBERED': ['#️⃣ Low #', '#ef6c00']};
const labelPills = p => (p.labels || []).filter(l => LABEL[l]).map(l => pill(LABEL[l][0], LABEL[l][1]) + ' ').join('');
const delivered = p => p.landed ?? p.total;
const bySweep = (x, y) => (y.sweep_score ?? -1e9) - (x.sweep_score ?? -1e9) || (delivered(x) ?? 1e9) - (delivered(y) ?? 1e9);
const oldOrder = (x, y) => y.deal - x.deal || !EDGE[x.edge] - !EDGE[y.edge] || (TIER_RANK[x.tier] ?? 3) - (TIER_RANK[y.tier] ?? 3) || saved(y) - saved(x);
// Biggest dollar gap first (the bot's gap: value minus delivered cost now); no gap sorts last.
const byGap = (x, y) => (y.gap ?? -1e9) - (x.gap ?? -1e9);
const steals = picks => picks
  .filter(p => p.deal >= 2 && !(p.is_auction && p.max != null && Number(p.bid_now ?? p.price) > Number(p.max)))
  .sort((x, y) => byGap(x, y) || (x.sweep_score != null && y.sweep_score != null ? bySweep(x, y) : oldOrder(x, y)));

// What every panel gets: the snapshot plus a few views of it.
const context = (card) => {
  const feed = card.feed, d = feed.data, s = d.settings || {};
  const gixen = d.gixen || {};
  const gixenOn = !!gixen.available;
  const all = (d.picks || []).filter(p => !(p.is_auction && p.end_time && msLeft(p.end_time) <= 0));
  const windowMs = (Number(s.need_snipe_hours) || 24) * HOUR;
  const soon = all.filter(p => p.is_auction && p.end_time && msLeft(p.end_time) < windowMs && GOOD.includes(p.tier));
  // A pick already in Gixen (a snipe on its list, or your own "Added to Gixen"
  // mark) steps aside so other steals surface. The 🙈 chip brings them back.
  const covered = new Set(all.filter(inGixen).map(p => p.item_id));
  (gixen.snipes || []).forEach(x => covered.add(x.item_id));
  const hiding = store('hide_gixen', 'on') === 'on';
  const unfolded = hiding ? all.filter(p => !covered.has(p.item_id)) : all;
  // Close to market: a pick that now costs fold_share of its value or more (an
  // auction bid up, a want-list card) folds into a strip under the steals. A
  // jackpot never folds. Bots that don't send fold_share fold nothing.
  const fold = Number(d.fold_share) || 0;
  // Small steals fold too: a pick whose dollar gap is under gap_floor ($50 cards for $4
  // stand out, $5 cards for $3 do not). No gap_floor from the bot means off.
  const floor = Number(d.gap_floor) || 0;
  const nearMarket = p => !p.jackpot && ((fold > 0 && (p.share_now ?? shareNow(p)) != null && (p.share_now ?? shareNow(p)) >= fold) || (floor > 0 && p.gap != null && p.gap < floor));
  const folded = unfolded.filter(nearMarket);
  const picks = unfolded.filter(p => !nearMarket(p));
  noteSeen(all);
  return {
    d, s, card, picks, gixen, gixenOn, windowMs, unfolded, folded, fold, floor,
    allPicks: all, covered, hiding, hidden: all.length - unfolded.length,
    inGixen: x => covered.has(x.item_id),
    gixenOff: d.gixen == null,
    hours: Number(s.need_snipe_hours) || 24,
    cards: d.cards || [],
    art: new Map((d.cards || []).map(x => [String(x.id), x])),
    need: (gixenOn ? soon.filter(p => p.snipe == null && !p.marked) : soon.filter(p => !p.marked)).sort((x, y) => x.end_time < y.end_time ? -1 : 1),
    snipes: (gixen.snipes || []).filter(x => msLeft(x.end_time) > 0),
    accent: card.config.accent || feed.options.accent || '#c41e3a',
    perPage: Number(card.config.picks_per_page || feed.options.picks_per_page) || 25,
  };
};
const span = hours => hours === 24 ? '24 hours' : (hours % 24 === 0 ? hours / 24 + ' days' : hours + ' hours');

// --------------------------------------------------------------------- rows
// Why a pick is more than a fair price, when the bot says so: a seller's pricing
// mistake, a listing other buyers won't find, or an auction nobody is watching.
const EDGE = {mispriced: ['💎 Price mistake', '#00838f'], hidden: ['🕵️ Slipped through', '#5e35b1'], sleeper: ['😴 Sleeper', '#ad1457']};
const edge = p => EDGE[p.edge] ? pill(EDGE[p.edge][0], EDGE[p.edge][1]) + ' ' : '';
const badge = p => {
  if (p.is_auction && p.end_time) {
    const ms = msLeft(p.end_time);
    return pill('⏱ ' + left(p.end_time), ms < 2 * HOUR ? '#e53935' : (ms < 24 * HOUR ? '#fb8c00' : '#546e7a'));
  }
  return pill(p.best_offer ? 'Offer' : 'Buy now', '#1e88e5');
};
// In Gixen already: a snipe on Gixen's list, or your own "Added to Gixen" mark.
const inGixen = p => p.snipe != null || !!p.marked;
// The chip that hides or shows them again (hidden by default, so other steals surface).
const gixenChip = c => {
  const n = c.allPicks.filter(c.inGixen).length;
  if (!n) return '';
  return c.hiding
    ? `<span class="btn" role="button" data-do="set" data-key="hide_gixen" data-value="off" title="${n} pick${n === 1 ? ' is' : 's are'} already in Gixen and hidden here so other steals come to the surface. Tap to show them.">🙈 ${n} in Gixen hidden</span>`
    : `<span class="btn on" role="button" data-do="set" data-key="hide_gixen" data-value="on" title="Picks already in Gixen are showing. Tap to hide them again.">👁 ${n} in Gixen shown</span>`;
};
// "Added to Gixen": your own mark on a pick, until Gixen's list shows the snipe.
const markedPill = p => p.snipe == null && p.marked
  ? ' ' + tpill('✓ Added to Gixen' + (p.marked.max ? ' ' + cents(p.marked.max) : ''), '#2e7d32', 'You marked this as sniped. It stays marked until Gixen\'s list shows the snipe.') : '';
const markBtn = p => !p.is_auction || p.snipe != null ? '' : (p.marked
  ? act('Undo added', {action: 'sniped', item_id: p.item_id, undo: true}, {busy: 'Unmarking…'})
  : act('✓ Added to Gixen', {action: 'sniped', item_id: p.item_id, max: p.max == null ? '' : cents(p.max)}, {busy: 'Marking…', color: '#2e7d32'}));
// An auction that still has a Buy It Now: it goes away at the first bid.
const binBtn = p => p.is_auction && p.bin_price ? linkBtn('Buy now ' + money(p.bin_price) + ' ↗', p.url, '#1e88e5') : '';
const binTxt = p => p.is_auction && p.bin_price ? ` · <b title="A Buy It Now on this auction; the first bid removes it">or BIN ${money(p.bin_price)}</b>` : '';
// Where steals happen (the bot's closes.py): the seller's heat and the ending hour.
const closesPill = (p, short) => {
  const c = p.closes;
  if (!c) return '';
  if (c.seller === 'hot') return tpill((short ? '🔥 hot seller' : '🔥 Hot seller') + ' ~' + Math.round(100 * c.seller_share) + '%', '#e53935', `This seller's auctions close at ~${Math.round(100 * c.seller_share)}% of the going rate (${c.seller_n} sold): a cheapskate max rarely wins here.`) + ' ';
  const parts = [];
  if (c.seller === 'cold') parts.push(short ? 'quiet' : 'quiet seller');
  if (c.ending === 'day') parts.push(short ? 'day end' : 'daytime end');
  return parts.length ? tpill('🧊 ' + parts.join(' · ') + ' ~' + Math.round(100 * c.likely_share) + '%', '#0288d1', `Auctions like this close at ~${Math.round(100 * c.likely_share)}% of the going rate${c.likely ? ' (about ' + money(c.likely) + ' here)' : ''}: where a max is likely to win.`) + ' ' : '';
};
// The card's own price trend from the ledger (the bot's ledger.py): last 30 days against before.
const trendPill = p => p.trend ? tpill((p.trend.dir === 'up' ? '📈 +' : '📉 ') + p.trend.pct + '%', p.trend.dir === 'up' ? '#2e7d32' : '#c62828',
  `This card's sales: ~${money(p.trend.was)} before, ~${money(p.trend.now)} in the last 30 days (${p.trend.n} sales)`) + ' ' : '';
// Win odds from the ledger: how many recorded sales of the exact card closed at or under what you'd pay.
const oddsTxt = p => p.win_odds ? ` · <span title="${p.win_odds.under} of the last ${p.win_odds.n} sales of this card closed at or under what you'd pay here, shipping included">wins <b style="color:${p.win_odds.pct >= 50 ? '#2e7d32' : p.win_odds.pct >= 25 ? '#f9a825' : '#e53935'}">${p.win_odds.under}/${p.win_odds.n}</b></span>` : '';
const sniped = p => {
  if (p.snipe == null) return markedPill(p);
  const over = p.bid_now != null && Number(p.bid_now) >= Number(p.snipe);
  return ' ' + pill((over ? '📈 over your ' : '🎯 ') + cents(p.snipe), over ? '#e53935' : '#6a1b9a');
};
const thumb = (p, w, h) => {
  const t = TIER[p.tier] || ['•', '#546e7a'];
  return `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="flex:none">` + (p.image
    ? `<img src="${esc(p.image)}" loading="lazy" style="width:${w}px;height:${h}px;object-fit:cover;border-radius:6px;display:block">`
    : `<div style="width:${w}px;height:${h}px;border-radius:6px;background:${t[1]}33;display:flex;align-items:center;justify-content:center;font-size:26px">🃏</div>`) + `</a>`;
};
// A card you own, by inventory id: its picture (the listing you bought it from) as a small thumbnail.
const ownThumb = (c, id, w = 36, h = 50) => {
  const x = id != null && c.art.get(String(id));
  if (!x || !x.i) return `<div style="width:${w}px;height:${h}px;border-radius:5px;background:#8882;flex:none"></div>`;
  const img = `<img src="${esc(x.i)}" loading="lazy" alt="" style="width:${w}px;height:${h}px;object-fit:cover;border-radius:5px;display:block">`;
  return x.e ? `<a href="https://www.ebay.com/itm/${esc(x.e)}" target="_blank" rel="noopener" style="flex:none">${img}</a>` : `<span style="flex:none">${img}</span>`;
};
// A card you own as a small picture that opens its card sheet (binder rows, filing, the mail).
const cardPic = (x, w = 38, h = 53) => x.i
  ? `<span role="button" tabindex="0" data-do="card" data-value="${esc(x.id)}" style="flex:none;cursor:pointer"><img src="${esc(x.i)}" loading="lazy" alt="" style="width:${w}px;height:${h}px;object-fit:cover;border-radius:5px;display:block"></span>`
  : `<div style="width:${w}px;height:${h}px;border-radius:5px;background:#8882;flex:none;display:flex;align-items:center;justify-content:center">🃏</div>`;
// One sleeve in the binder wall: the card's picture, its hit flags, what you paid and what it's worth now.
const POCKET_RING = {A: '#00bfa5', L: '#00bfa5', N: '#ab47bc', G: '#78909c', F: '#fbc02d'};
const pocket = (x, n = 0, rank = null) => {
  const ring = [...x.f].map(f => POCKET_RING[f]).find(Boolean);
  const gain = x.v != null && x.p > 0 ? x.v / x.p : null;
  const where = {'In transit': '🚚', 'Won': '🏷️', 'Delivered': '📥'}[x.s] || '';
  const flags = [...x.f].filter(f => f !== 'D').map(f => `<span class="flag" style="background:${({R: '#fb8c00', A: '#00897b', L: '#00897b', N: '#8e24aa', G: '#546e7a', F: '#f9a825'})[f]}">${({R: 'RC', A: 'AUTO', L: 'RELIC', N: '#’D', G: 'SLAB', F: '★'})[f]}</span>`).join('');
  const inner = `<div class="pk-img">${x.i ? `<img src="${esc(x.i)}" loading="${n < 24 ? 'eager' : 'lazy'}" alt="">` : `<div class="pk-none">🃏<span>${esc(x.n)}</span></div>`}
      <div class="pk-flags">${flags}</div>
      ${where ? `<div class="pk-where" title="${esc(x.s)}">${where}</div>` : ''}
      ${x.if === 'same' ? '<div class="pk-same" title="Photo of another copy of this card">≈</div>' : ''}
      ${gain != null && gain >= 1.5 ? `<div class="pk-gain">×${gain >= 10 ? Math.round(gain) : gain.toFixed(1)}</div>` : ''}</div>
    <div class="pk-cap"><span class="pk-name">${rank ? `<span class="pk-rank">#${rank}</span> ` : ''}${esc(x.n)}</span>
      <span class="pk-money">${x.p ? money(x.p) : '–'}${x.v != null ? ` ▸ <b style="color:${x.v >= x.p ? '#43a047' : '#e53935'}">${money(x.v)}</b>` : ''}</span></div>`;
  const find = esc((x.n + ' ' + x.s + ' ' + x.sl + ' ' + x.pg + ' ' + x.d).toLowerCase());
  return `<div class="pocket" role="button" tabindex="0" data-do="card" data-value="${esc(x.id)}" data-find="${find}" title="${esc(x.n + ' · ' + x.s + ' · ' + x.pg)}"${ring ? ` style="--ring:${ring}"` : ''}>${inner}</div>`;
};
const pickButtons = p => `<div class="row tight">
  ${p.is_auction
    ? (p.snipe == null && !p.marked ? snipeBtn(p.item_id, p.max) : copyBtn('Copy item #', p.item_id)) + (p.max == null ? '' : copyBtn('Copy max ' + cents(p.max), cents(p.max))) + (p.win == null ? '' : copyBtn('Copy win ' + cents(p.win), cents(p.win))) + markBtn(p) + binBtn(p)
    : linkBtn(p.best_offer ? 'Make offer ↗' : 'Buy ↗', p.url, '#1e88e5')}
  ${act('Skip', {action: 'skip', item_id: p.item_id}, {hide: true})}
  ${p.feedback === 'good_pick' ? pill('👍 Good call noted', '#43a047') : act('👍 Good call', {action: 'feedback', item_id: p.item_id, reason: 'good_pick'}, {busy: 'Saving…'})}
  <span class="btn" role="button" data-do="fb" data-item="${esc(p.item_id)}">👎 Bad pick</span>
</div>${fb.open === p.item_id ? feedbackForm(p) : ''}`;
// "Bad pick": what was wrong, and an optional note. Sending it hides the pick and
// scoring learns from it. Only one form is open at a time, and what is typed in
// it survives the dashboard redrawing.
const REASONS = [['overvalued', 'Overvalued'], ['wrong_card', 'Wrong card'], ['bad_seller', 'Bad seller'],
  ['dont_want_this_type', "Don't want this type"], ['already_have', 'Already have it'], ['other', 'Other']];
const fb = {open: null, reason: 'overvalued', note: ''};
const feedbackForm = p => `<div class="fb" style="margin-top:8px;padding:8px;border:1px solid var(--divider-color);border-radius:10px">
  <div class="muted" style="font-size:12px;margin-bottom:6px">What was wrong with this pick?</div>
  <div class="row tight">${REASONS.map(([value, label]) => `<span class="btn${fb.reason === value ? ' on' : ''}" role="button" data-do="fb-reason" data-value="${value}">${label}</span>`).join('')}</div>
  <input data-fb-note type="text" maxlength="200" placeholder="Note (optional): e.g. signed base card, worth about $25" value="${esc(fb.note)}" style="width:100%;box-sizing:border-box;margin:6px 0;padding:8px 10px;border-radius:8px;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color)">
  <div class="row tight"><span class="btn" role="button" data-do="fb-send" data-item="${esc(p.item_id)}" style="background:#e53935;color:#fff">Send and hide</span><span class="btn" role="button" data-do="fb">Cancel</span></div>
</div>`;
// The second number next to the max: a bid at about the going rate, for a card
// you would rather win than steal. Only the bot's newer versions send it.
const winTxt = p => p.win == null ? '' : ` · <span title="About the going rate less shipping: a fair buy, not a steal">to win ≈ <b>${cents(p.win)}</b></span>`;
// What makes the card worth knowing (the bot's "story": set, parallel, print run, a
// rookie year, an oddball release), one line a collector would tell a friend.
const story = p => p.story ? `<div class="story">💡 ${esc(p.story)}</div>` : '';
const lastSold = p => {
  // The trust strip: the newest real sales of the same card, each one tappable, so a
  // deal can be bought without opening anything else.
  const ls = p.last_sold;
  if (!ls) {
    if (p.value == null) return '';
    if (p.value_source === 'web') return `<div class="muted" style="font-size:12px;margin-top:2px">🔨 Value from sales the bot found online, none of this card on its own record.</div>`;
    return p.max_basis !== 'sales' ? `<div class="muted" style="font-size:12px;margin-top:2px">🔨 No sales of this card on record: the value is an estimate.</div>` : '';
  }
  const day = at => new Date(at + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric'});
  const comps = (ls.recent || [{total: ls.total, at: ls.at}]).map(r => r.url
    ? `<a class="comp" href="${esc(r.url)}" target="_blank" rel="noopener">${money(r.total)} · ${day(r.at)}${r.kind === 'bin' ? ' BIN' : ''}</a>`
    : `<span class="comp">${money(r.total)} · ${day(r.at)}</span>`).join('');
  return `<div style="font-size:12px;margin-top:3px;display:flex;flex-wrap:wrap;gap:4px;align-items:center"><span class="muted">🔨 Sold${ls.estimated ? ' (shipping assumed)' : ''}:</span>${comps}${ls.n > (ls.recent || [1]).length ? `<span class="muted">· ${ls.n} on record</span>` : ''}</div>`;
};
// A graded card checked with its grader (the bot's slabs.py): the real grade and how many exist.
const GRADER = {psa: 'PSA', beckett: 'BGS', sgc: 'SGC', cgc: 'CGC'};
const slabTxt = p => {
  const s = p.slab;
  if (!s || !s.cert || s.problem || !s.found) return '';
  const bits = [`${GRADER[s.grader] || ''} ${s.grade || ''}`.trim()];
  if (s.pop != null) bits.push(`pop ${s.pop}` + (s.higher != null ? `, ${s.higher} higher` : ''));
  if (s.total) bits.push(`${s.total} graded in all`);
  const link = s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener">cert ${esc(s.cert)}</a>` : '';
  return `<div class="muted" style="font-size:12px;margin-top:2px">🏷️ ${esc(bits.join(' · '))}${link}</div>`;
};
const fastTag = p => p.fast ? pill('⚡ Fast lane', '#f57c00') + ' ' : '';
// How far an auction's bid has climbed toward the bot's max, and how old that bid
// is (the bot reads good picks again in their last 3 hours). Past 80% it is
// heating up: likely to go over by the end.
// A jackpot (the bot's jackpot.py): a $20+ card for a sliver of its value. It gets
// the loudest thing on the dashboard, because it won't be there for long.
const jackpotPill = p => p.jackpot ? pill('🚨 JACKPOT', '#d50000') + ' ' : '';
// An auction of a $50+ card (the bot's long_shot_value): the bot's max almost never wins there.
const longShotPill = p => p.long_shot ? `<span title="Cards this dear rarely go for the bot's max: worth a snipe, not a sure thing.">${pill('🎲 Long shot', '#8e24aa')}</span> ` : '';
const jackpotPay = p => Number(p.jackpot_bin && p.bin_price ? p.bin_price : (p.bid_now ?? p.price)) + (p.combined_ship ? 0 : Number(p.shipping ?? 5));
const jackpotBanner = c => {
  const live = (c.d.jackpots || []).filter(p => !(p.is_auction && p.end_time && msLeft(p.end_time) <= 0));
  if (!live.length) return '';
  return live.slice(0, 3).map(p => {
    const off = p.value ? Math.round(100 * (1 - jackpotPay(p) / p.value)) : null;
    return `<div class="jackpot" data-row>
      ${p.image ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="flex:none"><img src="${esc(p.image.replace('s-l225', 's-l500'))}" style="height:110px;border-radius:8px;display:block"></a>` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;letter-spacing:2px;font-weight:700">🚨 JACKPOT${p.jackpot_bin ? ' · BUY IT NOW ON AN AUCTION, GONE AT THE FIRST BID' : p.is_auction ? ' · AUCTION ENDS ' + left(p.end_time).toUpperCase() : ' · BUY IT NOW'}</div>
        <a class="title" href="${esc(p.url)}" target="_blank" rel="noopener" style="display:block;font-size:18px;font-weight:700;margin:3px 0;color:#fff">${esc(p.card)}</a>
        <div style="font-size:16px"><b>${money(jackpotPay(p))}</b> delivered for a <b>${worth(p.value)}</b> card${off != null ? ` · <b>${off}% off</b>` : ''}</div>
        <div style="font-size:13px;margin-top:3px;opacity:.9">${p.jackpot === 'sales' ? 'Value from recorded sales.' : 'Value is the bot\'s estimate: glance at the comps as you buy.'} You will not see it this cheap again.</div>
        <div class="row tight" style="margin-top:8px">${p.is_auction && !p.jackpot_bin
          ? snipeBtn(p.item_id, p.max, '🎯 SNIPE ↗') + (p.max == null ? '' : copyBtn('Copy max ' + cents(p.max), cents(p.max)))
          : linkBtn(p.best_offer ? 'Buy now (has offers) ↗' : 'BUY NOW ↗', p.url, '#ffffff')}</div>
      </div></div>`;
  }).join('');
};
// Picks that crept up to close to market value, out of the way under the steals.
const foldedStrip = c => {
  if (!c.folded || !c.folded.length) return '';
  const n = c.folded.length;
  return `<details class="folded" style="margin-top:14px;border:1px dashed #8886;border-radius:12px;padding:6px 10px">
    <summary style="cursor:pointer;font-size:13px" class="muted">🧊 <b>${n}</b> small or close to market, folded away. Tap to look.</summary>
    <div style="opacity:.75">${c.folded.slice().sort((x, y) => byGap(x, y) || (x.share_now ?? shareNow(x)) - (y.share_now ?? shareNow(y))).map(p => pickLine(p, '', '')).join('')}</div></details>`;
};

// ---- the takeover: a jackpot fills the whole screen, whatever tab is open.
// One overlay on the page for every card (they share this module); a "mega"
// (a $40+ card for a tenth or less) is louder still. "Got it" folds it into a
// red bar across the top that opens it again; it stays until the listing ends.
const TAKEOVER_ID = 'snipe-hunt-takeover';
const liveCards = new Set();
const shownGone = new Set();
let takeoverKey = null, takeoverTimer = null, takeoverCtx = null;
const dismissed = () => { try { return new Set([...JSON.parse(localStorage.getItem('ws_jackpot_seen') || '[]'), ...shownGone]); } catch (e) { return new Set(shownGone); } };
const setDismissed = (id, on) => {
  if (on) shownGone.add(id); else shownGone.delete(id);
  let list = [];
  try { list = JSON.parse(localStorage.getItem('ws_jackpot_seen') || '[]'); } catch (e) { /* none kept */ }
  list = list.filter(x => x !== id).concat(on ? [id] : []).slice(-60);
  try { localStorage.setItem('ws_jackpot_seen', JSON.stringify(list)); } catch (e) { /* not kept past this visit */ }
};
const removeTakeover = () => {
  const el = document.getElementById(TAKEOVER_ID);
  if (el) el.remove();
  clearInterval(takeoverTimer);
  takeoverKey = null;
};
const TAKEOVER_CSS = `
  #${TAKEOVER_ID} .tk-back { position: fixed; inset: 0; z-index: 2147483000; background: rgba(0,0,0,.86); display: flex; align-items: center; justify-content: center; padding: 14px; font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif); }
  #${TAKEOVER_ID} .tk { width: min(560px, 100%); max-height: 96vh; overflow: auto; border-radius: 22px; padding: 18px 18px 16px; color: #fff; text-align: center;
    background: linear-gradient(135deg, #b71c1c, #d50000 45%, #ff1744); box-shadow: 0 0 0 4px #fff3, 0 0 60px 10px #ff174499; animation: tk-pulse 1.2s ease-in-out infinite; }
  #${TAKEOVER_ID} .tk.mega { background: linear-gradient(120deg, #ff1744, #ff9100, #ffd600, #ff9100, #ff1744); background-size: 300% 300%;
    animation: tk-pulse 0.9s ease-in-out infinite, tk-shift 3s linear infinite; box-shadow: 0 0 0 6px #fff6, 0 0 90px 24px #ffd600aa; color: #1a0000; }
  #${TAKEOVER_ID} .tk-head { font-size: clamp(22px, 7vw, 52px); white-space: nowrap; font-weight: 900; letter-spacing: 1px; line-height: 1; text-transform: uppercase; text-shadow: 0 3px 0 #0004; }
  #${TAKEOVER_ID} .tk-sub { font-size: 13px; font-weight: 800; letter-spacing: 3px; margin: 8px 0 10px; opacity: .9; }
  #${TAKEOVER_ID} .tk img { max-width: 100%; max-height: 38vh; border-radius: 12px; border: 4px solid #fff; box-shadow: 0 8px 30px #0008; background: #fff; }
  #${TAKEOVER_ID} .tk-card { font-size: 17px; font-weight: 700; margin: 10px 0 4px; }
  #${TAKEOVER_ID} .tk-pay { font-size: clamp(44px, 14vw, 76px); font-weight: 900; line-height: 1; }
  #${TAKEOVER_ID} .tk-for { font-size: 20px; font-weight: 700; margin-top: 2px; }
  #${TAKEOVER_ID} .tk-off { display: inline-block; margin: 10px 0 4px; padding: 6px 16px; border-radius: 999px; background: #fff; color: #d50000; font-size: 24px; font-weight: 900; }
  #${TAKEOVER_ID} .tk-note { font-size: 13px; margin-top: 6px; opacity: .95; }
  #${TAKEOVER_ID} .tk-clock { font-size: 22px; font-weight: 900; font-variant-numeric: tabular-nums; margin-top: 6px; }
  #${TAKEOVER_ID} .tk-btns { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 14px; }
  #${TAKEOVER_ID} .tk-btn { cursor: pointer; border: 0; border-radius: 12px; padding: 14px 18px; font-size: 17px; font-weight: 900; background: #fff; color: #b71c1c; text-decoration: none; }
  #${TAKEOVER_ID} .tk-btn.big { flex: 1 1 100%; font-size: 22px; padding: 18px; }
  #${TAKEOVER_ID} .tk-btn.ghost { background: #0003; color: inherit; font-weight: 700; font-size: 14px; padding: 10px 14px; }
  #${TAKEOVER_ID} .tk-bar { position: fixed; left: 0; right: 0; top: 0; z-index: 2147483000; cursor: pointer; text-align: center; padding: 10px 12px; color: #fff; font: 800 15px system-ui, sans-serif;
    background: linear-gradient(90deg, #d50000, #ff1744, #d50000); background-size: 200% 100%; animation: tk-shift 2s linear infinite; box-shadow: 0 4px 18px #d5000088; }
  @keyframes tk-pulse { 50% { transform: scale(1.015); } }
  @keyframes tk-shift { to { background-position: 300% 0; } }
  @media (prefers-reduced-motion: reduce) { #${TAKEOVER_ID} .tk, #${TAKEOVER_ID} .tk-bar { animation: none; } }`;
const takeoverHtml = (p, n, i) => {
  const mega = p.jackpot_level === 'mega';
  const pay = jackpotPay(p), off = p.value ? Math.round(100 * (1 - pay / p.value)) : null;
  const how = p.jackpot_bin ? 'BUY IT NOW ON AN AUCTION · GONE AT THE FIRST BID' : p.is_auction ? 'AUCTION · ENDING SOON' : 'BUY IT NOW · GONE IN MINUTES';
  const img = p.image ? `<a href="${esc(p.url)}" data-tk="open" data-v="${esc(p.url)}"><img src="${esc(String(p.image).replace('s-l225', 's-l800').replace('s-l500', 's-l800'))}" alt=""></a>` : '';
  const notes = [p.jackpot === 'sales' || p.ledger_only ? `Value from ${p.comps ? p.comps + ' ' : ''}recorded sales.` : "Value is the bot's estimate: glance at the comps.",
    p.ledger_only ? 'Found by the price ledger, not scored by Claude: check the photos and the seller.' : '',
    p.owned ? 'You already have this card: grab it to flip or trade.' : ''].filter(Boolean).map(t => `<div class="tk-note">${esc(t)}</div>`).join('');
  const act = p.is_auction && !p.jackpot_bin
    ? `<span class="tk-btn big" data-tk="snipe" data-v="${esc(p.item_id)}"${p.max != null ? ` data-max="${esc(cents(p.max))}"` : ''}>🎯 SNIPE ${esc(p.item_id)} ↗</span>` +
      (p.max != null ? `<span class="tk-btn" data-tk="copy" data-v="${esc(cents(p.max))}">Copy max ${esc(cents(p.max))}</span>` : '') +
      `<span class="tk-btn" data-tk="open" data-v="${esc(p.url)}">eBay ↗</span>`
    : `<span class="tk-btn big" data-tk="open" data-v="${esc(p.url)}">${p.best_offer ? 'BUY IT NOW (has offers) ↗' : 'BUY IT NOW ↗'}</span>`;
  return `<div class="tk-back"><div class="tk${mega ? ' mega' : ''}" role="alertdialog" aria-label="Jackpot">
    <div class="tk-head">${mega ? '🚨 HOLY SH*T 🚨' : '🚨 JACKPOT 🚨'}</div>
    <div class="tk-sub">${how}${n > 1 ? ` · ${i + 1} OF ${n}` : ''}</div>
    ${img}
    <div class="tk-card">${esc(p.card || p.title || '')}</div>
    <div class="tk-pay">${money(pay)}</div>
    <div class="tk-for">delivered, for a ${worth(p.value)} card</div>
    ${off != null ? `<div class="tk-off">${off}% OFF</div>` : ''}
    ${p.is_auction && p.end_time ? `<div class="tk-clock">ends <span data-tk-end="${esc(p.end_time)}">${left(p.end_time)}</span></div>` : ''}
    ${notes}
    <div class="tk-btns">${act}</div>
    <div class="tk-btns"><span class="tk-btn ghost" data-tk="seen" data-v="${esc(p.item_id)}">Got it</span>${n > 1 ? `<span class="tk-btn ghost" data-tk="next">Next jackpot →</span>` : ''}</div>
  </div></div>`;
};
let takeoverIndex = 0;
const takeover = c => {
  takeoverCtx = c;
  const live = (c.d.jackpots || []).filter(p => !(p.is_auction && p.end_time && msLeft(p.end_time) <= 0));
  if (!live.length) { removeTakeover(); return; }
  const gone = dismissed();
  const open = live.filter(p => !gone.has(p.item_id));
  const key = live.map(p => p.item_id + ':' + jackpotPay(p) + (gone.has(p.item_id) ? ':seen' : '')).join('|') + '#' + takeoverIndex;
  if (key === takeoverKey && document.getElementById(TAKEOVER_ID)) return;
  removeTakeover();
  takeoverKey = key;
  const el = document.createElement('div');
  el.id = TAKEOVER_ID;
  const top = live[0];
  const bar = `<div class="tk-bar" data-tk="reopen">🚨 ${top.jackpot_level === 'mega' ? 'HOLY SH*T' : 'JACKPOT'} LIVE: ${money(jackpotPay(top))} for a ${worth(top.value)} card${live.length > 1 ? ` · +${live.length - 1} more` : ''} · tap to open</div>`;
  if (takeoverIndex >= open.length) takeoverIndex = 0;
  el.innerHTML = `<style>${TAKEOVER_CSS}</style>` + (open.length ? takeoverHtml(open[takeoverIndex], open.length, takeoverIndex) : bar);
  el.addEventListener('click', ev => {
    const t = ev.target.closest('[data-tk]');
    if (!t) return;
    ev.preventDefault();
    const what = t.dataset.tk;
    if (what === 'open') window.open(t.dataset.v, '_blank', 'noopener');
    else if (what === 'copy') {
      copyText(t.dataset.v);
      t.textContent = 'Copied ✓';
    } else if (what === 'snipe') {
      copyText(t.dataset.v);
      window.open(GIXEN_URL, '_blank', 'noopener');
      t.textContent = '✓ Item # copied: paste it in Gixen';
    } else if (what === 'seen') { setDismissed(t.dataset.v, true); takeoverKey = null; takeover(takeoverCtx); }
    else if (what === 'next') { takeoverIndex += 1; takeoverKey = null; takeover(takeoverCtx); }
    else if (what === 'reopen') { live.forEach(p => setDismissed(p.item_id, false)); takeoverIndex = 0; takeoverKey = null; takeover(takeoverCtx); }
  });
  document.body.appendChild(el);
  if (open.length && navigator.vibrate) try { navigator.vibrate([300, 120, 300, 120, 600]); } catch (e) { /* no buzz */ }
  takeoverTimer = setInterval(() => {
    el.querySelectorAll('[data-tk-end]').forEach(x => {
      if (msLeft(x.dataset.tkEnd) <= 0) { takeoverKey = null; takeover(takeoverCtx); } else x.textContent = left(x.dataset.tkEnd);
    });
  }, 1000);
};

// The Hall of Fame's top three on a podium: silver, gold (raised, centre), bronze. Each opens
// its card sheet when the binder knows the card (by inventory id), with your own photo of it.
const podium = (c, top) => {
  if ((top || []).length < 3) return '';
  const STEP = [['🥇', '#ffca28', 'gold', 1], ['🥈', '#b0bec5', 'silver', 0], ['🥉', '#d7884f', 'bronze', 2]];
  const spot = i => {
    const x = top[i], own = x.id != null && c.art.get(String(x.id));
    const pic = (own && own.i) || (x.image ? String(x.image).replace(/s-l\d+/, 's-l500') : null);
    const [medal, color, name] = STEP[i];
    return `<div class="pod pod-${name}" style="--pod:${color}"${own ? ` role="button" tabindex="0" data-do="card" data-value="${esc(x.id)}"` : ''} title="${esc(x.card)}">
      <div class="pod-img">${pic ? `<img src="${esc(pic)}" alt="">` : '<div class="pk-none">🃏</div>'}</div>
      <div class="pod-off">-${x.off_pct}%</div>
      <div class="pod-name">${esc(x.card)}</div>
      <div class="pod-step"><span class="pod-medal">${medal}</span><b>${money(x.paid)}</b> for ${money(x.value)}</div></div>`;
  };
  return `<div class="podium">${spot(1)}${spot(0)}${spot(2)}</div>`;
};

// The card sheet: tap a card in the binder for its picture (tilt it, it shines), what you
// paid against what it's worth, and the ledger's recent sales of the same card. Like the
// takeover it lives on document.body so it covers the whole screen; Esc or a tap outside closes it.
const SHEET_ID = 'snipe-hunt-sheet';
const SHEET_CSS = `
  #${SHEET_ID} .sh-back { position: fixed; inset: 0; z-index: 2147482000; background: rgba(0,0,0,.72); display: flex; align-items: center; justify-content: center;
    padding: 14px; font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif); animation: sh-fade .15s ease; }
  #${SHEET_ID} .sh { width: min(760px, 100%); max-height: 94vh; overflow: auto; border-radius: 20px; padding: 18px; display: grid; grid-template-columns: minmax(0, 300px) 1fr; gap: 20px;
    background: var(--card-background-color, #1c1c1c); color: var(--primary-text-color, #eee); box-shadow: 0 20px 60px #000a; animation: sh-pop .2s ease; }
  @media (max-width: 640px) { #${SHEET_ID} .sh { grid-template-columns: 1fr; padding: 14px; gap: 14px; } #${SHEET_ID} .sh-stage { max-width: 260px; margin: 0 auto; } }
  #${SHEET_ID} .sh-stage { perspective: 900px; }
  #${SHEET_ID} .sh-card { position: relative; aspect-ratio: 5 / 7; border-radius: 14px; overflow: hidden; background: #0004; transform-style: preserve-3d;
    transition: transform .25s ease, box-shadow .25s ease; box-shadow: 0 14px 34px #0009, 0 0 0 3px var(--ring, transparent); }
  #${SHEET_ID} .sh-card img { width: 100%; height: 100%; object-fit: contain; display: block; }
  #${SHEET_ID} .sh-card::after { content: ''; position: absolute; inset: 0; pointer-events: none; mix-blend-mode: color-dodge; opacity: var(--shine, .25);
    background: radial-gradient(circle at var(--mx, 30%) var(--my, 20%), #ffffffb0, transparent 45%),
      linear-gradient(115deg, transparent 20%, #ff00c855 35%, #00e5ff55 50%, #fff20055 65%, transparent 80%);
    background-size: 100% 100%, 250% 250%; background-position: 0 0, var(--mx, 30%) var(--my, 20%); transition: opacity .25s; }
  #${SHEET_ID} .sh-none { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 64px; }
  #${SHEET_ID} .sh-name { font-size: 20px; font-weight: 800; line-height: 1.2; }
  #${SHEET_ID} .sh-meta { font-size: 13px; color: var(--secondary-text-color, #aaa); margin-top: 6px; line-height: 1.5; }
  #${SHEET_ID} .sh-flags span { display: inline-block; color: #fff; border-radius: 6px; padding: 1px 7px; font-size: 11px; font-weight: 800; margin: 8px 4px 0 0; }
  #${SHEET_ID} .sh-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
  #${SHEET_ID} .sh-stat { border-radius: 12px; padding: 10px 8px; text-align: center; background: color-mix(in srgb, var(--primary-text-color, #fff) 7%, transparent); }
  #${SHEET_ID} .sh-stat b { display: block; font-size: 22px; font-weight: 900; }
  #${SHEET_ID} .sh-stat span { font-size: 10px; letter-spacing: 1.5px; font-weight: 700; color: var(--secondary-text-color, #aaa); }
  #${SHEET_ID} .sh-cap { font-size: 11px; letter-spacing: 1.5px; font-weight: 700; color: var(--secondary-text-color, #aaa); margin: 16px 0 6px; }
  #${SHEET_ID} .sh-spark { width: 100%; height: 90px; display: block; }
  #${SHEET_ID} .sh-sale { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; padding: 5px 0; border-top: 1px solid var(--divider-color, #fff2);
    color: inherit; text-decoration: none; }
  #${SHEET_ID} .sh-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
  #${SHEET_ID} .sh-btn { cursor: pointer; border-radius: 10px; padding: 10px 14px; font-size: 14px; font-weight: 800; text-decoration: none;
    background: var(--primary-color, #03a9f4); color: var(--text-primary-color, #fff); }
  #${SHEET_ID} .sh-btn.ghost { background: color-mix(in srgb, var(--primary-text-color, #fff) 10%, transparent); color: inherit; }
  @keyframes sh-fade { from { opacity: 0; } }
  @keyframes sh-pop { from { transform: translateY(14px) scale(.97); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { #${SHEET_ID} .sh-back, #${SHEET_ID} .sh { animation: none; } #${SHEET_ID} .sh-card { transition: none; } }`;
const SHEET_FLAG = {R: ['RC', '#fb8c00'], A: ['AUTO', '#00897b'], L: ['RELIC', '#00897b'], N: ['NUMBERED', '#8e24aa'], G: ['GRADED', '#546e7a'], F: ['FRONT PAGE', '#f9a825'], D: ['DUPE', '#6d4c41']};
const sparkSvg = (h, paid) => {
  // the ledger's sales oldest → newest, with what you paid as a dashed line
  const pts = h.slice().reverse(), vals = pts.map(x => x[1]).concat(paid ? [paid] : []);
  const lo = Math.min(...vals) * 0.9, hi = Math.max(...vals) * 1.08 || 1, W = 300, H = 90;
  const X = i => pts.length === 1 ? W / 2 : 8 + i * (W - 16) / (pts.length - 1), Y = v => H - 8 - (v - lo) / ((hi - lo) || 1) * (H - 16);
  const line = pts.map((x, i) => `${X(i).toFixed(1)},${Y(x[1]).toFixed(1)}`).join(' ');
  return `<svg class="sh-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Recent sales">
    ${paid ? `<line x1="0" x2="${W}" y1="${Y(paid).toFixed(1)}" y2="${Y(paid).toFixed(1)}" stroke="currentColor" stroke-opacity=".45" stroke-dasharray="5 5" vector-effect="non-scaling-stroke"/>` : ''}
    ${pts.length > 1 ? `<polyline points="${line}" fill="none" stroke="var(--primary-color, #03a9f4)" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>` : ''}
    ${pts.map((x, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(x[1]).toFixed(1)}" r="4" fill="${paid && x[1] < paid ? '#e53935' : '#43a047'}"><title>${esc(x[0])}: ${money(x[1])}</title></circle>`).join('')}
  </svg>`;
};
const closeSheet = () => { const el = document.getElementById(SHEET_ID); if (el) el.remove(); document.removeEventListener('keydown', sheetKey); };
const sheetKey = ev => { if (ev.key === 'Escape') closeSheet(); };
const openSheet = x => {
  closeSheet();
  if (!x) return;
  const ring = [...x.f].map(f => POCKET_RING[f]).find(Boolean);
  const big = x.i ? String(x.i).replace(/s-l\d+/, 's-l800') : null;
  const gain = x.v != null && x.p > 0 ? x.v / x.p : null;
  const h = x.h || [];
  const look = 'https://www.ebay.com/sch/i.html?_sacat=261328&_sop=15&_nkw=' + encodeURIComponent(x.n.replace(/[#/]/g, ' '));
  const el = document.createElement('div');
  el.id = SHEET_ID;
  el.innerHTML = `<style>${SHEET_CSS}</style><div class="sh-back" data-sh="close"><div class="sh" role="dialog" aria-label="${esc(x.n)}">
    <div class="sh-stage"><div class="sh-card"${ring ? ` style="--ring:${ring}"` : ''}>${big ? `<img src="${esc(big)}" alt="">` : '<div class="sh-none">🃏</div>'}</div>
      ${x.if === 'same' ? '<div class="sh-meta" style="text-align:center">≈ photo of another copy of this card</div>' : ''}</div>
    <div style="min-width:0">
      <div class="sh-name">${esc(x.n)}</div>
      <div class="sh-flags">${[...x.f].map(f => `<span style="background:${SHEET_FLAG[f][1]}">${SHEET_FLAG[f][0]}</span>`).join('')}</div>
      <div class="sh-meta">${esc(x.s)} · page ${esc(x.pg)}${x.d ? '<br>bought ' + esc(x.d) : ''}${x.sl ? ' from ' + esc(x.sl) : ''}</div>
      <div class="sh-stats">
        <div class="sh-stat"><b>${x.p ? money(x.p) : '–'}</b><span>PAID</span></div>
        <div class="sh-stat"><b style="color:${x.v == null ? 'inherit' : (x.v >= x.p ? '#43a047' : '#e53935')}">${x.v != null ? money(x.v) : '–'}</b><span>WORTH NOW</span></div>
        <div class="sh-stat"><b style="color:${gain == null ? 'inherit' : (gain >= 1 ? '#43a047' : '#e53935')}">${gain != null ? '×' + (gain >= 10 ? Math.round(gain) : gain.toFixed(1)) : '–'}</b><span>GAIN</span></div>
      </div>
      ${h.length ? `<div class="sh-cap">${h.length > 1 ? 'RECENT SALES OF THIS CARD · DASHED = WHAT YOU PAID' : 'THE ONE SALE OF THIS CARD ON RECORD'}</div>${h.length > 1 ? sparkSvg(h, x.p) : ''}` +
        h.slice(0, 6).map(s => `<a class="sh-sale" href="https://www.ebay.com/itm/${esc(s[2])}" data-sh="open"><span>${esc(s[0])}</span><b>${money(s[1])}</b></a>`).join('')
        : '<div class="sh-meta" style="margin-top:14px">No sales of this card in the ledger yet, so it is valued at what you paid.</div>'}
      <div class="sh-btns">
        ${x.e ? `<a class="sh-btn" href="https://www.ebay.com/itm/${esc(x.e)}" data-sh="open">Your listing ↗</a>` : ''}
        <a class="sh-btn ghost" href="${esc(look)}" data-sh="open">Find another on eBay ↗</a>
        <span class="sh-btn ghost" data-sh="close">Close</span>
      </div>
    </div></div></div>`;
  const card = el.querySelector('.sh-card');
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!still) {
    card.addEventListener('pointermove', ev => {
      const r = card.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width, py = (ev.clientY - r.top) / r.height;
      card.style.transform = `rotateY(${(px - .5) * 22}deg) rotateX(${(.5 - py) * 22}deg) scale(1.03)`;
      card.style.setProperty('--mx', (px * 100).toFixed(0) + '%'); card.style.setProperty('--my', (py * 100).toFixed(0) + '%'); card.style.setProperty('--shine', '.7');
    });
    card.addEventListener('pointerleave', () => { card.style.transform = ''; card.style.setProperty('--shine', '.25'); });
  }
  el.addEventListener('click', ev => {
    const t = ev.target.closest('[data-sh]');
    if (!t) return;
    if (t.dataset.sh === 'close' && t !== ev.target && !ev.target.closest('.sh-btn')) return;   // a tap inside the sheet isn't a tap outside it
    ev.preventDefault();
    if (t.dataset.sh === 'open') window.open(t.href, '_blank', 'noopener'); else closeSheet();
  });
  document.addEventListener('keydown', sheetKey);
  document.body.appendChild(el);
};

// Auctions ending within the hour at 10% of their value or less (the bot's bidnow.py).
const bidNowList = c => {
  const live = (c.d.bid_now || []).filter(p => p.end_time && msLeft(p.end_time) > 0 && !(c.hiding && c.inGixen(p)));
  if (!live.length) return '';
  return `<div class="warn" style="margin:0 0 10px;padding:10px 12px">
    <div style="font-size:12px;letter-spacing:2px;font-weight:700;margin-bottom:4px">⏱️ BID NOW, THINK LATER · ENDING WITHIN THE HOUR AT 90%+ OFF</div>
    <div class="muted" style="font-size:12px;margin-bottom:4px">Cheap auctions get bid up in the last minutes: bid the max, not today's price.</div>` +
    live.map(p => `<div class="line" style="display:flex;gap:10px;align-items:flex-start;padding:8px 0">
      ${thumb(p, 46, 64)}
      <div style="flex:1;min-width:0">
        <a class="title" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.card)}</a>
        <div style="font-size:13px;margin-top:2px"><b>${money(p.pay)}</b> delivered for a <b>${worth(p.value)}</b> card · <b>${p.off_pct}% off</b> · ends ${left(p.end_time)}</div>
        <div class="row tight">${snipeBtn(p.item_id, p.max)}${p.max == null ? '' : copyBtn('Copy max ' + cents(p.max), cents(p.max))}${linkBtn('View ↗', p.url, '#1e88e5')}</div>
      </div></div>`).join('') + `</div>`;
};
// The steal radar (the bot's steals.radar): listings nearest a jackpot or bid-now line.
const radarStatus = r => r.hot
  ? `<b style="color:#d50000">${r.kind === 'jackpot' ? '🚨 JACKPOT NOW' : '⏱️ BID NOW'}</b>`
  : r.in_range
    ? `<b style="color:#2e7d32">In range</b> · turns hot ${r.opens_at ? when(r.opens_at) : 'soon'}`
    : `<b>${money(r.gap)}</b> above the ${r.kind === 'jackpot' ? 'jackpot' : 'bid-now'} line`;
const radarList = c => {
  const all = (c.d.radar || []).filter(r => !(r.is_auction && r.end_time && msLeft(r.end_time) <= 0) && !(c.hiding && c.inGixen(r)));
  if (!all.length) return '';
  const top = all.slice(0, Number(c.card.config.count) || 5);
  return `<div class="radar">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b style="letter-spacing:1px">🎯 STEAL RADAR</b><span class="muted" style="font-size:11px">closest to a no-think buy</span></div>` +
    top.map(r => {
      // the bar fills as the price falls toward the line; full means buy now
      const fill = Math.max(4, Math.min(100, Math.round(100 * r.line_pct / Math.max(r.share_pct, 1))));
      const color = r.hot ? '#d50000' : r.in_range ? '#2e7d32' : fill >= 70 ? '#fb8c00' : '#1e88e5';
      return `<div class="line${r.hot ? ' hotrow' : ''}" style="display:flex;gap:10px;align-items:center;padding:7px 0">
        ${thumb(r, 40, 56)}
        <div style="flex:1;min-width:0">
          <a class="title" href="${esc(r.url)}" target="_blank" rel="noopener" style="font-size:13px">${esc(r.card)}</a>
          <div style="font-size:12px;margin-top:1px"><b>${money(r.pay)}</b> for a <b>${worth(r.value)}</b> card · ${r.share_pct}% of value${r.is_auction && r.end_time ? ' · ends ' + left(r.end_time) : r.best_offer ? ' · takes offers' : ' · Buy It Now'}</div>
          <div class="meter"><span style="width:${fill}%;background:${color}"></span></div>
          <div style="font-size:11px;margin-top:1px">${radarStatus(r)}${r.max != null && r.is_auction ? ` · max ${cents(r.max)}` : ''}</div>
        </div>
        <div style="flex:none">${r.is_auction ? copyBtn('Copy #', r.item_id) : linkBtn('Buy ↗', r.url, '#2e7d32')}</div>
      </div>`;
    }).join('') + `</div>`;
};
// Buy It Nows a seller just cut into steal range (the bot's steals.drop_alert).
const droppedList = c => {
  const all = c.d.dropped || [];
  if (!all.length) return '';
  return `<div class="warn" style="margin:0 0 10px;padding:10px 12px;border-color:#2e7d32;background:#2e7d3218">
    <div style="font-size:12px;letter-spacing:2px;font-weight:700;margin-bottom:4px">📉 JUST DROPPED INTO STEAL RANGE</div>` +
    all.map(p => `<div class="line" style="display:flex;gap:10px;align-items:center;padding:6px 0">
      ${thumb(p, 40, 56)}
      <div style="flex:1;min-width:0"><a class="title" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.card)}</a>
        <div style="font-size:12px"><s class="muted">${money(p.was)}</s> → <b>${money(p.price)}</b> + ${shipTxt(p)} · goes for ${worth(p.value)}</div></div>
      <div style="flex:none">${linkBtn(p.best_offer ? 'Buy (has offers) ↗' : 'BUY ↗', p.url, '#2e7d32')}</div></div>`).join('') + `</div>`;
};
// What the bought picks were worth against what was paid (steals.savings).
const savingsLine = c => {
  const s = c.d.savings;
  if (!s || !s.all || !s.all.n) return '';
  const m = s.month && s.month.n ? s.month : null;
  return `<div class="savings">💰 You've saved <b>${worth((m || s.all).saved)}</b> ${m ? 'this month' : 'so far'} · paid <b>${(m || s.all).pct}%</b> of value on ${(m || s.all).n} card${(m || s.all).n === 1 ? '' : 's'}${s.best ? ` · best steal: ${esc(s.best.card.slice(0, 38))} for ${money(s.best.paid)} (worth ${worth(s.best.value)})` : ''}</div>`;
};
const HEAT = 0.8;
const heat = p => p.is_auction && p.max ? Number(p.bid_now ?? p.price) / Number(p.max) : null;
const heatPill = p => (heat(p) ?? 0) >= HEAT ? pill('🔥 Heating up', '#e53935') + ' ' : '';
const priceAge = p => p.price_at ? `<span class="muted" title="When eBay last gave this price"> · price ${ago(p.price_at)}</span>` : '';
const bidBar = p => {
  const h = heat(p);
  if (h == null) return '';
  const w = Math.max(3, Math.min(100, Math.round(h * 100)));
  const color = h >= 1 ? '#e53935' : (h >= HEAT ? '#fb8c00' : '#43a047');
  const bids = p.bids == null ? '' : ` · ${p.bids} bid${p.bids === 1 ? '' : 's'}`;
  return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin-top:4px;font-size:12px" title="Bid now as a share of the bot's max">
    <div class="bar" style="flex:1 1 120px;max-width:220px;height:8px"><div style="width:${w}%;background:${color}"></div></div>
    <span class="muted">bid ${money(p.bid_now ?? p.price)} of ${cents(p.max)} max${bids}${priceAge(p)}</span></div>`;
};
// The bot's doubts: a dear Buy It Now priced from a guess (never alerted), and a
// seller with little feedback asking real money.
const doubts = p => (p.unverified ? pill('⚠️ Unverified price', '#e65100') + ' ' : '')
  + (p.slab && p.slab.problem ? pill('⚠️ ' + esc(p.slab.problem), '#c62828') + ' ' : '')
  + (p.new_seller ? pill('⚠️ New seller (' + p.seller_feedback + ' feedback)', '#e65100') + ' ' : '');
const sellerTxt = p => esc(p.seller) + (p.seller_feedback == null ? '' : ` (${Number(p.seller_feedback).toLocaleString()} feedback${p.seller_pct == null ? '' : ', ' + p.seller_pct + '%'})`);
// A small line chart of prices, oldest first.
const spark = (values, color) => {
  if (!values || values.length < 2) return '';
  const lo = Math.min(...values), hi = Math.max(...values), w = 96, h = 28;
  const pts = values.map((v, i) => [(i / (values.length - 1) * (w - 6) + 3).toFixed(1), (h - 4 - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (h - 8)).toFixed(1)]);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="flex:none"><polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p => p.join(',')).join(' ')}"/><circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3" fill="${color}"/></svg>`;
};
const pickRow = p => pickLine(p, '', '');
const sweepTxt = p => (p.labels || p.landed != null) ? `<div style="font-size:12px;margin-top:3px">${labelPills(p)}<b>${money(delivered(p))} total</b>${p.sweep_score != null ? ` <span class="muted">· score ${p.sweep_score}</span>` : ''}</div>` +
  (p.ship_note ? `<div style="font-size:12px;margin-top:2px;color:#ef6c00">⚠️ ${esc(p.ship_note)}</div>` : '') : '';
const pickLine = (p, lead, extra) => {
  const t = TIER[p.tier] || ['•', '#546e7a'];
  const max = p.max == null ? '' : ` · <b>Max ${cents(p.max)}</b> <span class="muted">(${p.max_ledger ? 'the ledger\'s 25th-percentile close' : p.max_basis === 'sales' ? 'sales' : 'guess, no sales found'}${p.capped ? ', cut to fit your ceiling' : ''})</span>${oddsTxt(p)}`;
  const now = p.bid_now != null && Number(p.bid_now) !== Number(p.price) ? ` · <b>now ${money(p.bid_now)}</b>` : '';
  const ends = p.is_auction && p.end_time ? ` · ends ${when(p.end_time)}` : '';
  return `<div data-row data-find="${findKey(p)}" class="line" style="display:flex;gap:12px;align-items:flex-start;padding:10px 0">
    ${lead}${thumb(p, 54, 74)}
    <div style="flex:1;min-width:0">
      <div style="display:flex;gap:8px;justify-content:space-between;align-items:flex-start">
        <a class="title" href="${esc(p.url)}" target="_blank" rel="noopener">${t[0]} ${esc(p.card)}</a>
        <div style="text-align:right;flex:none">${badge(p)}${sniped(p)}</div>
      </div>
      ${sweepTxt(p)}
      <div style="font-size:13px;margin-top:3px">${newPill(p)}${jackpotPill(p)}${longShotPill(p)}${edge(p)}${heatPill(p)}${fastTag(p)}${closesPill(p)}${trendPill(p)}${doubts(p)}${money(p.price)} + ${shipTxt(p)}${now}${max}${binTxt(p)}${winTxt(p)}${p.is_auction ? '' : priceAge(p)}</div>
      ${bidBar(p)}
      ${p.deal ? `<div style="font-size:12px;margin-top:2px">${deal(p)}${extra}</div>` : ''}
      <div class="muted" style="font-size:12px;margin-top:2px;line-height:1.3">${esc(p.why)}</div>
      ${story(p)}${lastSold(p)}${slabTxt(p)}
      <div class="muted" style="font-size:11px;margin-top:2px">${sellerTxt(p)}${ends} · eBay item <b style="color:var(--primary-text-color);user-select:all;-webkit-user-select:all">${esc(p.item_id)}</b></div>
      ${pickButtons(p)}
    </div></div>`;
};
// The bot's second opinion on one of your Gixen amounts (snipecheck.py).
const CHECK = {over: ['💸 Over the going rate', '#e53935'], fair: ['👍 Fair: likely to win', '#1e88e5'], steal: ['💎 Real discount', '#43a047'],
  long_shot: ['🎲 Long shot', '#8e24aa'], outbid: ['📈 Bid past it', '#e53935'], unknown: ['❔ No price yet', '#78909c']};
const BASIS = {sales: 'recent sales', sold: 'a sale the bot recorded', estimate: 'an estimate'};
const snipeCheck = s => {
  const k = s.check;
  if (!k || !CHECK[k.verdict]) return '';
  const [label, color] = CHECK[k.verdict];
  let text = '';
  if (k.value != null) {
    text = `goes for about <b style="color:var(--primary-text-color)">${money(k.value)}</b> delivered <span class="muted">(${BASIS[k.basis] || 'an estimate'})</span>`;
    if (k.verdict === 'over') text += ` · your snipe would pay ${-k.pct}% more`;
    else if (k.verdict !== 'outbid') text += ` · yours is ${k.pct}% under`;
    if ((k.verdict === 'long_shot' || k.verdict === 'steal') && k.win != null) text += ` · to win ≈ <b style="color:var(--primary-text-color)">${cents(k.win)}</b>`;
    if (k.verdict === 'outbid') text += k.room ? ' · still under that at today\'s bid' : ' · no bargain left at today\'s bid';
  } else text = 'the bot will price this card at its next hourly run';
  return `<div style="font-size:12px;margin-top:3px"><span class="pill" style="background:${color}">${label}</span> ${text}</div>` +
    (k.note ? `<div class="muted" style="font-size:11px;margin-top:2px;line-height:1.3">${esc(k.note)}</div>` : '');
};
// What else might be wrong with a snipe (snipecheck.doubts): the wrong card, one
// you own, the same card sniped twice, a grader you skip, one the bot passed on.
const DOUBT = {not_walker: '#e53935', not_player: '#e53935', owned: '#e53935', twice: '#e53935', grader: '#e53935', slab: '#e53935', passed: '#fb8c00', seller: '#fb8c00', hot_seller: '#fb8c00'};
const SERIOUS_DOUBT = ['not_walker', 'not_player', 'owned', 'twice', 'grader', 'slab'];
// "Over the going rate" only counts when it costs real money: the bot itself stops
// pushing it under $3 over (cheap going rates are too rough to act on).
const OVER_MIN = 3;
const costly = x => !!x.check && x.check.verdict === 'over' && x.check.value != null
  && -x.check.pct / 100 * x.check.value >= OVER_MIN;
const doubtful = s => (s.doubts || []).length > 0 || (s.check && s.check.verdict === 'over');
const snipeDoubts = s => (s.doubts || []).map(d =>
  `<div style="font-size:12px;margin-top:3px">${pill('⚠️', DOUBT[d.kind] || '#fb8c00')} ${esc(d.text)}</div>`).join('');
const snipeRow = s => {
  const diff = s.bot_max != null && s.max_bid != null ? Number(s.max_bid) - Number(s.bot_max) : null;
  const note = s.bot_max == null ? '' : ` · bot max ${cents(s.bot_max)}` + (diff > 0.005 ? ' (yours is higher)' : (diff < -0.005 ? ' (yours is lower)' : ''));
  const state = s.outbid ? pill('📈 over your max', '#e53935') : pill('⏱ ' + left(s.end_time), msLeft(s.end_time) < 2 * HOUR ? '#fb8c00' : '#546e7a');
  return `<div data-row class="line" style="padding:8px 0">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
      <a class="title" href="${esc(s.url)}" target="_blank" rel="noopener" style="min-width:0;${s.outbid ? 'opacity:.65' : ''}">${(TIER[s.tier] || [''])[0]} ${esc(s.title || s.item_id)}</a><span style="flex:none">${state}</span></div>
    <div class="muted" style="font-size:12px;margin-top:2px"><b style="color:var(--primary-text-color)">Snipe ${s.max_bid == null ? '?' : cents(s.max_bid)}</b> · bid now ${s.current_bid == null ? '?' : cents(s.current_bid)}${note}</div>
    ${snipeCheck(s)}
    ${snipeDoubts(s)}
    <div class="muted" style="font-size:11px;margin-top:2px">${esc(s.seller)} · ${s.outbid ? 'ends in ' + left(s.end_time) : 'ends ' + when(s.end_time)} · ${esc(s.item_id)}</div>
    ${s.outbid ? `<div class="row tight">${s.bot_max != null && Number(s.bot_max) > Number(s.current_bid) ? copyBtn('Copy bot max ' + cents(s.bot_max), cents(s.bot_max)) : ''}${s.check && s.check.room && s.check.win != null && Number(s.check.win) > Number(s.current_bid) ? copyBtn('Copy win ' + cents(s.check.win), cents(s.check.win)) : ''}${snipeBtn(s.item_id, s.check && s.check.room && s.check.win != null && Number(s.check.win) > Number(s.current_bid) ? s.check.win : null, '🎯 Re-snipe ↗')}</div>` : ''}
  </div>`;
};
const gixenDown = c => c.gixenOff
  ? (c.d.gixen_account === false
    ? `<div style="padding-top:12px"><b>No Gixen account on this bot.</b><div class="muted" style="font-size:13px;margin-top:4px">Snipes are placed by hand here; each auction pick shows the max to use.</div></div>`
    : `<div style="padding-top:12px"><b>Gixen reading is off.</b><div class="muted" style="font-size:13px;margin-top:4px">Turn on "Read Gixen snipes" in the Snipe Hunt settings to see your snipes here.</div></div>`)
  : `<div style="padding-top:12px"><b>Can't read Gixen yet.</b><div class="muted" style="font-size:13px;margin:4px 0 8px">${esc(c.gixen.problem || 'Waiting for the first read')}.</div>${act('Sign in to Gixen now', {action: 'gixen_refresh', login: true}, {busy: 'Signing in…', color: '#6a1b9a'})}</div>`;
const gixenStale = g => `<div class="warn">List is from ${ago(g.read_at)}. ${esc(g.problem)}.<br>${act('Sign in now', {action: 'gixen_refresh', login: true}, {busy: 'Signing in…', color: '#6a1b9a'})} <span class="muted">This signs your browser out of Gixen.</span></div>`;
const searchBtn = c => c.d.status.searching ? pill('Searching eBay…', '#1e88e5') : act('Search eBay now', {action: 'search'}, {busy: 'Starting…', color: c.accent});

// ------------------------------------------------------------------- panels
// name: [label, redraw every 30 s for the countdowns?, draw]
// ------------------------------------------------------- tiles (Tonight strips)
// What you would pay now, delivered: the asking price, or today's bid, plus shipping.
const payNow = p => Number(p.bid_now ?? p.price) + (p.combined_ship ? 0 : Number(p.shipping ?? 5));
const shareNow = p => p.value ? payNow(p) / Number(p.value) : null;
const shareAtMax = p => p.value && p.max != null ? (Number(p.max) + (p.combined_ship ? 0 : Number(p.shipping ?? 5))) / Number(p.value) : null;
const clockColor = ms => ms < HOUR ? '#e53935' : ms < 3 * HOUR ? '#fb8c00' : ms < 12 * HOUR ? '#f9a825' : '#546e7a';
const offMeter = share => {
  if (share == null) return '';
  const off = Math.max(0, Math.min(100, Math.round(100 * (1 - share))));
  const color = off >= 75 ? '#00c853' : off >= 50 ? '#43a047' : off >= 25 ? '#f9a825' : '#78909c';
  return `<div class="meter" title="How far under its value you would pay, shipping included"><span style="width:${off}%;background:${color}"></span></div>`;
};
// ---- live clocks: anything with data-end is re-read every second (SnipeHuntCard.tick)
const clockTxt = ms => {
  if (ms <= 0) return 'ended';
  const sec = Math.floor(ms / 1000), m = Math.floor(sec / 60), h = Math.floor(m / 60);
  if (h < 1) return m + 'm ' + String(sec % 60).padStart(2, '0') + 's';
  if (h < 48) return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
};
const bigClock = ms => {
  if (ms <= 0) return 'ENDED';
  const sec = Math.floor(ms / 1000), m = Math.floor(sec / 60), h = Math.floor(m / 60);
  if (h >= 48) return Math.floor(h / 24) + 'd ' + String(h % 24).padStart(2, '0') + 'h';
  return h + ':' + String(m % 60).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
};
const liveClock = (iso, cls = 'clock', extra = '') => {
  const ms = msLeft(iso);
  return `<span class="${cls}" data-end="${esc(iso)}" style="background:${clockColor(ms)};${extra}">⏱ ${clockTxt(ms)}</span>`;
};

// ---- what you have already seen: a pick's first sighting on this browser, so a
// ✨ New badge marks what landed since you last looked (for 12 hours).
const FRESH = 12 * HOUR;
const seenKey = () => 'ws_' + scoped('seen');
let seenCache = null, seenFor = null;
const seenMap = () => {
  if (seenCache && seenFor === seenKey()) return seenCache;
  seenFor = seenKey();
  try { seenCache = JSON.parse(localStorage.getItem(seenFor) || 'null'); } catch (e) { seenCache = null; }
  return seenCache;
};
const noteSeen = picks => {
  const now = Date.now();
  let seen = seenMap(), changed = false;
  if (!seen) {   // first visit: nothing is new yet
    seen = {}; picks.forEach(p => { seen[p.item_id] = now - FRESH; }); changed = true;
  }
  const live = new Set(picks.map(p => p.item_id));
  picks.forEach(p => { if (!(p.item_id in seen)) { seen[p.item_id] = now; changed = true; } });
  Object.keys(seen).forEach(id => { if (!live.has(id) && now - seen[id] > 7 * 24 * HOUR) { delete seen[id]; changed = true; } });
  seenCache = seen; seenFor = seenKey();
  if (changed) try { localStorage.setItem(seenFor, JSON.stringify(seen)); } catch (e) { /* not kept past this visit */ }
};
const isFresh = p => { const t = (seenMap() || {})[p.item_id]; return t != null && Date.now() - t < FRESH; };
const newPill = p => isFresh(p) ? pill('✨ New', '#7c4dff') + ' ' : '';
const findKey = p => esc([p.card || p.title, p.seller, p.year, p.tier, (p.labels || []).join(' '), p.item_id].join(' ').toLowerCase());

// ---- small charts
const ring = (pct, color, label, sub) => {
  const r = 26, round = 2 * Math.PI * r, v = Math.max(0, Math.min(100, Number(pct) || 0));
  return `<div class="ring"><svg viewBox="0 0 64 64" width="76" height="76" aria-label="${esc(sub || label)}">
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="#8883" stroke-width="7"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(v / 100 * round).toFixed(1)} ${round.toFixed(1)}" transform="rotate(-90 32 32)"/>
    <text x="32" y="37" text-anchor="middle" font-size="15" font-weight="800" fill="currentColor">${label}</text></svg>${sub ? `<div class="ring-sub">${sub}</div>` : ''}</div>`;
};
const hbar = (label, value, max, color, text) => `<div class="hbar"><div class="hbar-label">${label}</div>
  <div class="hbar-track"><span style="width:${max ? Math.max(2, Math.round(value / max * 100)) : 0}%;background:${color}"></span></div><div class="hbar-val">${text}</div></div>`;
const stack = (parts, total) => `<div class="stack">${parts.filter(p => p[1] > 0).map(([label, n, color]) => `<span style="flex:${n};background:${color}" title="${esc(label)}: ${n}"></span>`).join('')}</div>
  <div class="legend">${parts.filter(p => p[1] > 0).map(([label, n, color]) => `<span><span class="dot" style="background:${color}"></span>${esc(label)} <b>${n}</b>${total ? ` <span class="muted">${Math.round(n / total * 100)}%</span>` : ''}</span>`).join('')}</div>`;

// The 24 hours ahead as a line: a dot where each picked auction ends, hatched
// where your quiet hours fall, so you can see when tonight needs you.
const quietSpans = (s, now, span) => {
  if (!s.quiet_hours || !s.quiet_start || !s.quiet_end) return [];
  const at = (day, hm) => { const [h, m] = String(hm).split(':').map(Number); const d = new Date(now); d.setDate(d.getDate() + day); d.setHours(h, m || 0, 0, 0); return d.getTime(); };
  const out = [];
  for (let day = -1; day <= 1; day++) {
    let a = at(day, s.quiet_start), b = at(day, s.quiet_end);
    if (b <= a) b += 24 * HOUR;
    const x = Math.max(a, now), y = Math.min(b, now + span);
    if (y > x) out.push([(x - now) / span * 100, (y - x) / span * 100]);
  }
  return out;
};
const timeline = c => {
  const span = 24 * HOUR, now = Date.now();
  const ends = c.allPicks.filter(p => p.is_auction && p.end_time && msLeft(p.end_time) > 0 && msLeft(p.end_time) < span)
    .sort((x, y) => x.end_time < y.end_time ? -1 : 1);
  if (!ends.length) return '';
  const quiet = quietSpans(c.s, now, span).map(([l, w]) => `<div class="tl-quiet" style="left:${l.toFixed(1)}%;width:${w.toFixed(1)}%" title="Quiet hours: alerts wait for the morning"></div>`).join('');
  const lanes = [];   // stack dots that land within the same stretch
  const dots = ends.map(p => {
    const x = msLeft(p.end_time) / span * 100;
    let lane = 0; while (lanes[lane] != null && x - lanes[lane] < 2.2) lane++;
    lanes[lane] = x;
    const t = TIER[p.tier] || ['', '#546e7a'];
    return `<a class="tl-dot${c.inGixen(p) ? ' got' : ''}" href="${esc(p.url)}" target="_blank" rel="noopener" style="left:${x.toFixed(2)}%;top:${4 + (lane % 3) * 10}px;background:${t[1]}"
      title="${esc(p.card)} · ends ${when(p.end_time)} · now ${money(payNow(p))}${p.max != null ? ' · max ' + cents(p.max) : ''}${c.inGixen(p) ? ' · in Gixen' : ''}"></a>`;
  }).join('');
  const ticks = [];
  for (let h = 0; h <= 24; h += 4) ticks.push(`<span style="left:${h / 24 * 100}%">${h === 0 ? 'now' : h === 24 ? '+24h' : new Date(now + h * HOUR).toLocaleTimeString([], {hour: 'numeric'})}</span>`);
  const got = ends.filter(p => c.inGixen(p)).length;
  return `<div class="tl"><div class="tl-cap">NEXT 24 HOURS · ${ends.length} AUCTION${ends.length === 1 ? '' : 'S'} END${got ? ` · ${got} IN GIXEN (RINGED)` : ''}${quiet ? ' · HATCHED = QUIET HOURS' : ''}</div>
    <div class="tl-track">${quiet}${dots}</div><div class="tl-ticks">${ticks.join('')}</div></div>`;
};

const tile = p => {
  const ms = p.is_auction && p.end_time ? msLeft(p.end_time) : null;
  const share = shareNow(p), off = share == null ? null : Math.round(100 * (1 - share));
  const img = p.image ? p.image.replace('s-l225', 's-l500') : null;
  const corner = ms != null
    ? liveClock(p.end_time)
    : `<span class="clock" style="background:#1e88e5">${p.via_bin ? 'BIN ON AUCTION' : p.best_offer ? 'BUY / OFFER' : 'BUY NOW'}</span>`;
  const edgeColor = p.jackpot ? '#d50000' : (TIER[p.tier] || ['', '#546e7a'])[1];
  const hot = p.jackpot ? ' jp' : (ms != null && ms < HOUR ? ' hot' : '');
  const buttons = p.is_auction
    ? copyBtn('Copy max ' + (p.max == null ? '' : cents(p.max)), p.max == null ? '' : cents(p.max)) + (p.snipe == null && !p.marked ? snipeBtn(p.item_id, p.max) : copyBtn('Item #', p.item_id)) + markBtn(p) + binBtn(p)
    : linkBtn(p.best_offer ? 'Buy / offer ↗' : 'Buy now ↗', p.url, '#1e88e5') + copyBtn('Item #', p.item_id);
  return `<div class="tile${hot}" data-row data-find="${findKey(p)}" style="border-top-color:${edgeColor}">
    <a class="tile-img" href="${esc(p.url)}" target="_blank" rel="noopener">
      ${img ? `<img src="${esc(img)}" loading="lazy" alt="">` : '<div class="noimg">🃏</div>'}
      ${corner}${off != null && off > 0 ? `<span class="off">-${off}%</span>` : ''}${p.jackpot ? '<span class="jptag">🚨 JACKPOT</span>' : ''}${isFresh(p) ? '<span class="newtag">✨ NEW</span>' : ''}
    </a>
    <div class="tile-body">
      <a class="title clamp" href="${esc(p.url)}" target="_blank" rel="noopener">${(TIER[p.tier] || [''])[0]} ${esc(p.card)}</a>
      <div class="tile-price"><b>${money(payNow(p))}</b> <span class="muted">${p.is_auction ? 'now · w/ ship' : 'w/ ship'}</span></div>
      <div class="muted tile-sub">worth ~<b style="color:var(--primary-text-color)">${worth(p.value)}</b>${p.value && saved(p) > 0 ? ` · <b style="color:#43a047">save ${worth(saved(p))}</b>` : ''}${p.max_basis === 'sales' ? ' · sales' : ' · est.'}${p.is_auction && p.max != null ? ` · max <b style="color:var(--primary-text-color)">${cents(p.max)}</b>` : ''}${oddsTxt(p)}</div>
      ${offMeter(share)}
      ${p.snipe != null ? `<div class="tile-sub" style="color:#43a047;font-weight:600">✓ Sniped at ${cents(p.snipe)}</div>` : (p.marked ? `<div class="tile-sub" style="color:#43a047;font-weight:600">✓ Added to Gixen${p.marked.max ? ' at ' + cents(p.marked.max) : ''}</div>` : '')}
      ${trendPill(p)}${closesPill(p, true) || (p.via_bin ? `<div class="tile-sub muted">a Buy It Now on an auction: gone at the first bid</div>` : '')}
      <div class="row tight">${buttons}</div>
    </div></div>`;
};
const strip = (tiles, more) => `<div class="strip">${tiles.join('')}</div>` + (more || '');

// Buy It Now steals at your steal line or better (max_share, else 60% of value),
// the cheapest share of value first, jackpots on top.
const buyLine = c => Math.min(Number(c.s.max_share) || 0.6, 0.6);
const buyNowSteals = c => {
  const line = buyLine(c);
  // an auction's Buy It Now is a Buy It Now until someone bids
  const viaBin = c.picks.filter(p => p.is_auction && p.bin_price && p.value && !p.unverified && !(Number(p.bids) > 0))
    .map(p => ({...p, is_auction: false, price: p.bin_price, bid_now: null, via_bin: true}))
    .filter(p => shareNow(p) <= line);
  const live = c.picks.filter(p => !p.is_auction && p.value && !p.unverified && shareNow(p) <= line).concat(viaBin);
  const ids = new Set(live.map(p => p.item_id));
  const jack = (c.d.jackpots || []).filter(p => !p.is_auction && !ids.has(p.item_id));
  return [...jack, ...live].sort((x, y) => !!y.jackpot - !!x.jackpot || shareNow(x) - shareNow(y));
};
// Picks a time-based list leaves out because they folded (small or close to market):
// a muted line at its foot so nothing vanishes silently.
const foldNote = (c, list, ...a) => {
  const n = list({...c, picks: c.unfolded}, ...a).length - list(c, ...a).length;
  return n > 0 ? `<div class="muted" style="font-size:12px;padding:8px 0 0">🧊 ${n} small or close to market folded away. ${navBtn('See them on Steals', 'steals')}</div>` : '';
};
// Picked auctions still live and not bid past the max: soonest ending first, or best deal at max.
const endingSoon = (c, order = 'soon') => c.picks
  .filter(p => p.is_auction && p.end_time && msLeft(p.end_time) > 0 && !(room(p) < 0))
  .sort(order === 'best'
    ? (x, y) => (shareAtMax(x) ?? 9) - (shareAtMax(y) ?? 9) || (x.end_time < y.end_time ? -1 : 1)
    : (x, y) => x.end_time < y.end_time ? -1 : 1);

// Card type × ending hour: how far from the going rate those auctions closed.
// Blue is cheap (a lowball max wins there), red is dear.
const heatColor = share => share == null ? '#8882' : share <= 0.75 ? '#0288d1cc' : share <= 0.9 ? '#0288d177' : share <= 1.1 ? '#8884' : share <= 1.3 ? '#e5393577' : '#e53935cc';
const heatGrid = types => {
  const cell = g => g && g.n ? `<div style="background:${heatColor(g.share)}" title="${g.n} sold">${Math.round(100 * g.share)}%<small class="muted"> · ${g.n}</small></div>` : '<div class="muted" style="background:#8881">–</div>';
  return `<div class="heat" style="grid-template-columns:minmax(70px,1fr) 1fr 1fr"><div class="hl"></div><div class="hl">🌤️ Daytime</div><div class="hl">🌙 Evening</div>` +
    Object.entries(types).map(([name, g]) => `<div class="hl">${esc(name)}</div>${cell(g.day)}${cell(g.evening)}`).join('') + `</div>`;
};

// ---- the board: every auction with your name on it, picks and Gixen snipes
// merged by item id and sorted by when they end, like a departures board.
const BOARD = {
  outbid: ['OUTBID', '#e53935'], check: ['CHECK', '#ff6d00'], need: ['NEEDS SNIPE', '#ff9100'],
  sniped: ['SNIPED', '#9575cd'], added: ['ADDED', '#43a047'], past: ['PAST MAX', '#78909c'], watch: ['WATCHING', '#78909c'],
};
const boardRows = c => {
  const rows = new Map();
  c.allPicks.filter(p => p.is_auction && p.end_time && msLeft(p.end_time) > 0).forEach(p => rows.set(p.item_id, {p}));
  c.snipes.forEach(s => { const r = rows.get(s.item_id); if (r) r.s = s; else rows.set(s.item_id, {s}); });
  (((c.d.lowball || {}).targets) || []).filter(t => t.sniped && !rows.has(t.item_id) && msLeft(t.end_time) > 0).forEach(t => rows.set(t.item_id, {t}));
  const needIds = new Set(c.need.map(p => p.item_id));
  return [...rows.values()].map(({p, s, t}) => {
    const src = p || s || t;
    const now = Number(s ? s.current_bid : (p ? (p.bid_now ?? p.price) : t.price)) || 0;
    const mine = s ? s.max_bid : (p && p.snipe != null ? p.snipe : (p && p.marked && p.marked.max ? Number(p.marked.max) : (t ? t.snipe : null)));
    const botMax = p ? p.max : (s ? s.bot_max : t.snipe);
    const value = p ? p.value : (s && s.check && s.check.value != null ? s.check.value : (t ? t.value : null));
    const ship = p ? (p.combined_ship ? 0 : Number(p.shipping ?? 5)) : (t ? Number(t.shipping ?? 5) : 0);
    let state = 'watch';
    if ((s && s.outbid) || (mine != null && now >= Number(mine))) state = 'outbid';
    else if (s && ((s.doubts || []).some(d => SERIOUS_DOUBT.includes(d.kind)) || costly(s))) state = 'check';
    else if (s || (p && p.snipe != null) || t) state = 'sniped';
    else if (p && p.marked) state = 'added';
    else if (p && needIds.has(p.item_id)) state = 'need';
    else if (p && room(p) < 0) state = 'past';
    return {id: src.item_id, end: src.end_time, title: p ? p.card : (s ? (s.title || s.item_id) : t.title), url: src.url, seller: src.seller || '',
      tier: src.tier, now, mine, botMax, value, ship, state, bids: p ? p.bids : null,
      win: s && s.check && s.check.win != null ? s.check.win : (p ? p.win : null), fresh: p ? isFresh(p) : false};
  }).sort((x, y) => x.end < y.end ? -1 : 1);
};
// What a pick costs you, delivered, on the steal map: the bot's max for an auction
// (or today's bid), the asking price for a Buy It Now, shipping included.
const mapPay = (p, mode) => (p.is_auction ? (mode === 'now' || p.max == null ? Number(p.bid_now ?? p.price) : Number(p.max)) : Number(p.price)) + (p.combined_ship ? 0 : Number(p.shipping ?? 5));
// A chart's drawing width: the card's own, so its text is drawn 1:1 (the next redraw follows a resize).
const cardWidth = c => Math.max(300, Math.min(1200, (c.card.offsetWidth || c.card.clientWidth || 628))) - 28;
// One series over dates: pts = [{d: 'YYYY-MM-DD', y, bar?, tip?}]. `ref` draws a dashed level (the
// index's 100), `fmt` writes the y labels, bars (when given) sit along the bottom.
const lineChart = (c, pts, {color, fmt = v => String(Math.round(v)), ref = null, bars = false, h = 220} = {}) => {
  pts = pts.filter(p => p.y != null);
  if (pts.length < 2) return empty('Not enough points yet.');
  const W = cardWidth(c), H = h, L = 46, R = 14, T = 14, B = 26, BARS = bars ? 34 : 0;
  const ys = pts.map(p => p.y).concat(ref != null ? [ref] : []);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12; lo = Math.max(0, lo - pad); hi += pad;
  const X = i => L + i / (pts.length - 1) * (W - L - R), Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B - BARS);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const area = line + ` L${X(pts.length - 1).toFixed(1)},${(H - B - BARS).toFixed(1)} L${L},${(H - B - BARS).toFixed(1)} Z`;
  const col = color || c.accent;
  const rules = [0, .5, 1].map(f => { const v = lo + f * (hi - lo);
    return `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="currentColor" stroke-opacity=".1"/><text x="${L - 6}" y="${(Y(v) + 3.5).toFixed(1)}" font-size="10" text-anchor="end" fill="currentColor" fill-opacity=".6">${esc(fmt(v))}</text>`; }).join('');
  const refLine = ref != null ? `<line x1="${L}" x2="${W - R}" y1="${Y(ref).toFixed(1)}" y2="${Y(ref).toFixed(1)}" stroke="currentColor" stroke-opacity=".45" stroke-dasharray="4 4"/>` : '';
  const maxBar = Math.max(1, ...pts.map(p => p.bar || 0)), bw = Math.max(2, Math.min(16, (W - L - R) / pts.length - 3));
  const barSvg = bars ? pts.map((p, i) => p.bar ? `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${(H - B - p.bar / maxBar * (BARS - 6)).toFixed(1)}" width="${bw.toFixed(1)}" height="${(p.bar / maxBar * (BARS - 6)).toFixed(1)}" rx="2" fill="currentColor" fill-opacity=".25"/>` : '').join('') : '';
  const lab = d => new Date(d + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric'});
  const ticks = [0, Math.floor((pts.length - 1) / 2), pts.length - 1].map(i => `<text x="${X(i).toFixed(1)}" y="${H - 6}" font-size="10" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}" fill="currentColor" fill-opacity=".6">${lab(pts[i].d)}</text>`).join('');
  const dots = pts.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${pts.length > 40 ? 6 : 3.5}" fill="${pts.length > 40 ? 'transparent' : col}"><title>${esc(p.tip || lab(p.d) + ': ' + fmt(p.y))}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block;max-width:100%;margin:6px 0">${rules}${refLine}${barSvg}
    <path d="${area}" fill="${col}" fill-opacity=".12"/><path d="${line}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round"/>${dots}${ticks}</svg>`;
};
const clockTime = iso => new Date(iso).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
const dayWord = iso => { const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? 'today' : d.toLocaleDateString([], {weekday: 'short'}); };

const PANELS = {
  hero: ['Command center', true, c => {
    // The top of Tonight: who the bot is hunting, the numbers that matter, the
    // next auction to end with a live clock, and the 24 hours ahead as a line.
    const a = c.d.status, pipe = c.d.pipeline || {}, sv = (c.d.savings || {}).month, prof = c.d.profile || {};
    const color = {ok: '#43a047', stale: '#fb8c00', failing: '#e53935'}[a.state] || '#546e7a';
    const fresh = c.allPicks.filter(isFresh).length;
    const hour = c.allPicks.filter(p => p.is_auction && p.end_time && msLeft(p.end_time) < HOUR).length;
    const next = endingSoon(c)[0];
    const hs = (label, value, color, sub) => `<div class="hs"${color ? ` style="border-color:${color}66;background:${color}2a"` : ''}><b>${value}</b><small>${label}</small>${sub ? `<small class="hs-sub">${sub}</small>` : ''}</div>`;
    const noGixen = c.d.gixen_account === false;   // a bot with no Gixen account
    const bought = sv && sv.n > 0;
    const stats = [
      hs('LIVE PICKS', c.allPicks.length, null, fresh ? `✨ ${fresh} new` : ''),
      hs(c.gixenOn ? 'NEED A SNIPE' : 'ENDING · ' + c.hours + 'H', c.need.length, c.need.length ? '#ff5252' : '#69f0ae'),
      noGixen ? hs('AUCTIONS LIVE', c.allPicks.filter(p => p.is_auction).length, '#b388ff') : hs('IN GIXEN', c.gixenOn ? c.snipes.length : '–', '#b388ff'),
      hs('TO PAY', '$' + Math.round(pipe.unpaid_total || 0), pipe.unpaid_total ? '#40c4ff' : null),
      hs('SAVED · MONTH', bought ? '$' + Math.round(sv.saved) : '–', bought ? '#69f0ae' : null, bought ? `${sv.n} cards · paid ${sv.pct}% of value` : 'no buys yet'),
    ];
    const nextHtml = !next ? `<div class="hero-next"><div style="flex:1"><div class="hero-kicker">NEXT TO END</div><div class="muted" style="font-size:13px;margin-top:4px">No picked auction is live${c.hidden ? ` outside Gixen (${c.hidden} already sniped)` : ''}. New ones land within the hour.</div></div></div>`
      : `<div class="hero-next" data-row>
        ${next.image ? `<a href="${esc(next.url)}" target="_blank" rel="noopener"><img src="${esc(next.image.replace('s-l225', 's-l500'))}" alt=""></a>` : ''}
        <div style="flex:1;min-width:0">
          <div class="hero-kicker">NEXT TO END${hour ? ` · <b style="color:#ff8a80">${hour} IN THE NEXT HOUR</b>` : ''}${!noGixen && (next.snipe != null || next.marked) ? ' · ✓ IN GIXEN' : ''}</div>
          <a class="hero-title" href="${esc(next.url)}" target="_blank" rel="noopener">${(TIER[next.tier] || [''])[0]} ${esc(next.card)}</a>
          <div style="font-size:13px"><b style="font-size:16px">${money(payNow(next))}</b> <span class="muted">now w/ ship</span>${next.max != null ? ` · max <b>${cents(next.max)}</b>` : ''} · worth ~<b>${worth(next.value)}</b>${shareNow(next) == null ? '' : shareNow(next) < 1 ? ` · <b style="color:#69f0ae">${Math.round(100 * (1 - shareNow(next)))}% off</b>` : ' · <b style="color:#ff8a80">over its value now</b>'}${next.bids != null ? ` · ${next.bids} bid${next.bids === 1 ? '' : 's'}` : ''}</div>
          <div class="muted" style="font-size:12px;margin-top:3px">ends ${when(next.end_time)} · ${esc(next.seller)}${closesPill(next, true) ? '' : ''}</div>
          <div class="row tight">${next.max != null ? copyBtn('Copy max ' + cents(next.max), cents(next.max)) : ''}${noGixen ? copyBtn('Item #', next.item_id) + linkBtn('Bid on eBay ↗', next.url, '#1e88e5') : (next.snipe == null && !next.marked ? snipeBtn(next.item_id, next.max) : copyBtn('Item #', next.item_id)) + markBtn(next)}${binBtn(next)}</div>
        </div>
        <div class="hero-clock" style="color:${clockColor(msLeft(next.end_time))}"><span data-end="${esc(next.end_time)}" data-big>${bigClock(msLeft(next.end_time))}</span><small>LEFT</small></div>
      </div>`;
    return `<div class="hero" style="--accent:${c.accent}">
      <div class="hero-top">
        <div class="hero-brand">
          <div class="hero-name">${esc(c.card.feed.options.name || prof.app_name || 'Snipe Hunt')}</div>
          <div class="hero-sub"><span class="dot pulse" style="background:${color}"></span>${prof.player ? esc(prof.player) + ' · ' : ''}${Number(a.listings || 0).toLocaleString()} listings watched · searched ${ago(a.last_search)}${a.searching ? ' · searching now' : ''}</div>
        </div>
        <div class="hero-stats">${stats.join('')}</div>
      </div>
      ${nextHtml}
      ${timeline(c)}
    </div>`;
  }],

  tape: ['Sales tape', false, c => {
    // The newest real sales of the player's cards as a slow ticker: the market
    // going by under the command center. Green is a pick that closed under the
    // bot's max, red one that went past it. Hover pauses it; a tap opens the sale.
    const sold = ((c.d.market || {}).sold || []).slice(0, 30);
    if (!sold.length) return '';
    const player = ((c.d.profile || {}).player || '').trim();
    const strip = player ? new RegExp(player.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig') : null;
    const item = x => {
      const k = x.call, color = k ? (k.under_max ? '#2e7d32' : '#e53935') : 'inherit';
      const name = (strip ? x.title.replace(strip, '') : x.title).replace(/\s+/g, ' ').trim();
      return `<a class="tp" href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.title)} · ${x.kind === 'bin' ? 'Buy It Now' : (x.bids || 0) + ' bid' + (x.bids === 1 ? '' : 's')} · sold ${esc(when(x.sold_at))}${k ? (k.under_max ? ' · a pick that closed under the max' : ' · a pick that went past the max') : ''}"><b style="color:${color}">${money(x.total)}</b> ${esc(name.slice(0, 52))}<small>${x.kind === 'bin' ? 'BIN' : (x.bids || 0) + ' bid' + (x.bids === 1 ? '' : 's')} · ${esc(clockTime(x.sold_at))}</small></a>`;
    };
    const run = sold.map(item).join('');
    return `<div class="tape" style="--n:${sold.length}"><div class="tape-tag">🔨 SOLD<small>${Number((c.d.market || {}).count_7d || 0).toLocaleString()} this week</small></div><div class="tape-win"><div class="tape-run">${run}${run}</div></div></div>`;
  }],

  board: ['The board', true, c => {
    // Every auction with your name on it, soonest first: the picks, your Gixen
    // snipes (on picks or not) and lowball snipes you set. Each row ticks by the
    // second and says what it needs from you; the footer adds up what every snipe
    // in the window would cost if it won.
    const all = boardRows(c);
    if (!all.length) return empty(`No auction with your name on it is live right now.${c.gixenOn ? '' : ' Gixen can\'t be read, so only picks can show.'}`);
    const span = store('board_span', '24');
    const win = {24: 24 * HOUR, 48: 48 * HOUR, all: Infinity}[span] || 24 * HOUR;
    let rows = all.filter(r => msLeft(r.end) < win);
    const auto = !rows.length;   // nothing that soon: show the lot
    if (auto) rows = all;
    const n = Number(c.card.config.count) || 14;
    const paged = store('board_limit', 'page') !== 'all';
    const shown = paged ? rows.slice(0, n) : rows;
    const count = k => rows.filter(r => r.state === k).length;
    const mine = rows.filter(r => r.mine != null && r.state !== 'outbid');
    const exposure = mine.reduce((t, r) => t + Number(r.mine) + r.ship, 0);
    const valued = mine.filter(r => r.value), worthSum = valued.reduce((t, r) => t + Number(r.value), 0), paySum = valued.reduce((t, r) => t + Number(r.mine) + r.ship, 0);
    const line = r => {
      const ms = msLeft(r.end), [label, color] = BOARD[r.state];
      const yours = r.mine ?? r.botMax;
      const off = r.value && yours != null ? Math.round(100 * (1 - (Number(yours) + r.ship) / Number(r.value))) : null;
      const offColor = off == null ? '' : off >= 50 ? '#2e7d32' : off >= 25 ? '#f9a825' : off >= 0 ? 'var(--secondary-text-color)' : '#e53935';
      const btn = r.state === 'need' ? snipeBtn(r.id, r.botMax, '🎯 Snipe') + (r.botMax != null ? copyBtn('Max ' + cents(r.botMax), cents(r.botMax)) : '')
        : r.state === 'outbid' && r.win != null && Number(r.win) > r.now ? snipeBtn(r.id, r.win, '🎯 Re-snipe') + copyBtn('Win ' + cents(r.win), cents(r.win))
        : r.state === 'check' ? linkBtn('Gixen ↗', GIXEN_URL, '#ff6d00') : '';
      return `<div class="brow${ms < HOUR ? ' soon' : ''}${r.state === 'need' ? ' need' : ''}" data-row data-find="${esc((r.title + ' ' + r.seller + ' ' + r.id).toLowerCase())}">
        <div class="bclock" data-end="${esc(r.end)}" data-text style="color:${clockColor(ms)}">${clockTxt(ms)}</div>
        <div class="bwhen">${esc(clockTime(r.end))}<small>${esc(dayWord(r.end))}</small></div>
        <div class="bcard"><a class="title" href="${esc(r.url)}" target="_blank" rel="noopener">${(TIER[r.tier] || [''])[0]} ${esc(r.title)}</a><small>${esc(r.seller)}${r.bids != null ? ` · ${r.bids} bid${r.bids === 1 ? '' : 's'}` : ''}${r.fresh ? ' · ✨ new' : ''}</small></div>
        <div class="bnums">
          <div class="bnum"><small>NOW</small>${money(r.now)}</div>
          <div class="bnum"><small>${r.mine != null ? 'SNIPE' : 'MAX'}</small>${yours != null ? cents(yours) : '–'}</div>
          <div class="bnum"><small>WORTH</small>${r.value ? worth(r.value) : '–'}${off != null ? ` <b style="color:${offColor}">${off >= 0 ? '-' + off : '+' + -off}%</b>` : ''}</div>
        </div>
        <div class="bstate" style="--c:${color}">${label}</div>
        <div class="bact">${btn}</div>
      </div>`;
    };
    const tally = [count('sniped') + count('added') ? `<b style="color:#9575cd">${count('sniped') + count('added')}</b> sniped` : '',
      count('need') ? `<b style="color:#ff9100">${count('need')}</b> need a snipe` : '', count('outbid') ? `<b style="color:#e53935">${count('outbid')}</b> outbid` : '',
      count('check') ? `<b style="color:#ff6d00">${count('check')}</b> to check` : ''].filter(Boolean).join(' · ');
    return `<div class="board">
      <div class="bhead">${chips('board_span', '24', [['24', 'Next 24h'], ['48', '48h'], ['all', 'All ' + all.length]], span)}
        <div class="muted" style="font-size:12px">${rows.length} auction${rows.length === 1 ? '' : 's'}${auto ? ` (none in the next ${span}h, so every one)` : ''}${tally ? ' · ' + tally : ''}</div></div>
      ${shown.map(line).join('')}
      ${rows.length > shown.length ? `<div class="row" style="padding:8px 0 0">${setBtn('Show all ' + rows.length, 'board_limit', 'all', '#546e7a')}</div>` : (!paged && rows.length > n ? `<div class="row" style="padding:8px 0 0">${setBtn('Show fewer', 'board_limit', 'page')}</div>` : '')}
      <div class="bfoot">${mine.length ? `If every snipe here wins: <b>${money(exposure)}</b> delivered${valued.length ? ` for about <b>${worth(worthSum)}</b> of cards (${Math.round(100 * paySum / worthSum)}% of value${valued.length < mine.length ? `, ${mine.length - valued.length} unpriced` : ''})` : ''}.` : 'No snipe of yours is in this window yet.'}${c.gixenOn ? '' : ' Gixen can\'t be read: only picks and your ✓ marks show.'}</div>
    </div>`;
  }],

  map: ['Steal map', true, c => {
    // Every live pick as a dot: what you would pay, delivered, against what the
    // card goes for. Above the line is under value; the shaded bands are half
    // value and a quarter. Bigger dots have more deal stars, a white ring is a
    // pick already in Gixen. Tap a dot for the pick itself.
    const mode = store('map_x', 'max');
    const pts = c.allPicks.filter(p => Number(p.value) > 0).map(p => ({p, x: mapPay(p, mode), y: Number(p.value)})).filter(o => o.x > 0);
    if (!pts.length) return empty('No live pick has a going rate yet.');
    const W = cardWidth(c), H = Math.round(Math.min(480, Math.max(300, W * 0.6))), L = 44, R = 64, T = 16, B = 40;
    const lo = 0.5, hi = Math.max(20, ...pts.map(o => Math.max(o.x, o.y))) * 1.5;
    const lg = v => Math.log10(Math.max(lo, Math.min(hi, v)));
    const X = v => L + (lg(v) - lg(lo)) / (lg(hi) - lg(lo)) * (W - L - R);
    const Y = v => H - B - (lg(v) - lg(lo)) / (lg(hi) - lg(lo)) * (H - T - B);
    const ticks = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].filter(t => t >= lo && t <= hi);
    const axis = ticks.map(t => `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="currentColor" stroke-opacity=".1"/><line x1="${L}" x2="${W - R}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" stroke="currentColor" stroke-opacity=".1"/>
      <text x="${X(t).toFixed(1)}" y="${H - B + 14}" font-size="10" text-anchor="middle">$${t}</text><text x="${L - 5}" y="${(Y(t) + 3.5).toFixed(1)}" font-size="10" text-anchor="end">$${t}</text>`).join('');
    // value = k × pay: the line of fair price (k = 1), half value (2) and a quarter (4)
    const zone = (k, fill) => `<path d="M${X(lo)},${Y(lo * k)} L${X(hi / k)},${Y(hi)} L${X(lo)},${Y(hi)} Z" fill="${fill}"/>`;
    const guide = (k, label, color, dash) => `<line x1="${X(lo)}" y1="${Y(lo * k)}" x2="${X(hi / k)}" y2="${Y(hi)}" stroke="${color}" stroke-width="1.2"${dash ? ' stroke-dasharray="4 4"' : ''}/>
      <text x="${(X(hi / k) + 4).toFixed(1)}" y="${T + 4 + (k === 2 ? 12 : 0)}" font-size="10" fill="${color}">${label}</text>`;
    const sel = store('map_pick', '');
    const dots = pts.slice().sort((a, b) => (a.p.deal || 0) - (b.p.deal || 0)).map(({p, x, y}) => {
      const t = TIER[p.tier] || ['', '#546e7a'], off = Math.round(100 * (1 - x / y)), r = 4 + (p.deal || 0) * 1.1, on = sel === p.item_id, got = c.inGixen(p);
      const cx = X(x).toFixed(1), cy = Y(y).toFixed(1);
      return `<g class="dot${p.jackpot ? ' jp' : ''}${on ? ' on' : ''}" role="button" data-do="set" data-key="map_pick" data-value="${esc(on ? '' : p.item_id)}">
        <title>${esc(p.card)} · pay ${money(x)} · goes for ${worth(y)} · ${off >= 0 ? off + '% off' : -off + '% over'}${got ? ' · in Gixen' : ''}</title>
        <circle cx="${cx}" cy="${cy}" r="13" fill="transparent"/>
        ${on ? `<circle cx="${cx}" cy="${cy}" r="${(r + 7).toFixed(1)}" fill="none" stroke="var(--primary-text-color)" stroke-opacity=".7" stroke-width="1.5"/>` : ''}
        <circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${t[1]}" fill-opacity="${p.unverified ? .35 : .9}" stroke="${on || got ? 'var(--primary-text-color)' : '#00000088'}" stroke-width="${on ? 3 : got ? 2 : 1}"/>
      </g>`;
    }).join('');
    const half = pts.filter(o => o.y >= 2 * o.x).length, quarter = pts.filter(o => o.y >= 4 * o.x).length;
    const offs = pts.map(o => 1 - o.x / o.y).sort((a, b) => a - b), median = Math.round(100 * offs[Math.floor(offs.length / 2)]);
    const chosen = sel && c.allPicks.find(p => p.item_id === sel);
    return `<div class="maphead">${chips('map_x', 'max', [['max', 'At the bot\'s max'], ['now', 'At today\'s bid']], mode)}
      <div class="muted" style="font-size:12px"><b style="color:var(--primary-text-color)">${pts.length}</b> picks · <b style="color:#43a047">${half}</b> at half value or better · <b style="color:#00c853">${quarter}</b> at a quarter · median <b style="color:var(--primary-text-color)">${median}% off</b></div></div>
    <svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Steal map">
      ${zone(2, '#43a04714')}${zone(4, '#00c85318')}${axis}
      ${guide(1, 'at value', '#e5737388')}${guide(2, 'half', '#43a047bb', true)}${guide(4, 'quarter', '#00c853bb', true)}
      <text x="${((L + W - R) / 2).toFixed(0)}" y="${H - 4}" font-size="10" text-anchor="middle" letter-spacing="2">YOU PAY, DELIVERED →</text>
      <text transform="translate(11 ${((T + H - B) / 2).toFixed(0)}) rotate(-90)" font-size="10" text-anchor="middle" letter-spacing="2">GOES FOR →</text>
      ${dots}
    </svg>
    <div class="legend" style="margin-top:2px">${Object.entries(TIER).filter(([k]) => k !== 'drop').map(([k, v]) => `<span><span class="dot" style="background:${v[1]}"></span>${v[0]} ${k === 'fire' ? 'Brag' : k === 'green' ? 'Value' : 'Cheap'}</span>`).join('')}<span><span class="dot" style="background:transparent;box-shadow:inset 0 0 0 2px var(--primary-text-color)"></span>in Gixen</span><span class="muted">bigger = more deal stars · ${mode === 'max' ? 'auctions at the bot\'s max, Buy It Nows at the asking price' : 'auctions at today\'s bid'}, shipping included</span></div>
    ${chosen ? `<div style="margin-top:6px">${pickLine(chosen, '', '')}</div>` : `<div class="muted" style="font-size:12px;margin-top:8px">Tap a dot to see the pick here.</div>`}`;
  }],

  growth: ['How it grew', false, c => {
    // The collection week by week: what you had paid by then (grey) against what
    // those cards are worth today by the ledger (green), with cards bought each
    // week as bars. The gap between the lines is the program's whole point.
    const cards = c.cards.filter(x => x.d && /^\d{4}-\d{2}-\d{2}/.test(x.d)).sort((a, b) => a.d < b.d ? -1 : 1);
    if (cards.length < 2) return empty('Not enough dated cards yet.');
    const day = s => new Date(s.slice(0, 10) + 'T12:00');
    const weekOf = d => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); x.setHours(12, 0, 0, 0); return x; };
    const first = weekOf(day(cards[0].d)), last = weekOf(new Date());
    const weeks = [];
    for (let w = new Date(first); w <= last; w.setDate(w.getDate() + 7)) weeks.push({at: new Date(w), n: 0, paid: 0, worth: 0});
    if (!weeks.length) return empty('Nothing dated yet.');
    cards.forEach(x => {
      const i = Math.min(weeks.length - 1, Math.max(0, Math.round((weekOf(day(x.d)) - first) / (7 * 24 * HOUR))));
      weeks[i].n++; weeks[i].paid += Number(x.p) || 0; weeks[i].worth += Number(x.v ?? x.p) || 0;
    });
    let cp = 0, cw = 0;
    weeks.forEach(w => { cp += w.paid; cw += w.worth; w.cp = cp; w.cw = cw; });
    const W = cardWidth(c), H = Math.round(Math.min(300, Math.max(220, W * 0.55))), L = 48, R = 18, T = 22, B = 48, BARS = 36;
    const top = Math.max(1, cp, cw) * 1.1;
    const X = i => L + (weeks.length > 1 ? i / (weeks.length - 1) : .5) * (W - L - R);
    const Y = v => T + (1 - v / top) * (H - T - B - BARS);
    const path = key => weeks.map((w, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(w[key]).toFixed(1)}`).join(' ');
    const area = key => path(key) + ` L${X(weeks.length - 1).toFixed(1)},${Y(0).toFixed(1)} L${X(0).toFixed(1)},${Y(0).toFixed(1)} Z`;
    const maxN = Math.max(1, ...weeks.map(w => w.n)), bw = Math.max(3, Math.min(18, (W - L - R) / weeks.length - 4));
    const bars = weeks.map((w, i) => { const h = w.n / maxN * (BARS - 8);
      return w.n ? `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${c.accent}" fill-opacity=".85"><title>${w.n} card${w.n === 1 ? '' : 's'} the week of ${w.at.toLocaleDateString([], {month: 'short', day: 'numeric'})} · ${money(w.paid)} paid</title></rect>` : ''; }).join('');
    const months = weeks.map((w, i) => (i === 0 || w.at.getMonth() !== weeks[i - 1].at.getMonth()) ? `<text x="${X(i).toFixed(1)}" y="${H - 4}" font-size="10" text-anchor="${i === 0 ? 'start' : 'middle'}">${w.at.toLocaleDateString([], {month: 'short'})}</text>` : '').join('');
    const rules = [.25, .5, .75, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${Y(f * top).toFixed(1)}" y2="${Y(f * top).toFixed(1)}" stroke="currentColor" stroke-opacity=".1"/><text x="${L - 6}" y="${(Y(f * top) + 3.5).toFixed(1)}" font-size="10" text-anchor="end">$${Math.round(f * top)}</text>`).join('');
    const marks = weeks.map((w, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(w.cw).toFixed(1)}" r="7" fill="transparent"><title>Week of ${w.at.toLocaleDateString([], {month: 'short', day: 'numeric'})} · ${money(w.cp)} paid so far · worth ${money(w.cw)} today</title></circle>`).join('');
    const xe = X(weeks.length - 1).toFixed(1), gainUp = cw >= cp;
    const best = weeks.reduce((a, b) => b.paid > a.paid ? b : a);
    const valued = c.cards.filter(x => x.v != null).length;
    return `<div style="padding-top:10px"></div>` + grid(3, [
      stat('WEEKS COLLECTING', weeks.length, c.accent, '📅'),
      stat('CARDS A WEEK', (cards.length / weeks.length).toFixed(1), '#1e88e5', '🃏'),
      stat('BIGGEST WEEK', '$' + Math.round(best.paid), '#fb8c00', '🧾'),
    ]) + `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Paid against worth, week by week">
      ${rules}
      <path d="${area('cp')}" fill="#78909c" fill-opacity=".16"/><path d="${area('cw')}" fill="${gainUp ? '#43a047' : '#e53935'}" fill-opacity=".12"/>
      <path d="${path('cp')}" fill="none" stroke="#90a4ae" stroke-width="2" stroke-linejoin="round"/>
      <path d="${path('cw')}" fill="none" stroke="${gainUp ? '#43a047' : '#e53935'}" stroke-width="2.5" stroke-linejoin="round"/>
      <text x="${xe}" y="${(Y(cw) - 7).toFixed(1)}" font-size="11" font-weight="700" text-anchor="end" fill="${gainUp ? '#43a047' : '#e53935'}">worth ${money(cw)}</text>
      <text x="${xe}" y="${(Y(cp) + 14).toFixed(1)}" font-size="11" font-weight="700" text-anchor="end" fill="#90a4ae">paid ${money(cp)}</text>
      ${bars}${months}${marks}
    </svg>
    <div class="muted" style="font-size:12px;line-height:1.5;margin-top:4px">Grey is what you had paid by each week; ${gainUp ? 'green' : 'red'} is what those same cards are worth today (${valued} of ${c.cards.length} priced by the ledger's newest sale of the same card, the rest at what you paid). Bars are cards bought each week.</div>`;
  }],

  buy_now: ['Buy now, think later', true, c => {
    const line = buyLine(c), all = buyNowSteals(c);
    if (!all.length) return empty(`No Buy It Now is at ${Math.round(100 * line)}% of its value or less right now. The bot checks every hour, and new ones push to your phone.`) + foldNote(c, buyNowSteals);
    const n = Number(c.card.config.count) || 8;
    return `<div class="muted strip-cap">${all.length} at ${Math.round(100 * line)}% of value or less, best first. Buy first, look closer after.</div>` +
      strip(all.slice(0, n).map(tile), all.length > n ? `<div class="row">${navBtn(`${all.length - n} more on Steals`, 'steals')}</div>` : '') + foldNote(c, buyNowSteals);
  }],

  ending: ['Ending soonest', true, c => {
    // Picked auctions, the soonest ending first (or the best deal at max first).
    const order = store('ending_order', 'soon');
    const live = endingSoon(c), sorted = endingSoon(c, order);
    if (!live.length) return empty('No picked auctions are live right now.') + foldNote(c, endingSoon);
    const n = Number(c.card.config.count) || 10;
    const hour = live.filter(p => msLeft(p.end_time) < HOUR).length;
    const unsniped = live.filter(p => p.snipe == null && msLeft(p.end_time) < c.windowMs).length;
    return `<div class="strip-head">${chips('ending_order', 'soon', [['soon', '⏱ Soonest'], ['best', '💎 Best deal']], order)}
      <div class="muted strip-cap">${live.length} live${hour ? ` · <b style="color:#e53935">${hour} in the last hour</b>` : ''}${c.gixenOn && unsniped ? ` · ${unsniped} with no snipe` : ''} ${gixenChip(c)}</div></div>` +
      strip(sorted.slice(0, n).map(tile), live.length > n ? `<div class="row">${navBtn(`All ${live.length} on Steals`, 'steals')}</div>` : '') + foldNote(c, endingSoon);
  }],

  summary: ['Right now', true, c => {
    const a = c.d.status, pipe = c.d.pipeline;
    const over = c.snipes.filter(s => s.outbid);
    const color = {ok: '#43a047', stale: '#fb8c00', failing: '#e53935'}[a.state] || '#546e7a';
    const last = c.d.last_action || {};
    const fresh = last.at && Date.now() - new Date(last.at) < 10 * 60e3;
    // Gixen snipes that could cost you: the wrong card, one you own, a double, a bad
    // slab, or an amount over the going rate. The details are in To do.
    const risky = c.snipes.filter(x => !x.outbid && ((x.doubts || []).some(d => SERIOUS_DOUBT.includes(d.kind)) || costly(x)));
    const banner = risky.length ? `<div class="warn" style="margin:0 0 10px;border-color:#e53935">⚠️ <b>${risky.length} snipe${risky.length === 1 ? '' : 's'} to check</b> before ${risky.length === 1 ? 'it ends' : 'they end'}: ${risky.slice(0, 3).map(x => esc((x.title || x.item_id).slice(0, 40))).join(' · ')}${risky.length > 3 ? ' …' : ''}. Details under To do.</div>` : '';
    return `<div style="padding-top:10px">` + savingsLine(c) + (c.d.demo ? `<div class="warn" style="margin:0 0 10px">Demo mode: these cards, prices and sellers are made up, and the buttons change nothing.</div>` : '') + banner + grid(4, [
      stat(c.gixenOn ? 'NEED A SNIPE' : 'ENDING · ' + c.hours + 'H', c.need.length, c.need.length ? '#e53935' : '#43a047', '🎯'),
      stat('OVER YOUR MAX', c.gixenOn ? over.length : '–', over.length ? '#fb8c00' : '#43a047', '📈'),
      stat('TO PAY', '$' + Math.round(pipe.unpaid_total || 0), '#1e88e5', '💳'),
      stat('TO FILE', pipe.to_file, '#8e24aa', '📥'),
    ]) + `<div class="row" style="margin-top:12px;align-items:center">
      ${searchBtn(c)}
      ${act('Refresh', {action: 'refresh'}, {busy: 'Refreshing…'})}
      ${linkBtn('Gixen ↗', GIXEN_URL)}
      ${linkBtn('eBay ↗', ebayUrl(c.d))}
    </div>
    <div class="muted" style="font-size:12px;margin-top:10px;line-height:1.5">
      <span class="dot" style="background:${color}"></span>${a.listings} listings watched · ${c.allPicks.length} live picks${c.hidden ? ` · <span title="Already in Gixen; hidden on the lists so other steals surface">${c.hidden} in Gixen</span>` : ''} · searched ${ago(a.last_search)}
      ${fresh ? `<br>${last.ok ? '✓' : '⚠️'} ${esc(last.message)}` : ''}
    </div></div>`;
  }],

  top_pick: ['Top pick', true, c => {
    // The best steal among the 🔥/🟢 picks, ones you haven't sniped first. A pick
    // rated one star (about the going rate) is never the top pick; a pick with
    // no rating at all, from an older bot, still can be.
    const good = c.picks.filter(x => GOOD.includes(x.tier) && !x.unverified);
    const ranked = [...steals(good), ...good.filter(x => x.deal == null)];
    // one you haven't sniped and that isn't already bid near its max, if there is one
    const p = ranked.find(x => x.snipe == null && (heat(x) ?? 0) < HEAT) || ranked.find(x => x.snipe == null) || ranked[0];
    if (!p) return empty(good.length
      ? 'Nothing live is a real steal right now: every 🔥 and 🟢 pick is close to its going rate. They are all on the Steals tab.'
      : 'No 🔥 or 🟢 picks are live right now. New ones land here within the hour.');
    const t = TIER[p.tier] || ['•', '#546e7a'];
    const gap = room(p);
    // a narrow column stacks the picture over the text, big (container query in STYLE)
    return `<div class="tp-wrap"><div data-row class="toppick" style="background:linear-gradient(135deg,${t[1]}55,transparent);border:1px solid ${t[1]}">
      ${p.image ? `<a class="tp-img" href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(String(p.image).replace(/s-l\d+/, 's-l800'))}" alt=""></a>` : ''}
      <div style="flex:1;min-width:0">
        <div class="muted" style="font-size:11px;letter-spacing:2px">TOP PICK · ${p.is_auction ? 'AUCTION' : 'BUY IT NOW'}</div>
        <a class="title" href="${esc(p.url)}" target="_blank" rel="noopener" style="display:block;font-size:19px;font-weight:700;margin:4px 0;line-height:1.2">${t[0]} ${esc(p.card)}</a>
        ${sweepTxt(p)}
        <div style="font-size:15px">${edge(p)}${heatPill(p)}${fastTag(p)}${doubts(p)}${money(p.bid_now ?? p.price)} + ${shipTxt(p)} ${badge(p)}${sniped(p)}</div>
        ${bidBar(p)}
        ${p.max == null ? '' : `<div style="margin-top:6px;font-size:15px"><b>Max ${cents(p.max)}</b> <span class="muted">(${p.max_basis === 'sales' ? 'sales' : 'guess, no sales found'})${gap > 0 ? ' · ' + money(gap) + ' of room' : ''}</span>${winTxt(p)}</div>`}
        ${lastSold(p)}
        ${p.deal ? `<div style="font-size:13px;margin-top:4px">${deal(p)}</div>` : ''}
        <div class="muted" style="font-size:13px;margin-top:6px;line-height:1.3">${esc(p.why)}</div>
        ${story(p)}
        <div class="muted" style="font-size:12px;margin-top:4px">${sellerTxt(p)}${p.is_auction && p.end_time ? ' · ends ' + when(p.end_time) : ''} · eBay item <b style="color:var(--primary-text-color);user-select:all;-webkit-user-select:all">${esc(p.item_id)}</b></div>
        ${pickButtons(p)}
      </div></div></div>`;
  }],

  radar: ['Steal radar', true, c => {
    if (!c.d.radar) return empty('Update the bot to see this: it needs a version with the steal radar.');
    const html = radarList({...c, card: {...c.card, config: {...c.card.config, count: c.card.config.count || 10}}});
    return html ? `<div style="padding-top:8px">${html}</div><div class="muted" style="font-size:12px;margin-top:6px">A jackpot is a $20+ card at 20% of its value or less (12% when the value is a guess); bid now is an auction in its last hour at 10% or less. The bar fills as the price falls toward the line.</div>`
      : empty('Nothing is near a jackpot or bid-now line right now.');
  }],

  bundles: ['Seller bundles', false, c => {
    // Picks from one seller added up (steals.bundles): shipping once where the seller combines it.
    const all = c.d.bundles;
    if (!all) return empty('Update the bot to see this: it needs a version with seller bundles.');
    if (!all.length) return empty('No seller has two or more live picks right now.');
    return `<div class="muted" style="font-size:12px;padding:10px 0 6px">Two or more picks from one seller, at each auction's max. Sellers that combine shipping charge it once; ask the others to combine before you pay.</div>` +
      all.map(b => `<div class="bundle${b.share_pct != null && b.share_pct <= 50 ? ' good' : ''}">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">
          <b>📦 ${esc(b.seller)} · ${b.n} cards</b>${b.combined ? pill('Combines shipping', '#2e7d32') : pill('Ask to combine', '#78909c')}</div>
        <div style="font-size:14px;margin-top:4px"><b>${money(b.total)}</b> delivered for <b>${worth(b.value)}</b> of cards · <b>${b.share_pct}%</b> of value · ${money(b.per_card)} a card${b.shipping_saved >= 0.5 ? ` · <b style="color:#2e7d32">${money(b.shipping_saved)} shipping saved</b>` : ''}</div>
        <div class="muted" style="font-size:12px;margin-top:2px">${b.first_end ? 'First ends ' + when(b.first_end) + ' · ' : ''}${money(b.saved)} under value if every snipe wins</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">${b.cards.map(k => `<a href="${esc(k.url)}" target="_blank" rel="noopener" title="${esc(k.card)}">${thumb(k, 34, 48)}</a>`).join('')}</div>
        <div class="row tight" style="margin-top:6px">${b.gixen ? copyBtn('Copy ' + b.gixen.split('\n').length + ' snipes for Gixen', b.gixen) + linkBtn('Gixen ↗', GIXEN_URL, '#6a1b9a') : ''}${linkBtn('Seller ↗', 'https://www.ebay.com/sch/i.html?_ssn=' + encodeURIComponent(b.seller) + '&_nkw=jordan+walker', '#1e88e5')}</div>
      </div>`).join('');
  }],

  savings: ['Savings', false, c => {
    const s = c.d.savings;
    if (!s) return empty('Update the bot to see this: it needs a version that adds up savings.');
    if (!s.all || !s.all.n) return empty('No bought picks on record yet.');
    const box = (label, t) => stat(label, worth(t.saved), '#2e7d32', '💰');
    return `<div style="padding-top:10px">` + grid(2, [box('SAVED THIS MONTH', s.month || {saved: 0}), box('SAVED IN ALL', s.all)]) +
      `<div class="muted" style="font-size:12px;margin-top:8px">${s.all.n} bought picks: paid ${money(s.all.paid)} for ${money(s.all.value)} of cards, ${s.all.pct}% of value. Value is the bot's going rate when it picked the card; paid is the price before shipping.</div>` +
      (s.best ? `<div class="line" style="display:flex;gap:12px;align-items:center;padding:10px 0;margin-top:6px">${s.best.image ? `<img src="${esc(s.best.image)}" style="height:74px;border-radius:6px">` : ''}<div><div class="muted" style="font-size:11px;letter-spacing:2px">🏆 BEST STEAL</div><b>${esc(s.best.card)}</b><div style="font-size:13px">${money(s.best.paid)} for a ${worth(s.best.value)} card · ${s.best.pct}% of value${s.best.date ? ' · ' + esc(s.best.date) : ''}</div></div></div>` : '') + `</div>`;
  }],

  gaps: ['Gaps in the collection', false, c => {
    // Every card of the player that has sold on eBay is the market's checklist;
    // what you own is matched against it card by card. The rest are the gaps:
    // the cheap ones that sell all the time, the big ones, and any on sale now.
    const g = c.d.gaps;
    if (!g) return empty('Update the bot to see this: it needs a version with the gap analysis.');
    if (!g.known) return empty('No sales on record yet. The gaps show up as the ledger learns what has sold.');
    const view = store('gaps_view', g.buyable && g.buyable.length ? 'buy' : 'easy');
    const years = (g.years || []).filter(y => /^\d{4}$/.test(y.name));
    const yMax = Math.max(1, ...years.map(y => y.known));
    const yearRows = years.map(y => `<div class="line" style="padding:5px 0;font-size:13px"><div style="display:flex;justify-content:space-between"><b>${esc(y.name)}</b><span class="muted" style="font-size:12px">${y.owned} of ${y.known} · ${y.pct}%${y.easy_cost ? ' · easy fills ' + money(y.easy_cost) : ''}</span></div>
      <div class="dual-bars" style="margin-top:3px"><span class="dual-paid" style="width:${Math.round(y.known / yMax * 100)}%"></span><span class="dual-worth" style="width:${Math.round(y.owned / yMax * 100)}%;background:${c.accent}"></span></div></div>`).join('');
    const famRows = (g.families || []).slice(0, 8).map(f => `<div class="line" style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;font-size:13px"><span style="min-width:0"><b>${esc(f.name)}</b> <span class="muted" style="font-size:12px">· ${f.owned} of ${f.known} · usually ${money(f.typical)}</span></span><b style="color:#c62828;flex:none">${f.gap} missing</b></div>`).join('');
    const liveTxt = e => !e.live ? '' : e.live.auction
      ? ` · <b style="color:#fb8c00">bid at ${money(e.live.total)}</b>${e.live.ends ? ' ' + liveClock(e.live.ends, 'pill') : ''}`
      : ` · <b style="color:#2e7d32">on sale ${money(e.live.total)}</b>`;
    const row = e => `<div class="line" style="display:flex;gap:10px;align-items:center;padding:7px 0">
      ${e.image ? `<img src="${esc(e.image)}" loading="lazy" style="height:52px;width:38px;object-fit:cover;border-radius:5px">` : ''}
      <div style="flex:1;min-width:0"><a class="title" href="${esc(e.live ? e.live.url : e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>
        <div class="muted" style="font-size:12px">${e.n} sale${e.n === 1 ? '' : 's'} · usually <b style="color:var(--primary-text-color)">${money(e.median)}</b> · ${esc(e.family)} · last ${esc(e.last)}${liveTxt(e)}</div></div>
      ${e.live ? linkBtn(e.live.auction ? 'Bid ↗' : 'Buy ↗', e.live.url, e.live.auction ? '#fb8c00' : '#2e7d32') : linkBtn('Search ↗', `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(e.title)}&LH_Complete=0`, '')}</div>`;
    const lists = {easy: g.easy || [], big: g.big || [], buy: g.buyable || []};
    const blurb = {easy: `The gaps that sell most often for ${money(6)} or less, delivered: the fastest way to fill a year.`,
      big: 'The missing centrepieces, by what they usually go for.',
      buy: 'Gaps on sale at a fixed price right now, the best price against the usual first.'}[view];
    return `<div style="padding-top:10px"></div>` + grid(4, [
      stat('FILLED', g.pct + '%', c.accent, '🧩'),
      stat('KNOWN CARDS', g.known, '#546e7a', '🗂️'),
      stat('YOU OWN', g.owned, '#1e88e5', '🃏'),
      stat('EASY FILLS', `${g.easy_n} · ${money(g.easy_cost)}`, '#2e7d32', '🛒'),
    ]) + `<div class="muted" style="font-size:12px;margin:8px 0 2px;line-height:1.5">Every card of this player that has sold on eBay, lots and slabs left out, against the cards you own. ${g.easy_n} missing cards usually go for ${money(6)} or less and would cost about ${money(g.easy_cost)} together${g.live_n ? `; <b style="color:var(--primary-text-color)">${g.live_n}</b> gaps are on sale right now` : ''}.</div>` +
      cap('BY YEAR · GREY = CARDS THAT HAVE SOLD, COLOUR = YOURS') + yearRows +
      cap('BIGGEST GAPS BY SET') + famRows +
      `<div style="margin-top:10px"></div>` + chips('gaps_view', 'easy', [['buy', '🛒 On sale now' + (lists.buy.length ? ' ' + lists.buy.length : '')], ['easy', '🧩 Easy fills'], ['big', '🐋 Big fish']], view) +
      `<div class="muted" style="font-size:12px;margin:6px 0 2px">${blurb}</div>` +
      (lists[view].length ? lists[view].map(row).join('') : empty(view === 'buy' ? 'No gap is on sale at a fixed price right now.' : 'Nothing here yet.'));
  }],

  whales: ['Big money', false, c => {
    // What people pay the most for, from the sales ledger: the price ladder by
    // what a card is, the biggest sales ever, the overpays, and your own cards
    // in the money tiers.
    const w = c.d.whales;
    if (!w) return empty('Update the bot to see this: it needs a version with the big-money analysis.');
    if (!w.n) return empty('No sales on record yet.');
    const view = store('whale_view', 'top');
    const ladderMax = Math.max(1, ...(w.ladder || []).map(l => l.median));
    const TIER_COLOR = {'1 of 1': '#6a1b9a', 'Autograph': '#c62828', 'Slab PSA 10': '#ef6c00', 'Slab, other': '#f9a825', 'Relic': '#00897b', 'Numbered': '#1e88e5', 'Plain': '#546e7a'};
    const ladder = (w.ladder || []).map(l => `<div class="line" style="padding:5px 0;font-size:13px"><div style="display:flex;justify-content:space-between;gap:8px"><span><b>${esc(l.tier)}</b> <span class="muted" style="font-size:12px">· ${l.n} sale${l.n === 1 ? '' : 's'} · top ${money(l.max)}</span></span><span style="flex:none"><b>${money(l.median)}</b>${l.x != null && l.x !== 1 ? ` <span class="muted" style="font-size:12px">${l.x}× plain</span>` : ''}</span></div>
      <div class="bar" style="margin-top:3px"><div style="width:${Math.max(2, Math.round(l.median / ladderMax * 100))}%;background:${TIER_COLOR[l.tier] || c.accent}"></div></div></div>`).join('');
    const drivers = (w.drivers || []).map(d => `<span class="btn on" title="${d.n} sales, top ${money(d.max)}">${esc(d.family)} · ${money(d.median)}</span>`).join(' ');
    const saleRow = (s, i) => `<div class="line" style="display:flex;gap:10px;align-items:center;padding:7px 0">
      <div class="rank" style="${i < 3 ? 'background:' + c.accent + ';color:#fff' : ''}">${i + 1}</div>
      ${s.image ? `<img src="${esc(s.image)}" loading="lazy" style="height:52px;width:38px;object-fit:cover;border-radius:5px">` : ''}
      <div style="flex:1;min-width:0"><a class="title" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>
        <div class="muted" style="font-size:12px">${pill(s.tier, TIER_COLOR[s.tier] || '#546e7a')} ${esc(s.family)} · ${esc(s.date)} · ${s.kind === 'bin' ? 'Buy It Now' : (s.bids != null ? s.bids + ' bid' + (s.bids === 1 ? '' : 's') : 'auction')}${s.usual != null ? ` · usually <b style="color:var(--primary-text-color)">${money(s.usual)}</b> · <b style="color:#c62828">${s.x}×</b>` : ''}</div></div>
      <div style="font-size:17px;font-weight:700;flex:none">${money(s.total)}</div></div>`;
    const y = w.yours || {};
    const yours = `<div style="padding-top:6px"></div>` + grid(3, [
      stat('MONEY CARDS', y.n || 0, '#6a1b9a', '💎'),
      stat('PAID', money(y.paid), '#546e7a', '💳'),
      stat('WORTH', y.valued ? money(y.value) : '–', '#1e88e5', '🏷️'),
    ]) + `<div class="muted" style="font-size:12px;margin:8px 0 2px;line-height:1.5">Your cards above plain: ${Object.entries(y.by_tier || {}).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ') || 'none yet'}. ${y.valued ? `${y.valued} of them priced by a real sale of the same card.` : ''}${y.dupes_value ? ` Dupes among them would fetch about ${money(y.dupes_value)}.` : ''}</div>` +
      (y.top || []).map(x => `<div class="line" style="display:flex;gap:10px;align-items:center;padding:6px 0;font-size:13px">${x.image ? `<img src="${esc(x.image)}" loading="lazy" style="height:44px;width:32px;object-fit:cover;border-radius:4px">` : ''}<span style="flex:1;min-width:0"><b>${esc(x.card)}</b><br><span class="muted" style="font-size:12px">${pill(x.tier, TIER_COLOR[x.tier] || '#546e7a')} paid ${money(x.paid)}</span></span><b style="flex:none">${x.value != null ? money(x.value) : '–'}</b></div>`).join('');
    const trend = w.trend ? `<div class="muted" style="font-size:12px;margin-top:8px">Autographs and PSA 10s lately: a typical ${money(w.trend.now)} against ${money(w.trend.was)} before, ${w.trend.pct === 0 ? 'flat' : (w.trend.pct > 0 ? '+' : '') + w.trend.pct + '%'} over ${w.trend.n} sales.</div>` : '';
    const body = view === 'over'
      ? `<div class="muted" style="font-size:12px;margin:6px 0 2px">Sales at three times or more what the same card usually goes for: ${w.overpaid_n} of them, ${money(w.overpaid_dollars)} over the usual in all. Someone else's stupid money is your reason to list a dupe.</div>` + ((w.overpaid || []).length ? w.overpaid.map(saleRow).join('') : empty('No overpay on record yet; this needs a card sold three times or more.'))
      : view === 'yours' ? yours
      : `<div class="muted" style="font-size:12px;margin:6px 0 2px">The biggest sales on record, shipping included.</div>` + (w.top || []).map(saleRow).join('');
    return `<div style="padding-top:10px"></div>` + grid(4, [
      stat('SALES ON RECORD', w.n.toLocaleString(), '#546e7a', '🧾'),
      stat('DOLLARS', '$' + Math.round(w.dollars).toLocaleString(), '#1e88e5', '💵'),
      stat('TOP 5% TAKE', (w.concentration || {}).share + '%', '#c62828', '🐋'),
      stat('TYPICAL SALE', money(w.median), '#2e7d32', '🏷️'),
    ]) + `<div class="muted" style="font-size:12px;margin:8px 0 2px;line-height:1.5">The ${(w.concentration || {}).top_n} biggest sales are ${(w.concentration || {}).share}% of every dollar spent on this player. What each step up is worth, as a typical price:</div>` +
      cap('THE PRICE LADDER') + ladder +
      (drivers ? cap('WHERE THE MONEY IS · TYPICAL SALE BY SET') + `<div class="row" style="margin:4px 0">${drivers}</div>` : '') + trend +
      `<div style="margin-top:10px"></div>` + chips('whale_view', 'top', [['top', '🐋 Biggest sales'], ['over', '🤑 Stupid money' + (w.overpaid_n ? ' ' + w.overpaid_n : '')], ['yours', '💎 Your money cards']], view) + body;
  }],

  hall: ['Hall of Fame', false, c => {
    // The ten best steals of all time, from the whole collection: each card you
    // own against what the same card last sold for (the bot's ledger), or the
    // bot's value for a pick the ledger can't price. The one list that says
    // what the whole program has been worth.
    const h = (c.d.brag || {}).hall;
    if (!h) return empty('Update the bot to see this: it needs a version with the Hall of Fame.');
    const t = h.totals || {};
    if (!(h.top || []).length) return empty(t.cards
      ? `None of your ${t.cards} priced card${t.cards === 1 ? ' is' : 's are'} 20% or more under what the same card sells for yet.`
      : 'Nothing is priced yet. The hall fills in as the ledger records sales of the cards you own.');
    const n = Number(c.card.config.count) || 10;
    const medal = i => ['🥇', '🥈', '🥉'][i] || String(i + 1);
    const bot = h.bot || {};
    return `<div style="padding-top:10px"></div>` + grid(4, [
      stat('PAID', '$' + Math.round(t.paid || 0).toLocaleString(), '#546e7a', '💳'),
      stat('WORTH', '$' + Math.round(t.worth || 0).toLocaleString(), '#1e88e5', '💎'),
      stat('UNDER VALUE', '$' + Math.round(t.saved || 0).toLocaleString(), t.saved >= 0 ? '#2e7d32' : '#c62828', '💰'),
      stat('PAID OF VALUE', t.pct == null ? '–' : t.pct + '%', '#ef6c00', '🏷️'),
    ]) + `<div class="muted" style="font-size:12px;margin:8px 0 2px;line-height:1.5">${t.cards} card${t.cards === 1 ? '' : 's'} priced by real sales of the same card${t.unpriced ? ` (${t.unpriced} more with no sale on record yet)` : ''}${bot.n ? ` · <b style="color:var(--primary-text-color)">${bot.n}</b> bought as the bot's picks, <b style="color:#2e7d32">${worth(bot.saved)}</b> under value` : ''}</div>` +
      podium(c, h.top) +
      cap(`THE ${n === 10 ? 'TEN' : n} BEST STEALS OF ALL TIME`) +
      h.top.slice(0, n).map((x, i) => `<div class="line" style="display:flex;gap:10px;align-items:center;padding:7px 0">
        <div class="rank" style="${i < 3 ? 'font-size:20px;width:28px' : ''}">${medal(i)}</div>
        ${x.image ? `<img src="${esc(x.image)}" loading="lazy" style="height:52px;width:38px;object-fit:cover;border-radius:5px">` : ''}
        <div style="flex:1;min-width:0"><b>${esc(x.card)}</b>
          <div class="muted" style="font-size:12px">${money(x.paid)} for a ${worth(x.value)} card · <b style="color:var(--primary-text-color)">${worth(x.saved)} under</b> · ${x.by === 'sales' ? 'by real sales' : "the bot's value"}${x.bot ? ' · 🤖 bot pick' : ''}</div></div>
        <div style="font-size:18px;font-weight:700;color:#2e7d32;flex:none">-${x.off_pct}%</div></div>`).join('') +
      cap('HALL OF FAME CARD · SAFE TO SHARE (NO SELLERS OR ITEM NUMBERS)') +
      `<pre class="brag">${esc(h.card)}</pre>`;
  }],

  brag: ['Brag board', false, c => {
    const b = c.d.brag;
    if (!b) return empty('Update the bot to see this: it needs a version with the brag board.');
    if (!b.card) return empty('Nothing bought yet. Buy a steal and it shows up here.');
    const badges = (b.badges || []).map(x => `<span class="btn${x.count ? ' on' : ''}" title="${esc(x.rule)}" style="${x.count ? '' : 'opacity:.45'}">${esc(x.name)} ×${x.count}</span>`).join(' ');
    const w = b.this_week || {n: 0, saved: 0};
    return `<div style="padding-top:10px">` +
      grid(2, [stat('STEAL STREAK', `${b.streak_weeks} wk${b.streak_weeks === 1 ? '' : 's'}`, '#ef6c00', '🔥'),
               stat('THIS WEEK', w.n ? worth(w.saved) + ' under' : 'none yet', '#2e7d32', '🛒')]) +
      `<div class="row" style="margin:10px 0 4px">${badges}</div>` +
      (b.top || []).map((t, i) => `<div class="line" style="display:flex;gap:10px;align-items:center;padding:6px 0">` +
        `<div class="rank" style="${i === 0 ? 'background:' + c.accent + ';color:#fff' : ''}">${i + 1}</div>` +
        (t.image ? `<img src="${esc(t.image)}" style="height:44px;border-radius:4px">` : '') +
        `<div style="flex:1;min-width:0"><b>${esc(t.card)}</b><div class="muted" style="font-size:12px">${money(t.paid)} for a ${worth(t.value)} card · <b style="color:var(--primary-text-color)">${t.off_pct}% off</b></div></div></div>`).join('') +
      cap('BRAG CARD · SAFE TO SHARE (NO SELLERS OR ITEM NUMBERS)') +
      `<pre class="brag">${esc(b.card)}</pre></div>`;
  }],

  ending_list: ['Ending soon', true, c => {
    const order = store('ending_order', 'soon'), all = endingSoon(c, order);
    if (!all.length) return empty('No picked auctions are live right now.') + foldNote(c, endingSoon, order);
    const n = Number(c.card.config.count) || 25;
    return `<div class="strip-head">${chips('ending_order', 'soon', [['soon', '⏱ Soonest'], ['best', '💎 Best deal at max']], order)}
      <div class="muted strip-cap">Picked auctions not yet bid past the max.</div></div>` +
      all.slice(0, n).map(p => pickLine(p, '', '')).join('') + (all.length > n ? empty(`${all.length - n} more under Every pick.`) : '') + foldNote(c, endingSoon, order);
  }],

  buy_list: ['Buy now, think later', true, c => {
    const all = buyNowSteals(c);
    if (!all.length) return empty(`No Buy It Now is at ${Math.round(100 * buyLine(c))}% of its value or less right now.`) + foldNote(c, buyNowSteals);
    return `<div class="muted" style="font-size:12px;padding:10px 0 6px">Buy It Now at ${Math.round(100 * buyLine(c))}% of value or less, shipping included: the cheapest share first. Buy first, look closer after.</div>` +
      all.map(p => pickLine(p, `<div class="rank" style="width:auto;padding:0 7px;border-radius:10px;color:#fff;background:#00a152">-${Math.round(100 * (1 - shareNow(p)))}%</div>`, '')).join('') + foldNote(c, buyNowSteals);
  }],

  top_deals: ['Top 10 deals', true, c => {
    const top = steals(c.picks).slice(0, Number(c.card.config.count) || 10);
    if (!top.length) return empty('No live pick is 10% or more under its going rate right now.');
    return `<div class="muted" style="font-size:12px;padding:10px 0 6px">Biggest dollar gap first (value minus what it costs delivered now), then the sweep score.</div>` +
      top.map((p, i) => pickLine(p,
        `<div class="rank" style="${i < 3 ? 'background:' + c.accent + ';color:#fff' : ''}">${i + 1}</div>`,
        saved(p) >= 0.5 ? ` <b style="color:var(--primary-text-color);white-space:nowrap">· ${worth(saved(p))} under</b>` : '')).join('');
  }],

  priority: ['Case hits & priority', false, c => {
    // The bot's casehits.md: the cards hunted first, every live copy cheapest
    // first against the row's ceiling, and the "hype" cards titled SSP or case
    // hit that sell like commons.
    const v = c.d.priority;
    if (!v) return empty('Update the bot to see this: it needs a version that hunts case hits (casehits.md).');
    if (!v.rows.length) return empty('casehits.md in the bot\'s repo is empty. Add the cards you want hunted first.');
    const KIND = {'Case hit': '#6a1b9a', SSP: '#c62828', Variation: '#ef6c00', Auto: '#5e35b1', Grail: '#c9a227', Event: '#1e88e5', Hype: '#757575'};
    const real = v.rows.filter(r => !r.hype), hype = v.rows.filter(r => r.hype);
    const view = store('prio_view', v.live_n ? 'sale' : 'list');
    const soldTxt = r => r.sold ? `sold ${r.sold.n}× · typical <b style="color:var(--primary-text-color)">${money(r.sold.median)}</b>${r.sold.n > 1 ? ` (${money(r.sold.low)}–${money(r.sold.high)})` : ''}` : 'no sale on record';
    const head = r => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div style="min-width:0"><b>${esc(r.card)}</b><div style="font-size:12px;margin-top:3px">${pill(esc(r.kind), KIND[r.kind] || '#546e7a')}${r.owned ? ' ' + pill('✓ You own one', '#2e7d32') : ''}${r.ceiling ? ` <span class="muted">ceiling <b style="color:var(--primary-text-color)">${money(r.ceiling)}</b></span>` : ''}</div></div>
        <a class="btn" href="${esc(r.ebay)}" target="_blank" rel="noopener" style="flex:none">eBay</a></div>`;
    const copy = (x, r) => {
      const under = r.ceiling && x.total <= r.ceiling;
      return `<div data-row class="line" style="display:flex;gap:10px;align-items:flex-start;padding:8px 0 8px 6px">${thumb(x, 44, 60)}
        <div style="flex:1;min-width:0"><a class="title" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>
          <div style="font-size:13px;margin-top:2px">${under ? pill('✅ Under your ceiling', '#2e7d32') + ' ' : ''}<b>${money(x.price)}</b> + ${shipTxt(x)}${x.is_auction ? ' · auction' + (x.bids ? ', ' + x.bids + (x.bids === 1 ? ' bid' : ' bids') : '') + (x.end_time ? ', ends ' + when(x.end_time) : '') : (x.best_offer ? ' · Best Offer' : ' · Buy It Now')}</div>
          <div class="muted" style="font-size:11px;margin-top:2px">${esc(x.seller)} · eBay item <b style="color:var(--primary-text-color);user-select:all;-webkit-user-select:all">${esc(x.item_id)}</b></div></div></div>`;
    };
    const sale = real.filter(r => r.live.length).sort((a, b) => b.under - a.under || a.live[0].total - b.live[0].total);
    let body;
    if (view === 'sale') {
      body = sale.length ? sale.map(r => `<div class="line" style="padding:10px 0">${head(r)}<div class="muted" style="font-size:12px;margin:4px 0 2px">${soldTxt(r)} · ${r.live.length} for sale</div>${r.live.slice(0, 3).map(x => copy(x, r)).join('')}${r.live.length > 3 ? `<div class="muted" style="font-size:12px;padding:2px 0 0 6px">+${r.live.length - 3} more from ${money(r.live[3].total)}: <a href="${esc(r.ebay)}" target="_blank" rel="noopener">see them all on eBay</a></div>` : ''}</div>`).join('')
        : empty('None of these is for sale right now. The bot searches a few of them every hour and alerts you when a copy shows up under its ceiling.');
    } else if (view === 'hype') {
      body = `<div class="muted" style="font-size:12px;margin:8px 0 4px;line-height:1.5">Cards sellers title "SSP" or "case hit" that sell like commons. The bot never alerts on these and keeps the normal price ceiling for them. Check the serial number and the pack odds, not the title.</div>` +
        hype.map(r => `<div class="line" style="padding:9px 0">${head(r)}<div style="font-size:13px;margin-top:4px">${esc(r.rare)}</div><div class="muted" style="font-size:12px;margin-top:3px">${soldTxt(r)}${r.live.length ? ` · ${r.live.length} listed now, from ${money(r.live[0].total)}` : ''}</div></div>`).join('');
    } else {
      body = real.map(r => `<div class="line" style="padding:9px 0">${head(r)}<div style="font-size:13px;margin-top:4px">${esc(r.rare)}</div><div class="muted" style="font-size:12px;margin-top:3px">${soldTxt(r)} · ${r.live.length ? `<b style="color:var(--primary-text-color)">${r.live.length}</b> for sale now${r.under ? `, ${r.under} under ceiling` : ''}` : 'none for sale now'}</div></div>`).join('');
    }
    return `<div style="padding-top:10px"></div>` + grid(4, [
      stat('ON THE LIST', v.n, '#6a1b9a', '🎯'),
      stat('FOR SALE', v.live_n, '#1e88e5', '🛒'),
      stat('UNDER CEILING', v.under_n, '#2e7d32', '✅'),
      stat('YOU OWN', v.owned_n, '#546e7a', '📒'),
    ]) + `<div class="muted" style="font-size:12px;margin:8px 0 6px;line-height:1.5">Case hits, short prints and grails from the bot's casehits.md. Each one gets its own eBay searches, its own price ceiling instead of the $25 sweep cap, the 🎯 label on picks, and one alert when a new copy is listed under its ceiling.</div>` +
      chips('prio_view', 'sale', [['sale', '🛒 For sale' + (sale.length ? ' ' + v.live_n : '')], ['list', '📋 The list'], ['hype', '⚠️ Hype check' + (hype.length ? ' ' + hype.length : '')]], view) + body;
  }],

  learn: ['Walker card school', false, c => {
    // guide.md from the bot, with the lessons' numbers from its own sales ledger.
    const g = c.d.learn;
    if (!g) return empty('Update the bot to see this: it needs a version with the card guide (guide.md).');
    const md = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const tabs = g.sections.map((s, i) => ['s' + i, esc(s.title)]).concat([['live', '📈 Live numbers'],
      ...(g.colors ? [['colors', '🎨 Colors']] : []), ...(c.d.topps_now ? [['now', '📰 Topps Now']] : []),
      ...(g.trivia ? [['trivia', '🎲 Trivia']] : []), ['quiz', '🧠 Quiz']]);
    const pick = store('learn_tab', 's0'), tab = tabs.some(t => t[0] === pick) ? pick : 's0';
    let body;
    if (tab === 'live') {
      const lad = g.ladder.filter(r => r.n), top = Math.max(1, ...lad.filter(r => r.enough).map(r => r.median));
      const COLOR = r => r.rung === 'Not numbered' ? '#546e7a' : (/^\/(2 to|10|11)/.test(r.rung) || r.rung === '1/1' ? '#c62828' : (/25|26/.test(r.rung) ? '#ef6c00' : '#1e88e5'));
      body = `<div class="muted" style="font-size:12px;margin:8px 0 2px;line-height:1.5">From ${Number(g.sales_n).toLocaleString()} sales the bot recorded, delivered prices. Raw cards with no autograph, relic or slab, so the print run is the only difference. These are medians across different cards, not the same card at each step.</div>` +
        cap('WHAT A PRINT RUN ADDS') + lad.map(r => `<div class="line" style="padding:5px 0;font-size:13px"><div style="display:flex;justify-content:space-between;gap:8px"><span><b>${esc(r.rung)}</b> <span class="muted" style="font-size:12px">· ${r.n} sale${r.n === 1 ? '' : 's'}</span></span><span style="flex:none">${r.enough ? `<b>${money(r.median)}</b>${r.x != null && r.x !== 1 ? ` <span class="muted" style="font-size:12px">${r.x}× unnumbered</span>` : ''}` : '<span class="muted">too few sales</span>'}</span></div>
          ${r.enough ? `<div class="bar" style="margin-top:3px"><div style="width:${Math.max(2, Math.round(r.median / top * 100))}%;background:${COLOR(r)}"></div></div>` : ''}</div>`).join('') +
        cap('WHAT ELSE ADDS VALUE') + g.premiums.map(p => `<div class="line" style="padding:7px 0;font-size:13px;display:flex;justify-content:space-between;gap:10px"><span><b>${esc(p.what)}</b><br><span class="muted" style="font-size:12px">vs ${esc(p.vs)} · ${p.with.n} and ${p.without.n} sales</span></span><span style="flex:none;text-align:right">${p.enough ? `<b style="font-size:16px">${p.x}×</b><br><span class="muted" style="font-size:12px">${money(p.with.median)} vs ${money(p.without.median)}</span>` : '<span class="muted">not enough<br>sales yet</span>'}</span></div>`).join('') +
        cap('TYPICAL SALE BY PRODUCT') + (() => { const ps = g.products.slice(0, 14), m = Math.max(1, ...ps.map(p => p.median));
          return ps.map(p => hbar(esc(p.family), p.median, m, c.accent, `${money(p.median)} · ${p.n}`)).join(''); })();
    } else if (tab === 'colors') {
      const rows = g.colors.filter(r => r.enough), top = Math.max(1, ...rows.map(r => r.median));
      body = `<div class="muted" style="font-size:12px;margin:8px 0 2px;line-height:1.5">What each color sells for on his raw, non-auto Chrome-type cards (delivered), and the print runs it actually came with. One color, several runs: read the number, not the color.</div>` +
        rows.map(r => `<div class="line" style="padding:6px 0;font-size:13px">
          <div style="display:flex;justify-content:space-between;gap:8px"><span><b>${esc(r.color)}</b> <span class="muted" style="font-size:12px">· ${r.n} sales · ${r.numbered_pct}% numbered</span></span><b>${money(r.median)}</b></div>
          <div class="bar" style="margin-top:3px"><div style="width:${Math.max(2, Math.round(r.median / top * 100))}%;background:${c.accent}"></div></div>
          <div style="margin-top:4px">${r.runs.map(x => `<span class="chip" style="font-size:11px;padding:1px 7px;margin:0 4px 0 0;display:inline-block;border-radius:99px;background:#8882">${esc(x.run)} · ${x.n}</span>`).join('')}</div></div>`).join('') +
        `<div class="muted" style="font-size:12px;margin-top:6px">Colors with fewer than three sales are left out. The ladders behind these are in "Color ladders by product".</div>`;
    } else if (tab === 'now') {
      const lib = c.d.topps_now || [], own = lib.filter(r => r.n_owned).length;
      body = `<div class="muted" style="font-size:12px;margin:8px 0 6px;line-height:1.5">Every Topps Now card of his the bot knows (toppsnow.md plus the sales ledger). Each was sold for about 24 hours after the moment it celebrates; the print run is how many were ordered. You own <b>${own}</b> of ${lib.length}.</div>` +
        lib.map(r => {
          const par = (r.parallels || []).length > 1 ? `<details style="margin-top:4px"><summary class="muted" style="cursor:pointer;font-size:12px">${r.parallels.length} versions</summary>${r.parallels.map(p => `<div style="font-size:12px;display:flex;justify-content:space-between;gap:8px;padding:2px 0"><span>${p[4] ? '✅ ' : ''}${esc(p[0])}</span><span class="muted">${p[2] != null ? money(p[2]) + ' · ' + p[3] + ' sold' : 'no sales yet'}</span></div>`).join('')}</details>` : '';
          return `<div class="line" style="display:flex;gap:10px;padding:8px 0">
            ${r.image ? `<img src="${esc(r.image)}" loading="lazy" style="width:46px;height:64px;object-fit:cover;border-radius:4px;flex:none">` : '<div style="width:46px;height:64px;border-radius:4px;background:#8882;flex:none"></div>'}
            <div style="flex:1;min-width:0"><div style="font-size:14px"><b>${esc(r.year)} #${esc(r.no)}</b> ${r.n_owned ? pill('✅ Owned', '#2e7d32') : ''}</div>
              <div style="font-size:13px">${esc(r.event && r.event !== 'unconfirmed' ? r.event : (r.title || 'Event not confirmed yet'))}</div>
              <div class="muted" style="font-size:12px">${r.date && r.date !== '—' ? esc(r.date) + ' · ' : ''}${r.print_run && r.print_run !== 'unconfirmed' ? '<b>' + esc(r.print_run) + '</b> printed' : 'print run unconfirmed'}${r.median != null ? ' · goes for ' + money(r.median) : ''}${r.sales ? ' · ' + r.sales + ' sold' : ''}${r.live != null ? ' · live from ' + money(r.live) : ''}</div>${par}</div></div>`;
        }).join('');
    } else if (tab === 'trivia') {
      const h = g.history || {}, sc = h.scanned || [], pr = h.prices || [];
      body = `<div class="trivia" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin:10px 0">` +
        g.trivia.map(t => `<div style="border:1px solid #8884;border-radius:12px;padding:10px"><div style="font-size:22px;font-weight:800">${esc(t.value)}</div><div style="font-size:12px;font-weight:600">${esc(t.label)}</div>${t.note ? `<div class="muted" style="font-size:11px;margin-top:3px;line-height:1.3">${esc(t.note)}</div>` : ''}</div>`).join('') + `</div>` +
        cap('WALKER LISTINGS FOUND, RUNNING TOTAL') + lineChart(c, sc.map(d => ({d: d.day, y: d.total, bar: d.new, tip: `${d.day}: ${d.new.toLocaleString()} new, ${d.total.toLocaleString()} in all`})), {bars: true, fmt: v => v >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v))}) +
        `<div class="muted" style="font-size:12px">Bars are new listings found each day. The jump at the end of October is the market sweep going live: it reads every listing up, not just the newest.</div>` +
        cap('WALKER MARKET INDEX, WEEK BY WEEK') + lineChart(c, pr.map(w => ({d: w.week, y: w.index, bar: w.n, tip: `Week of ${w.week}: index ${w.index} · ${w.n} sales · median ${money(w.median)}`})), {ref: 100, bars: true, color: '#43a047'}) +
        `<div class="muted" style="font-size:12px;line-height:1.5">100 is a normal week. Each sale is compared with the same card's sales in other weeks, so a week of pricey autos doesn't read as a rally: 120 means cards sold 20% over their usual. Bars are sales per week (weeks under 10 sales are left out).</div>` +
        cap('MEDIAN SALE, WEEK BY WEEK') + lineChart(c, pr.map(w => ({d: w.week, y: w.median, tip: `Week of ${w.week}: median ${money(w.median)} over ${w.n} sales`})), {fmt: v => '$' + v.toFixed(0), h: 170});
    } else if (tab === 'quiz') {
      body = `<div class="muted" style="font-size:12px;margin:8px 0 4px">Tap a question to see the answer.</div>` +
        g.quiz.map((q, i) => `<details class="line" style="padding:9px 0;font-size:14px"><summary style="cursor:pointer;font-weight:600">${i + 1}. ${md(q.q)}</summary><div style="margin-top:6px;line-height:1.5">${md(q.a)}</div></details>`).join('');
    } else {
      const s = g.sections[Number(tab.slice(1))] || g.sections[0];
      body = `<div style="font-size:16px;font-weight:700;margin:10px 0 4px">${esc(s.title)}</div>` + s.blocks.map(b => b.ul
        ? `<ul style="margin:4px 0 8px;padding-left:20px;line-height:1.55;font-size:14px">${b.ul.map(li => `<li style="margin:4px 0">${md(li)}</li>`).join('')}</ul>`
        : `<p style="margin:6px 0;line-height:1.55;font-size:14px">${md(b.p)}</p>`).join('');
    }
    return `<div style="padding-top:8px"></div>` + chips('learn_tab', 's0', tabs, tab) + body;
  }],

  catalog: ['Every Walker card', false, c => {
    // Every card the market has seen (and every card you own), one row per card with its
    // parallels folded under it. Built hourly by the bot (catalog.py).
    const cat = c.d.catalog;
    if (!cat) return empty('Update the bot to see this: it needs a version with the card catalog.');
    const show = store('cat_show', 'all'), fam = store('cat_family', 'all'), yr = store('cat_year', 'all'), flat = store('cat_flat', 'cards');
    let cards = cat.cards;
    if (fam !== 'all') cards = cards.filter(x => x.f === fam);
    if (yr !== 'all') cards = cards.filter(x => x.y === yr);
    if (show === 'owned') cards = cards.filter(x => x.p.some(p => p[4]));
    if (show === 'missing') cards = cards.filter(x => x.p.some(p => !p[4]));
    if (show === 'live') cards = cards.filter(x => x.p.some(p => p[5] != null));
    const famOpts = [['all', 'All products']].concat(cat.families.map(f => [f, f]));
    const yrOpts = [['all', 'All years']].concat(cat.years.filter(y => /^\d{4}$/.test(y)).map(y => [y, y]));
    const sel = (key, val, opts) => `<select data-do="set" data-key="${key}" style="margin:0 6px 6px 0">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const pRow = (x, p) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:13px">
      <span>${p[4] ? '✅ ' : '<span class="muted">○ </span>'}${esc(p[0])}</span>
      <span class="muted" style="text-align:right;white-space:nowrap">${p[2] != null ? money(p[2]) + ' · ' + p[3] + ' sold' : 'no sales yet'}${p[5] != null ? ` · <a href="https://www.ebay.com/itm/${esc(p[6])}" target="_blank" rel="noopener">live ${money(p[5])}</a>` : ''}</span></div>`;
    const head = `<div class="muted" style="font-size:12px;margin:8px 0 6px;line-height:1.5"><b>${cat.n_cards.toLocaleString()}</b> cards and <b>${cat.n_parallels.toLocaleString()}</b> card-and-parallel versions the market has seen or you own; you have <b>${cat.n_owned}</b>. Prices are typical sales, delivered.</div>
      <div style="padding-top:2px"><input data-search type="search" placeholder="Filter: set, number, parallel…" value="${esc(c.card.query)}"></div>
      <div style="margin-top:6px">${sel('cat_family', fam, famOpts)}${sel('cat_year', yr, yrOpts)}</div>` +
      chips('cat_show', 'all', [['all', 'All'], ['owned', '✅ Have'], ['missing', '○ Missing'], ['live', '🛒 For sale now']], show) +
      chips('cat_flat', 'cards', [['cards', 'One row per card'], ['all', 'Every parallel']], flat) +
      `<div class="muted" style="font-size:12px;margin:2px 0 6px"><span data-found>${cards.length}</span> shown</div>`;
    if (!cards.length) return head + empty('Nothing matches.');
    const limit = 250;
    if (flat === 'all') {
      const rows = cards.flatMap(x => x.p.map(p => [x, p])).slice(0, limit * 3);
      return head + rows.map(([x, p]) => `<div class="line" data-find="${esc((x.y + ' ' + x.f + ' ' + (x.no || '') + ' ' + x.t + ' ' + p[0]).toLowerCase())}" style="display:flex;flex-direction:column;padding:4px 0">
        <div style="font-size:12px" class="muted">${esc(x.y)} ${esc(x.f)}${x.no ? ' #' + esc(x.no) : ''}</div>${pRow(x, p)}</div>`).join('');
    }
    return head + cards.slice(0, limit).map(x => {
      const meds = x.p.map(p => p[2]).filter(v => v != null), lives = x.p.map(p => p[5]).filter(v => v != null);
      const have = x.p.filter(p => p[4]).length;
      return `<details class="line" data-find="${esc((x.y + ' ' + x.f + ' ' + (x.no || '') + ' ' + x.t + ' ' + x.p.map(p => p[0]).join(' ')).toLowerCase())}" style="display:flex;flex-direction:column;padding:6px 0">
        <summary style="cursor:pointer;display:flex;gap:10px;align-items:center">
          ${x.img ? `<img src="${esc(x.img)}" loading="lazy" style="width:38px;height:52px;object-fit:cover;border-radius:4px;flex:none">` : '<div style="width:38px;height:52px;border-radius:4px;background:#8882;flex:none"></div>'}
          <span style="flex:1;min-width:0"><b>${esc(x.y)} ${esc(x.f)}${x.no ? ' #' + esc(x.no) : ''}</b>
            <span class="muted" style="display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.t)}</span>
            <span style="font-size:12px">${x.p.length} version${x.p.length === 1 ? '' : 's'} · ${have ? `<b style="color:#43a047">${have} owned</b>` : 'none owned'}${meds.length ? ' · ' + money(Math.min(...meds)) + (meds.length > 1 ? '–' + money(Math.max(...meds)) : '') : ''}${lives.length ? ' · 🛒 from ' + money(Math.min(...lives)) : ''}</span></span>
        </summary><div style="padding:4px 0 2px 48px">${x.p.map(p => pRow(x, p)).join('')}</div></details>`;
    }).join('') + (cards.length > limit ? empty(`${cards.length - limit} more: narrow it with a product or year.`) : '');
  }],

  rarest: ['Rarest on eBay', false, c => {
    // Lowest print run first, read from the listing titles at the last search.
    const all = c.d.rarest;
    if (!all) return empty('Update the bot to see this: it needs a version that ranks print runs.');
    const top = all.filter(r => !(r.is_auction && r.end_time && msLeft(r.end_time) <= 0)).slice(0, Number(c.card.config.count) || 10);
    if (!top.length) return empty('No serial-numbered card is listed right now. This fills in at the next search.');
    const n = c.d.rarest_census, fresh = r => r.first_seen && Date.now() / 1000 - r.first_seen < 24 * 3600;
    return `<div class="muted" style="font-size:12px;padding:10px 0 6px">The fewest copies in existence that you could buy today, autographs first among equals. Not a price opinion: these are rare, not necessarily steals.${n && n.one_of_one != null ? `<br>For sale right now: <b style="color:var(--primary-text-color)">${n.one_of_one}</b> one-of-ones, <b style="color:var(--primary-text-color)">${n.to_10}</b> more numbered to 10 or fewer, <b style="color:var(--primary-text-color)">${n.to_50}</b> to 50 or fewer.` : ''}</div>` +
      top.map((r, i) => {
        const run = r.run === 1 ? '1 of 1' : 'one of ' + r.run;
        const color = r.run === 1 ? '#c9a227' : (r.run <= 10 ? '#e53935' : (r.run <= 50 ? '#fb8c00' : '#546e7a'));
        return `<div data-row class="line" style="display:flex;gap:12px;align-items:flex-start;padding:10px 0">
          <div class="rank" style="${i < 3 ? 'background:' + c.accent + ';color:#fff' : ''}">${i + 1}</div>${thumb(r, 54, 74)}
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:8px;justify-content:space-between;align-items:flex-start">
              <a class="title" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
              <div style="text-align:right;flex:none">${badge(r)}</div>
            </div>
            <div style="font-size:13px;margin-top:3px">${pill(run, color)}${r.auto ? ' ' + pill('✍️ Auto', '#5e35b1') : ''}${r.graded ? ' ' + pill('Graded', '#546e7a') : ''}${fresh(r) ? ' ' + pill('🆕 New today', '#00838f') : ''}${r.owned ? ' ' + pill('✓ You own one', '#2e7d32') : ''} <b>${money(r.price)}</b> + ${shipTxt(r)}${r.is_auction && r.bids ? ' · ' + r.bids + (r.bids === 1 ? ' bid' : ' bids') : ''}</div>
            <div class="muted" style="font-size:11px;margin-top:3px">${esc(r.seller)}${r.is_auction && r.end_time ? ' · ends ' + when(r.end_time) : ''} · eBay item <b style="color:var(--primary-text-color);user-select:all;-webkit-user-select:all">${esc(r.item_id)}</b></div>
          </div></div>`;
      }).join('');
  }],

  focus: ['Rookie steals', true, c => {
    // The parts of the market the bot hunts hardest: the player's rookie-year
    // cards and, for some players, pre-rookie cards (groups come from the bot).
    const groups = (c.d.focus || {}).groups;
    if (!groups) return empty('Update the bot to see this: it needs a version that marks rookie cards.');
    const pick = store('focus', groups[0].key), group = groups.find(g => g.key === pick) || groups[0];
    const mine = c.picks.filter(p => p.focus === group.key);
    const top = steals(mine).slice(0, Number(c.card.config.count) || 10);
    return chips('focus', groups[0].key, groups.map(g => [g.key, esc(g.label) + ' (' + steals(c.picks.filter(p => p.focus === g.key)).length + ')']), group.key) +
      `<div class="muted" style="font-size:12px;padding:8px 0 6px">${group.watched} ${esc(group.label)} listings watched · ${mine.length} live picks · ${top.length ? 'best steal first' : 'none 10% or more under the going rate yet'}.</div>` +
      (top.length ? top.map((p, i) => pickLine(p,
        `<div class="rank" style="${i < 3 ? 'background:' + c.accent + ';color:#fff' : ''}">${i + 1}</div>`,
        saved(p) >= 0.5 ? ` <b style="color:var(--primary-text-color);white-space:nowrap">· ${worth(saved(p))} under</b>` : '')).join('')
        : empty(mine.length ? 'The live picks here are all close to their going rate. They are on the Steals tab.' : 'No live picks here yet. The bot searches for these every hour.'));
  }],

  under: ['Best under $20', true, c => {
    // Steals you can land for the cap or less delivered: the asking price for Buy
    // It Now, the bot's max for an auction, shipping included ($5 when unknown).
    const capAt = Number(c.card.config.under) || 20;
    const pay = p => Number(p.is_auction ? p.max : p.price) + Number(p.shipping ?? 5);
    const top = steals(c.picks.filter(p => !(p.is_auction && p.max == null) && pay(p) <= capAt)).slice(0, Number(c.card.config.count) || 10);
    if (!top.length) return empty(`No live steal comes in at $${capAt} or less delivered right now.`);
    return `<div class="muted" style="font-size:12px;padding:10px 0 6px">Steals for $${capAt} or less delivered: the Buy It Now price, or the max for an auction, plus shipping. Best steal first.</div>` +
      top.map((p, i) => pickLine(p,
        `<div class="rank" style="${i < 3 ? 'background:' + c.accent + ';color:#fff' : ''}">${i + 1}</div>`,
        ` <b style="color:var(--primary-text-color);white-space:nowrap">· ${money(pay(p))} delivered</b>`)).join('');
  }],

  by_year: ['Top steals by year', true, c => {
    // The best few steals for each card year, read from the listing titles.
    if (!c.picks.some(p => 'year' in p)) return empty('Update the bot to see this: it needs a version that reads card years.');
    const all = steals(c.picks.filter(p => p.year));
    const years = [...new Set(all.map(p => p.year))].sort();
    if (!years.length) return empty('No live pick is 10% or more under its going rate right now.');
    const count = Number(c.card.config.count) || 5;
    const def = all[0].year, chosen = years.includes(store('steal_year', def)) ? store('steal_year', def) : def;
    const top = all.filter(p => p.year === chosen).slice(0, count);
    return chips('steal_year', def, years.map(y => [y, y + ' (' + all.filter(p => p.year === y).length + ')']), chosen) +
      `<div class="muted" style="font-size:12px;padding:8px 0 6px">Top ${count} steals on ${chosen} cards, best first.</div>` +
      top.map((p, i) => pickLine(p,
        `<div class="rank" style="${i < 3 ? 'background:' + c.accent + ';color:#fff' : ''}">${i + 1}</div>`,
        saved(p) >= 0.5 ? ` <b style="color:var(--primary-text-color);white-space:nowrap">· ${worth(saved(p))} under</b>` : '')).join('');
  }],

  must_have: ['Must-have cards', false, c => {
    // The nine defining cards of each year (the bot's musthave.md): which you own,
    // what is for sale now and whether one of them is a live pick.
    const m = c.d.must_have;
    if (!m || !m.years) return empty('Update the bot to see this: it needs a version with a must-have list.');
    if (!m.years.length) return empty('The must-have list is empty. Add cards to musthave.md in the bot\'s repo.');
    const def = (m.years.find(y => y.owned < y.cards.length) || m.years[0]).year;
    const year = m.years.find(y => y.year === store('must_year', def)) || m.years.find(y => y.year === def);
    const done = y => y.owned === y.cards.length ? ' ✓' : '';
    return `<div class="muted" style="font-size:12px;padding:10px 0 6px">You have <b style="color:var(--primary-text-color)">${m.owned}</b> of ${m.total}. Nine a year, one binder page each.</div>` +
      chips('must_year', def, m.years.map(y => [y.year, `${y.year} (${y.owned}/${y.cards.length})${done(y)}`]), year.year) +
      year.cards.map((k, i) => {
        const have = k.owned ? pill('✓ ' + esc(k.owned.status), '#2e7d32') : pill('Missing', '#78909c');
        const pick = k.pick ? ` ${pill((TIER[k.pick.tier] || ['⭐'])[0] + ' Live pick ' + money(k.pick.total), '#c41e3a')}` : '';
        const sale = k.for_sale ? `${k.for_sale} for sale now, from <b style="color:var(--primary-text-color)">${money(k.cheapest)}</b> delivered` : 'none for sale right now';
        return `<div class="line" style="display:flex;gap:12px;align-items:flex-start;padding:9px 0;${k.owned ? 'opacity:.75' : ''}">
          <div class="rank" style="${!k.owned ? 'background:' + c.accent + ';color:#fff' : ''}">${i + 1}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:8px;justify-content:space-between;align-items:flex-start"><b>${esc(k.card)}</b><span style="flex:none">${have}</span></div>
            <div class="muted" style="font-size:12px;margin-top:2px">${esc(k.why)} · goes for ${esc(k.rate)}</div>
            <div style="font-size:12px;margin-top:3px">${sale}${pick}</div>
            <div class="row tight">${linkBtn('Search eBay ↗', k.url)}${k.pick ? linkBtn('Open the pick ↗', k.pick.url, '#c41e3a') : ''}</div>
          </div></div>`;
      }).join('');
  }],

  offers: ['Lowball offers', false, c => {
    // Buy It Nows that have sat two weeks or more with Best Offer on (the bot's offers.py
    // ladder): an aggressive opener that drops the longer a listing sits, the most to
    // accept if the seller counters, and why it went that low. You send every offer yourself.
    const all = c.d.offers;
    if (!all) return empty('Update the bot to see this: it needs a version that looks for stale listings.');
    if (!all.length) return empty('No Buy It Now has sat two weeks with Best Offer on, on a card you don\'t own.');
    const view = store('offer_view', 'best');
    let list = all.slice();
    if (view === 'stale') list = list.filter(o => o.days >= 60);
    if (view === 'shots') list = list.filter(o => o.long_shot);
    if (view === 'best') list = list.filter(o => !o.long_shot);
    const bySeller = {};
    all.forEach(o => (bySeller[o.seller || '?'] = bySeller[o.seller || '?'] || []).push(o));
    const bundles = Object.entries(bySeller).filter(([, l]) => l.length > 1).sort((x, y) => y[1].length - x[1].length);
    const saved = all.filter(o => !o.long_shot).reduce((t, o) => t + (o.price - o.offer), 0);
    const dayCol = d => d >= 90 ? '#e53935' : d >= 60 ? '#fb8c00' : d >= 30 ? '#f9a825' : '#546e7a';
    const tile = o => {
      const img = o.image ? String(o.image).replace(/s-l\d+/, 's-l500') : null;
      return `<div class="tile offer-tile${o.long_shot ? ' shot' : ''}" data-row>
        <a class="tile-img" href="${esc(o.url)}" target="_blank" rel="noopener">${img ? `<img src="${esc(img)}" loading="lazy" alt="">` : '<div class="noimg">🃏</div>'}
          <span class="offer-days" style="background:${dayCol(o.days)}">${o.days}d up</span>
          ${o.long_shot ? '<span class="offer-shot">🎲 long shot</span>' : ''}</a>
        <div class="offer-body">
          <div class="offer-title" title="${esc(o.title)}">${o.must_have ? '⭐ ' : ''}${esc(o.title)}</div>
          <div class="offer-ask">asks <s>${money(o.price)}</s> + ${shipTxt(o)}${o.value != null ? ` · worth ~<b>${money(o.value)}</b>` : ''}</div>
          <div class="offer-open"><span>OPEN AT</span><b>$${cents(o.offer)}</b><em>${o.open_pct != null ? o.open_pct + '% of ask' : ''}</em></div>
          ${o.counter != null && o.counter > o.offer ? `<div class="offer-counter">If they counter: pay up to <b>$${cents(o.counter)}</b>, no more</div>` : `<div class="offer-counter muted">Take it or leave it: don't go higher</div>`}
          ${(o.tactics || []).length ? `<div class="offer-why">${o.tactics.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="row tight">${linkBtn('Make offer ↗', o.url, '#2e7d32')}${copyBtn('Copy ' + cents(o.offer), cents(o.offer))}${o.counter != null && o.counter > o.offer ? copyBtn('Copy ' + cents(o.counter), cents(o.counter)) : ''}</div>
        </div></div>`;
    };
    const how = `<details class="offer-how"><summary>📖 How to lowball (tap)</summary><ol>
      <li><b>Open at the number.</b> Send exactly the "open at" amount: the quarter past the dollar reads as a considered price, not a round guess.</li>
      <li><b>Counter once.</b> If the seller counters, accept anything at or under the counter line; over it, counter back at the line once, then walk.</li>
      <li><b>Time is your leverage.</b> The longer it has sat, the lower the opener (two weeks 68%, a month 60%, two months 55%, three months 50% of the ask). A price cut or a seller with 3+ stale listings takes 5% more off.</li>
      <li><b>Watch it too.</b> Sellers can send offers to everyone watching a listing; watching the ones you lowball invites a better price back.</li>
      <li><b>Bundle a seller.</b> Several stale cards from one seller: offer on each, then ask for combined shipping.</li>
      <li><b>Long shots cost nothing.</b> 🎲 ones are priced far over what the card sells for; the opener is under 40% of the ask and will often be declined. Fire them anyway.</li></ol></details>`;
    const head = `<div style="padding-top:10px"></div>` + grid(3, [
      stat('OFFER TARGETS', all.length, '#2e7d32', '🎣'),
      stat('SITTING 60+ DAYS', all.filter(o => o.days >= 60).length, '#fb8c00', '🕸️'),
      stat('ASKS OFF IF ALL HIT', '$' + Math.round(saved).toLocaleString(), '#1e88e5', '✂️')]) + how +
      chips('offer_view', 'best', [['best', '🎯 Best openers'], ['all', 'All ' + all.length], ['stale', '🕸️ 60+ days'], ['shots', '🎲 Long shots'], ['sellers', '📦 By seller' + (bundles.length ? ' ' + bundles.length : '')]]);
    if (view === 'sellers') return head + (bundles.length ? bundles.map(([seller, l]) => `<div class="line" style="padding:10px 0">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>📦 ${esc(seller)} · ${l.length} stale listings</b>
          <span class="muted" style="font-size:12px">open ${money(l.reduce((t, o) => t + o.offer, 0))} for ${money(l.reduce((t, o) => t + o.price, 0))} asked</span></div>
        <div class="muted" style="font-size:12px;margin:2px 0 6px">Offer on each, then message the seller for combined shipping.</div>
        <div class="offer-grid">${l.map(tile).join('')}</div></div>`).join('') : empty('No seller has more than one stale listing on your cards right now.'));
    return head + (list.length ? `<div class="offer-grid">${list.slice(0, Number(c.card.config.count) || 40).map(tile).join('')}</div>` : empty('Nothing in this view right now.'));
  }],

  lowball: ['Lowball snipes', false, c => {
    // Cheap auctions of $15+ cards, each with one low snipe (the bot's lowball.py).
    // Set many of these in Gixen: most lose, a few win at a fraction of the price.
    const lb = c.d.lowball;
    if (!lb || !lb.targets) return empty('Update the bot to see this: it needs a version with lowball snipes.');
    const rec = lb.record || {n: 0, won: 0}, pct = Math.round(lb.level * 100);
    const how = lb.learned
      ? `Snipes are ${pct}% of the going rate: of ${rec.n} auctions like these that ended, ${rec.won} would have been won at that.`
      : `Snipes are ${pct}% of the going rate for now; after 30 auctions like these have ended (${rec.n} so far), the bot sets it where about 1 in 5 would have won.`;
    const hrs = Object.entries(lb.hours || {}).filter(([, b]) => b.n >= 3);
    const hourTxt = hrs.length ? `<div class="muted" style="font-size:12px;padding-bottom:6px">Ending time vs price: ${hrs.map(([h, b]) => `${(+h % 12) || 12}${+h < 12 ? 'am' : 'pm'} <b style="color:${b.median <= 0.8 ? '#2e7d32' : b.median >= 1.1 ? '#c62828' : 'inherit'}">${Math.round(b.median * 100)}%</b> (${b.n})`).join(' · ')}</div>` : '';
    const top = lb.targets.slice(0, Number(c.card.config.count) || 15);
    if (!top.length) return `<div class="muted" style="font-size:12px;padding:10px 0 6px">${how}</div>${hourTxt}` + empty('No auction of a $15+ card is under half its going rate right now.');
    return `<div class="muted" style="font-size:12px;padding:10px 0 6px">Auctions ending within two days, still under half what the card goes for. ${how} You'll get a 🎯 Last call alert for any still under 30% with at most one bid in its last 3 hours.</div>${hourTxt}` +
      top.map(t => `<div class="line" style="display:flex;gap:12px;align-items:flex-start;padding:10px 0">
        ${thumb(t, 54, 74)}
        <div style="flex:1;min-width:0">
          <a class="title" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.title)}</a>
          <div style="font-size:13px;margin-top:3px">${pill('Snipe ' + cents(t.snipe), '#2e7d32')} ${t.sniped ? pill('In Gixen', '#546e7a') + ' ' : ''}now ${money(t.price)} + ${shipTxt(t)} · ${t.bids} bid${t.bids === 1 ? '' : 's'} · goes for about <b>${money(t.value)}</b> <span class="muted">(${t.basis === 'sales' || t.basis === 'sold' ? 'sales' : 'estimate'})</span></div>
          <div class="muted" style="font-size:12px;margin-top:2px">ends ${when(t.end_time)}${t.dead ? ' · 🌙 ' + esc(t.dead) : ''}${(t.overlooked || []).length ? ' · 👀 ' + esc(t.overlooked.join(', ')) : ''} · ${esc(t.seller)}</div>
          <div class="row tight">${linkBtn('View ↗', t.url, '#1e88e5')}${copyBtn('Copy item #', t.item_id)}${copyBtn('Copy ' + cents(t.snipe), cents(t.snipe))}</div>
        </div></div>`).join('');
  }],

  rainbows: ['Rainbows', false, c => {
    // Every parallel of a card (the bot's rainbow.md): owned, for sale now, live picks.
    const all = c.d.rainbows;
    if (!all) return empty('Update the bot to see this: it needs a version with rainbows.');
    if (!all.length) return empty('No rainbows yet. Add a card to rainbow.md in the bot\'s repo.');
    const def = all[0].card, r = all.find(x => x.card === store('rainbow', def)) || all[0];
    const filter = store('rainbow_show', 'all');
    const rows = r.parallels.filter(p => filter === 'all' || (filter === 'missing' ? !p.owned : p.for_sale > 0 && !p.owned));
    return chips('rainbow', def, all.map(x => [x.card, `${x.card} (${x.owned}/${x.parallels.length})`]), r.card) +
      chips('rainbow_show', 'all', [['all', 'All ' + r.parallels.length], ['missing', 'Missing ' + (r.parallels.length - r.owned)], ['sale', 'Missing and for sale ' + r.parallels.filter(p => !p.owned && p.for_sale).length]]) +
      `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-top:8px">` + rows.map(p => {
        const color = p.owned ? '#2e7d32' : (p.pick ? '#c41e3a' : (p.for_sale ? '#1e88e5' : '#546e7a'));
        return `<a href="${esc(p.pick ? p.pick.url : p.url)}" target="_blank" rel="noopener" style="display:block;text-decoration:none;color:inherit;padding:8px;border-radius:10px;border:1px solid ${color}88;background:${color}${p.owned ? '33' : '14'}">
          <div style="font-weight:600;font-size:13px">${p.owned ? '✓ ' : ''}${esc(p.name)}${p.run ? ` <span class="muted">/${p.run}</span>` : ''}</div>
          <div class="muted" style="font-size:11px;margin-top:2px">${p.owned ? esc(p.owned.status) : (p.pick ? (TIER[p.pick.tier] || ['⭐'])[0] + ' Live pick ' + money(p.pick.total) : (p.for_sale ? p.for_sale + ' for sale from ' + money(p.cheapest) : 'none for sale'))}${p.where ? ' · ' + esc(p.where) : ''}</div></a>`;
      }).join('') + `</div>` + (rows.length ? '' : empty('Nothing here.'));
  }],

  moves: ['Price drops and relists', false, c => {
    const all = c.d.moves;
    if (!all) return empty('Update the bot to see this: it needs a version that watches prices.');
    const top = all.filter(m => !(m.is_auction && m.end_time && msLeft(m.end_time) <= 0)).slice(0, Number(c.card.config.count) || 8);
    if (!top.length) return empty('No seller has cut a price or relisted an unsold card in the last three days.');
    return `<div class="muted" style="font-size:12px;padding:10px 0 6px">Sellers who blinked: a Buy It Now cut by 15% or more, or a card that ended unsold and came back. A good moment for an offer.</div>` +
      top.map(m => `<div data-row class="line" style="display:flex;gap:12px;align-items:flex-start;padding:10px 0">
        ${thumb(m, 54, 74)}
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:8px;justify-content:space-between;align-items:flex-start">
            <a class="title" href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a>
            <div style="text-align:right;flex:none">${badge(m)}</div>
          </div>
          <div style="font-size:13px;margin-top:3px">${m.kind === 'relist' ? pill('🔁 Relisted', '#5e35b1') : pill('📉 Price cut', '#c62828')} ${m.old && m.old !== m.price ? `<s class="muted">${money(m.old)}</s> → ` : ''}<b>${money(m.price)}</b> + ${shipTxt(m)}${m.cut_pct > 0 ? ` <b style="color:#43a047">−${m.cut_pct}%</b>` : ''}</div>
          <div class="muted" style="font-size:11px;margin-top:3px">${esc(m.seller)} · ${ago(new Date(m.at * 1000).toISOString())} · eBay item <b style="color:var(--primary-text-color);user-select:all;-webkit-user-select:all">${esc(m.item_id)}</b></div>
        </div></div>`).join('');
  }],

  history: ['Price history', false, c => {
    const m = c.d.market;
    if (!m || !m.history) return empty('Update the bot to see this: it needs a version that groups sold prices by card.');
    if (!m.history.length) return empty('No card has sold twice yet. Once one has, its prices line up here.');
    return `<div class="muted" style="font-size:12px;padding:10px 0 6px">Cards the bot has seen sell more than once, delivered prices, oldest to newest.</div>` +
      m.history.slice(0, Number(c.card.config.count) || 8).map(h => {
        const up = h.prices[h.prices.length - 1] - h.prices[0], color = up > 0 ? '#e53935' : (up < 0 ? '#43a047' : '#78909c');
        return `<div data-row class="line" style="display:flex;gap:12px;align-items:center;padding:10px 0">
          ${thumb(h, 40, 54)}
          <div style="flex:1;min-width:0">
            <a class="title" href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a>
            <div style="font-size:12px;margin-top:3px"><b>${h.n} sales</b> <span class="muted">· ${money(h.low)} to ${money(h.high)} · typical ${money(h.typical)} · last ${money(h.last)} ${ago(h.last_at)}</span></div>
          </div>
          <div style="text-align:right;flex:none">${spark(h.prices, color)}<div style="font-size:11px;color:${color};font-weight:700">${up === 0 ? 'flat' : (up > 0 ? '▲ ' : '▼ ') + money(Math.abs(up))}</div></div>
        </div>`;
      }).join('');
  }],

  need_snipe: ['Needs a snipe', true, c => {
    const head = c.gixenOn ? '' : `<div class="muted" style="font-size:12px;padding-top:10px">Gixen can't be read right now, so this shows every 🔥/🟢 auction ending within ${span(c.hours)}.</div>`;
    if (!c.need.length) return head + empty(`✅ Every 🔥/🟢 auction ending in the next ${span(c.hours)} has a snipe.`);
    return head + `<div class="muted" style="font-size:12px;padding:10px 0 6px">Copy the item number and max, then paste them into Gixen. Skip hides one you don't want.</div>` + c.need.map(pickRow).join('');
  }],

  snipes_today: ['Your snipes ending today', true, c => {
    if (!c.gixenOn) return gixenDown(c);
    const today = c.snipes.filter(s => msLeft(s.end_time) < 24 * HOUR);
    return (c.gixen.problem ? gixenStale(c.gixen) : '') + (today.length ? `<div style="padding-top:4px"></div>` + today.map(snipeRow).join('') : empty('No snipes end in the next 24 hours.'));
  }],

  pay: ['To pay', false, c => {
    const unpaid = c.d.pipeline.unpaid || [];
    const adviceColor = t => t.startsWith('pay') ? '#e53935' : (t.startsWith('request') ? '#fb8c00' : '#546e7a');
    // What your open Gixen snipes could still add, when the bot could read them.
    const sn = c.d.pipeline.sniping;
    const riding = sn && sn.count ? `<div class="muted" style="font-size:12px;padding:8px 0 2px">🎯 Also sniping: <b style="color:var(--primary-text-color)">${sn.count}</b> auction${sn.count === 1 ? '' : 's'}, up to <b style="color:var(--primary-text-color)">${money(sn.max_total)}</b> more if every one wins.</div>` : '';
    if (!unpaid.length) return riding + empty('✅ Nothing is waiting on payment.');
    return riding + `<div style="padding-top:4px"></div>` + unpaid.map(g => `<div class="line" style="padding:8px 0">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(g.seller)} · ${money(g.total)}</b><span style="flex:none">${g.snipes ? pill('🎯 ' + g.snipes + ' sniping', '#6a1b9a') + ' ' : ''}${pill(esc(g.advice.split(':')[0].split(',')[0]), adviceColor(g.advice))}</span></div>
      ${(g.ids || []).some(i => c.art.get(String(i))) ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 4px">${g.ids.map(i => c.art.get(String(i))).filter(Boolean).map(x => cardPic(x, 40, 56)).join('')}</div>` : ''}
      <div class="muted" style="font-size:12px;line-height:1.35;margin-top:2px">${g.cards.map(esc).join('<br>')}${g.count > g.cards.length ? `<br>+ ${g.count - g.cards.length} more` : ''}</div>
      <div class="muted" style="font-size:11px;margin-top:2px">${esc(g.advice)}</div></div>`).join('') +
      `<div style="margin-top:8px">${linkBtn('eBay purchases ↗', 'https://www.ebay.com/mye/myebay/purchase', '#1e88e5')}</div>`;
  }],

  all_picks: ['Every live pick', true, c => {
    const tier = store('tier', 'all'), kind = store('kind', 'all'), cover = store('cover', 'all'), sort = store('sort', 'best'), limit = store('limit', 'page');
    let picks = (cover === 'sniped' ? c.allPicks : c.unfolded).slice();   // every pick, close to market too
    const total = c.allPicks.length;
    const edges = picks.filter(p => EDGE[p.edge]).length, why = store('why', 'all'), label = store('label', 'all');
    const labelCount = l => picks.filter(p => (p.labels || []).includes(l)).length;
    const labelChips = Object.keys(LABEL).filter(l => labelCount(l)).map(l => [l, LABEL[l][0] + ' (' + labelCount(l) + ')']);
    if (label !== 'all') picks = picks.filter(p => (p.labels || []).includes(label));
    if (EDGE[why]) picks = picks.filter(p => p.edge === why);
    if (why === 'any') picks = picks.filter(p => EDGE[p.edge]);
    if (tier !== 'all') picks = picks.filter(p => p.tier === tier);
    if (kind === 'auction') picks = picks.filter(p => p.is_auction);
    if (kind === 'bin') picks = picks.filter(p => !p.is_auction);
    if (c.gixenOn && cover === 'open') picks = picks.filter(p => p.is_auction && p.snipe == null);
    if (c.gixenOn && cover === 'sniped') picks = picks.filter(p => p.snipe != null);
    const end = p => p.is_auction && p.end_time ? p.end_time : '9';
    if (sort === 'best' && picks.some(p => p.sweep_score != null)) picks.sort(bySweep);
    if (sort === 'ending') picks.sort((x, y) => end(x) < end(y) ? -1 : (end(x) > end(y) ? 1 : 0));
    if (sort === 'cheap') picks.sort((x, y) => (delivered(x) ?? 1e9) - (delivered(y) ?? 1e9));
    if (sort === 'room') picks.sort((x, y) => room(y) - room(x));
    if (sort === 'deal') picks.sort((x, y) => byGap(x, y) || (y.deal_pct ?? -1) - (x.deal_pct ?? -1));
    const shown = limit === 'all' ? picks : picks.slice(0, c.perPage);
    return `<div style="padding-top:6px">` +
      chips('tier', 'all', [['all', 'All tiers'], ['fire', '🔥 Brag'], ['green', '🟢 Value'], ['yellow', '🟡 Cheap']]) +
      chips('kind', 'all', [['all', 'All types'], ['auction', 'Auctions'], ['bin', 'Buy now / offer']]) +
      (edges || why !== 'all' ? chips('why', 'all', [['all', 'Any reason'], ['any', 'Slipped through the cracks (' + edges + ')'], ...Object.entries(EDGE).map(([k, v]) => [k, v[0]])]) : '') +
      (labelChips.length || label !== 'all' ? chips('label', 'all', [['all', 'Any label'], ...labelChips]) : '') +
      (c.gixenOn ? chips('cover', 'all', [['all', 'Sniped or not'], ['open', 'No snipe yet'], ['sniped', '🎯 Sniped']]) : '') +
      chips('sort', 'best', [['best', 'Sweep score'], ['deal', '★ Best deal'], ['ending', 'Ending soonest'], ['room', 'Most room'], ['cheap', 'Cheapest']]) +
      `<div class="muted" style="font-size:12px;margin:10px 0 2px">Showing ${shown.length} of ${picks.length}${picks.length !== total ? ' (' + total + ' live picks in all)' : ''}</div>` +
      (shown.length ? shown.map(pickRow).join('') : empty('Nothing matches those filters.')) +
      (picks.length > shown.length ? `<div class="line" style="padding-top:10px">${setBtn('Show all ' + picks.length, 'limit', 'all', '#546e7a')}</div>`
        : (limit === 'all' && picks.length > c.perPage ? `<div class="line" style="padding-top:10px">${setBtn('Show fewer', 'limit', 'page')}</div>` : '')) + `</div>`;
  }],

  trends: ['Market trends', false, c => {
    const t = c.d.trends;
    if (!t) return empty('Update the bot to see this: it needs a version with ledger trends.');
    const row = m => `<div class="line" style="display:flex;gap:10px;align-items:center;padding:7px 0">
      ${m.image ? `<img src="${esc(m.image)}" style="width:36px;height:50px;object-fit:cover;border-radius:5px">` : ''}
      <div style="flex:1;min-width:0"><a class=title href="${esc(m.url)}" target=_blank rel=noopener style="font-size:13px">${esc(m.card)}</a>
      <div class=muted style="font-size:12px">~${money(m.was)} → ~<b style="color:var(--primary-text-color)">${money(m.now)}</b> · ${m.n} sales</div></div>
      <b style="color:${m.dir === 'up' ? '#2e7d32' : '#c62828'};font-size:16px">${m.pct > 0 ? '+' : ''}${m.pct}%</b></div>`;
    if (!t.up.length && !t.down.length) return empty(`No card has moved 10% yet. ${t.cards} cards have sold 3+ times in the last 120 days; trends show once their recent sales part from the earlier ones.`);
    return (t.up.length ? cap('📈 RISING · LAST 30 DAYS AGAINST BEFORE') + t.up.map(row).join('') : '')
      + (t.down.length ? cap('📉 FALLING') + t.down.map(row).join('') : '')
      + `<div class=muted style="font-size:12px;margin-top:8px">From the bot's own sold-price ledger: cards sold 3+ times in 120 days, the last 30 days' median against the sales before.</div>`;
  }],

  worth: ['What the collection is worth', false, c => {
    const w = c.d.worth;
    if (!w) return empty('Update the bot to see this: it needs a version with ledger worth.');
    if (!w.valued) return empty(`None of your ${w.n} cards has a recorded sale of the same card yet. This fills in as the ledger grows.`);
    const gainColor = w.gain >= 0 ? '#2e7d32' : '#c62828';
    const paidPct = w.value ? Math.round(w.paid / w.value * 100) : 0;
    const top = w.top.filter(x => x.by === 'sales').slice(0, 8), topMax = Math.max(1, ...top.map(x => Math.max(x.value, x.paid)));
    return `<div style="padding-top:10px" class="ring-row">${ring(paidPct, paidPct <= 100 ? '#1e88e5' : '#c62828', paidPct + '%', 'PAID OF WORTH')}` + grid(3, [
      stat('WORTH', '$' + Math.round(w.value).toLocaleString(), '#1e88e5', '💎'),
      stat('PAID', '$' + Math.round(w.paid).toLocaleString(), '#546e7a', '💳'),
      stat(w.gain >= 0 ? 'UP' : 'DOWN', (w.gain >= 0 ? '+$' : '-$') + Math.abs(Math.round(w.gain)).toLocaleString(), gainColor, w.gain >= 0 ? '📈' : '📉')]) + `</div>` +
      `<div class=muted style="font-size:12px;margin-top:8px">${w.valued} of ${w.n} cards priced by the ledger's newest sale of the same card; the rest at what you paid.</div>` +
      (w.movers.length ? cap('MOVERS SINCE ' + (w.since || 'LAST WEEK')) + w.movers.map(m => `<div class=line style="display:flex;gap:10px;align-items:center;padding:6px 0;font-size:13px">${ownThumb(c, m.id)}<span style="min-width:0"><b>${esc(m.card)}</b> <span class=muted>· ${money(m.was)} → ${money(m.value)}</span> <b style="color:${m.pct > 0 ? '#2e7d32' : '#c62828'}">${m.pct > 0 ? '+' : ''}${m.pct}%</b></span></div>`).join('') : '') +
      cap('TOP CARDS BY THE LEDGER · GREY = PAID, COLOUR = WORTH') + top.map(x => `<div class=line style="display:flex;gap:10px;align-items:center;padding:7px 0;font-size:13px">${ownThumb(c, x.id, 40, 56)}<div style="flex:1;min-width:0"><b>${esc(x.card)}</b> <span class=muted style="font-size:12px">· ${x.n} sale${x.n === 1 ? '' : 's'}, ${x.at}</span>
        <div class="dual"><div class="dual-bars"><span class="dual-paid" style="width:${Math.round(x.paid / topMax * 100)}%"></span><span class="dual-worth" style="width:${Math.round(x.value / topMax * 100)}%;background:${x.value >= x.paid ? '#2e7d32' : '#c62828'}"></span></div>
        <div class="dual-txt">${money(x.paid)} ▸ <b>${money(x.value)}</b> <b style="color:${x.value >= x.paid ? '#2e7d32' : '#c62828'}">${x.value >= x.paid ? '+' : ''}${Math.round((x.value - x.paid) / (x.paid || 1) * 100)}%</b></div></div></div></div>`).join('');
  }],

  closes: ['Where steals happen', false, c => {
    const k = c.d.closes;
    if (!k) return empty('Update the bot to see this: it needs a version that learns how auctions close.');
    if (!k.trusted) return empty(`Still learning: ${k.calls} picked auctions have sold so far; this needs 30.`);
    const pct = g => g && g.share != null ? Math.round(100 * g.share) + '%' : '–';
    const row = (icon, s) => `<div class="line" style="padding:6px 0;font-size:13px">${icon} <b>${esc(s.seller)}</b> <span class="muted">· closes ~${Math.round(100 * s.share)}% of value · ${s.n} sold</span></div>`;
    return `<div style="padding-top:10px"></div>` + grid(2, [
      stat('ONE-OFF SELLERS', pct(k.groups.small), '#0288d1', '🧊'), stat('CONSIGNORS', pct(k.groups.consignor), '#e53935', '🔥'),
      stat('DAYTIME ENDINGS', pct(k.hours.day), '#0288d1', '🌤️'), stat('EVENING ENDINGS', pct(k.hours.evening), '#fb8c00', '🌙')]) +
      `<div class="muted" style="font-size:12px;margin-top:8px;line-height:1.5">How far from the bot's going rate its picked auctions closed, as a median of the ${k.calls} that sold (100% = at the going rate, shipping included). Daytime is 8am–8pm at small sellers; consignors nearly all end in the evening. A 🧊 quiet seller or daytime ending is where a cheapskate max wins; a 🔥 hot seller is where it doesn't, so lowball snipes skip them.</div>` +
      (k.types && Object.keys(k.types).length ? cap('BY CARD TYPE AND ENDING HOUR · HOW THEY CLOSE AGAINST VALUE') + heatGrid(k.types) : '') +
      (k.hot.length ? cap('HOT SELLERS · THEIR AUCTIONS CLOSE OVER VALUE') + k.hot.map(x => row('🔥', x)).join('') : '') +
      (k.quiet.length ? cap('QUIET SELLERS · WHERE THE MAX WINS') + k.quiet.map(x => row('🧊', x)).join('') : '');
  }],

  calls: ['How the calls turned out', false, c => {
    // (heatGrid lives just above PANELS)
    const m = c.d.market;
    if (!m) return empty('Update the bot to see this: it needs a version that records sold prices.');
    if (!m.count) return empty('No sold prices yet. The bot records the final bid of every auction it has watched, starting with the next ones to close.');
    const w = m.calls ? Math.round(m.under_max / m.calls * 100) : 0;
    return `<div style="padding-top:10px">` + grid(3, [
      stat('SOLD PRICES', m.count, '#1e88e5', '🔨'),
      stat('UNDER THE MAX', m.calls ? m.under_max + ' / ' + m.calls : '–', '#43a047', '🎯'),
      stat('PRICE GAP', m.value_gap_pct == null ? '–' : m.value_gap_pct + '%', '#8e24aa', '📏'),
    ]) + (m.calls ? stack([['Closed at or under the max', m.under_max, '#43a047'], ['Went higher', m.over_max, '#78909c']], m.calls) : '') +
    ((m.bands || []).some(b => b.calls) ? cap('BY VALUE BAND · HOW FAR THE REAL PRICE RAN FROM THE BOT\'S RATE') + m.bands.filter(b => b.calls).map(b =>
      hbar(esc(b.band), Math.abs(b.value_bias_pct), 50, b.value_bias_pct > 10 ? '#e53935' : b.value_bias_pct < -10 ? '#1e88e5' : '#43a047', `${b.calls} sold · ${Math.abs(b.value_bias_pct)}% ${b.value_bias_pct > 0 ? 'above' : 'below'}`)).join('') : '') +
    `<div class="muted" style="font-size:12px;margin-top:8px;line-height:1.5">
      ${m.count} real auction results on record, ${m.count_7d} from the last 7 days. New picks are priced from these.<br>
      ${m.calls ? `Of ${m.calls} picked auctions that sold, ${m.under_max} closed at or under the bot's max, so a snipe at that max was in the running. The other ${m.over_max} went higher and were left alone.${m.under_win == null ? '' : ` A snipe at the "to win" bid would have been in the running on ${m.under_win} of the ${m.calls}.`}` : 'None of the picked auctions has sold yet.'}
      ${m.value_gap_pct == null ? '' : `<br>The going rate the bot gave was typically ${m.value_gap_pct}% away from the real delivered price.`}
      ${(m.bands || []).filter(b => b.calls).map(b => `<br>Cards valued ${esc(b.band)}: ${b.calls} sold, final prices ran ${Math.abs(b.value_bias_pct)}% ${b.value_bias_pct > 0 ? 'above' : 'below'} the bot's going rate.`).join('')}
      ${m.missed_steals ? `<br>Missed steals in the last 30 days: ${m.missed_steals} sold well under their usual price with no pick from the bot.` : ''}</div></div>`;
  }],

  sold: ['Sold prices', false, c => {
    const m = c.d.market;
    if (!m) return empty('Update the bot to see this: it needs a version that records sold prices.');
    const only = store('sold_only', 'all'), limit = store('sold_limit', 'page');
    let sold = (m.sold || []).slice();
    if (only === 'picked') sold = sold.filter(x => x.call);
    const shown = limit === 'all' ? sold : sold.slice(0, 8);
    const row = x => {
      const k = x.call, t = k ? (TIER[k.tier] || ['•', '#546e7a']) : null;
      const verdict = !k ? '' : (k.under_max
        ? pill('🎯 under max ' + cents(k.max), '#43a047')
        : pill('went past max ' + cents(k.max), '#78909c'));
      return `<div class="line" style="display:flex;gap:12px;align-items:flex-start;padding:9px 0">
        ${thumb({url: x.url, image: x.image, tier: k && k.tier}, 44, 60)}
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:8px;justify-content:space-between;align-items:flex-start">
            <a class="title" href="${esc(x.url)}" target="_blank" rel="noopener" style="font-size:13px">${t ? t[0] + ' ' : ''}${esc(x.title)}</a>
            <div style="text-align:right;flex:none"><b style="font-size:15px">${money(x.price)}</b></div>
          </div>
          <div class="muted" style="font-size:12px;margin-top:2px">${shipTxt(x)} · ${x.kind === 'bin' ? 'Buy It Now' : (x.bids || 0) + ' bid' + (x.bids === 1 ? '' : 's')} · sold ${ago(x.sold_at)}</div>
          ${k ? `<div style="font-size:12px;margin-top:4px">${verdict}${k.value ? ` <span class="muted" style="white-space:nowrap">rated ${worth(k.value)} · went ${x.estimated ? 'about ' : ''}${money(x.total)} delivered${x.estimated ? ' (shipping assumed)' : ''}</span>` : ''}</div>` : ''}
        </div></div>`;
    };
    return `<div style="padding-top:6px">` +
      chips('sold_only', 'all', [['all', 'Every sale'], ['picked', 'Ones the bot picked']]) +
      `<div class="muted" style="font-size:12px;margin:10px 0 2px">Final bids of auctions the bot watched, and Buy It Nows that sold at their listed price, newest first. ${m.count} on record.</div>` +
      (shown.length ? shown.map(row).join('') : empty(only === 'picked' ? 'None of the picked auctions has sold yet.' : 'Nothing has sold yet.')) +
      (sold.length > shown.length ? `<div class="line" style="padding-top:10px">${setBtn('Show all ' + sold.length, 'sold_limit', 'all', '#546e7a')}</div>`
        : (limit === 'all' && sold.length > 8 ? `<div class="line" style="padding-top:10px">${setBtn('Show fewer', 'sold_limit', 'page')}</div>` : '')) + `</div>`;
  }],

  missed: ['Missed steals', false, c => {
    // Sales the bot made no pick for that closed far under the same card's usual
    // price (sales.find_missed): where it is still blind, so you can say why.
    const m = c.d.market;
    if (!m || !m.missed) return empty('Update the bot to see this: it needs a version that records sold prices.');
    if (!m.missed.length) return empty('No missed steals in the last 30 days: nothing sold well under its usual price without a pick.');
    return `<div class="muted" style="font-size:12px;padding:10px 0 4px">Sold well under the usual price of the same card, and the bot made no pick. ${m.missed_steals} in the last 30 days, biggest discount first.</div>` +
      m.missed.map(x => `<div class="line" style="padding:8px 0">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <a class="title" href="${esc(x.url)}" target="_blank" rel="noopener" style="font-size:13px;min-width:0">${esc(x.title)}</a>
          <b style="flex:none;font-size:15px">${money(x.total)}</b></div>
        <div class="muted" style="font-size:12px;margin-top:2px">${pill(x.pct + '% under', '#43a047')} usual ${money(x.typical)} from ${x.n} sale${x.n === 1 ? '' : 's'} · ${x.kind === 'bin' ? 'Buy It Now' : 'auction'} · sold ${ago(typeof x.sold_at === 'number' ? new Date(x.sold_at * 1000).toISOString() : x.sold_at)}</div>
      </div>`).join('');
  }],

  wantlist: ['Want list', false, c => {
    const targets = c.d.wantlist || [];
    if (!targets.length) return empty("The want list is empty.");
    return `<div style="padding-top:4px"></div>` + targets.map(t => `<div class="line" style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;font-size:13px">
      <span style="min-width:0"><b>${esc(t.target)}</b>${t.notes ? `<br><span class="muted" style="font-size:12px">${esc(t.notes)}</span>` : ''}</span><span style="flex:none;text-align:right">${esc(t.ceiling)}</span></div>`).join('');
  }],

  gixen: ['Scheduled snipes', true, c => {
    if (!c.gixenOn) return gixenDown(c);
    const a = c.gixen, show = store('snipes', 'all');
    let snipes = c.snipes;
    const all = snipes.length;
    if (show === 'over') snipes = snipes.filter(s => s.outbid);
    if (show === 'today') snipes = snipes.filter(s => msLeft(s.end_time) < 24 * HOUR);
    if (show === 'play') snipes = snipes.filter(s => !s.outbid);
    if (show === 'long_shot' || show === 'steal') snipes = snipes.filter(s => s.check && s.check.verdict === show);
    if (show === 'flagged') snipes = snipes.filter(doubtful);
    const n = a.analysis;
    const flagged = c.snipes.filter(doubtful).length;
    const verdicts = !n ? '' : `<div class="muted" style="font-size:12px;margin-top:10px;line-height:1.5"><b style="color:var(--primary-text-color)">The bot's read on your amounts:</b> ` +
      [['steal', 'real discounts'], ['fair', 'fair bids'], ['long_shot', 'long shots'], ['over', 'over the going rate'], ['unknown', 'not priced yet']]
        .filter(([k]) => n[k]).map(([k, t]) => `<b style="color:${CHECK[k][1]}">${n[k]}</b> ${t}`).join(' · ') +
      (n.worth ? `<br>The priced snipes still in play add up to ${money(n.committed)} at your maxes, on cards that go for about ${money(n.worth)} delivered.` : '') +
      (n.flagged == null ? '' : `<br>${flagged ? `<b style="color:#e53935">⚠️ ${flagged} snipe${flagged === 1 ? '' : 's'} to look at</b>: over the going rate, or the wrong card, a card you own, sniped twice, a grader you skip, or one the bot passed on.` : '✅ No bad snipes: none is over the going rate, a card you own, sniped twice or the wrong player.'}`) + `</div>`;
    return `<div style="padding-top:10px">` + grid(3, [
      stat('SNIPES SET', all, '#6a1b9a', '🎯'),
      stat('STILL IN PLAY', '$' + Math.round(a.committed), '#1e88e5', '💰'),
      stat('OVER YOUR MAX', a.outbid_count, a.outbid_count ? '#e53935' : '#43a047', '📈'),
    ]) + (a.problem ? gixenStale(a)
      : `<div class="row" style="align-items:center;margin-top:10px"><span class="muted" style="font-size:12px">Read from Gixen ${ago(a.read_at)}.</span>${act('Re-read now', {action: 'gixen_refresh'}, {busy: 'Reading…'})}${linkBtn('Open Gixen ↗', GIXEN_URL, '#6a1b9a')}</div>`) +
      verdicts +
      chips('snipes', 'all', [['all', 'All ' + all], ['today', 'Ending in 24h'], ['play', 'Still in play'], ['over', 'Over your max'],
        ...(n ? [['long_shot', '🎲 Long shots'], ['steal', '💎 Discounts']] : []), ...(flagged ? [['flagged', '⚠️ To look at (' + flagged + ')']] : [])]) +
      `<div style="padding-top:8px"></div>` +
      (snipes.length ? snipes.map(snipeRow).join('') : empty(show === 'all' ? 'No snipes scheduled.' : 'None.')) + `</div>`;
  }],

  gixen_gap: ['Good auctions with no snipe', true, c => {
    if (!c.gixenOn) return empty('Needs the Gixen list.');
    return c.need.length ? `<div style="padding-top:4px"></div>` + c.need.map(pickRow).join('') : empty(`✅ Every 🔥/🟢 auction ending in the next ${span(c.hours)} has a snipe.`);
  }],

  record: ['Snipe record', false, c => {
    const a = c.d.record;
    const total = (a.wins || 0) + (a.losses || 0);
    const w = total ? Math.round(a.wins / total * 100) : 0;
    const weekTotal = (a.wins_week || 0) + (a.losses_week || 0), gixTotal = (a.gixen_wins || 0) + (a.gixen_losses || 0);
    return `<div style="padding-top:10px" class="ring-row">${ring(a.rate == null ? w : a.rate, '#43a047', (a.rate == null ? w : a.rate) + '%', 'WIN RATE · ' + a.days + 'D')}` + grid(2, [
      stat('WON / LOST', a.wins + ' / ' + a.losses, '#8e24aa', '🏆'),
      stat('THIS WEEK', a.wins_week + ' / ' + a.losses_week, '#fb8c00', '📅'),
    ]) + `</div><div style="margin-top:10px">` +
      hbar('All wins', a.wins, total, '#43a047', `${a.wins} of ${total}`) +
      hbar('This week', a.wins_week, weekTotal, '#fb8c00', `${a.wins_week} of ${weekTotal}`) +
      hbar('Gixen snipes', a.gixen_wins, gixTotal, '#8e24aa', `${a.gixen_wins} of ${gixTotal}`) +
    `</div><div class="muted" style="font-size:12px;margin-top:6px">The other ${a.wins - a.gixen_wins} wins were straight eBay buys, bids and offers.</div>` +
    cap('LATEST ONES THAT GOT AWAY') +
    ((a.recent_losses || []).length ? a.recent_losses.map(e => {
      const pic = e.image ? `<img src="${esc(e.image)}" loading="lazy" alt="" style="width:40px;height:56px;object-fit:cover;border-radius:5px;display:block">` : '<div style="width:40px;height:56px;border-radius:5px;background:#8882"></div>';
      const by = e.sold != null && e.my_max != null ? `<b style="color:#e53935">${money(e.sold)}</b> <span class="muted">vs your ${cents(e.my_max)}</span>` : (e.sold != null ? `<b>${money(e.sold)}</b>` : '');
      return `<div class="line" style="display:flex;gap:10px;align-items:center;padding:6px 0;font-size:13px">${e.item_id ? `<a href="https://www.ebay.com/itm/${esc(e.item_id)}" target="_blank" rel="noopener" style="flex:none">${pic}</a>` : pic}
        <span style="flex:1;min-width:0">${esc(e.title)}<br><span class="muted" style="font-size:11px">${esc(e.date)}${e.seller ? ' · ' + esc(e.seller) : ''}</span></span>${by ? `<span style="flex:none;text-align:right;font-size:12px">${by}</span>` : ''}</div>`;
    }).join('') : empty('No losses on record.')) + `</div>`;
  }],

  collection: ['Collection', false, c => {
    const a = c.d.collection;
    const budget = Number(c.s.monthly_budget) || 0;
    const spent = Number(a.month_spent) || 0;
    const pct = budget > 0 ? Math.min(100, Math.round(spent / budget * 100)) : 0;
    const barColor = pct >= 100 ? '#e53935' : (pct >= 75 ? '#fb8c00' : '#43a047');
    const years = Object.entries(a.by_year || {});
    const top = Math.max(1, ...years.map(y => y[1]));
    const bars = years.map(([y, n]) => `<div style="flex:1;text-align:center;min-width:0">
      <div style="font-size:11px;font-weight:700">${n}</div>
      <div style="height:${Math.round(n / top * 70) + 3}px;background:${c.accent};border-radius:4px 4px 0 0"></div>
      <div class="muted" style="font-size:10px">${esc(String(y).length === 4 ? "'" + String(y).slice(2) : y)}</div></div>`).join('');
    return `<div style="padding-top:10px">` + grid(3, [
      stat('CARDS', a.cards, c.accent, '🃏'),
      stat('SPENT', '$' + Math.round(a.spent), '#1e88e5', '💵'),
      stat('AVG PAID', money(a.avg_paid), '#43a047', '🪙'),
      stat('ROOKIES', a.rookies, '#fb8c00', '⭐'),
      stat('NUMBERED', a.numbered, '#8e24aa', '🔢'),
      stat('AUTO / RELIC', a.autos + ' / ' + a.relics, '#00897b', '✍️'),
      stat('GRADED', a.graded, '#546e7a', '🏅'),
      stat('FRONT PAGE', a.front_page, '#f9a825', '📖'),
      stat('DUPES', a.dupes, '#6d4c41', '♻️'),
    ]) + (a.by_status ? cap('WHERE THEY ARE') + stack([['In binder', a.by_status['In binder'] || 0, c.accent], ['Delivered, to file', a.by_status.Delivered || 0, '#8e24aa'], ['In transit', a.by_status['In transit'] || 0, '#1e88e5'], ['Won, not shipped', a.by_status.Won || 0, '#fb8c00']], a.cards) : '') +
    cap('THIS MONTH · ' + a.month_cards + ' CARDS') + `
    <div style="display:flex;justify-content:space-between;align-items:baseline"><div style="font-size:22px;font-weight:800">${money(spent)}</div>
      <div class="muted" style="font-size:13px">${budget > 0 ? 'of $' + Math.round(budget) + ' budget · ' + (spent > budget ? money(spent - budget) + ' over' : money(budget - spent) + ' left') : 'no monthly budget set'}</div></div>
    ${budget > 0 ? `<div class="bar" style="margin-top:4px"><div style="width:${pct}%;background:${barColor}"></div></div>` : ''}` +
    cap('CARDS BY YEAR') + `<div style="display:flex;gap:4px;align-items:flex-end;margin-top:4px">${bars}</div>` +
    cap('BIGGEST BUYS') +
    (a.priciest || []).map(r => `<div class="line" style="display:flex;align-items:center;gap:10px;padding:5px 0;font-size:13px">${ownThumb(c, r.id)}<span style="flex:1;min-width:0">${esc(r.card)}</span><b>${money(r.paid)}</b></div>`).join('') + `</div>`;
  }],

  to_file: ['To file in the binder', false, c => {
    const cards = c.cards.filter(x => x.s === 'Delivered');
    if (!cards.length) return empty('✅ Everything delivered is in the binder.');
    const pages = {};
    cards.forEach(x => (pages[x.pg] = pages[x.pg] || []).push(x));
    const order = k => k === 'front page' ? -1 : (parseInt(String(k).replace(/\D+/, '')) || 99);
    // one strip of pictures per binder page; open a page for each card's own Filed button
    const open = store('file_page', '');
    return `<div class="muted" style="font-size:12px;padding:10px 0 2px">${cards.length} delivered cards are waiting to go in the binder, by page. Tap a picture to see the card, File all once a page is done, or open a page to file cards one by one.</div>` +
    Object.keys(pages).sort((x, y) => order(x) - order(y)).map(pg => `<div data-row class="line" style="padding:8px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>📖 ${esc(pg)} · ${pages[pg].length}</b>
        <span class="row tight" style="margin:0">${setBtn(open === pg ? 'Close' : 'One by one', 'file_page', open === pg ? '' : pg)}${act(pages[pg].length > 1 ? 'File all ' + pages[pg].length : 'Filed', {action: 'filed', ids: pages[pg].map(x => x.id)}, {busy: 'Filing…', color: '#43a047', hide: true, ...(pages[pg].length > 1 ? {confirm: 'Tap again to file ' + pages[pg].length} : {})})}</span></div>` +
      (open === pg
        ? pages[pg].map(x => `<div data-row class="line" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;font-size:13px">
            ${cardPic(x, 42, 58)}<span style="min-width:0;flex:1">${esc(x.n)}<br><span class="muted" style="font-size:11px">#${esc(x.id)} · ${esc(x.d)} · ${money(x.p)}</span></span>
            ${act('Filed', {action: 'filed', ids: [x.id]}, {hide: true, color: '#43a047'})}</div>`).join('')
        : `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${pages[pg].map(x => cardPic(x, 40, 56)).join('')}</div>`) + `</div>`).join('');
  }],

  on_the_way: ['On the way', false, c => {
    const transit = c.cards.filter(x => x.s === 'In transit').sort((x, y) => x.d < y.d ? -1 : 1);
    const unpaid = c.cards.filter(x => x.s === 'Won' || x.s === 'Awaiting payment');
    // days since the order: past two weeks in the mail is worth a nudge, past three a "where is it?" message
    const days = x => x.d ? Math.floor((Date.now() - new Date(x.d + 'T12:00:00')) / 864e5) : null;
    const age = x => { const n = days(x); if (n == null) return ''; const col = n >= 21 ? '#e53935' : (n >= 14 ? '#fb8c00' : null);
      return col ? ' · ' + pill(n + ' days', col) : ' · ' + n + ' day' + (n === 1 ? '' : 's'); };
    // Got it: in hand, to file. In binder: already filed. (Untracked envelopes never send a delivery email.)
    const rows = list => list.map(x => `<div data-row class="line" style="display:flex;gap:10px;align-items:center;padding:6px 0;font-size:13px">${cardPic(x)}
      <span style="min-width:0;flex:1">${esc(x.n)}<br><span class="muted" style="font-size:11px">${esc(x.d)}${age(x)} · ${esc(x.sl)} · goes on ${esc(x.pg)}</span>
        <span class="row tight" style="margin-top:4px">${act('Got it', {action: 'arrived', ids: [x.id]}, {hide: true, color: '#43a047'})}${act('In binder', {action: 'arrived', ids: [x.id], binder: true}, {hide: true})}</span></span><b>${money(x.p)}</b></div>`).join('');
    const late = transit.filter(x => days(x) >= 21);
    const MAIL_SHOWN = 8, mailAll = store('mail_limit', 'page') === 'all';
    return `<div style="padding-top:10px">` + grid(2, [
      stat('IN TRANSIT', transit.length, '#1e88e5', '🚚'),
      stat('WON, NOT SHIPPED', unpaid.length, '#fb8c00', '⏳'),
    ]) + (late.length ? `<div class="warn" style="margin-top:10px;padding:8px 10px;font-size:12px">📮 ${late.length} card${late.length === 1 ? ' has' : 's have'} shown "in transit" for 3+ weeks. Cheap cards often come untracked, so no delivery email ever arrives: check your pile and tap <b>Got it</b> on the ones you have. Anything still missing: message the seller or open a case. ${linkBtn('eBay purchases ↗', 'https://www.ebay.com/mye/myebay/purchase', '#1e88e5')}</div>` : '') +
    cap('IN THE MAIL · OLDEST FIRST') + (transit.length ? rows(mailAll ? transit : transit.slice(0, MAIL_SHOWN)) +
      (transit.length > MAIL_SHOWN ? `<div style="padding-top:8px">${setBtn(mailAll ? 'Show fewer' : 'Show all ' + transit.length, 'mail_limit', mailAll ? 'page' : 'all', '#546e7a')}</div>` : '') : empty('Nothing in transit.')) +
    cap('WON, WAITING ON PAYMENT OR SHIPPING') + (unpaid.length ? rows(mailAll ? unpaid : unpaid.slice(0, MAIL_SHOWN)) +
      (unpaid.length > MAIL_SHOWN && !mailAll ? `<div style="padding-top:8px">${setBtn('Show all ' + unpaid.length, 'mail_limit', 'all', '#546e7a')}</div>` : '') : empty('Nothing waiting.')) + `</div>`;
  }],

  binder: ['Every card', false, c => {
    // Every card you own, ranked and filtered: a wall of pictures (the listing each one
    // was bought from) or a plain list. Year/type/status filters stack; the search box narrows further.
    const status = store('status', 'all'), sort = store('cardsort', 'new'), kind = store('binder_kind', 'all'), year = store('binder_year', 'all');
    const wall = store('binder_view', 'wall') === 'wall' && c.cards.some(x => x.i);
    const yearOf = x => (/^(\d{4})/.exec(x.n) || [])[1] || 'TBD';
    const years = [...new Set(c.cards.map(yearOf))].sort().reverse();
    const KINDS = {rc: ['⭐ Rookies', 'R'], auto: ['✍️ Autos & relics', 'AL'], num: ['🔢 Numbered', 'N'], slab: ['🏅 Graded', 'G'], front: ['📖 Front page', 'F'], dupe: ['♻️ Dupes', 'D']};
    let cards = c.cards.slice();
    const total = cards.length;
    if (status === 'flag') cards = cards.filter(x => /[ALNGF]/.test(x.f));
    else if (status === 'dupe') cards = cards.filter(x => x.f.includes('D'));
    else if (status !== 'all') cards = cards.filter(x => x.s === status);
    if (KINDS[kind]) cards = cards.filter(x => [...KINDS[kind][1]].some(f => x.f.includes(f)));
    if (year !== 'all') cards = cards.filter(x => yearOf(x) === year);
    const gain = x => x.v != null && x.p > 0 ? x.v / x.p : 0;
    const byDate = (x, y) => (y.d || '') < (x.d || '') ? -1 : ((y.d || '') > (x.d || '') ? 1 : Number(y.id) - Number(x.id));
    const yk = (x, tbd) => yearOf(x) === 'TBD' ? tbd : yearOf(x);   // undated cards sort last either way
    const SORTS = {
      new: byDate,
      price: (x, y) => y.p - x.p,
      value: (x, y) => (y.v || 0) - (x.v || 0),
      gain: (x, y) => gain(y) - gain(x),
      steal: (x, y) => ((x.v ? x.p / x.v : 9) - (y.v ? y.p / y.v : 9)),
      year: (x, y) => yk(y, '0') < yk(x, '0') ? -1 : (yk(y, '0') > yk(x, '0') ? 1 : (x.n < y.n ? -1 : 1)),
      yearold: (x, y) => yk(x, '9') < yk(y, '9') ? -1 : (yk(x, '9') > yk(y, '9') ? 1 : (x.n < y.n ? -1 : 1)),
      name: (x, y) => x.n.replace(/^\d{4}\s*/, '') < y.n.replace(/^\d{4}\s*/, '') ? -1 : 1,
    };
    cards.sort(SORTS[sort] || byDate);
    const ranked = ['price', 'value', 'gain', 'steal'].includes(sort);
    const grouped = sort === 'year' || sort === 'yearold';
    const worthTxt = x => x.v == null ? '' : ` ▸ <b style="color:${x.v >= x.p ? '#2e7d32' : '#c62828'}">${money(x.v)}</b>`;
    const valued = cards.filter(x => x.v != null);
    const FLAG = {R: ['RC', '#fb8c00'], A: ['AUTO', '#00897b'], L: ['RELIC', '#00897b'], N: ['#’d', '#8e24aa'], G: ['GRADED', '#546e7a'], F: ['FRONT', '#f9a825'], D: ['DUPE', '#6d4c41']};
    const flags = x => [...x.f].map(f => `<span class="flag" style="background:${FLAG[f][1]}">${FLAG[f][0]}</span>`).join('');
    const findOf = x => (x.n + ' ' + x.s + ' ' + x.sl + ' ' + x.pg + ' ' + x.d).toLowerCase();
    const sel = (key, val, opts) => `<select data-do="set" data-key="${key}" style="margin:0 6px 6px 0">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    // year headers span the whole wall; their data-find holds every card under them so search keeps them in step
    const groups = [];
    for (const x of cards) {
      const k = grouped ? yearOf(x) : '';
      if (!groups.length || groups[groups.length - 1].k !== k) groups.push({k, cards: []});
      groups[groups.length - 1].cards.push(x);
    }
    let n = 0;
    const head = g => !grouped ? '' : `<div class="${wall ? 'pk-year' : 'line pk-year-list'}" data-find="${esc(g.cards.map(findOf).join(' | '))}"><b>${esc(g.k)}</b><span class="muted">${g.cards.length} card${g.cards.length === 1 ? '' : 's'} · ${money(g.cards.reduce((t, x) => t + x.p, 0))} paid${g.cards.some(x => x.v != null) ? ' · worth ' + money(g.cards.reduce((t, x) => t + (x.v ?? x.p), 0)) : ''}</span></div>`;
    const listRow = (x, i) => `<div class="line" data-find="${esc(findOf(x))}" style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;font-size:13px;align-items:center">
      ${ranked ? `<span class="rank">${i + 1}</span>` : ''}${x.i ? `<img src="${esc(x.i)}" loading="lazy" alt="" style="width:34px;height:47px;object-fit:cover;border-radius:4px;flex:none">` : ''}
      <span style="min-width:0;flex:1">${esc(x.n)}<br><span class="muted" style="font-size:11px">${flags(x)}${esc(x.s)} · ${esc(x.pg)}${x.d ? ' · ' + esc(x.d) : ''}${x.sl ? ' · ' + esc(x.sl) : ''}${x.vn ? ' · ' + x.vn + ' sale' + (x.vn === 1 ? '' : 's') : ''}</span></span><span style="flex:none;text-align:right"><b>${x.p ? money(x.p) : ''}</b>${worthTxt(x)}</span></div>`;
    const body = groups.map(g => head(g) + g.cards.map(x => { const i = n++; return wall ? pocket(x, i, ranked ? i + 1 : null) : listRow(x, i); }).join('')).join('');
    const jewels = c.cards.filter(x => x.i).sort((x, y) => (y.v ?? y.p) - (x.v ?? x.p)).slice(0, 5);
    const MEDAL = ['🥇', '🥈', '🥉', '4', '5'];
    const crown = jewels.length < 3 ? '' : `<div class="jewels-cap">👑 CROWN JEWELS · WORTH THE MOST</div><div class="jewels">` + jewels.map((x, i) =>
      `<div class="jewel" role="button" tabindex="0" data-do="card" data-value="${esc(x.id)}" title="${esc(x.n)}">
        <div class="jewel-img"><img src="${esc(String(x.i).replace(/s-l\d+/, 's-l500'))}" alt=""></div>
        <div class="jewel-medal">${MEDAL[i]}</div>
        <div class="jewel-txt"><b>${money(x.v ?? x.p)}</b><span>${esc(x.n)}</span></div></div>`).join('') + `</div>`;
    return `<div style="padding-top:10px">${crown}
    <input data-search type="search" placeholder="Search ${total} cards: set, year, parallel, seller…" value="${esc(c.card.query)}">` +
    `<div class="row" style="align-items:center;margin-top:8px">` +
      sel('cardsort', sort, [['new', '🆕 Newest buys'], ['value', '💎 Worth most'], ['price', '💳 Priciest paid'], ['gain', '📈 Biggest gain (×)'], ['steal', '🏷️ Best buys (% of worth)'], ['year', '📅 Year, newest first'], ['yearold', '📅 Year, oldest first'], ['name', '🔤 Set A–Z']]) +
      sel('binder_year', year, [['all', 'Every year'], ...years.map(y => [y, y])]) +
      sel('binder_kind', kind, [['all', 'Every kind'], ...Object.entries(KINDS).map(([k, [l]]) => [k, l])]) +
      sel('status', status, [['all', 'Anywhere'], ['In binder', 'In the binder'], ['Delivered', 'To file'], ['In transit', 'In transit'], ['Won', 'Won, not shipped'], ['flag', 'Hits']]) +
    `</div>` +
    (c.cards.some(x => x.i) ? chips('binder_view', 'wall', [['wall', '🖼️ Binder wall'], ['list', '☰ List']]) : '') +
    `<div class="muted" style="font-size:12px;margin:10px 0 2px"><span data-found>${cards.length}</span> of ${total} cards · ${money(cards.reduce((t, x) => t + x.p, 0))} paid${valued.length ? ` · ${valued.length} priced by the ledger at <b style="color:var(--primary-text-color)">${money(valued.reduce((t, x) => t + x.v, 0))}</b> (paid ${money(valued.reduce((t, x) => t + x.p, 0))})` : ''}${(kind !== 'all' || year !== 'all' || status !== 'all') ? ' · ' + setBtn('✕ Clear filters', 'binder_reset', String(Date.now()), '#546e7a') : ''}</div>` +
    (cards.length ? (wall ? `<div class="binder">${body}</div>` : body) : empty('No cards match these filters.')) + `</div>`;
  }],

  todo: ['To do', true, c => {
    // Everything that wants a tap from you, soonest first: snipes to set, lowball
    // snipes worth a try, Gixen snipes to look at, sellers to pay, offers to send.
    const items = [];
    const row = (kind, color, o) => ({at: o.at || '9', html: `<div data-row class="line" style="display:flex;gap:10px;align-items:flex-start;padding:9px 0">
      ${o.item ? thumb(o.item, 40, 54) : ''}
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <span style="min-width:0">${pill(kind, color)} ${o.url ? `<a class="title" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title)}</a>` : `<b>${esc(o.title)}</b>`}</span>
          ${o.at ? `<span style="flex:none">${liveClock(o.at, 'pill')}</span>` : ''}
        </div>
        <div class="muted" style="font-size:12px;margin-top:3px;line-height:1.35">${o.line}</div>
        <div class="row tight">${o.buttons}</div>
      </div></div>`});
    const needIds = new Set(c.need.map(p => p.item_id));
    c.need.forEach(p => items.push(row('🎯 Snipe', '#6a1b9a', {item: p, at: p.end_time, url: p.url, title: (TIER[p.tier] || [''])[0] + ' ' + p.card,
      line: `now ${money(p.bid_now ?? p.price)} + ${shipTxt(p)}${p.max != null ? ` · <b style="color:var(--primary-text-color)">max ${cents(p.max)}</b>` : ''}${p.deal ? ' · ' + deal(p) : ''}`,
      buttons: snipeBtn(p.item_id, p.max) + (p.max == null ? '' : copyBtn('Copy ' + cents(p.max), cents(p.max))) + act('Skip', {action: 'skip', item_id: p.item_id}, {hide: true})})));
    const lb = ((c.d.lowball || {}).targets || []).filter(t => !t.sniped && !needIds.has(t.item_id) && msLeft(t.end_time) > 0 && msLeft(t.end_time) < c.windowMs);
    const LOWBALL_MAX = 8;
    lb.slice().sort((x, y) => x.share - y.share).slice(0, LOWBALL_MAX).forEach(t => items.push(row('🐟 Lowball', '#00838f', {item: t, at: t.end_time, url: t.url, title: t.title,
      line: `now ${money(t.price)} + ${shipTxt(t)} · ${t.bids} bid${t.bids === 1 ? '' : 's'} · goes for ~${money(t.value)} · <b style="color:var(--primary-text-color)">snipe ${cents(t.snipe)}</b>${t.dead ? ' · 🌙 ' + esc(t.dead) : ''}`,
      buttons: snipeBtn(t.item_id, t.snipe) + copyBtn('Copy ' + cents(t.snipe), cents(t.snipe))})));
    // only what could cost you: the wrong card, one you own, a double, a bad slab, overpaying
    const serious = x => (x.doubts || []).filter(d => SERIOUS_DOUBT.includes(d.kind));
    c.snipes.filter(x => !x.outbid && (serious(x).length || costly(x))).forEach(x => items.push(row('⚠️ Check snipe', '#e53935', {at: x.end_time, url: x.url, title: x.title || x.item_id,
      line: [...serious(x).map(d => esc(d.text)), ...(costly(x) ? [`over the going rate (~${money(x.check.value)})`] : [])].join(' · ') + ` · your snipe ${cents(x.max_bid)}`,
      buttons: linkBtn('Gixen ↗', GIXEN_URL, '#6a1b9a')})));
    c.snipes.filter(x => x.outbid && x.check && x.check.room && x.check.win != null && Number(x.check.win) > Number(x.current_bid)).forEach(x => items.push(row('📈 Outbid, still cheap', '#fb8c00', {at: x.end_time, url: x.url, title: x.title || x.item_id,
      line: `bid now ${cents(x.current_bid)}, past your ${cents(x.max_bid)} · goes for ~${money(x.check.value)} · to win ≈ ${cents(x.check.win)}`,
      buttons: snipeBtn(x.item_id, x.check.win, '🎯 Re-snipe ↗') + copyBtn('Copy ' + cents(x.check.win), cents(x.check.win))})));
    const payPic = g => { const x = (g.ids || []).map(i => c.art.get(String(i))).find(y => y && y.i); return x ? {url: x.e ? 'https://www.ebay.com/itm/' + x.e : 'https://www.ebay.com/mye/myebay/purchase', image: x.i} : null; };
    (c.d.pipeline.unpaid || []).filter(g => /^pay/i.test(g.advice)).forEach(g => items.push(row('💳 Pay', '#1e88e5', {item: payPic(g), title: g.seller + ' · ' + money(g.total) + ((g.count || 0) > 1 ? ' · ' + g.count + ' cards' : ''),
      line: esc(g.advice), buttons: linkBtn('eBay purchases ↗', 'https://www.ebay.com/mye/myebay/purchase', '#1e88e5')})));
    (c.d.offers || []).filter(o => o.value != null).slice(0, 3).forEach(o => items.push(row('🤝 Offer', '#2e7d32', {item: o, url: o.url, title: o.title,
      line: `asks ${money(o.price)} + ${shipTxt(o)} · goes for ~${money(o.value)} · up ${o.days} days · <b style="color:var(--primary-text-color)">offer ${cents(o.offer)}</b>`,
      buttons: linkBtn('Make offer ↗', o.url, '#1e88e5') + copyBtn('Copy ' + cents(o.offer), cents(o.offer))})));
    if (c.d.pipeline.to_file) items.push(row('📥 File', '#8e24aa', {title: c.d.pipeline.to_file + ' delivered card' + (c.d.pipeline.to_file === 1 ? '' : 's') + ' to put in the binder',
      line: 'Tap Filed on each one once it is in its page.', buttons: navBtn('Open Collection', 'collection')}));
    items.sort((x, y) => x.at < y.at ? -1 : (x.at > y.at ? 1 : 0));
    const more = lb.length - Math.min(lb.length, LOWBALL_MAX);
    if (!items.length) return empty('✅ Nothing to do right now. New picks land here within the hour.');
    const all = store('todo_limit', 'page') === 'all', shown = all ? items : items.slice(0, 12);
    return `<div class="muted" style="font-size:12px;padding:10px 0 4px">${items.length} thing${items.length === 1 ? '' : 's'}, soonest first.${c.gixenOn ? '' : ' Gixen can\'t be read, so auctions you already sniped may show.'}</div>` +
      shown.map(i => i.html).join('') +
      (items.length > shown.length ? `<div class="line" style="padding-top:10px">${setBtn('Show all ' + items.length, 'todo_limit', 'all', '#546e7a')}</div>`
        : (all && items.length > 12 ? `<div class="line" style="padding-top:10px">${setBtn('Show fewer', 'todo_limit', 'page')}</div>` : '')) +
      (more > 0 ? `<div class="line" style="padding-top:10px">${navBtn(more + ' more lowball snipes on Steals', 'steals')}</div>` : '');
  }],

  steals: ['Steals', true, c => {
    // One list, many cuts: each chip draws one of the older panels.
    const lb = (c.d.lowball || {}).targets, offers = (c.d.offers || []).filter(o => o.value != null);
    const VIEWS = [['best', 'Best', 'top_deals', steals(c.picks).length], ['map', '🗺️ Map', 'map'],
      ['ending', '⏱ Ending soon', 'ending_list', endingSoon(c).length], ['buy', '⚡ Buy now', 'buy_list', buyNowSteals(c).length],
      ['radar', '🎯 Radar', 'radar', (c.d.radar || []).filter(r => !(c.hiding && c.inGixen(r))).length],
      ['bundles', '📦 Bundles', 'bundles', (c.d.bundles || []).length], ['under', 'Under $20', 'under'],
      ['rookies', 'Rookies & 2019', 'focus'], ['year', 'By year', 'by_year'], ['rarest', 'Rarest', 'rarest'],
      ['lowball', '🐟 Lowball', 'lowball', lb && lb.length], ['offers', '🎣 Lowball offers', 'offers', offers.length],
      ['drops', '📉 Price drops', 'moves', (c.d.moves || []).length],
      ['missed', '🕳️ Missed', 'missed', ((c.d.market || {}).missed || []).length], ['all', 'Every pick', 'all_picks', c.picks.length]];
    const chosen = VIEWS.find(v => v[0] === store('steal_view', 'best')) || VIEWS[0];
    const chip = gixenChip(c);
    return `<div style="padding-top:10px"><input data-search type="search" placeholder="Filter ${c.picks.length} picks: set, parallel, seller, year, item #…" value="${esc(c.card.query)}"></div>` +
      jackpotBanner(c) + bidNowList(c) + droppedList(c) + chips('steal_view', 'best', VIEWS.map(([key, label, , n]) => [key, label + (n ? ' ' + n : '')]), chosen[0]) +
      (chip ? `<div class="row" style="margin-top:2px">${chip}</div>` : '') + PANELS[chosen[2]][2](c) + foldedStrip(c);
  }],

  incoming: ['Incoming', false, c => PANELS.on_the_way[2](c) + cap('DELIVERED, TO FILE IN THE BINDER') + PANELS.to_file[2](c)],

  missing: ["What's missing", false, c => {
    const view = store('missing_view', 'must');
    return `<div style="padding-top:6px"></div>` + chips('missing_view', 'must', [['must', '⭐ Must-haves'], ['rainbow', '🌈 Rainbows']], view) +
      PANELS[view === 'rainbow' ? 'rainbows' : 'must_have'][2](c);
  }],

  health: ['Bot health', true, c => {
    const a = c.d.status, last = c.d.last_action || {};
    // the bot's Claude login lapses every few weeks (authcheck.py): say so before it does
    const loginLine = lg => {
      if (!lg || lg.token || lg.logged_in == null) return '';
      if (lg.logged_in === false) return '<span style="color:#e53935">⚠️ The bot\'s Claude login has lapsed: nothing is being scored. Run <code>claude auth login</code> on the bot.</span><br>';
      if (lg.days_left == null) return '';
      const days = Math.max(0, Math.round(lg.days_left));
      if (days <= 7) return '<span style="color:#fb8c00">⚠️ Claude login ends in ' + days + ' day' + (days === 1 ? '' : 's') + '. Run <code>claude auth login</code> on the bot.</span><br>';
      return 'Claude login good for ' + days + ' days.<br>';
    };
    const color = {ok: '#43a047', stale: '#fb8c00', failing: '#e53935'}[a.state] || '#546e7a';
    const label = {ok: 'Running', stale: 'No search in 2h+', failing: 'Failing: ' + (a.failing || []).join(', ')}[a.state] || a.state;
    const age = (Date.now() - new Date(c.d.generated)) / 60000;
    const reports = c.card.feed.options.report_url;
    return `<div style="padding-top:10px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">
      <div><span class="dot" style="width:10px;height:10px;background:${color}"></span><b>${esc(label)}</b></div>
      <div class="muted" style="font-size:12px">searched ${ago(a.last_search)}</div></div>` + grid(3, [
      stat('LISTINGS', a.listings, '#1e88e5', '🔎'),
      stat('NEW · 24H', a.new_24h, '#00897b', '🆕'),
      stat('ALERTS · 24H', a.alerts_24h, '#fb8c00', '🔔'),
      stat('🔥 LIVE', a.fire, '#ff7043', '🔥'),
      stat('🟢 LIVE', a.green, '#43a047', '🟢'),
      stat('🟡 LIVE', a.yellow, '#f9a825', '🟡'),
    ]) + `<div class="row" style="margin-top:12px">
      ${searchBtn(c)}
      ${act('Refresh', {action: 'refresh'}, {busy: 'Refreshing…'})}
      ${act('Send test alert', {action: 'test_alert'}, {busy: 'Sending…', confirm: 'Tap again to send'})}
      ${a.skipped ? act('Restore ' + a.skipped + ' skipped', {action: 'unskip_all'}, {busy: 'Restoring…', confirm: 'Tap again to restore'}) : ''}
      ${a.last_report && reports ? linkBtn('Latest report ↗', reports.replace(/\/?$/, '/') + encodeURIComponent(a.last_report)) : ''}
    </div>
    <div class="muted" style="font-size:12px;margin-top:10px;line-height:1.5">
      ${c.s.alerts_enabled === false ? '🔕 Phone alerts are paused.<br>' : ''}
      ${a.sales_based} of ${a.live_picks} live maxes come from real sold prices; the rest are estimates.<br>
      ${a.deep ? (a.deep.on ? 'Market sweep (the standing market, a few pages an hour): ' + esc(a.deep.band) + ', pass ' + (a.deep.passes + 1) + (a.deep.last_pass ? ', last full pass ' + ago(new Date(a.deep.last_pass * 1000).toISOString()) : '') + ', ' + Number(a.deep.found || 0).toLocaleString() + ' listings swept in.<br>' : 'Market sweep off (deep_pages is 0).<br>') : ''}
      ${a.cost_month != null ? 'Claude: ' + money(a.cost_today) + ' today (' + (a.calls_today || 0) + ' calls' + (a.calls_today ? ', ' + money(a.cost_today / a.calls_today) + ' a call' : '') + '), ' + money(a.cost_month) + ' this month.<br>' : ''}
      ${loginLine(a.claude_login)}
      ${a.held_overnight ? a.held_overnight + ' alerts held for the morning.<br>' : ''}
      ${a.skipped ? a.skipped + ' picks hidden with Skip.<br>' : ''}
      ${c.d.tuning && c.d.tuning.on === false ? 'Self-tuning is switched off.<br>' : ''}
      ${((c.d.tuning || {}).log || []).slice(0, 5).map(t => 'Tuned ' + esc(t.name) + ' ' + t.old + ' → ' + t.new + ' on ' + esc(String(t.applied_at).slice(0, 10)) + ': ' + esc(t.status) + (t.note ? ' (' + esc(t.note) + ')' : '') + ', judged by ' + esc(t.metric) + '.<br>').join('')}
      ${last.at ? 'Last button: ' + esc(last.message) + ' (' + ago(last.at) + ')<br>' : ''}
      ${!c.card.feed.ok || age > 10 ? "⚠️ Home Assistant can't reach the bot; this is from " + ago(c.d.generated) + '.' : 'Read from the bot ' + ago(c.d.generated) + '.'}</div></div>`;
  }],
};

const STYLE = `
  :host { display: block; }
  ha-card { padding: 4px 14px 12px; font-size: 14px; overflow: hidden; }
  a { color: var(--primary-color); }
  .muted { color: var(--secondary-text-color); }
  .story { font-size: 12px; line-height: 1.35; margin-top: 4px; padding: 5px 8px; border-radius: 8px;
           background: color-mix(in srgb, var(--primary-color) 10%, transparent);
           border-left: 3px solid var(--primary-color); }
  .deal { color: var(--secondary-text-color); white-space: nowrap; }
  .rank { flex: none; width: 24px; height: 24px; line-height: 24px; border-radius: 50%; text-align: center; font-size: 12px;
          font-weight: 800; margin: 2px -4px 0 0; background: var(--divider-color); }
  .empty { padding: 8px 0; }
  .line { border-top: 1px solid var(--divider-color); }
  .line > b { flex: none; }
  .title { font-weight: 600; line-height: 1.25; text-decoration: none; color: var(--primary-text-color); }
  .cap { display: flex; align-items: center; gap: 8px; margin-top: 16px; font-size: 11px; font-weight: 700; letter-spacing: 1.5px; color: var(--secondary-text-color); }
  .cap::after { content: ''; flex: 1; height: 1px; background: var(--divider-color); }
  .pill { color: #fff; border-radius: 10px; padding: 2px 8px; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .flag { color: #fff; border-radius: 6px; padding: 0 5px; font-size: 10px; font-weight: 700; margin-right: 3px; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; }
  .grid { display: grid; gap: 8px; }
  .stat { border-radius: 14px; padding: 11px 6px; border: 1px solid; text-align: center; min-width: 0;
          background-image: linear-gradient(160deg, #ffffff12, transparent 60%); box-shadow: inset 0 1px 0 #ffffff14; }
  .stat-icon { font-size: 18px; }
  .stat-value { font-size: 23px; font-weight: 800; line-height: 1.15; font-variant-numeric: tabular-nums; }
  .stat-label { font-size: 10px; letter-spacing: 1px; color: var(--secondary-text-color); }
  .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .row.tight { margin-top: 7px; }
  .btn { display: inline-block; cursor: pointer; user-select: none; -webkit-user-select: none; border-radius: 14px; padding: 5px 11px;
         font-size: 12px; font-weight: 600; line-height: 1.2; text-decoration: none; transition: filter .12s, transform .12s;
         background: var(--divider-color); color: var(--primary-text-color); }
  .btn:hover { filter: brightness(1.15); }
  .btn:active { transform: scale(.96); }
  .btn.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .btn.busy { opacity: .45; pointer-events: none; }
  .jackpot { display: flex; gap: 14px; align-items: center; margin: 0 0 12px; padding: 14px; border-radius: 16px;
    color: #fff; background: linear-gradient(135deg, #d50000, #ff6d00); box-shadow: 0 0 0 0 rgba(213,0,0,.6);
    animation: jackpot-pulse 1.6s ease-out infinite; }
  .jackpot .btn { color: #d50000 !important; font-weight: 700; }
  @keyframes jackpot-pulse { 0% { box-shadow: 0 0 0 0 rgba(213,0,0,.55); } 70% { box-shadow: 0 0 0 14px rgba(213,0,0,0); } 100% { box-shadow: 0 0 0 0 rgba(213,0,0,0); } }
  @media (prefers-reduced-motion: reduce) { .jackpot { animation: none; } }
  .bar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--divider-color); }
  .radar { margin: 0 0 12px; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--divider-color, #8884); background: linear-gradient(135deg, #1e88e512, transparent); }
  .radar .hotrow { animation: jackpot-pulse 1.6s infinite; border-radius: 10px; }
  .meter { height: 6px; border-radius: 3px; background: #8883; margin-top: 4px; overflow: hidden; }
  .meter span { display: block; height: 100%; border-radius: 3px; }
  .comp { padding: 1px 6px; border-radius: 8px; background: #8882; color: var(--primary-text-color); text-decoration: none; white-space: nowrap; }
  .brag { white-space: pre-wrap; font-size: 13px; line-height: 1.5; padding: 10px 12px; margin: 4px 0 0; border-radius: 10px; background: var(--secondary-background-color, #8881); user-select: all; }
  .savings { margin: 0 0 10px; padding: 8px 12px; border-radius: 12px; background: #2e7d3218; border: 1px solid #2e7d3255; font-size: 13px; line-height: 1.5; }
  .bundle { padding: 10px 12px; margin: 8px 0; border-radius: 12px; border: 1px solid var(--divider-color, #8884); }
  .bundle.good { border-color: #2e7d32; background: #2e7d3212; }
  @media (prefers-reduced-motion: reduce) { .radar .hotrow { animation: none; } }
  .strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(178px, 1fr)); gap: 10px; margin: 8px 0 4px; }
  .strip-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; margin-top: 4px; }
  .strip-head .row { margin-top: 4px; }
  .strip-cap { font-size: 12px; margin-top: 8px; }
  .tile { display: flex; flex-direction: column; border-radius: 14px; overflow: hidden; min-width: 0;
          background: var(--secondary-background-color, #8881); border: 1px solid var(--divider-color, #8884); border-top: 3px solid #546e7a;
          transition: transform .15s ease, box-shadow .15s ease; }
  .tile:hover { transform: translateY(-3px); box-shadow: 0 10px 24px #0006; }
  .tile-img::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 35%; background: linear-gradient(transparent, #0005); pointer-events: none; }
  .newtag { position: absolute; top: 8px; right: 8px; background: #7c4dff; color: #fff; font-size: 10px; font-weight: 800; letter-spacing: 1px;
            padding: 3px 7px; border-radius: 8px; box-shadow: 0 1px 4px #0006; z-index: 1; }
  .tile.hot { border-color: #e53935; box-shadow: 0 0 0 1px #e5393588; }
  .tile.jp { border-color: #d50000; animation: jackpot-pulse 1.6s ease-out infinite; }
  .tile-img { position: relative; display: block; height: 0; padding-top: 80%; background: #0003; overflow: hidden; }
  .binder { display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 12px; margin-top: 10px; padding: 14px;
            border-radius: 14px; background: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
            box-shadow: inset 0 0 0 1px var(--divider-color); }
  .pocket { cursor: pointer; display: flex; flex-direction: column; min-width: 0; text-decoration: none; color: var(--primary-text-color);
            border-radius: 10px; padding: 6px; background: color-mix(in srgb, var(--card-background-color) 85%, var(--primary-text-color) 4%);
            box-shadow: 0 0 0 2px var(--ring, transparent), 0 2px 6px #0003; transition: transform .15s ease, box-shadow .15s ease; }
  .pocket:hover { transform: translateY(-3px) rotate(-.6deg); box-shadow: 0 0 0 2px var(--ring, var(--primary-color)), 0 8px 18px #0005; }
  .pk-img { position: relative; aspect-ratio: 5 / 7; border-radius: 6px; overflow: hidden; background: #0002; }
  .pk-img img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .pk-img::after { content: ''; position: absolute; inset: 0; pointer-events: none;
                   background: linear-gradient(115deg, #ffffff38 0%, #ffffff08 28%, transparent 40%, transparent 70%, #ffffff12 100%); }
  .pk-none { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 8px;
             text-align: center; font-size: 30px; }
  .pk-none span { font-size: 10px; line-height: 1.25; color: var(--secondary-text-color); }
  .pk-flags { position: absolute; left: 4px; top: 4px; display: flex; flex-wrap: wrap; gap: 2px; z-index: 1; }
  .pk-flags .flag { margin: 0; box-shadow: 0 1px 3px #0006; }
  .pk-where, .pk-same { position: absolute; right: 4px; top: 4px; z-index: 1; font-size: 13px; line-height: 20px; min-width: 20px; text-align: center;
                        border-radius: 10px; background: #000a; color: #fff; }
  .pk-same { top: auto; bottom: 4px; font-weight: 800; }
  .pk-gain { position: absolute; left: 4px; bottom: 4px; z-index: 1; padding: 1px 6px; border-radius: 8px; font-size: 11px; font-weight: 800;
             background: #2e7d32; color: #fff; box-shadow: 0 1px 3px #0006; }
  .pk-cap { padding: 6px 2px 0; display: flex; flex-direction: column; gap: 2px; }
  .pk-name { font-size: 11px; line-height: 1.25; font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .podium { display: grid; grid-template-columns: 1fr 1.15fr 1fr; gap: 10px; align-items: end; margin: 16px 0 6px; }
  .pod { min-width: 0; text-align: center; cursor: default; }
  .pod[data-do] { cursor: pointer; }
  .pod-img { position: relative; aspect-ratio: 5 / 7; border-radius: 10px; overflow: hidden; background: #0003; box-shadow: 0 0 0 3px var(--pod), 0 8px 20px #0005;
             transition: transform .2s ease; }
  .pod[data-do]:hover .pod-img { transform: translateY(-4px) rotate(-1deg); }
  .pod-img img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .pod-gold .pod-img::after { content: ''; position: absolute; inset: -60%; pointer-events: none; mix-blend-mode: overlay;
                              background: linear-gradient(115deg, transparent 40%, #fff9 50%, transparent 60%); animation: jewel-shine 4s ease-in-out infinite; }
  .pod-off { display: inline-block; margin-top: -12px; position: relative; padding: 2px 10px; border-radius: 999px; background: #2e7d32; color: #fff;
             font-weight: 900; font-size: 15px; box-shadow: 0 2px 6px #0006; }
  .pod-name { font-size: 11px; line-height: 1.25; margin: 4px 2px; height: 2.5em; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .pod-step { border-radius: 10px 10px 4px 4px; padding: 8px 4px; font-size: 12px; color: #000c; background: linear-gradient(var(--pod), color-mix(in srgb, var(--pod) 70%, #000)); }
  .pod-step b { font-size: 15px; }
  .pod-medal { display: block; font-size: 24px; line-height: 1.1; }
  .pod-gold .pod-step { padding-top: 22px; padding-bottom: 22px; }
  .pod-silver .pod-step { padding-top: 12px; padding-bottom: 12px; }
  .tp-wrap { container-type: inline-size; }
  .toppick { display: flex; gap: 16px; align-items: center; margin-top: 10px; padding: 14px; border-radius: 16px; }
  .tp-img { flex: none; max-width: 36%; }
  .tp-img img { max-height: 220px; max-width: 100%; border-radius: 10px; display: block; box-shadow: 0 6px 18px #0005; }
  @container (max-width: 520px) {
    .toppick { flex-direction: column; align-items: stretch; }
    .tp-img { max-width: none; align-self: center; }
    .tp-img img { max-height: 300px; }
  }
  .offer-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; margin-top: 10px; }
  @media (max-width: 500px) { .offer-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } .offer-open b { font-size: 19px; } .offer-open em { display: none; } }
  .offer-tile { border: 1px solid #2e7d3266; }
  .offer-tile.shot { border-color: #8e24aa66; }
  .offer-days, .offer-shot { position: absolute; top: 6px; z-index: 1; color: #fff; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 10px; box-shadow: 0 1px 3px #0006; }
  .offer-days { left: 6px; } .offer-shot { right: 6px; background: #8e24aa; }
  .offer-body { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 4px; }
  .offer-title { font-size: 12px; font-weight: 700; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .offer-ask { font-size: 12px; color: var(--secondary-text-color); }
  .offer-open { display: flex; align-items: baseline; gap: 8px; margin-top: 2px; padding: 6px 10px; border-radius: 10px; background: #2e7d3222; }
  .offer-open span { font-size: 10px; font-weight: 800; letter-spacing: 1.5px; color: #2e7d32; }
  .offer-open b { font-size: 24px; font-weight: 900; color: #2e7d32; }
  .offer-open em { font-style: normal; font-size: 11px; color: var(--secondary-text-color); margin-left: auto; }
  .offer-counter { font-size: 12px; }
  .offer-why { display: flex; flex-wrap: wrap; gap: 4px; }
  .offer-why span { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 8px; background: color-mix(in srgb, var(--primary-text-color) 10%, transparent); }
  .offer-how { margin: 10px 0 4px; font-size: 12px; }
  .offer-how summary { cursor: pointer; font-weight: 700; }
  .offer-how ol { margin: 6px 0 0; padding-left: 18px; line-height: 1.5; }
  .jewels-cap { font-size: 11px; font-weight: 800; letter-spacing: 2px; color: var(--secondary-text-color); margin: 4px 0 8px; }
  .jewels { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
  .jewel { position: relative; cursor: pointer; border-radius: 14px; padding: 8px; background: linear-gradient(160deg, #ffd54f33, #ff6f0022 40%, #7c4dff22);
           box-shadow: 0 0 0 2px #ffca2899, 0 6px 16px #0004; transition: transform .2s ease; }
  .jewel:hover { transform: translateY(-4px) scale(1.02); }
  .jewel-img { position: relative; aspect-ratio: 5 / 7; border-radius: 8px; overflow: hidden; background: #0003; }
  .jewel-img img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .jewel-img::after { content: ''; position: absolute; inset: -60%; pointer-events: none; mix-blend-mode: overlay;
                      background: linear-gradient(115deg, transparent 40%, #ffffffaa 50%, transparent 60%); animation: jewel-shine 4.5s ease-in-out infinite; }
  .jewel:nth-child(2) .jewel-img::after { animation-delay: .9s; } .jewel:nth-child(3) .jewel-img::after { animation-delay: 1.8s; }
  .jewel:nth-child(4) .jewel-img::after { animation-delay: 2.7s; } .jewel:nth-child(5) .jewel-img::after { animation-delay: 3.6s; }
  @keyframes jewel-shine { 0%, 60% { transform: translateX(-60%); } 100% { transform: translateX(60%); } }
  @media (prefers-reduced-motion: reduce) { .jewel-img::after { animation: none; } }
  .jewel-medal { position: absolute; top: 2px; left: 2px; min-width: 28px; height: 28px; line-height: 28px; text-align: center; border-radius: 14px;
                 background: #000b; color: #fff; font-weight: 900; font-size: 15px; }
  .jewel-txt { padding-top: 6px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .jewel-txt b { font-size: 18px; }
  .jewel-txt span { font-size: 11px; line-height: 1.25; color: var(--secondary-text-color); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  @media (max-width: 500px) { .jewels { grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: 42%; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 6px; }
                              .jewel { scroll-snap-align: start; } }
  .pk-rank { font-weight: 800; color: var(--primary-color); }
  .pk-year { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 10px; padding: 6px 2px 0; font-size: 20px; }
  .pk-year:not(:first-child) { margin-top: 10px; border-top: 1px solid var(--divider-color); padding-top: 12px; }
  .pk-year .muted, .pk-year-list .muted { font-size: 12px; }
  .pk-year-list { display: flex; align-items: baseline; gap: 10px; padding: 12px 0 4px; font-size: 16px; }
  .pk-money { font-size: 12px; color: var(--secondary-text-color); }
  @media (max-width: 500px) { .binder { grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 8px; } .pk-name { font-size: 10px; } }
  .tile-img img, .tile-img .noimg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .tile-img img { object-fit: contain; display: block; }
  .tile-img .noimg { display: flex; align-items: center; justify-content: center; font-size: 40px; }
  .clock, .off, .jptag { position: absolute; color: #fff; font-size: 12px; font-weight: 800; padding: 3px 8px; border-radius: 10px;
          box-shadow: 0 1px 4px #0006; z-index: 1; font-variant-numeric: tabular-nums; }
  .clock { top: 8px; left: 8px; }
  .off { bottom: 8px; right: 8px; background: #00a152; font-size: 14px; }
  .jptag { bottom: 8px; left: 8px; background: #d50000; }
  .tile-body { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 3px; flex: 1; }
  .tile-body .row { margin-top: auto; padding-top: 6px; }
  .tile-body .btn { padding: 4px 9px; }
  .clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13px; min-height: 2.5em; }
  .tile-price { font-size: 18px; white-space: nowrap; }
  .tile-price .muted { font-size: 12px; }
  .tile-sub { font-size: 12px; }
  @media (max-width: 600px) {
    .strip { display: grid; grid-auto-flow: column; grid-template-columns: none; grid-auto-columns: 68%;
             overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; padding-bottom: 6px; }
    .tile { scroll-snap-align: start; }
  }
  @media (prefers-reduced-motion: reduce) { .tile, .tile:hover { transition: none; transform: none; } .tile.jp { animation: none; } .pulse { animation: none; } }
  .pill[data-end] { font-variant-numeric: tabular-nums; }
  /* command center */
  .hero { position: relative; margin: 10px 0 2px; padding: 16px 18px 14px; border-radius: 18px; color: #fff; overflow: hidden;
          background: radial-gradient(120% 150% at 0% 0%, var(--accent, #c41e3a) 0%, #1c2140 52%, #0e1120 100%); box-shadow: 0 12px 30px #0005; }
  .hero::after { content: ''; position: absolute; inset: 0; background: radial-gradient(55% 80% at 100% 0%, #ffffff1f, transparent 60%); pointer-events: none; }
  .hero > * { position: relative; }
  .hero a { color: #fff; }
  .hero .muted { color: #ffffffb3; }
  .hero .btn { background: #ffffff24; color: #fff; }
  .hero .btn:hover { background: #ffffff38; filter: none; }
  .hero-top { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: flex-start; justify-content: space-between; }
  .hero-name { font-size: 26px; font-weight: 900; letter-spacing: -.3px; line-height: 1.1; text-shadow: 0 2px 10px #0006; }
  .hero-sub { font-size: 12px; margin-top: 5px; color: #ffffffc4; }
  .hero-stats { display: flex; flex-wrap: wrap; gap: 8px; }
  .hs { min-width: 84px; padding: 8px 10px; border-radius: 12px; background: #ffffff14; border: 1px solid #ffffff22; text-align: center; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
  .hs b { display: block; font-size: 21px; font-weight: 900; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .hs small { display: block; font-size: 9.5px; letter-spacing: 1px; color: #ffffffb3; margin-top: 3px; white-space: nowrap; }
  .hs .hs-sub { letter-spacing: 0; color: #ffffffd9; }
  .hero-next { display: flex; gap: 14px; align-items: center; margin-top: 14px; padding: 12px 14px; border-radius: 14px; background: #00000038; border: 1px solid #ffffff1c; }
  .hero-next img { width: 84px; height: 112px; object-fit: cover; border-radius: 8px; box-shadow: 0 4px 14px #0008; display: block; flex: none; }
  .hero-kicker { font-size: 10px; letter-spacing: 2px; color: #ffffffb3; font-weight: 700; }
  .hero-title { display: block; font-size: 17px; font-weight: 700; line-height: 1.2; margin: 3px 0 5px; text-decoration: none; }
  .hero-clock { flex: none; text-align: right; line-height: 1; text-shadow: 0 2px 12px #0008; }
  .hero-clock span { font-size: 38px; font-weight: 900; font-variant-numeric: tabular-nums; letter-spacing: 1px; }
  .hero-clock small { display: block; font-size: 10px; letter-spacing: 2px; color: #ffffffb3; font-weight: 700; margin-top: 5px; }
  .pulse { animation: pulse 1.8s ease-out infinite; }
  @keyframes pulse { 0% { box-shadow: 0 0 0 0 currentColor; } 70% { box-shadow: 0 0 0 6px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
  .tl { margin-top: 14px; }
  .tl-cap { font-size: 10px; letter-spacing: 2px; color: #ffffffb3; font-weight: 700; margin-bottom: 6px; }
  .tl-track { position: relative; height: 40px; border-radius: 8px; background: #ffffff12; }
  .tl-quiet { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(135deg, #ffffff14 0 5px, transparent 5px 11px); }
  .tl-dot { position: absolute; width: 13px; height: 13px; border-radius: 50%; margin-left: -7px; border: 2px solid #0009; box-shadow: 0 0 0 1px #fff4; transition: transform .15s; }
  .tl-dot:hover { transform: scale(1.6); z-index: 2; }
  .tl-dot.got { box-shadow: 0 0 0 2px #fff, 0 0 8px #fff9; }
  .tl-ticks { position: relative; height: 16px; margin-top: 4px; font-size: 10px; color: #ffffff99; }
  .tl-ticks span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
  .tl-ticks span:first-child { transform: none; }
  .tl-ticks span:last-child { transform: translateX(-100%); }
  @media (max-width: 600px) {
    .hero { padding: 14px 14px 12px; }
    .hero-name { font-size: 22px; }
    .hero-stats { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; }
    .hs { min-width: 0; padding: 7px 4px; }
    .hs small { white-space: normal; }
    .hero-next { flex-wrap: wrap; }
    .hero-next img { width: 64px; height: 86px; }
    .hero-clock { width: 100%; text-align: left; }
    .hero-clock span { font-size: 30px; }
  }
  /* small charts */
  .ring { display: flex; flex-direction: column; align-items: center; flex: none; }
  .ring svg { display: block; }
  .ring-sub { font-size: 9.5px; letter-spacing: 1px; color: var(--secondary-text-color); margin-top: 2px; text-align: center; }
  .ring-row { display: flex; gap: 14px; align-items: center; }
  .ring-row .grid { flex: 1; }
  .hbar { display: grid; grid-template-columns: minmax(80px, 2fr) 3fr minmax(60px, auto); gap: 8px; align-items: center; font-size: 12px; padding: 4px 0; }
  .hbar-track { height: 8px; border-radius: 4px; background: #8883; overflow: hidden; }
  .hbar-track span { display: block; height: 100%; border-radius: 4px; }
  .hbar-val { text-align: right; white-space: nowrap; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .stack { display: flex; height: 12px; border-radius: 6px; overflow: hidden; margin-top: 10px; gap: 2px; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; margin-top: 6px; }
  .heat { display: grid; gap: 4px; margin-top: 8px; font-size: 12px; }
  .heat div { padding: 7px 4px; border-radius: 8px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
  .heat .hl { text-align: left; font-weight: 600; color: var(--secondary-text-color); background: none; padding-left: 0; }
  .dual { display: flex; gap: 10px; align-items: center; margin-top: 5px; }
  .dual-bars { position: relative; flex: 1; height: 14px; border-radius: 5px; background: #8882; overflow: hidden; }
  .dual-bars span { position: absolute; left: 0; top: 0; height: 50%; }
  .dual-paid { background: #78909c99; }
  .dual-worth { top: 50% !important; }
  .dual-txt { flex: none; font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .warn { margin-top: 10px; padding: 8px 10px; border-radius: 10px; background: #fb8c0022; border: 1px solid #fb8c0077; font-size: 12px; line-height: 1.7; }
  /* the sales tape */
  .tape { display: flex; align-items: center; gap: 12px; margin: 8px 0 2px; }
  .tape-tag { flex: none; font-size: 10px; letter-spacing: 2px; font-weight: 800; color: var(--secondary-text-color); line-height: 1.2; }
  .tape-tag small { display: block; font-size: 10px; letter-spacing: 0; font-weight: 500; text-transform: none; }
  .tape-win { flex: 1; min-width: 0; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent); mask-image: linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent); }
  .tape-run { display: flex; width: max-content; animation: tape calc(var(--n, 20) * 3.4s) linear infinite; }
  .tape-win:hover .tape-run { animation-play-state: paused; }
  @keyframes tape { to { transform: translateX(-50%); } }
  .tp { white-space: nowrap; text-decoration: none; color: var(--primary-text-color); font-size: 13px; font-variant-numeric: tabular-nums; margin-right: 28px; }
  .tp:hover { text-decoration: underline; }
  .tp small { color: var(--secondary-text-color); margin-left: 6px; font-size: 11px; }
  @media (prefers-reduced-motion: reduce) { .tape-run { animation: none; } .tape-win { overflow-x: auto; -webkit-mask-image: none; mask-image: none; } }
  /* the board */
  .board { margin-top: 10px; padding: 10px 12px 10px; border-radius: 14px; border: 1px solid var(--divider-color);
           background: color-mix(in srgb, var(--card-background-color) 90%, #000); }
  .bhead { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px 12px; margin-bottom: 4px; }
  .bhead .row { margin-top: 0; }
  .brow { display: grid; grid-template-columns: 76px 64px minmax(0, 1fr) 64px 70px 92px 104px auto; gap: 0 10px; align-items: center; }
  .bnums { display: contents; }
  .brow { padding: 8px 12px 8px 9px; margin: 0 -12px; border-top: 1px solid var(--divider-color); border-left: 3px solid transparent; }
  .bact:empty { display: none; }
  .brow.soon { border-left-color: #e53935; background: linear-gradient(90deg, #e5393518, transparent 45%); }
  .brow.need { background: linear-gradient(90deg, #ff910018, transparent 45%); }
  .bclock, .bnum { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
  .bclock { font-size: 15px; font-weight: 800; letter-spacing: .3px; white-space: nowrap; }
  .bwhen { font-size: 12.5px; line-height: 1.2; white-space: nowrap; }
  .bwhen small, .bcard small, .bnum small { display: block; font-size: 10px; color: var(--secondary-text-color); }
  .bnum small { font-size: 8.5px; letter-spacing: 1.5px; font-weight: 700; font-family: inherit; }
  .bcard { min-width: 0; }
  .bcard .title { display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bcard small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bnum { font-size: 13px; font-weight: 600; white-space: nowrap; }
  .bnum b { font-size: 11px; }
  .bstate { font-size: 9.5px; letter-spacing: 1.5px; font-weight: 800; color: var(--c); text-align: center; white-space: nowrap; padding: 4px 6px; border-radius: 6px;
            border: 1px solid color-mix(in srgb, var(--c) 55%, transparent); background: color-mix(in srgb, var(--c) 14%, transparent); }
  .brow.need .bstate { animation: blink 1.3s steps(2, start) infinite; }
  @keyframes blink { to { opacity: .3; } }
  .bact { display: flex; gap: 4px; justify-content: flex-end; }
  .bact .btn { padding: 4px 8px; white-space: nowrap; }
  .bfoot { font-size: 12px; padding-top: 10px; color: var(--secondary-text-color); line-height: 1.5; }
  .bfoot b { color: var(--primary-text-color); }
  @media (max-width: 760px) {
    .brow { grid-template-columns: 78px minmax(0, 1fr) auto; grid-template-areas: "clock card state" "when nums nums" "act act act"; gap: 5px 8px; }
    .bact { justify-content: flex-start; }
    .bclock { grid-area: clock; } .bwhen { grid-area: when; } .bcard { grid-area: card; } .bstate { grid-area: state; } .bact { grid-area: act; }
    .bnums { grid-area: nums; display: flex; gap: 12px; }
    .bnum { font-size: 12px; }
    .bwhen { font-size: 12px; } .bwhen small { display: inline; margin-left: 3px; }
  }
  @media (prefers-reduced-motion: reduce) { .brow.need .bstate { animation: none; } }
  /* steal map and growth chart */
  .maphead { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px 12px; margin-top: 8px; }
  .maphead .row { margin-top: 0; }
  svg.map, svg.chart { display: block; width: 100%; height: auto; margin-top: 6px; color: var(--secondary-text-color); font-family: inherit; }
  svg.map text, svg.chart text { fill: currentColor; }
  svg.map .dot { cursor: pointer; }
  svg.map .dot:hover circle:last-child { stroke: var(--primary-text-color); stroke-width: 2.5; }
  svg.map .dot.jp circle:last-child { animation: dotpulse 1.2s ease-in-out infinite; }
  @keyframes dotpulse { 50% { stroke: #d50000; stroke-width: 5; } }
  @media (prefers-reduced-motion: reduce) { svg.map .dot.jp circle:last-child { animation: none; } }
  input[data-search] { width: 100%; box-sizing: border-box; padding: 9px 12px; border-radius: 10px; border: 1px solid var(--divider-color);
         background: var(--card-background-color); color: var(--primary-text-color); font-size: 14px; }
`;

// --------------------------------------------------------------------- card
class SnipeHuntCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode: 'open'});
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><div id="body"></div></ha-card>`;
    this.body = this.shadowRoot.getElementById('body');
    this.query = '';
    this.shadowRoot.addEventListener('click', ev => this.clicked(ev));
    this.shadowRoot.addEventListener('change', ev => {   // a <select data-do="set"> chooses like a chip
      const el = ev.target;
      if (el.matches('select[data-do="set"]')) { scope = this.feed.entry || ''; remember(el.dataset.key, el.value); this.feed.redraw(); }
    });
    this.shadowRoot.addEventListener('input', ev => {
      if (ev.target.matches('input[data-search]')) this.find(ev.target);
      if (ev.target.matches('input[data-fb-note]')) fb.note = ev.target.value;
    });
  }

  static getStubConfig() { return {panel: 'summary'}; }
  static getConfigForm() {
    return {
      schema: [
        {name: 'panel', required: true, selector: {select: {mode: 'dropdown', options: Object.entries(PANELS).map(([value, p]) => ({value, label: p[0]}))}}},
        {name: 'title', selector: {text: {}}},
        {name: 'entry', selector: {config_entry: {integration: DOMAIN}}},
        {name: 'accent', selector: {text: {}}},
        {name: 'picks_per_page', selector: {number: {min: 5, max: 200, step: 5, mode: 'box'}}},
      ],
      computeLabel: s => ({panel: 'Panel', title: 'Title (optional)', entry: 'Bot (when more than one is set up)', accent: 'Accent colour, e.g. #c41e3a (optional)', picks_per_page: 'Picks before "Show all" (Every live pick panel)'}[s.name]),
    };
  }

  setConfig(config) {
    if (!config || !PANELS[config.panel]) {
      throw new Error('Set panel to one of: ' + Object.keys(PANELS).join(', '));
    }
    this.config = config;
    this._html = null;
    const feed = feedFor(config.entry);
    if (this.feed !== feed) {   // the card moved to another bot
      if (this.feed) this.feed.cards.delete(this);
      this.feed = feed;
      if (this.isConnected) { feed.cards.add(this); if (this._hass) feed.start(this._hass); }
    }
    this.draw();
  }

  set hass(hass) {
    this._hass = hass;
    if (this.feed) this.feed.start(hass);
  }

  connectedCallback() {
    if (!this.feed) this.feed = feedFor(this.config && this.config.entry);
    this.feed.cards.add(this);
    liveCards.add(this);
    if (this._hass) this.feed.start(this._hass);
    clearInterval(this.timer);
    this.timer = setInterval(() => { if (this.config && PANELS[this.config.panel][1]) this.draw(); }, 30000);
    clearInterval(this.ticker);
    this.ticker = setInterval(() => this.tick(), 1000);
    this.draw();
  }

  disconnectedCallback() {
    this.feed.cards.delete(this);
    liveCards.delete(this);
    if (!liveCards.size) removeTakeover();   // left the dashboard
    clearInterval(this.timer);
    clearInterval(this.ticker);
  }

  // Every countdown on the card moves once a second; when one reaches zero the
  // panel is drawn again so the ended auction steps aside.
  tick() {
    let ended = false;
    this.body.querySelectorAll('[data-end]').forEach(el => {
      const ms = msLeft(el.dataset.end);
      if (ms <= 0 && el.dataset.ended == null) { el.dataset.ended = '1'; ended = true; }
      if (el.dataset.big != null) { el.textContent = bigClock(ms); el.parentElement.style.color = clockColor(ms); }
      else if (el.dataset.text != null) { el.textContent = clockTxt(ms); el.style.color = clockColor(ms); }
      else { el.textContent = '⏱ ' + clockTxt(ms); el.style.background = clockColor(ms); }
    });
    if (ended) this.draw();
  }

  getCardSize() { return 4; }
  getGridOptions() { return {columns: 'full', rows: 'auto', min_columns: 6}; }

  draw() {
    if (!this.config || !this.isConnected) return;
    const title = this.config.title ? `<div style="font-size:16px;font-weight:600;padding-top:10px">${esc(this.config.title)}</div>` : '';
    if (!this.feed || !this.feed.data) {
      this._html = null;
      this.body.innerHTML = title + empty(esc((this.feed && this.feed.error) || 'Waiting for the bot…'));
      return;
    }
    if (this.shadowRoot.querySelector('[data-armed]')) return;   // mid two-tap confirm
    scope = this.feed.entry || '';
    const typing = this.shadowRoot.activeElement;
    if (typing && typing.matches('input[data-fb-note]')) return;   // mid "bad pick" note
    const search = this.shadowRoot.activeElement && this.shadowRoot.activeElement.matches('input[data-search]')
      ? this.shadowRoot.activeElement : null;
    const caret = search ? [search.selectionStart, search.selectionEnd] : null;
    let html;
    try {
      const ctx = context(this);
      if (this.config.takeover !== false && (this.feed.options || {}).takeover !== false) {
        try { takeover(ctx); } catch (e) { /* the panel still draws */ }
      }
      html = PANELS[this.config.panel][2](ctx);
    } catch (err) {
      html = empty('This panel hit an error: ' + esc(err.message));
    }
    const out = title + html;
    if (out === this._html && this.body.firstChild) return;   // nothing changed: leave the DOM be
    this._html = out;
    this.body.innerHTML = out;
    const input = this.body.querySelector('input[data-search]');
    if (input) {
      this.find(input);
      if (caret) { input.focus(); try { input.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not a text box */ } }
    }
  }

  find(input) {
    this.query = input.value;
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    this.body.querySelectorAll('[data-find]').forEach(row => {
      const hit = !q || row.dataset.find.includes(q);
      row.style.display = hit ? 'flex' : 'none';
      shown += hit;
    });
    const found = this.body.querySelector('[data-found]');
    if (found) found.textContent = shown;
  }

  toast(message) {
    this.dispatchEvent(new CustomEvent('hass-notification', {detail: {message}, bubbles: true, composed: true}));
  }

  clicked(ev) {
    // Open links the way Home Assistant's own "url" action does. A plain
    // target=_blank link does nothing in some of the phone apps' web views.
    const link = ev.target.closest('a[href]');
    if (link && !ev.defaultPrevented && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
      ev.preventDefault();
      window.open(link.href, '_blank', 'noopener');
      return;
    }
    const el = ev.target.closest('[data-do]');
    if (el && el.tagName === 'SELECT') return;   // its change event chooses (see the constructor)
    if (!el) return;
    ev.preventDefault();
    if (el.dataset.do === 'copy') return this.copy(el);
    if (el.dataset.do === 'snipe') return this.snipe(el);
    if (el.dataset.do === 'card') return openSheet(((this.feed.data || {}).cards || []).find(x => String(x.id) === el.dataset.value));
    if (el.dataset.do === 'nav') {
      const base = location.pathname.split('/').slice(0, 2).join('/');
      history.pushState(null, '', base + '/' + el.dataset.path);
      window.dispatchEvent(new CustomEvent('location-changed', {detail: {replace: false}}));
      return;
    }
    if (el.dataset.do === 'set') {
      scope = this.feed.entry || '';
      remember(el.dataset.key, el.dataset.value);
      return this.feed.redraw();
    }
    if (el.dataset.do === 'fb') {
      fb.open = el.dataset.item && fb.open !== el.dataset.item ? el.dataset.item : null;
      fb.reason = 'overvalued'; fb.note = '';
      return this.feed.redraw();
    }
    if (el.dataset.do === 'fb-reason') { fb.reason = el.dataset.value; return this.feed.redraw(); }
    if (el.dataset.do === 'fb-send') {
      const note = el.closest('.fb').querySelector('input[data-fb-note]');
      const data = {item_id: el.dataset.item, reason: fb.reason, note: (note ? note.value : fb.note).slice(0, 200)};
      fb.open = null; fb.note = '';
      const row = el.closest('[data-row]'); if (row) row.style.display = 'none';
      this._hass.callWS({type: DOMAIN + '/action', action: 'feedback', data, ...this.who()})
        .then(res => { this.toast(res.message); this.feed.redraw(); })
        .catch(err => { this.toast((err && err.message) || 'That did not work'); this.feed.redraw(); });
      return;
    }
    if (el.dataset.confirm && el.dataset.armed == null) {
      const label = el.textContent;
      el.dataset.armed = '1';
      el.textContent = el.dataset.confirm;
      setTimeout(() => { if (el.dataset.armed != null) { delete el.dataset.armed; if (el.isConnected) el.textContent = label; this.draw(); } }, 4000);
      return;
    }
    delete el.dataset.armed;
    el.classList.add('busy');
    if (el.dataset.busy) el.textContent = el.dataset.busy;
    if (el.hasAttribute('data-hide')) { const row = el.closest('[data-row]'); if (row) row.style.display = 'none'; }
    const {action, ...data} = JSON.parse(el.dataset.payload);
    this._hass.callWS({type: DOMAIN + '/action', action, data, ...this.who()})
      .then(res => { if (action !== 'skip') this.toast(res.message); this.feed.redraw(); })
      .catch(err => { this.toast((err && err.message) || 'That did not work'); this.feed.redraw(); });
  }

  // Which bot this card's buttons talk to, when more than one is set up.
  who() { return this.feed && this.feed.entry ? {entry: this.feed.entry} : {}; }

  copy(el) {
    copyText(el.dataset.text);
    const old = el.textContent;
    el.textContent = 'Copied ✓';
    setTimeout(() => { if (el.isConnected) el.textContent = old; }, 1300);
  }

  // First tap: item # to the clipboard and Gixen opens in a new tab. If there is
  // a max, the same button then copies it, for the second box on Gixen's form.
  snipe(el) {
    if (el.dataset.stage === 'max') {
      copyText(el.dataset.max);
      el.textContent = 'Max copied ✓';
      delete el.dataset.stage;
      setTimeout(() => { if (el.isConnected) el.textContent = el.dataset.label; }, 2500);
      return;
    }
    copyText(el.dataset.text);
    window.open(GIXEN_URL, '_blank', 'noopener');
    el.dataset.label = el.dataset.label || el.textContent;
    if (el.dataset.max) {
      el.dataset.stage = 'max';
      el.textContent = 'Copy max ' + el.dataset.max;
      this.toast(`Item # ${el.dataset.text} copied: paste it in Gixen. Your max is $${el.dataset.max}; tap the button again to copy it.`);
    } else {
      el.textContent = 'Item # copied ✓';
      this.toast(`Item # ${el.dataset.text} copied: paste it in Gixen.`);
      setTimeout(() => { if (el.isConnected) el.textContent = el.dataset.label; }, 2500);
    }
  }
}
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'snipe-hunt-card', name: 'Snipe Hunt',
  description: 'One panel of the Snipe Hunt card bot: picks, snipes, the collection or bot health.',
});

// ----------------------------------------------------------------- strategy
// dashboard:  strategy: {type: custom:snipe-hunt}
// Optional:   tabs: [tonight, steals, collection, stats]   (overrides the integration option)
//             entry: Monday Hunt   (which bot, by name or config entry id, when several are set up)
const panelFor = entry => (name, extra) => ({type: 'custom:snipe-hunt-card', panel: name, ...(entry ? {entry} : {}), ...extra});
const heading = (text, icon, entity) => ({
  type: 'heading', heading: text, icon, heading_style: 'title',
  ...(entity ? {badges: [{type: 'entity', entity}]} : {}),
});
const section = (...cards) => ({type: 'grid', cards: cards.filter(Boolean)});

class SnipeHuntStrategy {
  static async generate(config, hass) {
    const entry = config.entry ? String(config.entry).trim() : '';
    const panel = panelFor(entry);
    let options = {};
    try { options = await hass.callWS({type: DOMAIN + '/options', ...(entry ? {entry} : {})}); } catch (e) { /* cards say why */ }
    // Entity ids can be renamed, so find the integration's entities by key, and
    // with several bots set up, only this bot's: the ones on its device.
    const devices = options.entry_id ? Object.values(hass.devices || {}).filter(d => (d.config_entries || []).includes(options.entry_id)).map(d => d.id) : [];
    const mine = e => e.platform === DOMAIN && (!devices.length || devices.includes(e.device_id));
    const id = (domain, key) => Object.values(hass.entities || {}).find(e =>
      mine(e) && e.translation_key === key && e.entity_id.startsWith(domain + '.'))?.entity_id;
    const botName = options.name || 'Snipe Hunt';
    const gixen = options.gixen_account !== false;   // a bot with no Gixen account gets no snipe panels
    const graph = (hours, keys, title) => {
      const entities = keys.map(k => id('sensor', k)).filter(Boolean);
      return entities.length ? {type: 'history-graph', hours_to_show: hours, entities, ...(title ? {title} : {}), grid_options: {columns: 'full'}} : null;
    };
    const budget = id('number', 'monthly_budget');
    const VIEWS = {
      tonight: {title: 'Tonight', path: 'tonight', icon: 'mdi:weather-night', sections: [
        {...section(panel('hero')), column_span: 3},
        {...section(panel('tape')), column_span: 3},
        {...section(heading('The board', 'mdi:clock-fast'), panel('board')), column_span: 3},
        {...section(heading('Buy now, think later', 'mdi:lightning-bolt'), panel('buy_now')), column_span: 3},
        {...section(heading('Ending soonest', 'mdi:timer-sand'), panel('ending')), column_span: 3},
        section(heading('Right now', 'mdi:flash'), panel('summary'), heading('Top pick', 'mdi:star-circle'), panel('top_pick')),
        {...section(heading('To do', 'mdi:checkbox-marked-circle-outline', id('sensor', 'need_snipe')), panel('todo')), column_span: 2},
        section(...(gixen ? [heading('Your snipes ending today', 'mdi:target', id('sensor', 'gixen_snipes')), panel('snipes_today')] : []),
          heading('To pay', 'mdi:credit-card-outline', id('sensor', 'to_pay')), panel('pay')),
      ]},
      steals: {title: 'Steals', path: 'steals', icon: 'mdi:cards-playing-outline', sections: [
        {...section(heading('Steals', 'mdi:cards-playing-outline', id('sensor', 'live_picks')), panel('steals')), column_span: 3},
        {...section(heading('Case hits & priority cards', 'mdi:target-variant'), panel('priority')), column_span: 3},
        {...section(heading('Lowball offers', 'mdi:hand-coin-outline'), panel('offers')), column_span: 3},
      ]},
      catalog: {title: 'Catalog', path: 'catalog', icon: 'mdi:book-open-variant', sections: [
        {...section(heading('Every Walker card', 'mdi:book-open-variant'), panel('catalog')), column_span: 3},
      ]},
      learn: {title: 'Learn', path: 'learn', icon: 'mdi:school-outline', sections: [
        {...section(heading('Walker card school', 'mdi:school-outline'), panel('learn')), column_span: 2},
        section(heading('Case hits & priority cards', 'mdi:target-variant'), panel('priority')),
      ]},
      collection: {title: 'Collection', path: 'collection', icon: 'mdi:cards', sections: [
        section(heading('Collection', 'mdi:cards', id('sensor', 'collection')), panel('collection'),
          budget ? {type: 'tile', entity: budget, name: 'Monthly budget', features: [{type: 'numeric-input', style: 'buttons'}], features_position: 'bottom', grid_options: {columns: 'full'}} : null,
          graph(240, ['month_spend'], 'Spend this month')),
        section(heading('Incoming', 'mdi:package-variant-closed', id('sensor', 'in_transit')), panel('incoming')),
        section(heading("What's missing", 'mdi:star-box-multiple'), panel('missing')),
        {...section(heading('Gaps in the collection', 'mdi:puzzle-outline'), panel('gaps')), column_span: 2},
        section(heading('Want list', 'mdi:puzzle', id('sensor', 'want_list')), panel('wantlist')),
      ]},
      binder: {title: 'Binder', path: 'binder', icon: 'mdi:view-grid', sections: [
        {...section(heading('The binder', 'mdi:view-grid'), panel('binder')), column_span: 3},
      ]},
      stats: {title: 'Stats & bot', path: 'stats', icon: 'mdi:chart-box-outline', sections: [
        section(heading('How the calls turned out', 'mdi:bullseye-arrow'), panel('calls'), heading('Where steals happen', 'mdi:map-marker-radius'), panel('closes')),
        section(heading('What the collection is worth', 'mdi:diamond-stone'), panel('worth'), heading('How it grew', 'mdi:chart-areaspline'), panel('growth'), heading('Market trends', 'mdi:trending-up'), panel('trends')),
        section(heading('Big money', 'mdi:cash-multiple'), panel('whales')),
        section(heading('Savings', 'mdi:piggy-bank-outline'), panel('savings')),
        section(heading('Hall of Fame', 'mdi:trophy-variant'), panel('hall'), heading('Brag board', 'mdi:trophy-award'), panel('brag')),
        section(heading('Snipe record', 'mdi:trophy', id('sensor', 'win_rate')), panel('record'),
          ...(id('calendar', 'auctions') ? [heading('Auction calendar', 'mdi:gavel'),
            {type: 'calendar', entities: [id('calendar', 'auctions')], initial_view: 'listWeek', grid_options: {columns: 'full'}}] : [])),
        gixen ? section(heading('Every Gixen snipe', 'mdi:target', id('sensor', 'gixen_snipes')), panel('gixen')) : null,
        section(heading('Sold prices', 'mdi:gavel'), panel('sold'), heading('Price history', 'mdi:chart-line'), panel('history')),
        section(heading('Bot health', 'mdi:robot-outline'), panel('health'), heading('Last 3 days', 'mdi:chart-line'), graph(72, ['listings', 'live_picks']), graph(72, ['status'])),
        section(heading('Settings', 'mdi:tune'), {
          type: 'entities', grid_options: {columns: 'full'},
          entities: [['switch', 'alerts_enabled'], ['switch', 'alert_fire'], ['switch', 'alert_green'], ['switch', 'alert_cheap_yellow'],
            ['number', 'yellow_max_total'], ['number', 'alert_min_stars'], ['number', 'price_lookups'], ['switch', 'quiet_hours'], ['time', 'quiet_start'], ['time', 'quiet_end'], ['switch', 'bedtime_bundle'],
            ['number', 'urgent_hours'], ['number', 'need_snipe_hours'], ['number', 'monthly_budget'], ['switch', 'gixen_enabled'],
            ['number', 'gixen_relogin_minutes'], ['text', 'sellers'], ['text', 'extra_searches'], ['text', 'combined_ship_sellers'], ['switch', 'self_tuning']]
            .map(([domain, key]) => id(domain, key))
            // A setting the bot doesn't expose is unavailable; leave it off the list.
            .filter(e => e && hass.states && hass.states[e] && hass.states[e].state !== 'unavailable')
            .map(e => ({entity: e, name: String(hass.states[e].attributes.friendly_name || e).replace(botName + ' ', '')})),
        }),
      ]},
    };
    // Tab names from before the 2.12 redesign, as an older integration may still send them.
    const OLD = {today: 'tonight', picks: 'steals', gixen: 'stats', bot: 'stats'};
    const asked = config.tabs || options.tabs || Object.keys(VIEWS);
    const upgraded = asked.join(',') === 'today,picks,gixen,collection,bot' ? Object.keys(VIEWS)
      : [...new Set(asked.map(t => OLD[t] || t))];
    // Learn came after the tabs option: it shows even when saved tabs predate it.
    if (!upgraded.includes('learn')) upgraded.push('learn');
    if (!upgraded.includes('catalog')) upgraded.push('catalog');
    if (!upgraded.includes('binder')) upgraded.splice(upgraded.includes('collection') ? upgraded.indexOf('collection') + 1 : upgraded.length, 0, 'binder');
    const tabs = upgraded.filter(t => VIEWS[t]);
    return {
      title: config.title || botName,
      views: (tabs.length ? tabs : Object.keys(VIEWS)).map(t => ({type: 'sections', max_columns: 3, ...VIEWS[t], sections: VIEWS[t].sections.filter(Boolean)})),
    };
  }
}
class SnipeHuntStrategyElement extends HTMLElement {
  static async generate(config, hass) { return SnipeHuntStrategy.generate(config, hass); }
}

// Home Assistant swaps in its own element registry while it starts, and this
// file loads before that. Anything defined too early is lost, so wait until
// Home Assistant's own root element exists, then register on that registry.
const register = () => {
  if (!customElements.get('home-assistant')) return setTimeout(register, 40);
  if (!customElements.get('snipe-hunt-card')) customElements.define('snipe-hunt-card', SnipeHuntCard);
  if (!customElements.get('ll-strategy-dashboard-snipe-hunt')) customElements.define('ll-strategy-dashboard-snipe-hunt', SnipeHuntStrategyElement);
};
register();
