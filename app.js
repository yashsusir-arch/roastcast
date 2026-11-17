'use strict';
(() => {
  const M = RoastModel;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = M.fmtTime, R = M.round;
  const STORE = 'roastcast.batches.v1';
  const LAST = 'roastcast.last.v1';
  const year = new Date().getFullYear();

  const form = $('#bean-form');
  let result = null;
  let baseProfile = null;

  /* ---------------- storage (all wrapped: may be unavailable) ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };

  /* ---------------- populate selects ---------------- */
  const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
  $('#level').innerHTML = Object.entries(M.LEVELS).map(([k, v]) => opt(k, v.label)).join('');
  $('#level').value = 'light-medium';
  $('#process').innerHTML = Object.entries(M.PROCESS).map(([k, v]) => opt(k, v.label)).join('');
  $('#origin').innerHTML = '<option value="">Select origin…</option>' + M.ORIGINS.map(o => opt(o.name, o.name)).join('');
  $('#layout').innerHTML = opt('auto', 'Auto-detect') + Object.entries(M.LAYOUTS).map(([k, v]) => opt(k, v)).join('');
  $('#harvestYear').max = year + 1;
  $('#harvestYear').value = year;

  $('#origin').addEventListener('change', () => {
    const o = M.ORIGINS.find(x => x.name === $('#origin').value);
    $('#elev-hint').textContent = o ? `Typical for ${o.name}: ~${o.elev} masl` : 'Use the farm’s average';
    if (o && !$('#elevation').value) $('#elevation').placeholder = o.elev;
  });

  /* ---------------- form read / write / validate ---------------- */
  const FIELDS = ['name', 'batch', 'level', 'density', 'moisture', 'origin', 'elevation', 'harvestYear', 'process', 'screen', 'variety', 'ambient'];
  const readForm = () => Object.fromEntries(FIELDS.map(f => [f, form.elements[f].value.trim()]));
  const writeForm = (d) => { FIELDS.forEach(f => { if (d[f] != null) form.elements[f].value = d[f]; }); $('#origin').dispatchEvent(new Event('change')); };

  const RULES = {
    batch: [50, 200, 'Batch must be 50–200 g'],
    density: [0.5, 900, 'Density: enter g/L (e.g. 700) or g/mL (e.g. 0.70)'],
    moisture: [5, 16, 'Moisture must be 5–16 %'],
    elevation: [0, 3000, 'Elevation must be 0–3000 masl'],
    harvestYear: [2010, year + 1, `Harvest year must be 2010–${year + 1}`],
    ambient: [0, 45, 'Ambient must be 0–45 °C', true],
  };
  function validate(d) {
    const errs = [];
    form.querySelectorAll('.field').forEach(f => f.classList.remove('invalid'));
    const bad = (id, msg) => { errs.push(msg); form.elements[id].closest('.field').classList.add('invalid'); };
    for (const [id, [lo, hi, msg, optional]] of Object.entries(RULES)) {
      const v = d[id];
      if (v === '' && optional) continue;
      const n = Number(v);
      if (v === '' || isNaN(n) || n < lo || n > hi) bad(id, msg);
    }
    const dn = +d.density;
    if (dn > 1.2 && dn < 400) bad('density', 'Density looks off — use g/L (≈550–850)');
    if (!d.origin) bad('origin', 'Choose an origin');
    return errs;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = readForm();
    const errs = validate(d);
    const box = $('#form-error');
    if (errs.length) { box.textContent = errs.join(' · '); box.hidden = false; box.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    box.hidden = true;
    store.set(LAST, d);
    result = M.simulate(d);
    renderResults(result);
    location.hash = '#results';
  });

  /* ---------------- saved batches ---------------- */
  function renderSaved() {
    const list = store.get(STORE, []);
    $('#saved-list').innerHTML = list.length ? list.map((b, i) => `
      <li><span class="nm">${esc(b.inputs.name || 'Unnamed lot')}
        <small>${esc(b.inputs.origin || '—')} · ${esc(b.inputs.density)} g/L · ${esc(b.inputs.moisture)}% · ${new Date(b.savedAt).toLocaleDateString()}</small></span>
        <button type="button" class="load" data-i="${i}">Load</button>
        <button type="button" class="del" data-i="${i}" aria-label="Delete">✕</button></li>`).join('')
      : '<li class="empty">Nothing saved yet. Fill the form and tap “Save batch”.</li>';
  }
  $('#save-batch').addEventListener('click', () => {
    const d = readForm();
    if (!d.density && !d.origin) { $('#form-error').textContent = 'Fill in some bean details before saving.'; $('#form-error').hidden = false; return; }
    const list = store.get(STORE, []);
    const idx = list.findIndex(b => b.inputs.name && b.inputs.name === d.name);
    const entry = { inputs: d, savedAt: Date.now() };
    if (idx >= 0) list[idx] = entry; else list.unshift(entry);
    if (!store.set(STORE, list.slice(0, 50))) alert('Could not save — browser storage is unavailable.');
    renderSaved();
  });
  $('#saved-list').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const list = store.get(STORE, []), i = +b.dataset.i;
    if (b.classList.contains('load')) { writeForm(list[i].inputs); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    if (b.classList.contains('del') && confirm(`Delete “${list[i].inputs.name || 'Unnamed lot'}”?`)) { list.splice(i, 1); store.set(STORE, list); renderSaved(); }
  });

  /* ---------------- results ---------------- */
  function renderResults(r) {
    const i = r.inputs;
    $('#res-title').textContent = i.name || `${i.origin} ${r.proc.label}`;
    $('#res-sub').textContent = `${i.origin} · ${r.proc.label} · ${i.density} g/L · ${i.moisture}% moisture · ${i.elevation} masl · ${i.harvestYear} harvest · ${i.batch} g → ${r.lvl.label}`;

    const stat = (cls, k, v, s) => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    $('#stats').innerHTML = [
      stat('y', 'First crack', T(r.fcTime), `@ ${R(r.fcTemp)} °C`),
      stat('b', 'Development', `${Math.round(r.dev)} s`, `DTR ${R(r.dtr * 100)} %`),
      stat('g', 'Weight loss', `${r.weightLoss} %`, `${r.roastedWeight} g roasted`),
      stat('', 'Total / drop', T(r.total), `@ ${R(r.dropTemp)} °C`),
      stat('', 'Colour change', T(r.dry), `@ ${R(r.ccTemp)} °C`),
      stat('', 'Kaffelogic level', r.kaffelogicLevel.toFixed(1), 'estimate'),
      stat('', 'Expected colour', r.lvl.agtron, 'Agtron whole bean'),
      stat('', 'Bean hardness', (r.hardness > 0 ? '+' : '') + r.hardness, r.hardness > 0.5 ? 'hard' : r.hardness < -0.5 ? 'soft' : 'average'),
    ].join('');

    $('#chart').innerHTML = chartSvg(r);
    $('#phasebar').innerHTML = r.phases.map(p => `<div class="${p.key}" style="width:${p.pct}%" title="${p.label}">${{ dry: 'Dry', mail: 'Maillard', dev: 'Dev' }[p.key]} ${Math.round(p.pct)}%</div>`).join('');

    const colors = { start: '#A3AABB', cc: '#1FD67A', fc: '#FFD60A', sc: '#FF5C61', drop: '#2F7BFF' };
    $('#milestones').innerHTML = '<tr><th>Event</th><th>Time</th><th>°C</th><th>RoR<small>°C/min</small></th></tr>' +
      r.milestones.map(m => `<tr><td><i class="dot" style="background:${colors[m.key]}"></i>${m.label}</td><td>${T(m.t)}</td><td>${R(m.T)}</td><td>${m.ror == null ? '—' : R(m.ror)}</td></tr>`).join('');
    $('#phases').innerHTML = '<tr><th>Phase</th><th>Time</th><th>Share</th><th>Avg RoR<small>°C/min</small></th></tr>' +
      r.phases.map(p => `<tr><td>${p.label}</td><td>${T(p.dur)}</td><td>${p.pct}%</td><td>${p.ror}</td></tr>`).join('');

    $('#flags').innerHTML = r.flags.length
      ? r.flags.map(f => `<li class="${f.type}">${f.type === 'warn' ? '<b>⚠ </b>' : ''}${esc(f.text)}</li>`).join('')
      : '<li>No special concerns for this lot.</li>';

    updateKproPreview();
  }

  function chartSvg(r) {
    const W = 420, H = 300, L = 34, Rm = 30, Tp = 30, B = 34;
    const pw = W - L - Rm, ph = H - Tp - B;
    const tMax = Math.ceil((r.total + 30) / 60) * 60;
    const yMin = 0, yMax = 240, rorMax = 40;
    const x = t => L + t / tMax * pw;
    const y = v => Tp + ph - (v - yMin) / (yMax - yMin) * ph;
    const yr = v => Tp + ph - Math.min(v, rorMax) / rorMax * ph;
    let g = '';
    // phase bands
    const band = (a, b, c) => `<rect x="${x(a)}" y="${Tp}" width="${x(b) - x(a)}" height="${ph}" fill="${c}"/>`;
    g += band(0, r.dry, 'rgba(31,214,122,.10)') + band(r.dry, r.fcTime, 'rgba(255,214,10,.08)') + band(r.fcTime, r.total, 'rgba(47,123,255,.14)');
    // grid + axes
    for (let v = 0; v <= yMax; v += 40) g += `<line x1="${L}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" stroke="#2B2E3D"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#A3AABB">${v}</text>`;
    for (let v = 0; v <= rorMax; v += 10) g += `<text x="${W - Rm + 6}" y="${yr(v) + 4}" font-size="11" fill="#2F7BFF">${v}</text>`;
    for (let t = 0; t <= tMax; t += 60) g += `<text x="${x(t)}" y="${H - 18}" text-anchor="middle" font-size="11" fill="#A3AABB">${t / 60}</text>`;
    g += `<text x="${L + pw / 2}" y="${H - 3}" text-anchor="middle" font-size="10" fill="#A3AABB">minutes</text>`;
    g += `<text x="${L - 6}" y="${Tp - 12}" text-anchor="end" font-size="10" fill="#FFD60A">°C</text><text x="${W - Rm + 6}" y="${Tp - 12}" font-size="10" fill="#2F7BFF">RoR</text>`;
    // curves
    const tp = r.curve.map(p => `${x(p.t).toFixed(1)},${y(p.T).toFixed(1)}`).join(' ');
    const rp = r.curve.filter(p => p.t >= 30 && p.ror <= rorMax).map(p => `${x(p.t).toFixed(1)},${yr(p.ror).toFixed(1)}`).join(' ');
    g += `<polyline points="${rp}" fill="none" stroke="#2F7BFF" stroke-width="3" stroke-linejoin="round"/>`;
    g += `<polyline points="${tp}" fill="none" stroke="#FFD60A" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
    // milestones
    const colors = { cc: '#1FD67A', fc: '#FFD60A', sc: '#FF5C61', drop: '#2F7BFF' };
    const tags = { cc: 'CC', fc: 'FC', sc: '2C', drop: 'DROP' };
    for (const m of r.milestones) {
      if (!colors[m.key]) continue;
      const cx = x(m.t), cy = y(m.T);
      g += `<line x1="${cx}" x2="${cx}" y1="${cy}" y2="${Tp + ph}" stroke="${colors[m.key]}" stroke-dasharray="3 4" opacity=".7"/>`;
      g += `<circle cx="${cx}" cy="${cy}" r="5" fill="#0A0A0D" stroke="${colors[m.key]}" stroke-width="3"/>`;
      g += `<text x="${cx - 8}" y="${cy - 9}" text-anchor="end" font-size="12" font-weight="700" fill="${colors[m.key]}">${tags[m.key]} ${T(m.t)}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
  }

  /* ---------------- export ---------------- */
  function currentKpro() { return M.buildKpro(result, { base: baseProfile, layout: $('#layout').value }); }
  function updateKproPreview() {
    if (!result) return;
    const k = currentKpro();
    $('#kpro-preview').textContent = k.text;
    if ($('#layout').value === 'auto') $('#layout').options[0].textContent = `Auto-detect (${M.LAYOUTS[k.layout]})`;
  }
  $('#layout').addEventListener('change', updateKproPreview);

  $('#base-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) { baseProfile = null; $('#base-info').textContent = 'No base loaded — a minimal profile will be generated.'; updateKproPreview(); return; }
    const text = await f.text();
    const p = M.parseKpro(text);
    const curve = p.get('roast_profile');
    if (!curve) {
      baseProfile = null;
      $('#base-info').textContent = `“${f.name}” has no roast_profile line — not used. Is it a Kaffelogic profile?`;
    } else {
      baseProfile = p;
      const keys = p.entries.filter(x => x.key).length;
      $('#base-info').textContent = `Base: ${f.name} · ${keys} settings kept · curve has ${curve.split(',').length} numbers · layout: ${M.LAYOUTS[M.detectLayout(curve)]}`;
    }
    updateKproPreview();
  });

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  const baseName = () => (result.inputs.name || 'roastcast').replace(/[^\w\-]+/g, '_');
  $('#dl-kpro').addEventListener('click', () => { const k = currentKpro(); download(k.filename, k.text, 'text/plain'); });
  $('#dl-csv').addEventListener('click', () => download(`${baseName()}_profile.csv`, M.buildCsv(result), 'text/csv'));
  $('#dl-json').addEventListener('click', () => {
    const { curve, ...rest } = result;
    download(`${baseName()}_roastcast.json`, JSON.stringify({ ...rest, curve: curve.filter(p => p.t % 10 === 0) }, null, 2), 'application/json');
  });

  if (navigator.canShare) {
    $('#share').hidden = false;
    $('#share').addEventListener('click', async () => {
      const k = currentKpro();
      const file = new File([k.text], k.filename, { type: 'text/plain' });
      const summary = `${$('#res-title').textContent}: FC ${T(result.fcTime)} @ ${R(result.fcTemp)}°C, dev ${Math.round(result.dev)}s (DTR ${R(result.dtr * 100)}%), drop ${T(result.total)} @ ${R(result.dropTemp)}°C, weight loss ${result.weightLoss}%`;
      try {
        if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'RoastCast profile', text: summary });
        else await navigator.share({ title: 'RoastCast profile', text: summary });
      } catch { /* cancelled */ }
    });
  }

  /* ---------------- routing ---------------- */
  function route() {
    const res = location.hash === '#results' && result;
    $('#view-input').hidden = !!res;
    $('#view-results').hidden = !res;
    if (location.hash === '#results' && !result) history.replaceState(null, '', '#input');
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  $('#back').addEventListener('click', () => { location.hash = '#input'; });

  /* ---------------- online badge + service worker ---------------- */
  const net = () => { const on = navigator.onLine; $('#net').textContent = on ? 'OFFLINE READY' : 'OFFLINE MODE'; $('#net').classList.toggle('off', !on); };
  window.addEventListener('online', net); window.addEventListener('offline', net); net();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { $('#net').textContent = 'ONLINE ONLY'; });
  }

  /* ---------------- init ---------------- */
  const last = store.get(LAST, null);
  if (last) writeForm(last);
  renderSaved();
  route();
})();
