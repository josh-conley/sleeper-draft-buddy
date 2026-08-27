// The floating overlay: Shadow DOM host, table, toolbar, sorting, drag/resize.

import { FIELDS } from '../lib/parse.js';
import { bandFor } from '../lib/value.js';
import { formatPick, picksUntilTurn } from '../lib/draft.js';
import { clockState, clockTooltip } from '../lib/clock.js';
import { picksUntilOwnedTurn } from '../lib/turn.js';
import { renderSettings } from './settings.js';

/**
 * What the table shows, in this order.
 *
 * Deliberately not FIELDS: that is the ingest contract, and a pasted CSV may
 * well carry a Pos column. This is the display, where "RB1" already says the
 * position, so a separate Pos column is just the same fact twice. The ranking
 * page shows these same columns in this same order.
 */
export const COLUMNS = ['myRank', 'posRank', 'name', 'team', 'bye'];

const fieldFor = (key) => FIELDS.find((f) => f.key === key);

// Position filter chips. `test` gets the row's uppercased position.
export const FILTERS = [
  { id: 'ALL', label: 'ALL', test: () => true },
  { id: 'QB', label: 'QB', test: (p) => p === 'QB' },
  { id: 'RB', label: 'RB', test: (p) => p === 'RB' },
  { id: 'WR', label: 'WR', test: (p) => p === 'WR' },
  { id: 'TE', label: 'TE', test: (p) => p === 'TE' },
  { id: 'FLEX', label: 'FLEX', test: (p) => p === 'RB' || p === 'WR' || p === 'TE' },
];

const el = (tag, props = {}, kids = []) => {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  });
  (Array.isArray(kids) ? kids : [kids]).forEach((c) => c && n.appendChild(c));
  return n;
};

export class Panel {
  /**
   * @param {object} cb  { onSettingsChange(patch), onSaveRankings(rankings, map),
   *                       onClearRankings(), onToggleManual(id) }
   */
  constructor(cssText, settings, cb) {
    this.cb = cb;
    this.settings = settings;
    this.state = {
      rankings: [],
      draftedIds: new Set(),
      manualIds: new Set(),
      unmatched: [],
      pickNo: null,
      teams: null,
      type: 'snake',
      status: 'stale',
      source: null,
      picksAway: null,
      // Slot worked out from the draft itself, and the exact pick numbers you
      // own once trades are applied. Both arrive from main.js.
      autoSlot: null,
      ownPicks: null,
      reference: null,
      view: 'ranks',
      showUnmatched: false,
    };

    this.host = el('div');
    this.host.id = 'sleeper-ranks-host';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.appendChild(el('style', { text: cssText }));
    this.build();
    document.body.appendChild(this.host);
    this.applyGeometry();
    this.render(); // never show a blank panel while waiting for the first update
  }

  // ---------------------------------------------------------------- structure

