// Paste view. A bare list of names needs no mapping step at all — the common
// case is one paste and done. A wider CSV still gets a mapping confirmation,
// because a mis-mapped column would poison every rank and value colour.

import { FIELDS, parsePaste, buildRows } from '../lib/parse.js';

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

/**
 * @param cb { onSave(rows, mapping), onSettings(patch), onClose(), onClear(),
 *             onRefreshReference() }
 */
export function renderSettings(container, ctx, cb) {
  container.textContent = '';
  const box = el('div', { class: 'settings' });
  container.appendChild(box);

  box.appendChild(el('h3', { text: 'Paste your player list' }));
  box.appendChild(
    el('p', {
      text:
        'One player per line is enough — the order you list them in is your ranking. ' +
        'Position, team, bye and positional rank are filled in automatically. ' +
        'Paste a wider CSV and any column you include wins over the inferred value.',
    })
  );

  const ta = el('textarea', {
    placeholder: "Ja'Marr Chase\nBijan Robinson\nJahmyr Gibbs\n…\n\nor: 1. Ja'Marr Chase\nor a CSV with Player,Pos,Team,Bye headers",
    spellcheck: 'false',
  });
  box.appendChild(ta);

  const msg = el('div');
  const mapArea = el('div', { class: 'mapgrid' });

  const slotSel = el('select', {
    onchange: () => cb.onSettings({ slot: slotSel.value ? Number(slotSel.value) : null }),
  });
  slotSel.appendChild(el('option', { value: '', text: '—' }));
  for (let i = 1; i <= (ctx.teams || 12); i++) {
    const o = el('option', { value: String(i), text: String(i) });
    if (ctx.settings.slot === i) o.selected = true;
    slotSel.appendChild(o);
  }

  box.appendChild(
    el('div', { class: 'btnrow' }, [
      el('button', { class: 'primary', text: 'Load list', onclick: doParse }),
      el('button', { class: 'ghost', text: 'Back to ranks', onclick: () => cb.onClose() }),
      el('span', { class: 'spacer' }),
      el('label', { class: 'field' }, [
        el('span', { text: 'Your slot' }),
        slotSel,
      ]),
    ])
  );
  box.appendChild(
    el('p', {
      class: 'pickinfo',
      text: 'Your slot drives the dot at the top: green when you are on the clock, yellow 1–4 picks away, red beyond that.',
    })
  );

  box.appendChild(msg);
  box.appendChild(mapArea);

  const refInfo = ctx.reference
    ? `player data cached ${ageText(ctx.reference.at)} · ${ctx.reference.players.length} players · ${ctx.reference.season} byes`
    : 'player data not loaded yet';
  const footer = el('div', { class: 'btnrow' }, [
    el('button', { class: 'ghost danger', text: 'Clear saved list', onclick: () => { if (confirmish()) cb.onClear(); } }),
    el('button', { class: 'ghost', text: 'Refresh player data', onclick: () => cb.onRefreshReference() }),
    el('span', { class: 'pickinfo', text: refInfo }),
  ]);
  box.appendChild(footer);

  // Two-click confirm; window.confirm() would block the page.
  let armed = false;
  function confirmish() {
    const btn = footer.firstChild;
    if (armed) return true;
    armed = true;
    btn.textContent = 'Really clear? Click again';
    setTimeout(() => { armed = false; btn.textContent = 'Clear saved list'; }, 4000);
    return false;
  }

  function doParse() {
    msg.textContent = '';
    msg.className = '';
    mapArea.textContent = '';
    let parsed;
    try {
      parsed = parsePaste(ta.value);
    } catch (err) {
      msg.className = 'err';
      msg.textContent = err.message;
      return;
    }
    // A bare name list has nothing to confirm — save it straight away.
    if (parsed.namesOnly) {
      try {
        cb.onSave(buildRows(parsed.rows, parsed.mapping), parsed.mapping);
      } catch (err) {
        msg.className = 'err';
        msg.textContent = err.message;
      }
      return;
    }
    renderMapping(parsed);
  }

  function renderMapping(parsed) {
    const mapping = parsed.mapping.slice();
    const tbl = el('table');
    const hrow = el('tr');
    parsed.headerCells.forEach((h, i) => {
      const sel = el('select', {
        onchange: () => {
          const v = sel.value || null;
          if (v) mapping.forEach((k, j) => { if (j !== i && k === v) mapping[j] = null; });
          mapping[i] = v;
          syncSelects();
          validate();
        },
      });
      sel.appendChild(el('option', { value: '', text: '— ignore —' }));
      FIELDS.forEach((f) => {
        const o = el('option', { value: f.key, text: f.label });
        if (mapping[i] === f.key) o.selected = true;
        sel.appendChild(o);
      });
      sel.dataset.col = String(i);
      hrow.appendChild(el('th', {}, [el('div', { text: h }), sel]));
    });
    tbl.appendChild(el('thead', {}, [hrow]));

    const tbody = el('tbody');
    parsed.rows.slice(0, 5).forEach((r) => {
      const tr = el('tr');
      parsed.headerCells.forEach((_, i) => tr.appendChild(el('td', { text: r[i] ?? '' })));
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    mapArea.appendChild(tbl);

    function syncSelects() {
      mapArea.querySelectorAll('select').forEach((s) => { s.value = mapping[Number(s.dataset.col)] || ''; });
    }

    const saveBtn = el('button', {
      class: 'primary',
      text: `Load ${parsed.rows.length} players`,
      onclick: () => {
        try { cb.onSave(buildRows(parsed.rows, mapping), mapping); }
        catch (err) { msg.className = 'err'; msg.textContent = err.message; }
      },
    });
    mapArea.appendChild(el('div', { class: 'btnrow' }, [saveBtn]));

    function validate() {
      const hasName = mapping.includes('name');
      saveBtn.disabled = !hasName;
      msg.className = hasName ? 'ok' : 'err';
      const filled = mapping.filter(Boolean).length;
      msg.textContent = hasName
        ? `Using ${filled} column${filled === 1 ? '' : 's'}; anything unmapped will be inferred` +
          (parsed.hasHeader ? '' : ' (no header row found — guessed from the data)')
        : 'Map one column to Player before loading.';
    }
    validate();
  }
}

function ageText(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}
