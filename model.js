/* RoastCast — roast model.
 * A heuristic, rules-of-thumb model that turns green-bean properties into a
 * *recommended target* bean-temperature profile for a small hot-air sample
 * roaster (tuned around a Kaffelogic Nano 7, 120 g default batch).
 * It is NOT a physics simulation: treat every number as a starting point and
 * calibrate against your own roasts.
 */
'use strict';

const RoastModel = (() => {
  // [name, typical elevation masl, hardness nudge, tip]
  const ORIGINS = [
    ['Brazil', 1100, -0.25, 'Often lower density naturals/pulped naturals: keep Maillard gentle and don’t drag development.'],
    ['Burundi', 1700, 0.1, 'Dense and bright. Sort for potato-taste defect before roasting.'],
    ['China (Yunnan)', 1500, 0, ''],
    ['Colombia', 1650, 0.05, 'Usually dense and washed; tolerates assertive early heat.'],
    ['Costa Rica', 1450, 0, 'Honeys are common — ease heat into colour change to avoid scorching.'],
    ['DR Congo', 1700, 0.05, ''],
    ['Ecuador', 1600, 0.05, ''],
    ['El Salvador', 1300, -0.1, 'Pacamara is large and soft — use gentler heat.'],
    ['Ethiopia', 1950, 0.1, 'Small, dense heirloom beans. Protect florals: avoid long development.'],
    ['Guatemala', 1550, 0.05, ''],
    ['Hawaii (Kona)', 600, -0.2, 'Low elevation, softer bean.'],
    ['Honduras', 1400, -0.05, ''],
    ['India', 1100, -0.15, ''],
    ['Indonesia (Java)', 1400, -0.05, ''],
    ['Indonesia (Sulawesi)', 1500, 0, ''],
    ['Indonesia (Sumatra)', 1400, -0.1, 'Usually wet-hulled: high moisture, uneven — extend drying, finish gently.'],
    ['Jamaica', 1200, -0.1, ''],
    ['Kenya', 1750, 0.2, 'Very dense SL28/SL34: strong early energy, slightly longer development.'],
    ['Mexico', 1300, -0.05, ''],
    ['Myanmar', 1300, -0.05, ''],
    ['Nicaragua', 1200, -0.1, 'Large-screen varieties (Maragogype etc.) roast unevenly — go gentler.'],
    ['Panama', 1600, 0.05, 'Geisha is delicate: lighter roast, short development.'],
    ['Papua New Guinea', 1600, 0, ''],
    ['Peru', 1650, 0, ''],
    ['Rwanda', 1750, 0.1, 'Dense and juicy. Sort for potato-taste defect.'],
    ['Tanzania', 1600, 0.05, 'Peaberry is common — rolls well and roasts slightly faster.'],
    ['Thailand', 1200, -0.1, ''],
    ['Uganda', 1500, 0, ''],
    ['Vietnam', 900, -0.2, ''],
    ['Yemen', 2000, 0.1, 'Small, irregular naturals — gentle Maillard, watch for scorching.'],
    ['Other / blend', 1400, 0, ''],
  ].map(([name, elev, h, tip]) => ({ name, elev, h, tip }));

  // Offsets per process. dry/mail in seconds, fc/dT in °C, dtr as fraction, wl in % points.
  const PROCESS = {
    washed:    { label: 'Washed', dry: 0, mail: 0, fc: 0, dtr: 0, dT: 0, wl: 0, tip: '' },
    honey:     { label: 'Honey / pulped natural', dry: 0, mail: 6, fc: -1, dtr: -0.005, dT: -0.5, wl: 0.2, tip: 'Honey: sticky sugars brown early — ease heat before colour change.' },
    natural:   { label: 'Natural / dry', dry: -5, mail: 10, fc: -1.5, dtr: -0.01, dT: -1, wl: 0.3, tip: 'Natural: gentler Maillard and a slightly shorter development keep the fruit and avoid a smoky finish.' },
    anaerobic: { label: 'Anaerobic / experimental', dry: -5, mail: 12, fc: -2, dtr: -0.015, dT: -2, wl: 0.3, tip: 'Anaerobic: very sugar-rich and fragile — lowest heat through Maillard, drop early.' },
    wethulled: { label: 'Wet-hulled (Giling Basah)', dry: 20, mail: 0, fc: -1, dtr: 0, dT: 0, wl: 0.8, tip: 'Wet-hulled: extra drying time to drive off moisture evenly.' },
    decaf:     { label: 'Decaf', dry: -15, mail: -10, fc: -6, dtr: -0.01, dT: -4, wl: -0.5, tip: 'Decaf browns early and looks darker than it is: roast by temperature, not colour. First crack is quiet.' },
  };

  // dtr = development time ratio, dT = rise after FC to drop, wl = base weight loss %,
  // kl = approximate Kaffelogic level, agtron = expected whole-bean range.
  const LEVELS = {
    light:         { label: 'Light (Nordic filter)', dtr: 0.16, dT: 8, wl: 12.3, kl: 1.8, agtron: '75–85' },
    'light-medium':{ label: 'Light-medium (filter / omni)', dtr: 0.185, dT: 11, wl: 13.4, kl: 2.5, agtron: '65–75' },
    medium:        { label: 'Medium (omni / espresso)', dtr: 0.21, dT: 14, wl: 14.6, kl: 3.2, agtron: '55–65' },
    'medium-dark': { label: 'Medium-dark (espresso)', dtr: 0.23, dT: 18, wl: 16.0, kl: 4.0, agtron: '45–55' },
    dark:          { label: 'Dark (traditional espresso)', dtr: 0.25, dT: 23, wl: 18.0, kl: 5.0, agtron: '35–45' },
  };

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

  /* ---- cubic Hermite evaluation. Knot slopes (ms, °C/s) are chosen so each
     segment is exactly quadratic, i.e. RoR falls linearly between milestones.
     The same knots + slopes become Bezier control points for the export. ---- */
  function evalSpline(k, x) {
    const { xs, ys, ms } = k;
    let i = 0;
    while (i < xs.length - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = clamp((x - xs[i]) / h, 0, 1);
    const t2 = t * t, t3 = t2 * t;
    const T = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * ms[i] +
              (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * ms[i + 1];
    const dT = ((6 * t2 - 6 * t) * ys[i] + (3 * t2 - 4 * t + 1) * h * ms[i] +
               (-6 * t2 + 6 * t) * ys[i + 1] + (3 * t2 - 2 * t) * h * ms[i + 1]) / h;
    return { T, ror: dT * 60 }; // °C and °C/min
  }

  /* ------------------------------ simulate ------------------------------ */
  function simulate(raw) {
    const inp = { ...raw };
    let density = +inp.density;
    if (density > 0 && density < 5) density *= 1000; // accept g/mL
    const moisture = +inp.moisture;
    const origin = ORIGINS.find(o => o.name === inp.origin) || ORIGINS[ORIGINS.length - 1];
    const elevation = inp.elevation === '' || inp.elevation == null ? origin.elev : +inp.elevation;
    const year = new Date().getFullYear();
    const age = clamp(year - +inp.harvestYear, 0, 15);
    const ageOld = Math.max(0, age - 1); // past-crop years
    const proc = PROCESS[inp.process] || PROCESS.washed;
    const lvl = LEVELS[inp.level] || LEVELS.medium;
    const batch = clamp(+inp.batch || 120, 30, 250);
    const ambient = inp.ambient === '' || inp.ambient == null ? 22 : clamp(+inp.ambient, 0, 45);
    const screen = inp.screen ? +inp.screen : 16;

    // normalised bean descriptors (0 = typical)
    const dN = clamp((density - 700) / 40, -2.5, 2.5);
    const mN = clamp((moisture - 10.5) / 1.5, -2.5, 2.5);
    const eN = clamp((elevation - 1500) / 500, -3, 2.5);
    const sN = clamp((screen - 16) / 2, -2, 2);
    const hardness = clamp(0.6 * dN + 0.2 * eN + 0.2 * mN - 0.25 * ageOld + origin.h, -3, 3);

    const batchF = clamp(1 + 0.0012 * (batch - 120), 0.9, 1.2);
    const ambF = 1 + 0.004 * (22 - ambient);

    const dry = (255 + 12 * mN + 8 * dN + 4 * sN - 8 * ageOld + proc.dry) * batchF * ambF;
    const ccTemp = 157 + 1.5 * dN + 0.5 * mN;
    const mail = (205 + 12 * hardness + 5 * sN + proc.mail) * batchF;
    const fcTemp = 202 + 2 * hardness + proc.fc;
    const fcTime = dry + mail;
    const dtr = clamp(lvl.dtr + 0.005 * hardness + proc.dtr, 0.12, 0.3);
    const dev = fcTime * dtr / (1 - dtr);
    const total = fcTime + dev;
    const dropTemp = Math.min(fcTemp + lvl.dT + 1.0 * hardness + proc.dT, 235);
    const weightLoss = clamp(lvl.wl + 0.7 * (moisture - 10.5) + proc.wl + 0.25 * (dtr - lvl.dtr) * 100, 9, 24);

    // Target curve = piecewise-linear, always-declining rate of rise (RoR), so
    // temperature is piecewise quadratic and passes exactly through each milestone.
    // Solved backwards from the drop: each segment's average RoR = (rStart + rEnd) / 2.
    const avgDev = (dropTemp - fcTemp) / dev;          // °C/s
    const avgMail = (fcTemp - ccTemp) / mail;
    let rFc = Math.min(1.45 * avgDev, 0.9 * avgMail);  // keep RoR falling into FC
    const rDrop = Math.max(2 * avgDev - rFc, 0.2 * avgDev);
    rFc = 2 * avgDev - rDrop;
    const rCc = 2 * avgMail - rFc;
    const t1 = 0.3 * dry;                               // split drying for a fast early decline
    const rLin0 = 2 * (ccTemp - ambient) / dry - rCc;  // RoR at t=0 if drying were linear
    const r1 = rCc + clamp(0.45 + 0.03 * hardness, 0.35, 0.55) * (rLin0 - rCc);
    const T1 = ccTemp - (r1 + rCc) / 2 * (dry - t1);
    const r0 = 2 * (T1 - ambient) / t1 - r1;
    const xs = [0, t1, dry, fcTime, total];
    const ys = [ambient, T1, ccTemp, fcTemp, dropTemp];
    const k = { xs, ys, ms: [r0, r1, rCc, rFc, rDrop] };

    // extended curve (for roaster export): 90 s of headroom past drop at a still-falling RoR
    const rExt = rDrop * 0.6;
    const kExt = { xs: [...xs, total + 90], ys: [...ys, Math.min(dropTemp + (rDrop + rExt) / 2 * 90, 245)], ms: [...k.ms, rExt] };

    const curve = [];
    for (let t = 0; t <= Math.ceil(total); t += 2) curve.push({ t, ...evalSpline(k, Math.min(t, total)) });

    const at = (t) => evalSpline(k, t);
    const phaseRoR = (a, b) => round((evalSpline(k, b).T - evalSpline(k, a).T) / (b - a) * 60, 1);

    const milestones = [
      { key: 'start', label: 'Start (ambient)', t: 0, T: ambient, ror: null },
      { key: 'cc', label: 'Colour change / yellow', t: dry, T: ccTemp, ror: at(dry).ror },
      { key: 'fc', label: 'First crack', t: fcTime, T: fcTemp, ror: at(fcTime).ror },
      { key: 'drop', label: 'Drop / end of roast', t: total, T: dropTemp, ror: at(total).ror },
    ];
    if (inp.level === 'dark' || inp.level === 'medium-dark') {
      const scT = fcTemp + 22;
      if (scT <= dropTemp + 1) {
        let t = fcTime; while (t < total && at(t).T < scT) t += 1;
        milestones.splice(3, 0, { key: 'sc', label: 'Second crack (approx.)', t, T: scT, ror: at(t).ror });
      }
    }

    // flags / guidance
    const flags = [];
    if (density < 640) flags.push({ type: 'warn', text: `Low density (${round(density, 0)} g/L): soft bean — lower heat, risk of tipping/scorching and running away after first crack.` });
    if (density > 780) flags.push({ type: 'warn', text: `Very high density (${round(density, 0)} g/L): needs strong early energy; underdevelopment (grassy/sour) is the main risk.` });
    if (moisture > 12.5) flags.push({ type: 'warn', text: `High moisture (${moisture}%): above SCA’s 8–12.5% range. Mould risk in storage; drying runs long and first crack may be loud/uneven.` });
    if (moisture < 9) flags.push({ type: 'warn', text: `Low moisture (${moisture}%): dry or aged coffee roasts fast; reduce heat and watch for flat, papery cups.` });
    if (ageOld >= 1) flags.push({ type: 'warn', text: `Past crop (${age} yr since harvest): expect faded acidity. The profile is shortened and gentler.` });
    if (+inp.harvestYear > year) flags.push({ type: 'warn', text: 'Harvest year is in the future — check the input.' });
    if (batch > 120) flags.push({ type: 'info', text: `Batch ${batch} g is above the Nano 7’s 120 g default — use the roaster’s BOOST setting for larger batches.` });
    if (batch < 80) flags.push({ type: 'info', text: `Small batch (${batch} g): small batches are more sensitive to heat; check the profile tracks the curve.` });
    if (proc.tip) flags.push({ type: 'info', text: proc.tip });
    if (origin.tip) flags.push({ type: 'info', text: `${origin.name}: ${origin.tip}` });
    if (dev < 60) flags.push({ type: 'warn', text: 'Development under 60 s: high risk of underdeveloped, sour cups.' });
    if (dev > 180) flags.push({ type: 'warn', text: 'Development over 3 min: risk of baked/flat flavour.' });

    const phases = [
      { key: 'dry', label: 'Drying', from: 0, to: dry, ror: phaseRoR(Math.min(30, dry / 4), dry) },
      { key: 'mail', label: 'Maillard', from: dry, to: fcTime, ror: phaseRoR(dry, fcTime) },
      { key: 'dev', label: 'Development', from: fcTime, to: total, ror: phaseRoR(fcTime, total) },
    ].map(p => ({ ...p, dur: p.to - p.from, pct: round((p.to - p.from) / total * 100, 1) }));

    return {
      inputs: { ...inp, density: round(density, 0), elevation, batch, ambient },
      origin, proc, lvl, age, hardness: round(hardness, 2),
      dry, mail, fcTime, fcTemp, ccTemp, dev, dtr, total, dropTemp,
      weightLoss: round(weightLoss, 1), roastedWeight: round(batch * (1 - weightLoss / 100), 1),
      kaffelogicLevel: round(clamp(lvl.kl + 0.1 * hardness, 0.5, 6), 1),
      curve, knots: k, knotsExt: kExt, milestones, phases, flags,
      generated: new Date().toISOString(),
    };
  }

  /* ----------------------- Kaffelogic .kpro export ----------------------- *
   * Kaffelogic does not publish the .kpro layout. Files are plain text
   * `key:value` lines and curves are Bezier splines; the exact ordering of
   * control points is inferred. When a base profile from Kaffelogic Studio is
   * supplied we keep every other setting (fan, zones, levels…) and match its
   * curve layout.
   */
  const LAYOUTS = {
    polybezier: 'Bezier spline: point, handle, handle, point…',
    'in-p-out': 'Per point: in-handle, point, out-handle',
    'p-in-out': 'Per point: point, in-handle, out-handle',
    pairs: 'Points only (time, temp)',
  };

  function parseKpro(text) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const entries = lines.map(l => {
      const i = l.indexOf(':');
      return i > 0 ? { key: l.slice(0, i).trim(), value: l.slice(i + 1), raw: l } : { key: null, raw: l };
    });
    const get = (k) => (entries.find(e => e.key === k) || {}).value;
    return { eol, entries, get };
  }

  function detectLayout(curveStr) {
    if (!curveStr) return 'polybezier';
    const n = curveStr.split(',').map(Number).filter(v => !isNaN(v));
    if (n.length % 2) return 'pairs';
    if (n.length % 6 === 2) return 'polybezier';
    if (n.length % 6 === 0) {
      let sorted = 0, pFirst = 0;
      for (let i = 0; i + 5 < n.length; i += 6) {
        const a = n[i], b = n[i + 2], c = n[i + 4];
        if (a <= b && b <= c) sorted++;
        if (b <= a && a <= c) pFirst++;
      }
      return pFirst > sorted ? 'p-in-out' : 'in-p-out';
    }
    return 'pairs';
  }

  function encodeCurve(k, layout) {
    const f = v => String(+v.toFixed(2));
    const n = k.xs.length, out = [];
    const P = i => [k.xs[i], k.ys[i]];
    const cOut = i => { if (i >= n - 1) return P(i); const h = (k.xs[i + 1] - k.xs[i]) / 3; return [k.xs[i] + h, k.ys[i] + k.ms[i] * h]; };
    const cIn = i => { if (i <= 0) return P(i); const h = (k.xs[i] - k.xs[i - 1]) / 3; return [k.xs[i] - h, k.ys[i] - k.ms[i] * h]; };
    for (let i = 0; i < n; i++) {
      if (layout === 'pairs') out.push(P(i));
      else if (layout === 'polybezier') { out.push(P(i)); if (i < n - 1) out.push(cOut(i), cIn(i + 1)); }
      else if (layout === 'p-in-out') out.push(P(i), cIn(i), cOut(i));
      else out.push(cIn(i), P(i), cOut(i));
    }
    return out.flat().map(f).join(',');
  }

  function shortName(name) {
    const s = (name || 'RoastCast').replace(/[^A-Za-z0-9 \-]/g, '').trim() || 'RoastCast';
    return s.slice(0, 12);
  }

  function buildKpro(res, opts = {}) {
    const layout = opts.layout && opts.layout !== 'auto' ? opts.layout
      : detectLayout(opts.base ? opts.base.get('roast_profile') : null);
    const desc = `RoastCast target: ${res.inputs.origin}, ${res.inputs.process}, ${res.inputs.density} g/L, ` +
      `${res.inputs.moisture}% H2O, ${res.inputs.elevation} masl, harvest ${res.inputs.harvestYear}. ` +
      `FC ${fmtTime(res.fcTime)} @ ${round(res.fcTemp)}C, drop ${fmtTime(res.total)} @ ${round(res.dropTemp)}C, DTR ${round(res.dtr * 100)}%.`;
    const values = {
      profile_short_name: shortName(res.inputs.name),
      profile_designer: 'RoastCast',
      profile_description: desc,
      recommended_level: res.kaffelogicLevel.toFixed(1),
      expect_colrchange: res.ccTemp.toFixed(1),
      expect_fc: res.fcTemp.toFixed(1),
      roast_profile: encodeCurve(res.knotsExt, layout),
    };
    let text;
    if (opts.base) {
      const seen = new Set();
      const lines = opts.base.entries.map(e => {
        if (e.key && e.key in values) { seen.add(e.key); return `${e.key}:${values[e.key]}`; }
        return e.raw;
      });
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      for (const key of Object.keys(values)) if (!seen.has(key)) lines.push(`${key}:${values[key]}`);
      text = lines.join(opts.base.eol) + opts.base.eol;
    } else {
      text = Object.entries(values).map(([k, v]) => `${k}:${v}`).join('\n') + '\n';
    }
    return { text, layout, filename: `${shortName(res.inputs.name).replace(/\s+/g, '_')}.kpro` };
  }

  function buildCsv(res) {
    const rows = ['time_s,time_mmss,bean_temp_c,ror_c_per_min,phase'];
    for (let t = 0; t <= Math.ceil(res.total); t += 15) {
      const tt = Math.min(t, res.total);
      const p = evalSpline(res.knots, tt);
      const phase = tt < res.dry ? 'drying' : tt < res.fcTime ? 'maillard' : 'development';
      rows.push([tt.toFixed(0), fmtTime(tt), p.T.toFixed(1), t === 0 ? '' : p.ror.toFixed(1), phase].join(','));
    }
    rows.push('', 'event,time_s,time_mmss,bean_temp_c');
    for (const m of res.milestones) rows.push([m.label, m.t.toFixed(0), fmtTime(m.t), m.T.toFixed(1)].join(','));
    rows.push('', `weight_loss_pct,${res.weightLoss}`, `roasted_weight_g,${res.roastedWeight}`,
      `development_s,${res.dev.toFixed(0)}`, `dtr_pct,${(res.dtr * 100).toFixed(1)}`, `kaffelogic_level_est,${res.kaffelogicLevel}`);
    return rows.join('\n') + '\n';
  }

  function fmtTime(s) {
    s = Math.round(s);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return { ORIGINS, PROCESS, LEVELS, LAYOUTS, simulate, parseKpro, detectLayout, buildKpro, buildCsv, evalSpline, fmtTime, round };
})();

if (typeof module !== 'undefined') module.exports = RoastModel;