  build() {
    this.wrap = el('div', { class: 'wrap' });

    // header
    this.dot = el('span', { class: 'dot', 'data-state': 'stale' });
    this.pickInfo = el('span', { class: 'pickinfo' });
    this.warnChip = el('button', {
      class: 'chip-warn',
      hidden: '',
      onclick: () => {
        this.state.showUnmatched = !this.state.showUnmatched;
        this.render();
      },
    });
    this.collapseBtn = el('button', {
      class: 'iconbtn',
      title: 'Collapse',
      onclick: () => this.toggleCollapse(),
    });
    this.gearBtn = el('button', {
      class: 'iconbtn',
      text: '⚙',
      title: 'Rankings & settings',
      onclick: () => this.setView(this.state.view === 'ranks' ? 'settings' : 'ranks'),
    });

    this.header = el('div', { class: 'header' }, [
      el('span', { class: 'title', text: 'DRAFT BUDDY' }),
      this.dot,
      this.pickInfo,
      this.warnChip,
      el('span', { class: 'spacer' }),
      this.gearBtn,
      this.collapseBtn,
    ]);

    // toolbar
    this.filterBtns = FILTERS.map((f) =>
      el('button', {
        class: 'filter',
        text: f.label,
        'aria-pressed': String(this.settings.filter === f.id),
        onclick: () => this.patch({ filter: f.id }),
      })
    );
    this.search = el('input', {
      class: 'search',
      type: 'search',
      placeholder: 'Search…',
      value: this.settings.search || '',
      oninput: () => this.patch({ search: this.search.value }, { refocus: true }),
    });
    this.showDrafted = el('input', { type: 'checkbox' });
    this.showDrafted.checked = !!this.settings.showDrafted;
    this.showDrafted.addEventListener('change', () =>
      this.patch({ showDrafted: this.showDrafted.checked })
    );
    this.countEl = el('span', { class: 'count' });

    // The dot is meaningless without a draft slot, so ask for it in the toolbar
    // rather than burying it behind the gear icon.
    this.slotSel = el('select', {
      class: 'slotsel',
      onchange: () => this.patch({ slot: this.slotSel.value ? Number(this.slotSel.value) : null }),
    });
    this.slotWrap = el('label', { class: 'slotwrap' }, [
      el('span', { class: 'slotlabel', text: 'Slot' }),
      this.slotSel,
    ]);

    this.toolbar = el('div', { class: 'toolbar' }, [
      el('div', { class: 'filters' }, this.filterBtns),
      this.search,
      el('label', { class: 'toggle' }, [this.showDrafted, el('span', { text: 'show drafted' })]),
      this.slotWrap,
      this.countEl,
    ]);

    this.unmatchedBox = el('div', { class: 'unmatched', hidden: '' });
    this.body = el('div', { class: 'body' });
    this.grip = el('div', { class: 'grip' });

    this.wrap.append(this.header, this.toolbar, this.unmatchedBox, this.body, this.grip);
    this.shadow.appendChild(this.wrap);

    this.wireDrag();
    this.wireResize();
  }

  // ------------------------------------------------------------------ geometry

