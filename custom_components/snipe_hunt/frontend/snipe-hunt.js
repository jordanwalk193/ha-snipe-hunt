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
const feed = {
  data: null, options: {}, ok: true, error: null,
  cards: new Set(), connection: null, started: false,
  start(hass) {
    if (this.started && this.connection === hass.connection) return;
    this.started = true;
    this.connection = hass.connection;
    hass.connection.subscribeMessage(msg => {
      this.data = msg.snapshot; this.options = msg.options || {}; this.ok = msg.ok; this.error = null;
      this.redraw();
    }, {type: DOMAIN + '/subscribe'}).catch(err => {
      this.error = (err && err.message) || 'Snipe Hunt is not set up';
      this.started = false;
      this.redraw();
      setTimeout(() => this.cards.size && this.start(hass), 15000);
    });
  },
  redraw() { this.cards.forEach(card => card.draw()); },
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
const store = (key, def) => { try { return localStorage.getItem('ws_' + key) ?? def; } catch (e) { return def; } };
const arg = o => esc(JSON.stringify(o));

const cap = text => `<div class="cap">${text}</div>`;
const pill = (text, color) => `<span class="pill" style="background:${color}">${text}</span>`;
const empty = text => `<div class="muted empty">${text}</div>`;
const stat = (label, value, color, icon) => `<div class="stat" style="background:${color}22;border-color:${color}55">
  <div class="stat-icon">${icon}</div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
const grid = (cols, cells) => `<div class="grid" style="grid-template-columns:repeat(${cols},1fr)">${cells.join('')}</div>`;
const tint = color => color ? `background:${color};color:#fff` : '';
const linkBtn = (label, url, color) => `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener" style="${tint(color)}">${label}</a>`;
const copyBtn = (label, text) => `<span class="btn" role="button" data-do="copy" data-text="${esc(text)}">${label}</span>`;
// A button that asks the bot to do something. `confirm` makes it a two-tap
// button; `hide` removes the row it sits in straight away.
const act = (label, data, o = {}) => `<span class="btn" role="button" data-do="act" data-payload="${arg(data)}"${o.busy ? ` data-busy="${esc(o.busy)}"` : ''}${o.confirm ? ` data-confirm="${esc(o.confirm)}"` : ''}${o.hide ? ' data-hide' : ''} style="${tint(o.color)}">${label}</span>`;
const setBtn = (label, key, value, color) => `<span class="btn" role="button" data-do="set" data-key="${esc(key)}" data-value="${esc(value)}" style="${tint(color)}">${label}</span>`;
const chips = (key, def, options) => `<div class="row">` + options.map(([value, label]) =>
  `<span class="btn${store(key, def) === value ? ' on' : ''}" role="button" data-do="set" data-key="${esc(key)}" data-value="${esc(value)}">${label}</span>`).join('') + `</div>`;
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
const steals = picks => picks
  .filter(p => p.deal >= 2 && !(p.is_auction && p.max != null && Number(p.bid_now ?? p.price) > Number(p.max)))
  .sort((x, y) => y.deal - x.deal || !EDGE[x.edge] - !EDGE[y.edge] || (TIER_RANK[x.tier] ?? 3) - (TIER_RANK[y.tier] ?? 3) || saved(y) - saved(x));

// What every panel gets: the snapshot plus a few views of it.
const context = (card) => {
  const d = feed.data, s = d.settings || {};
  const gixen = d.gixen || {};
  const gixenOn = !!gixen.available;
  const picks = (d.picks || []).filter(p => !(p.is_auction && p.end_time && msLeft(p.end_time) <= 0));
  const windowMs = (Number(s.need_snipe_hours) || 24) * HOUR;
  const soon = picks.filter(p => p.is_auction && p.end_time && msLeft(p.end_time) < windowMs && GOOD.includes(p.tier));
  return {
    d, s, card, picks, gixen, gixenOn, windowMs,
    gixenOff: d.gixen == null,
    hours: Number(s.need_snipe_hours) || 24,
    cards: d.cards || [],
    need: (gixenOn ? soon.filter(p => p.snipe == null) : soon).sort((x, y) => x.end_time < y.end_time ? -1 : 1),
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
const sniped = p => {
  if (p.snipe == null) return '';
  const over = p.bid_now != null && Number(p.bid_now) >= Number(p.snipe);
  return ' ' + pill((over ? '📈 over your ' : '🎯 ') + cents(p.snipe), over ? '#e53935' : '#6a1b9a');
};
const thumb = (p, w, h) => {
  const t = TIER[p.tier] || ['•', '#546e7a'];
  return `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="flex:none">` + (p.image
    ? `<img src="${esc(p.image)}" loading="lazy" style="width:${w}px;height:${h}px;object-fit:cover;border-radius:6px;display:block">`
    : `<div style="width:${w}px;height:${h}px;border-radius:6px;background:${t[1]}33;display:flex;align-items:center;justify-content:center;font-size:26px">🃏</div>`) + `</a>`;
};
const pickButtons = p => `<div class="row tight">
  ${p.is_auction
    ? copyBtn('Copy item #', p.item_id) + (p.max == null ? '' : copyBtn('Copy max ' + cents(p.max), cents(p.max))) + (p.win == null ? '' : copyBtn('Copy win ' + cents(p.win), cents(p.win))) + (p.snipe == null ? linkBtn('Gixen ↗', GIXEN_URL, '#6a1b9a') : '')
    : linkBtn(p.best_offer ? 'Make offer ↗' : 'Buy ↗', p.url, '#1e88e5')}
  ${act('Skip', {action: 'skip', item_id: p.item_id}, {hide: true})}
</div>`;
// The second number next to the max: a bid at about the going rate, for a card
// you would rather win than steal. Only the bot's newer versions send it.
const winTxt = p => p.win == null ? '' : ` · <span title="About the going rate less shipping: a fair buy, not a steal">to win ≈ <b>${cents(p.win)}</b></span>`;
const lastSold = p => p.last_sold ? `<div class="muted" style="font-size:12px;margin-top:2px">🔨 Same card last sold for <b style="color:var(--primary-text-color)">${money(p.last_sold.total)}</b> delivered on ${new Date(p.last_sold.at + 'T12:00').toLocaleDateString([], {month: 'short', day: 'numeric'})}${p.last_sold.n > 1 ? ' · ' + p.last_sold.n + ' sales on record' : ''}</div>` : '';
const fastTag = p => p.fast ? pill('⚡ Fast lane', '#f57c00') + ' ' : '';
// A small line chart of prices, oldest first.
const spark = (values, color) => {
  if (!values || values.length < 2) return '';
  const lo = Math.min(...values), hi = Math.max(...values), w = 96, h = 28;
  const pts = values.map((v, i) => [(i / (values.length - 1) * (w - 6) + 3).toFixed(1), (h - 4 - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (h - 8)).toFixed(1)]);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="flex:none"><polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p => p.join(',')).join(' ')}"/><circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3" fill="${color}"/></svg>`;
};
const pickRow = p => pickLine(p, '', '');
const pickLine = (p, lead, extra) => {
  const t = TIER[p.tier] || ['•', '#546e7a'];
  const max = p.max == null ? '' : ` · <b>Max ${cents(p.max)}</b> <span class="muted">(${esc(p.max_basis || 'estimate')})</span>`;
  const now = p.bid_now != null && Number(p.bid_now) !== Number(p.price) ? ` · <b>now ${money(p.bid_now)}</b>` : '';
  const ends = p.is_auction && p.end_time ? ` · ends ${when(p.end_time)}` : '';
  return `<div data-row class="line" style="display:flex;gap:12px;align-items:flex-start;padding:10px 0">
    ${lead}${thumb(p, 54, 74)}
    <div style="flex:1;min-width:0">
      <div style="display:flex;gap:8px;justify-content:space-between;align-items:flex-start">
        <a class="title" href="${esc(p.url)}" target="_blank" rel="noopener">${t[0]} ${esc(p.card)}</a>
        <div style="text-align:right;flex:none">${badge(p)}${sniped(p)}</div>
      </div>
      <div style="font-size:13px;margin-top:3px">${edge(p)}${fastTag(p)}${money(p.price)} + ${shipTxt(p)}${now}${max}${winTxt(p)}</div>
      ${p.deal ? `<div style="font-size:12px;margin-top:2px">${deal(p)}${extra}</div>` : ''}
      <div class="muted" style="font-size:12px;margin-top:2px;line-height:1.3">${esc(p.why)}</div>
      ${lastSold(p)}
      <div class="muted" style="font-size:11px;margin-top:2px">${esc(p.seller)}${ends} · eBay item <b style="color:var(--primary-text-color);user-select:all;-webkit-user-select:all">${esc(p.item_id)}</b></div>
      ${pickButtons(p)}
    </div></div>`;
};
const snipeRow = s => {
  const diff = s.bot_max != null && s.max_bid != null ? Number(s.max_bid) - Number(s.bot_max) : null;
  const note = s.bot_max == null ? '' : ` · bot max ${cents(s.bot_max)}` + (diff > 0.005 ? ' (yours is higher)' : (diff < -0.005 ? ' (yours is lower)' : ''));
  const state = s.outbid ? pill('📈 over your max', '#e53935') : pill('⏱ ' + left(s.end_time), msLeft(s.end_time) < 2 * HOUR ? '#fb8c00' : '#546e7a');
  return `<div data-row class="line" style="padding:8px 0">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
      <a class="title" href="${esc(s.url)}" target="_blank" rel="noopener" style="min-width:0;${s.outbid ? 'opacity:.65' : ''}">${(TIER[s.tier] || [''])[0]} ${esc(s.title || s.item_id)}</a><span style="flex:none">${state}</span></div>
    <div class="muted" style="font-size:12px;margin-top:2px"><b style="color:var(--primary-text-color)">Snipe ${s.max_bid == null ? '?' : cents(s.max_bid)}</b> · bid now ${s.current_bid == null ? '?' : cents(s.current_bid)}${note}</div>
    <div class="muted" style="font-size:11px">${esc(s.seller)} · ${s.outbid ? 'ends in ' + left(s.end_time) : 'ends ' + when(s.end_time)} · ${esc(s.item_id)}</div>
    ${s.outbid ? `<div class="row tight">${copyBtn('Copy item #', s.item_id)}${s.bot_max != null && Number(s.bot_max) > Number(s.current_bid) ? copyBtn('Copy bot max ' + cents(s.bot_max), cents(s.bot_max)) : ''}${linkBtn('Gixen ↗', GIXEN_URL, '#6a1b9a')}</div>` : ''}
  </div>`;
};
const gixenDown = c => c.gixenOff
  ? `<div style="padding-top:12px"><b>Gixen reading is off.</b><div class="muted" style="font-size:13px;margin-top:4px">Turn on "Read Gixen snipes" in the Snipe Hunt settings to see your snipes here.</div></div>`
  : `<div style="padding-top:12px"><b>Can't read Gixen yet.</b><div class="muted" style="font-size:13px;margin:4px 0 8px">${esc(c.gixen.problem || 'Waiting for the first read')}.</div>${act('Sign in to Gixen now', {action: 'gixen_refresh', login: true}, {busy: 'Signing in…', color: '#6a1b9a'})}</div>`;
const gixenStale = g => `<div class="warn">List is from ${ago(g.read_at)}. ${esc(g.problem)}.<br>${act('Sign in now', {action: 'gixen_refresh', login: true}, {busy: 'Signing in…', color: '#6a1b9a'})} <span class="muted">This signs your browser out of Gixen.</span></div>`;
const searchBtn = c => c.d.status.searching ? pill('Searching eBay…', '#1e88e5') : act('Search eBay now', {action: 'search'}, {busy: 'Starting…', color: c.accent});

// ------------------------------------------------------------------- panels
// name: [label, redraw every 30 s for the countdowns?, draw]
const PANELS = {
  summary: ['Right now', true, c => {
    const a = c.d.status, pipe = c.d.pipeline;
    const over = c.snipes.filter(s => s.outbid);
    const color = {ok: '#43a047', stale: '#fb8c00', failing: '#e53935'}[a.state] || '#546e7a';
    const last = c.d.last_action || {};
    const fresh = last.at && Date.now() - new Date(last.at) < 10 * 60e3;
    return `<div style="padding-top:10px">` + (c.d.demo ? `<div class="warn" style="margin:0 0 10px">Demo mode: these cards, prices and sellers are made up, and the buttons change nothing.</div>` : '') + grid(4, [
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
      <span class="dot" style="background:${color}"></span>${a.listings} listings watched · ${c.picks.length} live picks · searched ${ago(a.last_search)}
      ${fresh ? `<br>${last.ok ? '✓' : '⚠️'} ${esc(last.message)}` : ''}
    </div></div>`;
  }],

  top_pick: ['Top pick', true, c => {
    // The best steal among the 🔥/🟢 picks, ones you haven't sniped first. A pick
    // rated one star (about the going rate) is never the top pick; a pick with
    // no rating at all, from an older bot, still can be.
    const good = c.picks.filter(x => GOOD.includes(x.tier));
    const ranked = [...steals(good), ...good.filter(x => x.deal == null)];
    const p = ranked.find(x => x.snipe == null) || ranked[0];
    if (!p) return empty(good.length
      ? 'Nothing live is a real steal right now: every 🔥 and 🟢 pick is close to its going rate. They are all on the Picks tab.'
      : 'No 🔥 or 🟢 picks are live right now. New ones land here within the hour.');
    const t = TIER[p.tier] || ['•', '#546e7a'];
    const gap = room(p);
    return `<div data-row style="display:flex;gap:16px;align-items:center;margin-top:10px;padding:14px;border-radius:16px;background:linear-gradient(135deg,${t[1]}55,transparent);border:1px solid ${t[1]}">
      ${p.image ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="flex:none;max-width:36%"><img src="${esc(p.image.replace('s-l225', 's-l500'))}" style="max-height:150px;max-width:100%;border-radius:8px;display:block"></a>` : ''}
      <div style="flex:1;min-width:0">
        <div class="muted" style="font-size:11px;letter-spacing:2px">TOP PICK · ${p.is_auction ? 'AUCTION' : 'BUY IT NOW'}</div>
        <a class="title" href="${esc(p.url)}" target="_blank" rel="noopener" style="display:block;font-size:19px;font-weight:700;margin:4px 0;line-height:1.2">${t[0]} ${esc(p.card)}</a>
        <div style="font-size:15px">${edge(p)}${fastTag(p)}${money(p.bid_now ?? p.price)} + ${shipTxt(p)} ${badge(p)}${sniped(p)}</div>
        ${p.max == null ? '' : `<div style="margin-top:6px;font-size:15px"><b>Max ${cents(p.max)}</b> <span class="muted">(${esc(p.max_basis || 'estimate')})${gap > 0 ? ' · ' + money(gap) + ' of room' : ''}</span>${winTxt(p)}</div>`}
        ${lastSold(p)}
        ${p.deal ? `<div style="font-size:13px;margin-top:4px">${deal(p)}</div>` : ''}
        <div class="muted" style="font-size:13px;margin-top:6px;line-height:1.3">${esc(p.why)}</div>
        <div class="muted" style="font-size:12px;margin-top:4px">${esc(p.seller)}${p.is_auction && p.end_time ? ' · ends ' + when(p.end_time) : ''} · eBay item <b style="color:var(--primary-text-color);user-select:all;-webkit-user-select:all">${esc(p.item_id)}</b></div>
        ${pickButtons(p)}
      </div></div>`;
  }],

  top_deals: ['Top 10 deals', true, c => {
    const top = steals(c.picks).slice(0, Number(c.card.config.count) || 10);
    if (!top.length) return empty('No live pick is 10% or more under its going rate right now.');
    return `<div class="muted" style="font-size:12px;padding:10px 0 6px">Best steal first: most deal stars, then 🔥 before 🟢 before 🟡, then the most dollars under the going rate.</div>` +
      top.map((p, i) => pickLine(p,
        `<div class="rank" style="${i < 3 ? 'background:' + c.accent + ';color:#fff' : ''}">${i + 1}</div>`,
        saved(p) >= 0.5 ? ` <b style="color:var(--primary-text-color);white-space:nowrap">· ${worth(saved(p))} under</b>` : '')).join('');
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
    if (!unpaid.length) return empty('✅ Nothing is waiting on payment.');
    return `<div style="padding-top:4px"></div>` + unpaid.map(g => `<div class="line" style="padding:8px 0">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(g.seller)} · ${money(g.total)}</b>${pill(esc(g.advice.split(':')[0].split(',')[0]), adviceColor(g.advice))}</div>
      <div class="muted" style="font-size:12px;line-height:1.35;margin-top:2px">${g.cards.map(esc).join('<br>')}</div>
      <div class="muted" style="font-size:11px;margin-top:2px">${esc(g.advice)}</div></div>`).join('') +
      `<div style="margin-top:8px">${linkBtn('eBay purchases ↗', 'https://www.ebay.com/mye/myebay/purchase', '#1e88e5')}</div>`;
  }],

  all_picks: ['Every live pick', true, c => {
    const tier = store('tier', 'all'), kind = store('kind', 'all'), cover = store('cover', 'all'), sort = store('sort', 'best'), limit = store('limit', 'page');
    let picks = c.picks.slice();
    const total = picks.length;
    const edges = picks.filter(p => EDGE[p.edge]).length, why = store('why', 'all');
    if (EDGE[why]) picks = picks.filter(p => p.edge === why);
    if (why === 'any') picks = picks.filter(p => EDGE[p.edge]);
    if (tier !== 'all') picks = picks.filter(p => p.tier === tier);
    if (kind === 'auction') picks = picks.filter(p => p.is_auction);
    if (kind === 'bin') picks = picks.filter(p => !p.is_auction);
    if (c.gixenOn && cover === 'open') picks = picks.filter(p => p.is_auction && p.snipe == null);
    if (c.gixenOn && cover === 'sniped') picks = picks.filter(p => p.snipe != null);
    const end = p => p.is_auction && p.end_time ? p.end_time : '9';
    if (sort === 'ending') picks.sort((x, y) => end(x) < end(y) ? -1 : (end(x) > end(y) ? 1 : 0));
    if (sort === 'cheap') picks.sort((x, y) => (x.total ?? 1e9) - (y.total ?? 1e9));
    if (sort === 'room') picks.sort((x, y) => room(y) - room(x));
    if (sort === 'deal') picks.sort((x, y) => (y.deal_pct ?? -1) - (x.deal_pct ?? -1));
    const shown = limit === 'all' ? picks : picks.slice(0, c.perPage);
    return `<div style="padding-top:6px">` +
      chips('tier', 'all', [['all', 'All tiers'], ['fire', '🔥 Brag'], ['green', '🟢 Value'], ['yellow', '🟡 Cheap']]) +
      chips('kind', 'all', [['all', 'All types'], ['auction', 'Auctions'], ['bin', 'Buy now / offer']]) +
      (edges || why !== 'all' ? chips('why', 'all', [['all', 'Any reason'], ['any', 'Slipped through the cracks (' + edges + ')'], ...Object.entries(EDGE).map(([k, v]) => [k, v[0]])]) : '') +
      (c.gixenOn ? chips('cover', 'all', [['all', 'Sniped or not'], ['open', 'No snipe yet'], ['sniped', '🎯 Sniped']]) : '') +
      chips('sort', 'best', [['best', 'Best first'], ['deal', '★ Best deal'], ['ending', 'Ending soonest'], ['room', 'Most room'], ['cheap', 'Cheapest']]) +
      `<div class="muted" style="font-size:12px;margin:10px 0 2px">Showing ${shown.length} of ${picks.length}${picks.length !== total ? ' (' + total + ' live picks in all)' : ''}</div>` +
      (shown.length ? shown.map(pickRow).join('') : empty('Nothing matches those filters.')) +
      (picks.length > shown.length ? `<div class="line" style="padding-top:10px">${setBtn('Show all ' + picks.length, 'limit', 'all', '#546e7a')}</div>`
        : (limit === 'all' && picks.length > c.perPage ? `<div class="line" style="padding-top:10px">${setBtn('Show fewer', 'limit', 'page')}</div>` : '')) + `</div>`;
  }],

  calls: ['How the calls turned out', false, c => {
    const m = c.d.market;
    if (!m) return empty('Update the bot to see this: it needs a version that records sold prices.');
    if (!m.count) return empty('No sold prices yet. The bot records the final bid of every auction it has watched, starting with the next ones to close.');
    const w = m.calls ? Math.round(m.under_max / m.calls * 100) : 0;
    return `<div style="padding-top:10px">` + grid(3, [
      stat('SOLD PRICES', m.count, '#1e88e5', '🔨'),
      stat('UNDER THE MAX', m.calls ? m.under_max + ' / ' + m.calls : '–', '#43a047', '🎯'),
      stat('PRICE GAP', m.value_gap_pct == null ? '–' : m.value_gap_pct + '%', '#8e24aa', '📏'),
    ]) + (m.calls ? `<div class="bar" style="margin-top:12px"><div style="width:${w}%;background:#43a047"></div><div style="flex:1;background:#78909c"></div></div>` : '') +
    `<div class="muted" style="font-size:12px;margin-top:8px;line-height:1.5">
      ${m.count} real auction results on record, ${m.count_7d} from the last 7 days. New picks are priced from these.<br>
      ${m.calls ? `Of ${m.calls} picked auctions that sold, ${m.under_max} closed at or under the bot's max, so a snipe at that max was in the running. The other ${m.over_max} went higher and were left alone.${m.under_win == null ? '' : ` A snipe at the "to win" bid would have been in the running on ${m.under_win} of the ${m.calls}.`}` : 'None of the picked auctions has sold yet.'}
      ${m.value_gap_pct == null ? '' : `<br>The going rate the bot gave was typically ${m.value_gap_pct}% away from the real delivered price.`}</div></div>`;
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
          <div class="muted" style="font-size:12px;margin-top:2px">${shipTxt(x)} · ${x.bids || 0} bid${x.bids === 1 ? '' : 's'} · sold ${ago(x.sold_at)}</div>
          ${k ? `<div style="font-size:12px;margin-top:4px">${verdict}${k.value ? ` <span class="muted" style="white-space:nowrap">rated ${worth(k.value)} · went ${money(x.total)} delivered</span>` : ''}</div>` : ''}
        </div></div>`;
    };
    return `<div style="padding-top:6px">` +
      chips('sold_only', 'all', [['all', 'Every sale'], ['picked', 'Ones the bot picked']]) +
      `<div class="muted" style="font-size:12px;margin:10px 0 2px">Final bids of auctions the bot watched, newest first. ${m.count} on record.</div>` +
      (shown.length ? shown.map(row).join('') : empty(only === 'picked' ? 'None of the picked auctions has sold yet.' : 'Nothing has sold yet.')) +
      (sold.length > shown.length ? `<div class="line" style="padding-top:10px">${setBtn('Show all ' + sold.length, 'sold_limit', 'all', '#546e7a')}</div>`
        : (limit === 'all' && sold.length > 8 ? `<div class="line" style="padding-top:10px">${setBtn('Show fewer', 'sold_limit', 'page')}</div>` : '')) + `</div>`;
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
    return `<div style="padding-top:10px">` + grid(3, [
      stat('SNIPES SET', all, '#6a1b9a', '🎯'),
      stat('STILL IN PLAY', '$' + Math.round(a.committed), '#1e88e5', '💰'),
      stat('OVER YOUR MAX', a.outbid_count, a.outbid_count ? '#e53935' : '#43a047', '📈'),
    ]) + (a.problem ? gixenStale(a)
      : `<div class="row" style="align-items:center;margin-top:10px"><span class="muted" style="font-size:12px">Read from Gixen ${ago(a.read_at)}.</span>${act('Re-read now', {action: 'gixen_refresh'}, {busy: 'Reading…'})}${linkBtn('Open Gixen ↗', GIXEN_URL, '#6a1b9a')}</div>`) +
      chips('snipes', 'all', [['all', 'All ' + all], ['today', 'Ending in 24h'], ['play', 'Still in play'], ['over', 'Over your max']]) +
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
    return `<div style="padding-top:10px">` + grid(3, [
      stat('WIN RATE · ' + a.days + 'D', a.rate == null ? '–' : a.rate + '%', '#43a047', '🎯'),
      stat('WON / LOST', a.wins + ' / ' + a.losses, '#8e24aa', '🏆'),
      stat('THIS WEEK', a.wins_week + ' / ' + a.losses_week, '#fb8c00', '📅'),
    ]) + `<div class="bar" style="margin-top:12px"><div style="width:${w}%;background:#43a047"></div><div style="flex:1;background:#78909c"></div></div>
    <div class="muted" style="font-size:12px;margin-top:6px">Gixen snipes: ${a.gixen_wins} won, ${a.gixen_losses} lost. The other ${a.wins - a.gixen_wins} wins were straight eBay buys, bids and offers.</div>` +
    cap('LATEST ONES THAT GOT AWAY') +
    ((a.recent_losses || []).length ? a.recent_losses.map(e => `<div class="line" style="padding:5px 0;font-size:13px">${esc(e.title)}<br><span class="muted" style="font-size:11px">${esc(e.date)}${e.seller ? ' · ' + esc(e.seller) : ''}</span></div>`).join('') : empty('No losses on record.')) + `</div>`;
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
    ]) + cap('THIS MONTH · ' + a.month_cards + ' CARDS') + `
    <div style="display:flex;justify-content:space-between;align-items:baseline"><div style="font-size:22px;font-weight:800">${money(spent)}</div>
      <div class="muted" style="font-size:13px">${budget > 0 ? 'of $' + Math.round(budget) + ' budget · ' + (spent > budget ? money(spent - budget) + ' over' : money(budget - spent) + ' left') : 'no monthly budget set'}</div></div>
    ${budget > 0 ? `<div class="bar" style="margin-top:4px"><div style="width:${pct}%;background:${barColor}"></div></div>` : ''}` +
    cap('CARDS BY YEAR') + `<div style="display:flex;gap:4px;align-items:flex-end;margin-top:4px">${bars}</div>` +
    cap('BIGGEST BUYS') +
    (a.priciest || []).map(r => `<div class="line" style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;font-size:13px"><span style="min-width:0">${esc(r.card)}</span><b>${money(r.paid)}</b></div>`).join('') + `</div>`;
  }],

  to_file: ['To file in the binder', false, c => {
    const cards = c.cards.filter(x => x.s === 'Delivered');
    if (!cards.length) return empty('✅ Everything delivered is in the binder.');
    const pages = {};
    cards.forEach(x => (pages[x.pg] = pages[x.pg] || []).push(x));
    const order = k => k === 'front page' ? -1 : (parseInt(String(k).replace(/\D+/, '')) || 99);
    return `<div class="muted" style="font-size:12px;padding:10px 0 2px">${cards.length} delivered cards are waiting to go in the binder. Tap Filed once a card is in its page; that updates the inventory.</div>` +
    Object.keys(pages).sort((x, y) => order(x) - order(y)).map(pg => `<div data-row>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:12px;padding:6px 0"><b>📖 ${esc(pg)} · ${pages[pg].length}</b>${pages[pg].length > 1 ? act('File all ' + pages[pg].length, {action: 'filed', ids: pages[pg].map(x => x.id)}, {busy: 'Filing…', color: '#43a047', confirm: 'Tap again to file ' + pages[pg].length}) : ''}</div>` +
      pages[pg].map(x => `<div data-row class="line" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;font-size:13px">
        <span style="min-width:0">${esc(x.n)}<br><span class="muted" style="font-size:11px">#${esc(x.id)} · ${esc(x.d)} · ${money(x.p)}</span></span>
        ${act('Filed', {action: 'filed', ids: [x.id]}, {hide: true, color: '#43a047'})}</div>`).join('') + `</div>`).join('');
  }],

  on_the_way: ['On the way', false, c => {
    const transit = c.cards.filter(x => x.s === 'In transit').sort((x, y) => x.d < y.d ? -1 : 1);
    const unpaid = c.cards.filter(x => x.s === 'Won' || x.s === 'Awaiting payment');
    const rows = list => list.map(x => `<div class="line" style="display:flex;justify-content:space-between;gap:8px;padding:5px 0;font-size:13px">
      <span style="min-width:0">${esc(x.n)}<br><span class="muted" style="font-size:11px">${esc(x.d)} · ${esc(x.sl)} · goes on ${esc(x.pg)}</span></span><b>${money(x.p)}</b></div>`).join('');
    return `<div style="padding-top:10px">` + grid(2, [
      stat('IN TRANSIT', transit.length, '#1e88e5', '🚚'),
      stat('WON, NOT SHIPPED', unpaid.length, '#fb8c00', '⏳'),
    ]) + cap('IN THE MAIL') + (transit.length ? rows(transit) : empty('Nothing in transit.')) +
    cap('WON, WAITING ON PAYMENT OR SHIPPING') + (unpaid.length ? rows(unpaid) : empty('Nothing waiting.')) + `</div>`;
  }],

  binder: ['Every card', false, c => {
    const status = store('status', 'all'), sort = store('cardsort', 'new');
    let cards = c.cards.slice();
    const total = cards.length;
    if (status === 'flag') cards = cards.filter(x => /[ALNGF]/.test(x.f));
    else if (status === 'dupe') cards = cards.filter(x => x.f.includes('D'));
    else if (status !== 'all') cards = cards.filter(x => x.s === status);
    if (sort === 'new') cards.sort((x, y) => (y.d || '') < (x.d || '') ? -1 : ((y.d || '') > (x.d || '') ? 1 : Number(y.id) - Number(x.id)));
    if (sort === 'price') cards.sort((x, y) => y.p - x.p);
    if (sort === 'year') cards.sort((x, y) => x.n < y.n ? -1 : 1);
    const FLAG = {R: ['RC', '#fb8c00'], A: ['AUTO', '#00897b'], L: ['RELIC', '#00897b'], N: ['#’d', '#8e24aa'], G: ['GRADED', '#546e7a'], F: ['FRONT', '#f9a825'], D: ['DUPE', '#6d4c41']};
    const flags = x => [...x.f].map(f => `<span class="flag" style="background:${FLAG[f][1]}">${FLAG[f][0]}</span>`).join('');
    return `<div style="padding-top:10px">
    <input data-search type="search" placeholder="Search ${total} cards: set, year, parallel, seller…" value="${esc(c.card.query)}">` +
    chips('status', 'all', [['all', 'All'], ['In binder', 'In binder'], ['Delivered', 'To file'], ['In transit', 'In transit'], ['flag', 'Hits'], ['dupe', 'Dupes']]) +
    chips('cardsort', 'new', [['new', 'Newest'], ['price', 'Priciest'], ['year', 'By year']]) +
    `<div class="muted" style="font-size:12px;margin:10px 0 2px"><span data-found>${cards.length}</span> cards · ${money(cards.reduce((t, x) => t + x.p, 0))} paid</div>` +
    cards.map(x => `<div class="line" data-find="${esc((x.n + ' ' + x.s + ' ' + x.sl + ' ' + x.pg + ' ' + x.d).toLowerCase())}" style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;font-size:13px">
      <span style="min-width:0">${esc(x.n)}<br><span class="muted" style="font-size:11px">${flags(x)}${esc(x.s)} · ${esc(x.pg)}${x.d ? ' · ' + esc(x.d) : ''}${x.sl ? ' · ' + esc(x.sl) : ''}</span></span><b>${x.p ? money(x.p) : ''}</b></div>`).join('') + `</div>`;
  }],

  health: ['Bot health', true, c => {
    const a = c.d.status, last = c.d.last_action || {};
    const color = {ok: '#43a047', stale: '#fb8c00', failing: '#e53935'}[a.state] || '#546e7a';
    const label = {ok: 'Running', stale: 'No search in 2h+', failing: 'Failing: ' + (a.failing || []).join(', ')}[a.state] || a.state;
    const age = (Date.now() - new Date(c.d.generated)) / 60000;
    const reports = feed.options.report_url;
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
      ${a.cost_month != null ? 'Claude: ' + money(a.cost_today) + ' today (' + (a.calls_today || 0) + ' calls), ' + money(a.cost_month) + ' this month.<br>' : ''}
      ${a.held_overnight ? a.held_overnight + ' alerts held for the morning.<br>' : ''}
      ${a.skipped ? a.skipped + ' picks hidden with Skip.<br>' : ''}
      ${last.at ? 'Last button: ' + esc(last.message) + ' (' + ago(last.at) + ')<br>' : ''}
      ${!feed.ok || age > 10 ? "⚠️ Home Assistant can't reach the bot; this is from " + ago(c.d.generated) + '.' : 'Read from the bot ' + ago(c.d.generated) + '.'}</div></div>`;
  }],
};

const STYLE = `
  :host { display: block; }
  ha-card { padding: 4px 14px 12px; font-size: 14px; overflow: hidden; }
  a { color: var(--primary-color); }
  .muted { color: var(--secondary-text-color); }
  .deal { color: var(--secondary-text-color); white-space: nowrap; }
  .rank { flex: none; width: 24px; height: 24px; line-height: 24px; border-radius: 50%; text-align: center; font-size: 12px;
          font-weight: 800; margin: 2px -4px 0 0; background: var(--divider-color); }
  .empty { padding: 8px 0; }
  .line { border-top: 1px solid var(--divider-color); }
  .line > b { flex: none; }
  .title { font-weight: 600; line-height: 1.25; text-decoration: none; color: var(--primary-text-color); }
  .cap { margin-top: 14px; font-size: 12px; letter-spacing: 1px; color: var(--secondary-text-color); }
  .pill { color: #fff; border-radius: 10px; padding: 2px 8px; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .flag { color: #fff; border-radius: 6px; padding: 0 5px; font-size: 10px; font-weight: 700; margin-right: 3px; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; }
  .grid { display: grid; gap: 8px; }
  .stat { border-radius: 12px; padding: 10px 6px; border: 1px solid; text-align: center; min-width: 0; }
  .stat-icon { font-size: 18px; }
  .stat-value { font-size: 22px; font-weight: 800; line-height: 1.15; }
  .stat-label { font-size: 10px; letter-spacing: 1px; color: var(--secondary-text-color); }
  .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .row.tight { margin-top: 7px; }
  .btn { display: inline-block; cursor: pointer; user-select: none; -webkit-user-select: none; border-radius: 14px; padding: 5px 11px;
         font-size: 12px; font-weight: 600; line-height: 1.2; text-decoration: none;
         background: var(--divider-color); color: var(--primary-text-color); }
  .btn.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .btn.busy { opacity: .45; pointer-events: none; }
  .bar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--divider-color); }
  .warn { margin-top: 10px; padding: 8px 10px; border-radius: 10px; background: #fb8c0022; border: 1px solid #fb8c0077; font-size: 12px; line-height: 1.7; }
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
    this.shadowRoot.addEventListener('input', ev => { if (ev.target.matches('input[data-search]')) this.find(ev.target); });
  }

  static getStubConfig() { return {panel: 'summary'}; }
  static getConfigForm() {
    return {
      schema: [
        {name: 'panel', required: true, selector: {select: {mode: 'dropdown', options: Object.entries(PANELS).map(([value, p]) => ({value, label: p[0]}))}}},
        {name: 'title', selector: {text: {}}},
        {name: 'accent', selector: {text: {}}},
        {name: 'picks_per_page', selector: {number: {min: 5, max: 200, step: 5, mode: 'box'}}},
      ],
      computeLabel: s => ({panel: 'Panel', title: 'Title (optional)', accent: 'Accent colour, e.g. #c41e3a (optional)', picks_per_page: 'Picks before "Show all" (Every live pick panel)'}[s.name]),
    };
  }

  setConfig(config) {
    if (!config || !PANELS[config.panel]) {
      throw new Error('Set panel to one of: ' + Object.keys(PANELS).join(', '));
    }
    this.config = config;
    this.draw();
  }

  set hass(hass) {
    this._hass = hass;
    feed.start(hass);
  }

  connectedCallback() {
    feed.cards.add(this);
    if (this._hass) feed.start(this._hass);
    clearInterval(this.timer);
    this.timer = setInterval(() => { if (this.config && PANELS[this.config.panel][1]) this.draw(); }, 30000);
    this.draw();
  }

  disconnectedCallback() {
    feed.cards.delete(this);
    clearInterval(this.timer);
  }

  getCardSize() { return 4; }
  getGridOptions() { return {columns: 'full', rows: 'auto', min_columns: 6}; }

  draw() {
    if (!this.config || !this.isConnected) return;
    const title = this.config.title ? `<div style="font-size:16px;font-weight:600;padding-top:10px">${esc(this.config.title)}</div>` : '';
    if (!feed.data) {
      this.body.innerHTML = title + empty(esc(feed.error || 'Waiting for the bot…'));
      return;
    }
    if (this.shadowRoot.querySelector('[data-armed]')) return;   // mid two-tap confirm
    const search = this.shadowRoot.activeElement && this.shadowRoot.activeElement.matches('input[data-search]')
      ? this.shadowRoot.activeElement : null;
    const caret = search ? [search.selectionStart, search.selectionEnd] : null;
    let html;
    try {
      html = PANELS[this.config.panel][2](context(this));
    } catch (err) {
      html = empty('This panel hit an error: ' + esc(err.message));
    }
    this.body.innerHTML = title + html;
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
    if (!el) return;
    ev.preventDefault();
    if (el.dataset.do === 'copy') return this.copy(el);
    if (el.dataset.do === 'set') {
      try { localStorage.setItem('ws_' + el.dataset.key, el.dataset.value); } catch (e) { /* private mode */ }
      return feed.redraw();
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
    this._hass.callWS({type: DOMAIN + '/action', action, data})
      .then(res => { if (action !== 'skip') this.toast(res.message); feed.redraw(); })
      .catch(err => { this.toast((err && err.message) || 'That did not work'); feed.redraw(); });
  }

  copy(el) {
    const text = el.dataset.text;
    const done = () => { const old = el.textContent; el.textContent = 'Copied ✓'; setTimeout(() => { if (el.isConnected) el.textContent = old; }, 1300); };
    const fallback = () => {
      const t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = 0;
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch (e) { /* nothing else to try */ }
      t.remove(); done();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }
}
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'snipe-hunt-card', name: 'Snipe Hunt',
  description: 'One panel of the Snipe Hunt card bot: picks, snipes, the collection or bot health.',
});

// ----------------------------------------------------------------- strategy
// dashboard:  strategy: {type: custom:snipe-hunt}
// Optional:   tabs: [today, picks, ...]   (overrides the integration option)
const panel = (name, extra) => ({type: 'custom:snipe-hunt-card', panel: name, ...extra});
const heading = (text, icon, entity) => ({
  type: 'heading', heading: text, icon, heading_style: 'title',
  ...(entity ? {badges: [{type: 'entity', entity}]} : {}),
});
const section = (...cards) => ({type: 'grid', cards: cards.filter(Boolean)});

class SnipeHuntStrategy {
  static async generate(config, hass) {
    let options = {};
    try { options = await hass.callWS({type: DOMAIN + '/options'}); } catch (e) { /* cards say why */ }
    // Entity ids can be renamed, so find the integration's entities by key.
    const id = (domain, key) => Object.values(hass.entities || {}).find(e =>
      e.platform === DOMAIN && e.translation_key === key && e.entity_id.startsWith(domain + '.'))?.entity_id;
    const graph = (hours, keys, title) => {
      const entities = keys.map(k => id('sensor', k)).filter(Boolean);
      return entities.length ? {type: 'history-graph', hours_to_show: hours, entities, ...(title ? {title} : {}), grid_options: {columns: 'full'}} : null;
    };
    const budget = id('number', 'monthly_budget');
    const VIEWS = {
      today: {title: 'Today', path: 'today', icon: 'mdi:calendar-star', sections: [
        section(heading('Right now', 'mdi:flash'), panel('summary'), heading('Top pick', 'mdi:star-circle'), panel('top_pick')),
        section(heading('Top 10 deals', 'mdi:podium-gold'), panel('top_deals')),
        section(heading('Rarest on eBay', 'mdi:diamond-stone'), panel('rarest')),
        section(heading('How the calls turned out', 'mdi:bullseye-arrow'), panel('calls')),
        section(heading('Needs a snipe', 'mdi:target-account', id('sensor', 'need_snipe')), panel('need_snipe')),
        section(heading('Your snipes ending today', 'mdi:target', id('sensor', 'gixen_snipes')), panel('snipes_today'),
          heading('To pay', 'mdi:credit-card-outline', id('sensor', 'to_pay')), panel('pay')),
      ]},
      picks: {title: 'Picks', path: 'picks', icon: 'mdi:cards-playing-outline', sections: [
        {...section(heading('Every live pick', 'mdi:cards-playing-outline', id('sensor', 'live_picks')), panel('all_picks')), column_span: 2},
        section(heading('Sold prices', 'mdi:gavel'), panel('sold'), heading('Want list', 'mdi:puzzle', id('sensor', 'want_list')), panel('wantlist')),
        section(heading('Price drops and relists', 'mdi:trending-down'), panel('moves')),
        section(heading('Price history', 'mdi:chart-line'), panel('history')),
      ]},
      gixen: {title: 'Gixen', path: 'gixen', icon: 'mdi:target', sections: [
        section(heading('Scheduled snipes', 'mdi:target', id('sensor', 'gixen_snipes')), panel('gixen')),
        section(heading('Good auctions with no snipe', 'mdi:target-account'), panel('gixen_gap')),
        section(heading('Snipe record', 'mdi:trophy', id('sensor', 'win_rate')), panel('record'),
          ...(id('calendar', 'auctions') ? [heading('Auction calendar', 'mdi:gavel'),
            {type: 'calendar', entities: [id('calendar', 'auctions')], initial_view: 'listWeek', grid_options: {columns: 'full'}}] : [])),
      ]},
      collection: {title: 'Collection', path: 'collection', icon: 'mdi:cards', sections: [
        section(heading('Collection', 'mdi:cards', id('sensor', 'collection')), panel('collection'),
          budget ? {type: 'tile', entity: budget, name: 'Monthly budget', features: [{type: 'numeric-input', style: 'buttons'}], features_position: 'bottom', grid_options: {columns: 'full'}} : null,
          graph(240, ['month_spend'], 'Spend this month')),
        section(heading('To file in the binder', 'mdi:book-open-page-variant', id('sensor', 'to_file')), panel('to_file'),
          heading('On the way', 'mdi:package-variant-closed', id('sensor', 'in_transit')), panel('on_the_way')),
        section(heading('Every card', 'mdi:magnify'), panel('binder')),
      ]},
      bot: {title: 'Bot', path: 'bot', icon: 'mdi:robot-outline', sections: [
        section(heading('Bot health', 'mdi:robot-outline'), panel('health')),
        section(heading('Last 3 days', 'mdi:chart-line'), graph(72, ['listings', 'live_picks']), graph(72, ['status'])),
        section(heading('Settings', 'mdi:tune'), {
          type: 'entities', grid_options: {columns: 'full'},
          entities: [['switch', 'alerts_enabled'], ['switch', 'alert_fire'], ['switch', 'alert_green'], ['switch', 'alert_cheap_yellow'],
            ['number', 'yellow_max_total'], ['number', 'alert_min_stars'], ['number', 'price_lookups'], ['switch', 'quiet_hours'], ['time', 'quiet_start'], ['time', 'quiet_end'],
            ['number', 'urgent_hours'], ['number', 'need_snipe_hours'], ['number', 'monthly_budget'], ['switch', 'gixen_enabled'],
            ['number', 'gixen_relogin_minutes'], ['text', 'sellers'], ['text', 'extra_searches']]
            .map(([domain, key]) => id(domain, key))
            // A setting the bot doesn't expose is unavailable; leave it off the list.
            .filter(e => e && hass.states && hass.states[e] && hass.states[e].state !== 'unavailable')
            .map(e => ({entity: e, name: String(hass.states[e].attributes.friendly_name || e).replace(/^Snipe Hunt /, '')})),
        }),
      ]},
    };
    const tabs = (config.tabs || options.tabs || Object.keys(VIEWS)).filter(t => VIEWS[t]);
    return {
      title: config.title || 'Snipe Hunt',
      views: (tabs.length ? tabs : Object.keys(VIEWS)).map(t => ({type: 'sections', max_columns: 3, ...VIEWS[t]})),
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