  applyGeometry() {
    const p = this.settings.panel;
    const w = Math.min(p.w, window.innerWidth - 20);
    const h = Math.min(p.h, window.innerHeight - 20);
    const x = p.x == null ? Math.max(10, window.innerWidth - w - 24) : p.x;
    const y = p.y == null ? 80 : p.y;
    Object.assign(this.wrap.style, {
      left: `${clamp(x, 0, window.innerWidth - 120)}px`,
      top: `${clamp(y, 0, window.innerHeight - 40)}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    this.wrap.classList.toggle('collapsed', !!p.collapsed);
    this.collapseBtn.textContent = p.collapsed ? '▸' : '▾';
  }

  savePanel(patch) {
    this.settings.panel = { ...this.settings.panel, ...patch };
    this.cb.onSettingsChange({ panel: this.settings.panel });
  }

  toggleCollapse() {
    const collapsed = !this.settings.panel.collapsed;
    this.savePanel({ collapsed });
    this.wrap.classList.toggle('collapsed', collapsed);
    this.collapseBtn.textContent = collapsed ? '▸' : '▾';
  }

  wireDrag() {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    this.header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      ox = this.wrap.offsetLeft; oy = this.wrap.offsetTop;
      this.header.classList.add('dragging');
      this.header.setPointerCapture(e.pointerId);
    });
    this.header.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const x = clamp(ox + e.clientX - sx, 0, window.innerWidth - 120);
      const y = clamp(oy + e.clientY - sy, 0, window.innerHeight - 40);
      this.wrap.style.left = `${x}px`;
      this.wrap.style.top = `${y}px`;
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      this.header.classList.remove('dragging');
      try { this.header.releasePointerCapture(e.pointerId); } catch {}
      this.savePanel({ x: this.wrap.offsetLeft, y: this.wrap.offsetTop });
    };
    this.header.addEventListener('pointerup', end);
    this.header.addEventListener('pointercancel', end);
  }

  wireResize() {
    let sx = 0, sy = 0, ow = 0, oh = 0, resizing = false;
    this.grip.addEventListener('pointerdown', (e) => {
      resizing = true;
      sx = e.clientX; sy = e.clientY;
      ow = this.wrap.offsetWidth; oh = this.wrap.offsetHeight;
      this.grip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    this.grip.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      this.wrap.style.width = `${Math.max(420, ow + e.clientX - sx)}px`;
      this.wrap.style.height = `${Math.max(160, oh + e.clientY - sy)}px`;
    });
    const end = (e) => {
      if (!resizing) return;
      resizing = false;
      try { this.grip.releasePointerCapture(e.pointerId); } catch {}
      this.savePanel({ w: this.wrap.offsetWidth, h: this.wrap.offsetHeight });
    };
    this.grip.addEventListener('pointerup', end);
    this.grip.addEventListener('pointercancel', end);
  }

  // --------------------------------------------------------------------- state

  patch(patch, opts = {}) {
    Object.assign(this.settings, patch);
    this.cb.onSettingsChange(patch);
    this.render();
    if (opts.refocus) {
      this.search.focus();
      const v = this.search.value;
      this.search.setSelectionRange(v.length, v.length);
    }
  }

  update(next) {
    Object.assign(this.state, next);
    this.render();
  }

  setView(view) {
    this.state.view = view;
    this.render();
  }

  // -------------------------------------------------------------------- render

  render() {
    // picksAway must be computed before the dot reads it, or the dot renders one
    // update behind — which looks like it is simply stuck on a slow board.
    this.state.picksAway = this.computePicksAway();
    this.renderDot();
    this.renderHeaderInfo();

    const n = this.state.unmatched.length;
    this.warnChip.hidden = n === 0;
    this.warnChip.textContent = `⚠ ${n} unmatched pick${n === 1 ? '' : 's'}`;

    this.unmatchedBox.hidden = !(this.state.showUnmatched && n);
    if (!this.unmatchedBox.hidden) {
      this.unmatchedBox.textContent = '';
      this.unmatchedBox.append(
        el('div', {
          text:
            'These picks did not match any row in your rankings. Click a row in the table to strike it manually.',
        }),
        el('ul', {}, this.state.unmatched.map((t) => el('li', { text: t })))
      );
    }

    this.filterBtns.forEach((b, i) =>
      b.setAttribute('aria-pressed', String(this.settings.filter === FILTERS[i].id))
    );
    this.showDrafted.checked = !!this.settings.showDrafted;
    this.renderSlotPicker();
    if (this.search.value !== (this.settings.search || '')) {
      this.search.value = this.settings.search || '';
    }

    const settingsView = this.state.view === 'settings';
    this.toolbar.style.display = settingsView ? 'none' : '';
    this.gearBtn.textContent = settingsView ? '✕' : '⚙';

    this.body.textContent = '';
    if (settingsView) {
      renderSettings(
        this.body,
        {
          rankings: this.state.rankings,
          settings: this.settings,
          teams: this.state.teams,
          reference: this.state.reference,
        },
        {
          onSave: (r, m) => { this.cb.onSaveRankings(r, m); this.setView('ranks'); },
          onSettings: (p) => { Object.assign(this.settings, p); this.cb.onSettingsChange(p); },
          onClear: () => { this.cb.onClearRankings(); this.render(); },
          onClose: () => this.setView('ranks'),
          onRefreshReference: () => this.cb.onRefreshReference(),
        }
      );
      return;
    }
    this.renderTable();
  }

  /**
   * The dot answers "how close am I to picking?", not "is the connection ok?".
   * Connection trouble degrades it to grey rather than showing a confident
   * colour that would be a lie.
   */
  renderDot() {
    const connected = this.state.status === 'live' && Number.isFinite(this.state.pickNo);
    const source = this.slotSource();
    const away = source ? this.state.picksAway : null;
    this.dot.dataset.state = clockState(away, connected).id;
    this.dot.title = clockTooltip(away, connected, source);
  }

  /**
   * Your slot, and how we came by it. A slot you chose yourself always wins —
   * detection fills the gap rather than overriding you, so a wrong guess is
   * always correctable and never silently sticks.
   * @returns {'user'|'auto'|null}
   */
  slotSource() {
    if (this.settings.slot) return 'user';
    return this.state.autoSlot ? 'auto' : null;
  }

  effectiveSlot() {
    return this.settings.slot || this.state.autoSlot || null;
  }

  /**
   * The pick number of your next turn — what a "can I wait?" question is really
   * asked against. Null until a slot is set, because without one there is no
   * next turn and a colour would be a guess.
   */
  nextPickNo() {
    const { pickNo } = this.state;
    const away = this.computePicksAway();
    if (!Number.isFinite(pickNo) || !Number.isFinite(away)) return null;
    return pickNo + away;
  }

  /**
   * Distance to your next turn. Prefers the explicit set of picks you own,
   * which is the only thing that stays right when a pick has been traded;
   * snake arithmetic is the fallback for drafts with no ownership data.
   */
  computePicksAway() {
    const { pickNo, teams, type, ownPicks } = this.state;
    if (!Number.isFinite(pickNo)) return null;
    const slot = this.effectiveSlot();
    if (ownPicks?.size) return picksUntilOwnedTurn(pickNo, ownPicks);
    return picksUntilTurn(pickNo, teams, slot, type);
  }

  /** Slot picker in the toolbar; highlighted until it is actually set. */
  renderSlotPicker() {
    const teams = this.state.teams || 12;
    const auto = this.state.autoSlot;
    const want = `${teams}|${this.settings.slot ?? ''}|${auto ?? ''}`;
    if (this.slotSel.dataset.built !== want) {
      this.slotSel.textContent = '';
      // The empty option doubles as the readout for a detected slot, so the
      // picker shows what is actually in force without pretending you set it.
      this.slotSel.appendChild(el('option', { value: '', text: auto ? `auto ${auto}` : 'set…' }));
      for (let i = 1; i <= teams; i++) {
        const o = el('option', { value: String(i), text: String(i) });
        if (this.settings.slot === i) o.selected = true;
        this.slotSel.appendChild(o);
      }
      this.slotSel.dataset.built = want;
    }
    const unset = !this.settings.slot;
    // Only nag when nothing at all is known — a detected slot is a working slot.
    this.slotWrap.classList.toggle('needed', unset && !auto);
    this.slotWrap.classList.toggle('auto', unset && !!auto);
    this.slotWrap.title = !unset
      ? `Drafting from slot ${this.settings.slot}`
      : auto
        ? `Slot ${auto}, detected from the draft. Choose one here to override it.`
        : 'Pick your draft slot to turn on the on-the-clock dot and the countdown';
  }

  renderHeaderInfo() {
    const { pickNo, teams } = this.state;
    if (!Number.isFinite(pickNo)) {
      this.pickInfo.textContent = 'waiting for draft…';
      return;
    }
    this.pickInfo.textContent = '';
    this.pickInfo.append(
      el('span', { text: 'On the clock ' }),
      el('b', { text: formatPick(pickNo, teams) }),
      // The overall number as well as the round.pick: "2.09" places you in the
      // round, but every ADP on screen is an overall pick number.
      el('span', { class: 'overall', text: ` #${pickNo}`, title: `Overall pick ${pickNo}` })
    );
    const until = this.state.picksAway;
    if (until !== null) {
      this.pickInfo.append(
        el('span', { text: until === 0 ? ' · you are up' : ` · ${until} until you` })
      );
    }
    const next = this.nextPickNo();
    if (Number.isFinite(next)) {
      this.pickInfo.append(
        el('span', {
          class: 'overall',
          text: ` · next #${next}`,
          title: `Your next pick is overall pick ${next} — what the ADP column is coloured against`,
        })
      );
    }
    if (this.state.source) {
      this.pickInfo.title =
        this.state.source === 'board'
          ? 'Reading picks live off the draft board'
          : 'Reading picks from the Sleeper REST API';
      this.pickInfo.append(el('span', { text: ` · ${this.state.source}` }));
    }
  }

  visibleRows() {
    const f = FILTERS.find((x) => x.id === this.settings.filter) || FILTERS[0];
    const q = (this.settings.search || '').trim().toLowerCase();
    return this.state.rankings.filter((r) => {
      const drafted = this.state.draftedIds.has(r.id) || this.state.manualIds.has(r.id);
      if (drafted && !this.settings.showDrafted) return false;
      if (!f.test((r.position || '').toUpperCase())) return false;
      if (q && !`${r.name} ${r.team || ''} ${r.position || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  sortRows(rows) {
    const { sortKey, sortDir } = this.settings;
    const field = fieldFor(sortKey) || FIELDS[0];
    const dir = sortDir === 'desc' ? -1 : 1;
    return rows.slice().sort((a, b) => {
      const av = a[field.key];
      const bv = b[field.key];
      // Blanks always sort last, in both directions — an empty Underdog ADP
      // must never float to the top of an ascending Underdog sort.
      const ae = av === null || av === undefined || av === '' || Number.isNaN(av);
      const be = bv === null || bv === undefined || bv === '' || Number.isNaN(bv);
      if (ae && be) return (a.myRank ?? 0) - (b.myRank ?? 0);
      if (ae) return 1;
      if (be) return -1;
      const cmp =
        field.type === 'num' ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return cmp * dir || (a.myRank ?? 0) - (b.myRank ?? 0);
    });
  }

  cycleSort(key) {
    const { sortKey, sortDir } = this.settings;
    if (sortKey !== key) return this.patch({ sortKey: key, sortDir: 'asc' });
    if (sortDir === 'asc') return this.patch({ sortDir: 'desc' });
    return this.patch({ sortKey: 'myRank', sortDir: 'asc' }); // third click clears
  }

  /**
   * Drag to reorder, delegated on the tbody. The move is applied by the two
   * players' positions in the full list, so it stays a valid reordering however
   * filtered the view is — which matters most mid-draft, when the board is
   * usually filtered to one position.
   */
  bindDrag(tbody) {
    let dragId = null;

    tbody.addEventListener('dragstart', (e) => {
      const tr = e.target.closest('tr');
      if (!tr?.dataset.id) return;
      dragId = tr.dataset.id;
      tr.classList.add('dragging');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });

    tbody.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      const tr = e.target.closest('tr');
      tbody.querySelectorAll('tr.over').forEach((n) => n.classList.remove('over'));
      if (tr?.dataset.id && tr.dataset.id !== dragId) tr.classList.add('over');
    });

    tbody.addEventListener('drop', (e) => {
      e.preventDefault();
      const tr = e.target.closest('tr');
      const target = tr?.dataset.id;
      if (dragId && target && target !== dragId) {
        this.justDragged = true;
        this.cb.onReorder?.(dragId, target);
        // Cleared on a timer because the click that follows a drag arrives
        // after it, and only a real click should strike a player off.
        setTimeout(() => { this.justDragged = false; }, 250);
      }
      dragId = null;
    });

    tbody.addEventListener('dragend', () => {
      dragId = null;
      tbody.querySelectorAll('tr.dragging, tr.over').forEach((n) => n.classList.remove('dragging', 'over'));
    });
  }

  renderTable() {
    if (!this.state.rankings.length) {
      this.body.appendChild(
        el('div', { class: 'empty' }, [
          el('div', { text: 'No player list loaded yet.' }),
          el('div', {}, [
            el('button', {
              class: 'primary',
              text: 'Paste a list of names',
              onclick: () => this.setView('settings'),
            }),
          ]),
        ])
      );
      this.countEl.textContent = '';
      return;
    }

    const rows = this.sortRows(this.visibleRows());
    // Union, not sum: a player struck manually and then actually drafted
    // must count once.
    const draftedCount = new Set([...this.state.draftedIds, ...this.state.manualIds]).size;
    this.countEl.textContent = `${rows.length} shown · ${draftedCount} drafted`;

    const columns = COLUMNS.map(fieldFor).filter(Boolean);

    const thead = el('thead');
    const hr = el('tr');
    columns.forEach((f) => {
      const active = this.settings.sortKey === f.key;
      const th = el('th', {
        'aria-sort': active ? (this.settings.sortDir === 'asc' ? 'ascending' : 'descending') : 'none',
        title: `Sort by ${f.label}`,
        onclick: () => this.cycleSort(f.key),
      });
      th.append(document.createTextNode(f.label));
      if (active) {
        th.append(el('span', { class: 'arrow', text: this.settings.sortDir === 'asc' ? ' ▲' : ' ▼' }));
      }
      hr.appendChild(th);
    });
    thead.appendChild(hr);

    const tbody = el('tbody');
    const pickNo = this.state.pickNo;

    // Reordering is only meaningful while the screen is showing the order being
    // rewritten. Under any other sort the rows on screen are not the list.
    const canDrag = this.settings.sortKey === 'myRank' && this.settings.sortDir === 'asc';

    rows.forEach((r) => {
      const auto = this.state.draftedIds.has(r.id);
      const manual = this.state.manualIds.has(r.id);
      const tr = el('tr', {
        class: `${auto ? 'drafted' : manual ? 'manual' : ''}${canDrag ? ' draggable' : ''}`,
        title: canDrag
          ? 'Drag to reorder · click to strike manually'
          : manual ? 'Manually struck — click to restore' : 'Click to strike manually',
        // A drag ends with a click in some browsers; without this guard,
        // reordering a player would also strike him off the board.
        onclick: () => { if (!this.justDragged) this.cb.onToggleManual?.(r.id); },
      });
      if (canDrag) {
        tr.draggable = true;
        tr.dataset.id = r.id;
      }

      const band = bandFor(r.myRank, pickNo);

      columns.forEach((f) => {
        if (f.key === 'myRank') {
          const badge = el('span', {
            class: 'rankbadge',
            'data-band': band ? band.id : null,
            text: r.myRank ?? '',
          });
          if (band) badge.title = `${band.label} — ${r.myRank} ranked, pick ${pickNo} on the clock`;
          tr.appendChild(el('td', {}, [badge]));
          return;
        }
        if (f.key === 'posRank') {
          // Coloured by position, which is what the dropped Pos column was for.
          tr.appendChild(
            el('td', {}, [
              el('span', { class: 'pos', 'data-pos': r.position || null, text: r.posRank ?? '' }),
            ])
          );
          return;
        }
        if (f.key === 'name') {
          const td = el('td', { class: 'name', text: r.name });
          // Mark rows we could not resolve, so a typo is visible rather than
          // silently sitting there with no position and never matching a pick.
          if (!r.position) { td.classList.add('unresolved'); td.title = 'Not found in Sleeper — check the spelling'; }
          tr.appendChild(td);
          return;
        }
        const v = r[f.key];
        tr.appendChild(el('td', {
          class: f.type === 'num' ? 'num' : '',
          text: v === null || v === undefined ? '' : f.type === 'num' ? fmtNum(v) : String(v),
        }));
      });
      tbody.appendChild(tr);
    });

    if (!rows.length) {
      this.body.appendChild(
        el('div', { class: 'empty', text: 'Nothing matches this filter. Everyone here is off the board.' })
      );
      return;
    }
    this.bindDrag(tbody);
    this.body.appendChild(el('table', {}, [thead, tbody]));
  }
}

function fmtNum(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
