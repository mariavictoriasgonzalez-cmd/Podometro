/* Pasito · Podómetro — app sin dependencias. Datos guardados en el dispositivo (localStorage). */
(() => {
  'use strict';

  // ================= Utilidades =================
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const todayKey = () => keyOf(new Date());
  const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); };
  const fmt = n => { const v = Math.round(n), a = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return v < 0 ? '-' + a : a; };
  const fmtK = n => n >= 1e6 ? (n / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + 'M' : n >= 1000 ? (n / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + 'k' : fmt(n);
  const fmtDur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${pad(m)} min` : `${m} min`; };
  const fmtClock = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${pad(m)}:${pad(x)}`; };
  const fmtKm = km => km.toLocaleString('es-ES', { maximumFractionDigits: km < 10 ? 2 : 1 });
  const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const DOW_LONG = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ================= Estado =================
  const STORE = 'pasito.v1';
  const WALK_MIN = 15;   // pasos/minuto a partir de los que un minuto cuenta como "caminando"
  const defaults = () => ({
    settings: {
      name: '',
      avatar: 'pipo',
      mascotName: 'Pipo',
      mascotColor: '#FF8A4C',
      dailyGoal: 8000,
      weeklyGoal: 50000,
      strideCm: 72,
      weightKg: 70,
      theme: 'auto',
      dailyMilestones: [1000, 5000, 8000, 10000, 15000, 20000],
      weeklyMilestones: [35000, 50000, 70000, 100000],
      totalMilestones: [10000, 50000, 100000, 250000, 500000, 1000000],
      onboarded: false,
      hideTips: {},
    },
    // 'YYYY-MM-DD' -> { auto: { minutoDelDía: pasos }, sessions: [registros manuales] }
    days: {},
    badges: {},     // id -> { at, count }
    lastSync: 0,    // último minuto (desde epoch) sincronizado con el contador del móvil
  });

  let S = load();
  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return defaults();
      const d = JSON.parse(raw), base = defaults();
      delete d.live;
      return { ...base, ...d, settings: { ...base.settings, ...(d.settings || {}) } };
    } catch { return defaults(); }
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { /* sin espacio o modo privado */ } }

  const dayOf = k => S.days[k] || { sessions: [], auto: {} };
  const autoOf = k => (S.days[k] && S.days[k].auto) || {};
  const manualOf = k => (S.days[k] && S.days[k].sessions) || [];
  const sumVals = o => { let t = 0; for (const v of Object.values(o)) t += v; return t; };
  const daySteps = k => sumVals(autoOf(k)) + manualOf(k).reduce((a, s) => a + s.steps, 0);
  const activeMins = k => Object.values(autoOf(k)).filter(v => v >= WALK_MIN).length;
  const daySecs = k => activeMins(k) * 60 + manualOf(k).reduce((a, s) => a + s.seconds, 0);
  const kmOf = steps => steps * S.settings.strideCm / 100000;
  const kcalOf = steps => steps * 0.04 * (S.settings.weightKg / 70);
  const hasData = k => !!S.days[k] && (manualOf(k).length > 0 || Object.keys(autoOf(k)).length > 0);
  const allKeys = () => Object.keys(S.days).filter(hasData).sort();
  const weekSteps = monday => { let t = 0; for (let i = 0; i < 7; i++) t += daySteps(keyOf(addDays(monday, i))); return t; };
  const ensureDay = k => { if (!S.days[k]) S.days[k] = { sessions: [], auto: {} }; if (!S.days[k].auto) S.days[k].auto = {}; if (!S.days[k].sessions) S.days[k].sessions = []; return S.days[k]; };

  function addSession(k, sess) {
    const d = ensureDay(k);
    d.sessions.push(sess);
    d.sessions.sort((a, b) => a.start - b.start);
  }

  // Caminatas detectadas solas: minutos seguidos caminando (huecos de hasta 2 min), de 5 min o más.
  const walkCache = new Map();
  function autoWalks(k) {
    const auto = autoOf(k);
    const sig = Object.keys(auto).length + ':' + sumVals(auto);
    const c = walkCache.get(k); if (c && c.sig === sig) return c.walks;
    const mins = Object.keys(auto).map(Number).sort((a, b) => a - b);
    const walks = []; let cur = null;
    const base = parseKey(k).getTime();
    for (const m of mins) {
      const v = auto[m];
      if (v < WALK_MIN) { if (cur && m - cur.last <= 2) cur.steps += v; continue; }
      if (cur && m - cur.last <= 3) { cur.last = m; cur.steps += v; cur.active++; }
      else { if (cur) walks.push(cur); cur = { first: m, last: m, steps: v, active: 1 }; }
    }
    if (cur) walks.push(cur);
    const out = walks.filter(w => w.last - w.first + 1 >= 5).map(w => ({
      id: `a${k}-${w.first}`, start: base + w.first * 60000, end: base + (w.last + 1) * 60000,
      steps: w.steps, seconds: w.active * 60, source: 'auto',
    }));
    walkCache.set(k, { sig, walks: out });
    return out;
  }
  const sessionsOf = k => [...autoWalks(k), ...manualOf(k)].sort((a, b) => a.start - b.start);
  const hourly = k => { const h = Array(24).fill(0); for (const [m, v] of Object.entries(autoOf(k))) h[Math.floor(m / 60)] += v; for (const s of manualOf(k)) h[new Date(s.start).getHours()] += s.steps; return h; };
  // ¿Estás caminando ahora mismo? (pasos en los últimos 3 minutos)
  function walkingNow() {
    const now = new Date(), k = keyOf(now), m = now.getHours() * 60 + now.getMinutes(), a = autoOf(k);
    return ((a[m] || 0) + (a[m - 1] || 0) + (a[m - 2] || 0)) >= 40;
  }

  // ================= Mascota (avatares) =================
  const AVATARS = {
    pipo: { name: 'Pipo', color: '#FF8A4C', desc: 'Una bolita con mucha energía' },
    misi: { name: 'Misi', color: '#B39CFF', desc: 'Gata curiosa y paseadora' },
    toby: { name: 'Toby', color: '#D29A66', desc: 'Perrito que nunca se cansa' },
    copo: { name: 'Copo', color: '#FF5C9A', desc: 'Pingüino con bufanda' },
    rex:  { name: 'Rex',  color: '#5FCB72', desc: 'Dino de pasos gigantes' },
  };
  const OUT = '#2A1F3D';

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  function mascotSVG(mood = 'happy', avatar = S.settings.avatar, color = S.settings.mascotColor) {
    if (!AVATARS[avatar]) avatar = 'pipo';
    const dark = shade(color, -45), light = shade(color, 55);
    const sleepy = mood === 'sleepy', party = mood === 'party';
    const B = 'M56 18 C86 18 96 42 96 66 C96 92 80 104 56 104 C32 104 16 92 16 66 C16 42 26 18 56 18Z';
    let back = '', body = '', front = '', arm = dark, mouthOn = true;

    if (avatar === 'pipo') {
      body = `<path d="M56 14 C84 14 96 38 96 64 C96 90 80 104 56 104 C32 104 16 90 16 64 C16 38 28 14 56 14Z" fill="${color}" stroke="${OUT}" stroke-width="2.5"/>
        <path d="M30 40 C34 28 44 22 54 21" stroke="${light}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/>
        <path d="M52 15 q-2 -9 6 -11 q-1 6 3 10" fill="${dark}" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>
        <path d="M24 46 Q56 30 88 46" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/>
        <path d="M24 46 Q56 30 88 46" stroke="#7B61FF" stroke-width="2.5" fill="none" stroke-dasharray="4 5" stroke-linecap="round"/>`;
    } else if (avatar === 'misi') {
      back = `<path d="M86 94 q24 -2 16 -32" stroke="${OUT}" stroke-width="11" fill="none" stroke-linecap="round"/><path d="M86 94 q24 -2 16 -32" stroke="${color}" stroke-width="6.5" fill="none" stroke-linecap="round"/>
        <path d="M22 48 L24 8 L52 22 Z" fill="${color}" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round"/><path d="M28 36 L29 17 L44 25 Z" fill="#FFB3C7"/>
        <path d="M90 48 L88 8 L60 22 Z" fill="${color}" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round"/><path d="M84 36 L83 17 L68 25 Z" fill="#FFB3C7"/>`;
      body = `<path d="${B}" fill="${color}" stroke="${OUT}" stroke-width="2.5"/>
        <path d="M49 24 v7 M56 22 v8 M63 24 v7" stroke="${dark}" stroke-width="3" stroke-linecap="round"/>
        <path d="M32 40 C36 30 44 25 50 24" stroke="${light}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/>`;
      front = `<path d="M28 66 L12 62 M28 70 L12 72 M84 66 L100 62 M84 70 L100 72" stroke="${OUT}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M52.5 63.5 h7 l-3.5 3.5z" fill="#FF7A9A"/>`;
    } else if (avatar === 'toby') {
      body = `<path d="${B}" fill="${color}" stroke="${OUT}" stroke-width="2.5"/>
        <ellipse cx="68" cy="55" rx="12" ry="11" fill="${light}"/>
        <path d="M32 40 C36 30 44 25 52 23" stroke="${light}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".7"/>`;
      front = `<path d="M26 28 q-18 4 -14 36 q5 10 15 1 q1 -21 7 -31z" fill="${dark}" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M86 28 q18 4 14 36 q-5 10 -15 1 q-1 -21 -7 -31z" fill="${dark}" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round"/>
        <ellipse cx="56" cy="64.5" rx="5" ry="3.6" fill="${OUT}"/>
        <path d="M28 90 Q56 102 84 90" stroke="#7B61FF" stroke-width="5" fill="none" stroke-linecap="round"/>
        <circle cx="56" cy="98" r="4.5" fill="#F5B301" stroke="${OUT}" stroke-width="1.5"/>`;
    } else if (avatar === 'copo') {
      arm = '#2F3A56';
      body = `<path d="${B}" fill="#2F3A56" stroke="${OUT}" stroke-width="2.5"/>
        <path d="M56 32 C76 32 86 46 86 64 C86 86 72 100 56 100 C40 100 26 86 26 64 C26 46 36 32 56 32Z" fill="#fff"/>
        <path d="M34 30 C40 24 46 22 52 21" stroke="#56628A" stroke-width="4" fill="none" stroke-linecap="round"/>`;
      front = `<path d="M49.5 63 h13 l-6.5 7z" fill="#FFB020" stroke="${OUT}" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M22 82 Q56 98 90 82" stroke="${color}" stroke-width="9" fill="none" stroke-linecap="round"/>
        <path d="M70 90 l5 14" stroke="${color}" stroke-width="7" stroke-linecap="round"/>
        <path d="M30 86 l4 2 M44 91 l4 1 M60 92 l4 -1" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/>`;
      mouthOn = party;
    } else if (avatar === 'rex') {
      back = `<path d="M24 90 q-22 6 -20 -16 q8 10 22 4z" fill="${color}" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M32 32 l4 -16 l10 10z M48 22 l8 -16 l8 16z M66 26 l10 -10 l4 16z" fill="${light}" stroke="${OUT}" stroke-width="2.5" stroke-linejoin="round"/>`;
      body = `<path d="${B}" fill="${color}" stroke="${OUT}" stroke-width="2.5"/>
        <ellipse cx="56" cy="90" rx="22" ry="11" fill="${light}" opacity=".75"/>
        <circle cx="28" cy="52" r="3" fill="${dark}" opacity=".5"/><circle cx="86" cy="58" r="2.5" fill="${dark}" opacity=".5"/><circle cx="80" cy="38" r="3.2" fill="${dark}" opacity=".5"/>`;
    }

    const eyes = sleepy
      ? `<path d="M40 58 q5 4 10 0 M62 58 q5 4 10 0" stroke="${OUT}" stroke-width="3" fill="none" stroke-linecap="round"/>`
      : party
        ? `<path d="M39 59 q6 -8 12 0 M61 59 q6 -8 12 0" stroke="${OUT}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`
        : `<g class="m-eyes"><ellipse cx="45" cy="56" rx="5" ry="6.2" fill="${OUT}"/><ellipse cx="67" cy="56" rx="5" ry="6.2" fill="${OUT}"/><circle cx="46.8" cy="53.8" r="1.8" fill="#fff"/><circle cx="68.8" cy="53.8" r="1.8" fill="#fff"/></g>`;
    const mouth = !mouthOn ? '' : sleepy
      ? `<ellipse cx="56" cy="73" rx="3" ry="2.4" fill="${OUT}"/>`
      : party || mood === 'walking'
        ? `<path d="M47 70 q9 12 18 0 z" fill="${OUT}"/><path d="M51 74 q5 4 10 0" fill="#FF5C7A"/>`
        : `<path d="M49 70 q7 7 14 0" stroke="${OUT}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    const shoe = (x, cls) => `<g class="${cls}"><path d="M${x} 100 h20 a6 6 0 0 1 6 6 v2 a2 2 0 0 1 -2 2 h-26 a6 6 0 0 1 -6 -6 a4 4 0 0 1 8 -4z" fill="#fff" stroke="${OUT}" stroke-width="2.5"/><path d="M${x - 2} 108 h28" stroke="${avatar === 'copo' ? color : color}" stroke-width="2.5"/></g>`;
    return `
<svg class="mascot is-${mood}" viewBox="-4 -4 120 124" aria-hidden="true">
  <ellipse cx="56" cy="113" rx="30" ry="4.5" fill="${OUT}" opacity=".10"/>
  <g class="m-body">
    ${back}
    ${shoe(30, 'm-foot-l')}${shoe(62, 'm-foot-r')}
    <path class="m-arm-l" d="M20 62 q-10 6 -8 18" stroke="${arm}" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path class="m-arm-r" d="M92 62 q10 6 8 18" stroke="${arm}" stroke-width="7" fill="none" stroke-linecap="round"/>
    ${body}
    ${eyes}
    <ellipse cx="35" cy="68" rx="5.5" ry="3.5" fill="#FF5C7A" opacity=".35"/>
    <ellipse cx="77" cy="68" rx="5.5" ry="3.5" fill="#FF5C7A" opacity=".35"/>
    ${front}
    ${mouth}
  </g>
  ${sleepy ? `<text class="m-zzz" x="90" y="20" font-family="Nunito, sans-serif" font-weight="900" font-size="16" fill="#7B61FF">z</text>` : ''}
  ${party ? `<g font-size="14"><text x="-2" y="22">✨</text><text x="94" y="14">🎉</text></g>` : ''}
</svg>`;
  }

  function mascotMood(steps, goal) {
    if (walkingNow()) return 'walking';
    if (steps >= goal) return 'party';
    const h = new Date().getHours();
    if (steps < 50 && (h < 9 || h >= 22)) return 'sleepy';
    return 'happy';
  }

  function mascotLine(steps, goal) {
    const n = S.settings.name ? `, ${S.settings.name}` : '';
    const left = Math.max(0, goal - steps);
    const pct = steps / goal;
    const h = new Date().getHours();
    const pick = arr => arr[(new Date().getDate() + Math.floor(steps / 500)) % arr.length];
    if (walkingNow()) return pick(['¡Te veo caminando! Sigue así 💪', '¡Vamos, vamos! Cada paso cuenta 👟', '¡Qué buen ritmo llevas!']);
    if (pct >= 1.5) return pick([`¡Leyenda${n}! Has superado tu objetivo con creces 🔥`, '¡Hoy estás imparable! 🚀']);
    if (pct >= 1) return pick([`¡Objetivo cumplido${n}! Qué orgullo 🎉`, '¡Lo lograste! Hoy toca celebrarlo 🥳']);
    if (pct >= .75) return `¡Casi lo tienes! Solo ${fmt(left)} pasos más 🙌`;
    if (pct >= .5) return pick([`¡Ya vas por la mitad${n}! Un paseíto y lo rematas`, `Te quedan ${fmt(left)} pasos. ¡Tú puedes!`]);
    if (steps > 0) return pick([`¡Buen comienzo! Faltan ${fmt(left)} pasos`, '¿Un paseo después de comer? Me apunto 🚶']);
    if (h < 12) return `¡Buenos días${n}! ¿Damos los primeros pasos? ☀️`;
    if (h < 20) return `¡Hola${n}! Aún hay tiempo para un buen paseo 🌳`;
    return `Un paseo cortito antes de dormir sienta genial 🌙`;
  }

  // ================= Insignias =================
  // tiers según importancia
  const tierFor = (v, arr) => { const i = arr.indexOf(v), r = i / Math.max(1, arr.length - 1); return r < .25 ? 't-bronze' : r < .55 ? 't-silver' : r < .85 ? 't-gold' : 't-diamond'; };
  const dailyEmoji = ['👟', '🚶', '🎯', '🏅', '🔥', '🚀', '🌟', '👑'];
  const weeklyEmoji = ['📅', '💪', '🏆', '🦸', '🌍'];
  const totalEmoji = ['🌱', '🌿', '🌳', '⛰️', '🏔️', '🌕', '🪐'];

  function computeStats() {
    const keys = allKeys();
    const goal = S.settings.dailyGoal;
    const dayVals = keys.map(k => ({ k, steps: daySteps(k), secs: daySecs(k) }));
    // racha
    let best = 0, cur = 0, prev = null;
    const metKeys = dayVals.filter(d => d.steps >= goal).map(d => d.k).sort();
    for (const k of metKeys) {
      if (prev && keyOf(addDays(parseKey(prev), 1)) === k) cur++; else cur = 1;
      best = Math.max(best, cur); prev = k;
    }
    // racha actual (hasta hoy o ayer)
    let current = 0; let d = new Date();
    if (daySteps(keyOf(d)) < goal) d = addDays(d, -1);
    while (daySteps(keyOf(d)) >= goal) { current++; d = addDays(d, -1); }
    // semanas
    const weeks = {};
    for (const dv of dayVals) { const m = keyOf(mondayOf(parseKey(dv.k))); weeks[m] = (weeks[m] || 0) + dv.steps; }
    const sessions = [];
    for (const k of keys) sessions.push(...sessionsOf(k));
    return { dayVals, best, current, weeks, sessions, total: dayVals.reduce((a, x) => a + x.steps, 0) };
  }

  function badgeCatalog(st) {
    const cfg = S.settings;
    const maxDay = Math.max(0, ...st.dayVals.map(d => d.steps));
    const maxWeek = Math.max(0, ...Object.values(st.weeks));
    const out = [];
    [...cfg.dailyMilestones].sort((a, b) => a - b).forEach((v, i, arr) => out.push({
      id: `d${v}`, group: 'Hitos diarios', name: `${fmtK(v)} en un día`, desc: `Camina ${fmt(v)} pasos en un solo día`,
      icon: dailyEmoji[Math.min(i, dailyEmoji.length - 1)], tier: tierFor(v, arr),
      progress: maxDay / v, count: st.dayVals.filter(d => d.steps >= v).length,
    }));
    [...cfg.weeklyMilestones].sort((a, b) => a - b).forEach((v, i, arr) => out.push({
      id: `w${v}`, group: 'Retos semanales', name: `Semana de ${fmtK(v)}`, desc: `Suma ${fmt(v)} pasos de lunes a domingo`,
      icon: weeklyEmoji[Math.min(i, weeklyEmoji.length - 1)], tier: tierFor(v, arr),
      progress: maxWeek / v, count: Object.values(st.weeks).filter(x => x >= v).length,
    }));
    [...cfg.totalMilestones].sort((a, b) => a - b).forEach((v, i, arr) => out.push({
      id: `t${v}`, group: 'Pasos acumulados', name: `${fmtK(v)} pasos`, desc: `Acumula ${fmt(v)} pasos en total (≈ ${fmtKm(kmOf(v))} km)`,
      icon: totalEmoji[Math.min(i, totalEmoji.length - 1)], tier: tierFor(v, arr),
      progress: st.total / v, count: st.total >= v ? 1 : 0,
    }));
    [[3, '🔥', 't-bronze'], [7, '⚡', 't-silver'], [14, '💎', 't-gold'], [30, '🏆', 't-diamond']].forEach(([n, icon, tier]) => out.push({
      id: `s${n}`, group: 'Rachas', name: `Racha de ${n} días`, desc: `Cumple tu objetivo diario ${n} días seguidos`,
      icon, tier, progress: st.best / n, count: st.best >= n ? 1 : 0,
    }));
    const ss = st.sessions;
    const hourOf = s => new Date(s.start).getHours();
    const weekendDone = Object.keys(st.weeks).some(m => {
      const sat = keyOf(addDays(parseKey(m), 5)), sun = keyOf(addDays(parseKey(m), 6));
      return daySteps(sat) >= cfg.dailyGoal && daySteps(sun) >= cfg.dailyGoal;
    });
    const special = [
      { id: 'first', name: 'Primer paso', desc: 'Registra tu primera caminata', icon: '🐣', ok: ss.length > 0 },
      { id: 'early', name: 'Madrugador', desc: 'Empieza una caminata antes de las 8:00', icon: '🌅', ok: ss.some(s => s.source !== 'manual' && hourOf(s) < 8) },
      { id: 'night', name: 'Noctámbulo', desc: 'Camina después de las 21:00', icon: '🦉', ok: ss.some(s => s.source !== 'manual' && hourOf(s) >= 21) },
      { id: 'long', name: 'Gran paseo', desc: 'Una caminata de 60 minutos o más', icon: '🧭', ok: ss.some(s => s.seconds >= 3600) },
      { id: 'weekend', name: 'Finde activo', desc: 'Cumple tu objetivo sábado y domingo', icon: '🏖️', ok: weekendDone },
      { id: 'double', name: 'Doble o nada', desc: 'Duplica tu objetivo diario en un día', icon: '✌️', ok: maxDay >= cfg.dailyGoal * 2 },
    ];
    special.forEach(s => out.push({ ...s, group: 'Especiales', tier: 't-special', progress: s.ok ? 1 : 0, count: s.ok ? 1 : 0 }));
    return out;
  }

  // Comprueba nuevas insignias y celebra
  function checkBadges({ silent = false } = {}) {
    const st = computeStats();
    const cat = badgeCatalog(st);
    const fresh = [];
    for (const b of cat) {
      const had = S.badges[b.id];
      if (b.count > 0 && !had) { S.badges[b.id] = { at: Date.now(), count: b.count }; fresh.push(b); }
      else if (had) had.count = b.count;
    }
    if (fresh.length) { save(); if (!silent) celebrate(fresh); }
    return fresh;
  }

  // ================= Nivel =================
  const LEVELS = ['Paseante', 'Caminante', 'Andarín', 'Explorador', 'Trotamundos', 'Aventurero', 'Peregrino', 'Leyenda'];
  function levelInfo(total) {
    // nivel n requiere 25k * n*(n+1)/2 pasos acumulados
    let n = 0; while (25000 * (n + 1) * (n + 2) / 2 <= total) n++;
    const lo = 25000 * n * (n + 1) / 2, hi = 25000 * (n + 1) * (n + 2) / 2;
    return { level: n + 1, title: LEVELS[Math.min(n, LEVELS.length - 1)], pct: (total - lo) / (hi - lo), left: hi - total };
  }

  // ================= Contador automático (app de Android) =================
  // En la app nativa, un servicio en segundo plano lee el contador de pasos del propio móvil
  // y guarda los pasos minuto a minuto. Aquí solo los recogemos y los guardamos por días.
  const Native = (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
    ? window.Capacitor.Plugins.Pasos : null;
  let counter = null;   // estado del contador: { available, permission, running, enabled, batteryOptimized }
  let syncing = false;

  async function refreshCounter() {
    if (!Native) return;
    try { counter = await Native.status(); } catch { counter = null; }
  }

  async function sync({ quiet = false } = {}) {
    if (!Native || syncing) return;
    syncing = true;
    try {
      const since = S.lastSync ? S.lastSync - 120 : 0;
      const res = await Native.getBuckets({ since });
      let changed = false;
      for (const [m, steps] of res.buckets || []) {
        const d = new Date(m * 60000), k = keyOf(d), mod = d.getHours() * 60 + d.getMinutes();
        const day = ensureDay(k);
        if (day.auto[mod] !== steps) { day.auto[mod] = steps; changed = true; }
      }
      S.lastSync = res.now;
      save();
      if (changed && !$('.sheet')) { render({ soft: true }); if (!quiet) checkBadges(); }
    } catch { /* el servicio aún no tiene datos */ }
    finally { syncing = false; }
  }

  async function enableCounter() {
    if (!Native) return;
    try { counter = await Native.enable(); } catch { await refreshCounter(); }
    if (counter && counter.permission === 'granted' && counter.running) {
      toast(`¡Listo! ${S.settings.mascotName} ya cuenta tus pasos en segundo plano 👟`);
      Native.setGoal({ goal: S.settings.dailyGoal }).catch(() => {});
    } else if (counter && counter.permission === 'denied') {
      toast('Sin el permiso de actividad física no puedo contar pasos. Puedes darlo en Ajustes del móvil.');
    }
    render();
  }

  // ================= UI general =================
  let tab = 'hoy';
  const views = {};
  function setTab(t) {
    tab = t; history.replaceState(null, '', '#' + t);
    $$('.tab').forEach(b => { b.classList.toggle('is-active', b.dataset.tab === t); b.setAttribute('aria-current', b.dataset.tab === t ? 'page' : 'false'); });
    render(); window.scrollTo({ top: 0 });
  }
  function render(opts = {}) {
    const now = new Date(), h = now.getHours();
    $('#greet').textContent = (h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches') + (S.settings.name ? `, ${S.settings.name}` : '') + ' 👋';
    const ds = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }); $('#today-date').textContent = ds[0].toUpperCase() + ds.slice(1);
    const v = $('#view');
    v.innerHTML = views[tab]();
    if (opts.soft) v.style.animation = 'none'; else { v.style.animation = 'none'; void v.offsetWidth; v.style.animation = ''; }
    bindView();
  }

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('is-on');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('is-on'), 3200);
  }

  function ringSVG(pct, size = 260, stroke = 22) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const p1 = clamp(pct, 0, 1), p2 = clamp(pct - 1, 0, 1);
    return `<svg viewBox="0 0 ${size} ${size}">
      <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--primary-2)"/><stop offset="1" stop-color="var(--primary)"/></linearGradient></defs>
      <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
      <circle class="ring-bar" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p1)}"/>
      ${p2 > 0 ? `<circle class="ring-over" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke * .45}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p2)}"/>` : ''}
    </svg>`;
  }
  function miniRing(pct, met) {
    const r = 15, c = 2 * Math.PI * r;
    return `<svg viewBox="0 0 38 38"><circle cx="19" cy="19" r="${r}" fill="none" stroke="var(--heat-0)" stroke-width="5"/>
      ${pct > 0 ? `<circle cx="19" cy="19" r="${r}" fill="none" stroke="${met ? 'var(--mint)' : 'var(--primary)'}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - clamp(pct, 0, 1))}"/>` : ''}
      ${met ? `<path d="M13 19.5l4 4 8-8" transform="rotate(90 19 19)" stroke="var(--mint)" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : ''}</svg>`;
  }
  const medal = (b, extra = '') => `<div class="medal ${b.tier} ${extra}">${b.icon}</div>`;

  // ================= Vista: Hoy =================
  function counterCard() {
    const tips = S.settings.hideTips;
    if (!Native) {
      if (tips.web) return '';
      return `<div class="notice">
        <div class="notice__icon">📲</div>
        <div class="notice__txt"><strong>Cuenta automática en la app de Android</strong><span>En el navegador no se pueden leer los pasos del móvil. Aquí puedes añadirlos a mano o explorar la app.</span></div>
        <button class="notice__x" data-hide="web" aria-label="Ocultar">✕</button></div>`;
    }
    if (!counter) return '';
    if (!counter.available) return `<div class="notice is-warn"><div class="notice__icon">⚠️</div><div class="notice__txt"><strong>Este móvil no tiene contador de pasos</strong><span>Puedes seguir apuntando tus pasos a mano.</span></div></div>`;
    if (counter.permission === 'denied') return `<div class="notice is-warn"><div class="notice__icon">🔒</div><div class="notice__txt"><strong>Falta el permiso de actividad física</strong><span>Sin él no puedo contar tus pasos.</span><button class="btn btn--primary btn--sm" data-act="app-settings">Abrir ajustes del móvil</button></div></div>`;
    if (!counter.running) return `<div class="notice is-cta"><div class="notice__icon">👟</div><div class="notice__txt"><strong>Activa el contador automático</strong><span>Contaré tus pasos en segundo plano, sin que tengas que hacer nada.</span><button class="btn btn--primary btn--sm" data-act="enable">Activar ahora</button></div></div>`;
    if (counter.batteryOptimized && !tips.battery) return `<div class="notice">
      <div class="notice__icon">🔋</div>
      <div class="notice__txt"><strong>Que Android no me duerma</strong><span>Algunos móviles detienen las apps en segundo plano. Permite que Pasito funcione sin restricciones de batería (gasta muy poco).</span><button class="btn btn--soft btn--sm" data-act="battery">Permitir</button></div>
      <button class="notice__x" data-hide="battery" aria-label="Ocultar">✕</button></div>`;
    return '';
  }

  function hourChart(k) {
    const h = hourly(k), now = new Date(), isToday = k === todayKey();
    const max = Math.max(500, ...h), W = 340, H = 96, pb = 16, cw = W / 24, bw = cw - 4;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pasos por hora">`;
    s += `<line class="grid-line" x1="0" x2="${W}" y1="${H - pb}" y2="${H - pb}"/>`;
    h.forEach((v, i) => {
      const x = i * cw + 2, bh = v ? Math.max(3, (H - pb - 6) * v / max) : 0, y = H - pb - bh, r = Math.min(3, bw / 2, bh);
      s += `<rect class="hit" x="${i * cw}" y="0" width="${cw}" height="${H - pb}" data-i="${i}"/>`;
      if (bh) s += `<path class="bar ${v >= 250 ? 'is-met' : ''}" data-bar="${i}" d="M${x},${H - pb} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${H - pb} Z"/>`;
      else if (!isToday || i <= now.getHours()) s += `<rect x="${x + bw / 2 - 1.5}" y="${H - pb - 3}" width="3" height="3" rx="1.5" fill="var(--line)"/>`;
      if (i % 6 === 0) s += `<text class="axis-lbl" x="${i * cw + 2}" y="${H - 3}">${i}h</text>`;
    });
    s += `</svg>`;
    chartData = h.map((v, i) => ({ tip: `${fmt(v)} pasos<small>${pad(i)}:00 – ${pad(i)}:59</small>` }));
    return `<div class="chart" id="chart">${s}<div class="tooltip" id="tip"></div></div>`;
  }

  views.hoy = () => {
    const tk = todayKey(), goal = S.settings.dailyGoal;
    const steps = daySteps(tk), secs = daySecs(tk);
    const pct = steps / goal, done = steps >= goal;
    const mood = mascotMood(steps, goal);
    const mon = mondayOf(new Date()), wk = weekSteps(mon);
    const st = computeStats(), cat = badgeCatalog(st);
    const next = cat.filter(b => b.count === 0 && b.progress > 0 && b.group !== 'Especiales').sort((a, b) => b.progress - a.progress)[0]
      || cat.filter(b => b.count === 0).sort((a, b) => b.progress - a.progress)[0];
    const pace = secs > 60 ? steps / (secs / 60) : 0;
    const sessions = sessionsOf(tk).reverse();

    return `
    ${counterCard()}
    <section class="hero">
      <div class="hero__top">
        <div class="mascot-wrap" id="mascot">${mascotSVG(mood)}</div>
        <div class="bubble" id="bubble"><small>${esc(S.settings.mascotName)} dice</small>${esc(mascotLine(steps, goal))}</div>
      </div>
      <div class="ring-wrap">
        ${ringSVG(pct)}
        <div class="ring-center">
          <div class="ring-steps num">${fmt(steps)}</div>
          <div class="ring-label">pasos hoy</div>
          <div class="ring-goal ${done ? 'is-done' : ''}">${done ? '✓ Objetivo cumplido' : `${Math.round(pct * 100)}% de ${fmtK(goal)}`}</div>
        </div>
      </div>
      <div class="metrics">
        <div class="metric"><div class="metric__icon">⏱️</div><div class="metric__val num">${fmtDur(secs)}</div><div class="metric__lbl">caminando</div></div>
        <div class="metric"><div class="metric__icon">📍</div><div class="metric__val num">${fmtKm(kmOf(steps))}</div><div class="metric__lbl">km</div></div>
        <div class="metric"><div class="metric__icon">🔥</div><div class="metric__val num">${fmt(kcalOf(steps))}</div><div class="metric__lbl">kcal</div></div>
        <div class="metric"><div class="metric__icon">⚡</div><div class="metric__val num">${pace ? fmt(pace) : '–'}</div><div class="metric__lbl">pasos/min</div></div>
      </div>
    </section>

    <div class="section-title">Hoy, hora a hora <button class="link-btn" data-act="manual">+ Añadir pasos</button></div>
    <div class="card">${hourChart(tk)}</div>

    <div class="section-title">Esta semana <small>${fmt(wk)} / ${fmtK(S.settings.weeklyGoal)}</small></div>
    <div class="card">
      <div class="week-strip">
        ${DOW.map((d, i) => {
          const k = keyOf(addDays(mon, i)), s = daySteps(k);
          return `<button class="wday ${k === tk ? 'is-today' : ''}" ${hasData(k) ? `data-day="${k}"` : ''}><span class="wday__lbl">${d}</span><div class="wday__ring">${miniRing(s / goal, s >= goal)}</div><span class="wday__val num">${s ? fmtK(s) : '·'}</span></button>`;
        }).join('')}
      </div>
      <div class="bar-progress is-violet" style="margin-top:14px"><i style="width:${clamp(wk / S.settings.weeklyGoal, 0, 1) * 100}%"></i></div>
    </div>

    <div class="row-cards" style="margin-top:12px">
      <div class="mini"><div class="mini__lbl">🔥 Racha</div><div class="mini__val num">${st.current} ${st.current === 1 ? 'día' : 'días'}</div><div class="mini__sub">Mejor: ${st.best}</div></div>
      <div class="mini"><div class="mini__lbl">🌍 Total</div><div class="mini__val num">${fmtK(st.total)}</div><div class="mini__sub">${fmtKm(kmOf(st.total))} km recorridos</div></div>
    </div>

    ${next ? `
    <div class="section-title">Próxima insignia</div>
    <button class="card next-badge" data-badge="${next.id}" style="width:100%;text-align:left">
      ${medal(next)}
      <div class="next-badge__txt">
        <div class="next-badge__title">${esc(next.name)}</div>
        <div class="next-badge__sub">${esc(next.desc)}</div>
        <div class="bar-progress"><i style="width:${clamp(next.progress, 0, 1) * 100}%"></i></div>
      </div>
    </button>` : ''}

    <div class="section-title">Caminatas de hoy <small>${sessions.length || ''}</small></div>
    ${sessions.length ? `<div class="list">${sessions.map(sessionItem).join('')}</div>` : `<div class="empty">Cuando camines 5 minutos seguidos o más, la caminata aparecerá aquí sola, con su duración y su ritmo.</div>`}
    `;
  };

  function sessionItem(s) {
    const t1 = new Date(s.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const manual = s.source === 'manual';
    return `<button class="item" data-sess="${s.id}" data-day="${keyOf(new Date(s.start))}">
      <div class="item__icon ${manual ? 'is-manual' : ''}">${manual ? '✍️' : '👟'}</div>
      <div class="item__main"><div class="item__title">${manual ? 'Registro manual' : 'Caminata'}</div><div class="item__sub">${t1} · ${fmtDur(s.seconds)}${s.seconds > 60 ? ` · ${fmt(s.steps / (s.seconds / 60))} p/min` : ''}</div></div>
      <div class="item__end num">${fmt(s.steps)}<small>pasos</small></div>
    </button>`;
  }

  // ================= Vista: Historial =================
  let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  views.historial = () => {
    const goal = S.settings.dailyGoal;
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    const first = new Date(y, m, 1), offset = (first.getDay() + 6) % 7, nDays = new Date(y, m + 1, 0).getDate();
    const tk = todayKey(), now = new Date();
    const isCurrent = y === now.getFullYear() && m === now.getMonth();
    let monthSteps = 0, monthMet = 0, monthActive = 0;
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(`<div class="cal__day is-empty"></div>`);
    for (let d = 1; d <= nDays; d++) {
      const date = new Date(y, m, d), k = keyOf(date), s = daySteps(k);
      monthSteps += s; if (s >= goal) monthMet++; if (s > 0) monthActive++;
      const lv = s === 0 ? 0 : s < goal * .4 ? 1 : s < goal * .75 ? 2 : s < goal * 1.25 ? 3 : 4;
      const fut = date > now;
      cells.push(`<button class="cal__day ${k === tk ? 'is-today' : ''} ${fut ? 'is-future' : ''} ${s >= goal ? 'is-goal' : ''}" data-l="${lv}" ${fut ? 'disabled' : `data-day="${k}"`} aria-label="${d}: ${fmt(s)} pasos">${d}</button>`);
    }
    const keys = allKeys().reverse();
    // agrupar por semanas para la lista
    const groups = [];
    for (const k of keys) {
      const mk = keyOf(mondayOf(parseKey(k)));
      let g = groups[groups.length - 1];
      if (!g || g.mk !== mk) { g = { mk, days: [] }; groups.push(g); }
      g.days.push(k);
    }
    return `
    <h1 class="page-title">Historial</h1>
    <p class="page-sub">Tu día a día, de un vistazo.</p>
    <div class="card" style="margin-top:12px">
      <div class="cal-head">
        <button class="cal-nav" data-act="cal-prev" aria-label="Mes anterior"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <strong>${calMonth.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}</strong>
        <button class="cal-nav" data-act="cal-next" aria-label="Mes siguiente" ${isCurrent ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      <div class="cal">${DOW.map(d => `<div class="cal__dow">${d}</div>`).join('')}${cells.join('')}</div>
      <div class="heat-legend">Menos <i style="background:var(--heat-0)"></i><i style="background:var(--heat-1)"></i><i style="background:var(--heat-2)"></i><i style="background:var(--heat-3)"></i><i style="background:var(--heat-4)"></i> Más · <span style="display:inline-flex;align-items:center;gap:4px"><i style="width:6px;height:6px;border-radius:50%;background:var(--mint)"></i>objetivo</span></div>
    </div>
    <div class="kpis" style="margin-top:12px; grid-template-columns: repeat(3,1fr)">
      <div class="kpi"><div class="kpi__lbl">Pasos</div><div class="kpi__val num" style="font-size:20px">${fmtK(monthSteps)}</div></div>
      <div class="kpi"><div class="kpi__lbl">Días activos</div><div class="kpi__val num" style="font-size:20px">${monthActive}</div></div>
      <div class="kpi"><div class="kpi__lbl">Objetivo</div><div class="kpi__val num" style="font-size:20px">${monthMet}<small> días</small></div></div>
    </div>

    <div class="section-title">Todos los días</div>
    ${groups.length ? groups.map(g => {
      const mon = parseKey(g.mk), sun = addDays(mon, 6);
      const wk = weekSteps(mon);
      return `<div class="section-title" style="margin:16px 4px 8px;font-size:14px;color:var(--muted)">${mon.getDate()} ${mon.toLocaleDateString('es-ES', { month: 'short' })} – ${sun.getDate()} ${sun.toLocaleDateString('es-ES', { month: 'short' })} <small class="num">${fmt(wk)} pasos ${wk >= S.settings.weeklyGoal ? '🏆' : ''}</small></div>
      <div class="list">${g.days.map(k => {
        const s = daySteps(k), sec = daySecs(k), d = parseKey(k);
        return `<button class="item" data-day="${k}">
          <div style="width:42px;height:42px">${miniRing(s / goal, s >= goal)}</div>
          <div class="item__main"><div class="item__title" style="text-transform:capitalize">${d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' })}</div><div class="item__sub">${fmtDur(sec)} · ${fmtKm(kmOf(s))} km · ${sessionsOf(k).length} ${sessionsOf(k).length === 1 ? 'caminata' : 'caminatas'}</div></div>
          <div class="item__end num">${fmt(s)}<small>pasos</small></div>
          <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
        </button>`;
      }).join('')}</div>`;
    }).join('') : `<div class="empty">Aún no hay historial. ¡Tu primera caminata aparecerá aquí!<br><br><button class="btn btn--soft btn--sm" data-act="demo">Ver con datos de ejemplo</button></div>`}
    `;
  };

  // ================= Vista: Estadísticas =================
  let statRange = 7;
  views.stats = () => {
    const goal = S.settings.dailyGoal, today = new Date();
    const days = [];
    for (let i = statRange - 1; i >= 0; i--) { const d = addDays(today, -i), k = keyOf(d); days.push({ d, k, steps: daySteps(k), secs: daySecs(k) }); }
    const prev = [];
    for (let i = statRange * 2 - 1; i >= statRange; i--) { const k = keyOf(addDays(today, -i)); prev.push(daySteps(k)); }
    const sum = days.reduce((a, x) => a + x.steps, 0), secs = days.reduce((a, x) => a + x.secs, 0);
    const prevSum = prev.reduce((a, x) => a + x, 0);
    const active = days.filter(x => x.steps > 0).length;
    const avg = sum / statRange;
    const met = days.filter(x => x.steps >= goal).length;
    const bestD = days.reduce((a, x) => x.steps > a.steps ? x : a, { steps: 0 });
    const change = prevSum ? (sum - prevSum) / prevSum : null;
    const st = computeStats();
    const pace = secs > 60 ? sum / (secs / 60) : 0;
    const sess = st.sessions.filter(s => s.start >= addDays(today, -statRange).getTime());
    const avgSess = sess.length ? sess.reduce((a, s) => a + s.seconds, 0) / sess.length : 0;

    // por día de la semana (todo el historial)
    const wdSum = Array(7).fill(0), wdN = Array(7).fill(0);
    st.dayVals.forEach(dv => { const i = (parseKey(dv.k).getDay() + 6) % 7; wdSum[i] += dv.steps; wdN[i]++; });
    const wdAvg = wdSum.map((s, i) => wdN[i] ? s / wdN[i] : 0);
    const wdMax = Math.max(1, ...wdAvg);
    // por franja horaria
    const slots = [['🌅', 'Mañana', 6, 12], ['☀️', 'Mediodía', 12, 16], ['🌇', 'Tarde', 16, 21], ['🌙', 'Noche', 21, 30]];
    const slotSum = slots.map(([, , a, b]) => st.sessions.filter(s => { const h = new Date(s.start).getHours(); const hh = h < 6 ? h + 24 : h; return hh >= a && hh < b; }).reduce((x, s) => x + s.steps, 0));
    const slotTot = Math.max(1, slotSum.reduce((a, b) => a + b, 0));
    // récords
    const recDay = st.dayVals.reduce((a, x) => x.steps > a.steps ? x : a, { steps: 0, k: null });
    const recWeekE = Object.entries(st.weeks).sort((a, b) => b[1] - a[1])[0];
    const recSess = st.sessions.reduce((a, s) => s.seconds > (a?.seconds || 0) ? s : a, null);
    const recPace = st.sessions.filter(s => s.seconds >= 300).reduce((a, s) => { const p = s.steps / (s.seconds / 60); return p > (a?.p || 0) ? { s, p } : a; }, null);

    return `
    <h1 class="page-title">Estadísticas</h1>
    <p class="page-sub">Cómo te mueves, en números.</p>
    <div class="seg" role="tablist">
      ${[[7, '7 días'], [30, '30 días'], [90, '3 meses']].map(([v, l]) => `<button class="${statRange === v ? 'is-active' : ''}" data-range="${v}" role="tab" aria-selected="${statRange === v}">${l}</button>`).join('')}
    </div>

    <div class="card" style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div><div class="kpi__lbl">Pasos por día</div><div class="kpi__val num">${fmt(avg)} <small>de media</small></div></div>
        ${change !== null ? `<div class="kpi__sub ${change >= 0 ? 'trend-up' : 'trend-down'}" style="font-weight:900">${change >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(change * 100))}% vs. periodo anterior</div>` : ''}
      </div>
      ${barChart(days, goal)}
      <div class="legend"><span><i style="background:var(--primary)"></i>Objetivo cumplido</span><span><i style="background:var(--primary-soft)"></i>Por debajo</span><span><i class="dash"></i>Objetivo (${fmtK(goal)})</span></div>
    </div>

    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><div class="kpi__lbl">👣 Total</div><div class="kpi__val num">${fmtK(sum)}</div><div class="kpi__sub">${fmtKm(kmOf(sum))} km · ${fmt(kcalOf(sum))} kcal</div></div>
      <div class="kpi"><div class="kpi__lbl">⏱️ Tiempo activo</div><div class="kpi__val num">${fmtDur(secs)}</div><div class="kpi__sub">${fmtDur(secs / statRange)} al día</div></div>
      <div class="kpi"><div class="kpi__lbl">🎯 Objetivo</div><div class="kpi__val num">${met}<small>/${statRange} días</small></div><div class="kpi__sub">${active} días con actividad</div></div>
      <div class="kpi"><div class="kpi__lbl">⚡ Ritmo medio</div><div class="kpi__val num">${pace ? fmt(pace) : '–'}<small> p/min</small></div><div class="kpi__sub">${pace ? fmtKm(pace * 60 * S.settings.strideCm / 100000) + ' km/h' : 'Sin datos de tiempo'}</div></div>
      <div class="kpi"><div class="kpi__lbl">🏅 Mejor día</div><div class="kpi__val num">${fmtK(bestD.steps)}</div><div class="kpi__sub" style="text-transform:capitalize">${bestD.d ? bestD.d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' }) : '–'}</div></div>
      <div class="kpi"><div class="kpi__lbl">🚶 Caminata media</div><div class="kpi__val num">${avgSess ? fmtDur(avgSess) : '–'}</div><div class="kpi__sub">${sess.length} caminatas</div></div>
    </div>

    <div class="section-title">Tu día favorito <small>media histórica</small></div>
    <div class="card"><div class="hbars">
      ${wdAvg.map((v, i) => `<div class="hbar"><span class="hbar__lbl">${DOW_LONG[i]}</span><div class="hbar__track"><div class="hbar__fill" style="width:${v / wdMax * 100}%;${v === wdMax && v > 0 ? '' : 'opacity:.45'}"></div></div><span class="hbar__val num">${v ? fmt(v) : '–'}</span></div>`).join('')}
    </div></div>

    <div class="section-title">¿Cuándo caminas? <small>% de pasos</small></div>
    <div class="card"><div class="hbars">
      ${slots.map(([ic, l], i) => `<div class="hbar" style="grid-template-columns:96px 1fr 44px"><span class="hbar__lbl">${ic} ${l}</span><div class="hbar__track"><div class="hbar__fill" style="width:${slotSum[i] / slotTot * 100}%;background:var(--violet)"></div></div><span class="hbar__val num">${Math.round(slotSum[i] / slotTot * 100)}%</span></div>`).join('')}
    </div></div>

    <div class="section-title">Récords personales</div>
    <div class="list">
      ${recordItem('🏔️', 'Día con más pasos', recDay.k ? parseKey(recDay.k).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Sin datos', recDay.steps ? fmt(recDay.steps) : '–', 'pasos')}
      ${recordItem('📆', 'Mejor semana', recWeekE ? 'Semana del ' + parseKey(recWeekE[0]).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }) : 'Sin datos', recWeekE ? fmt(recWeekE[1]) : '–', 'pasos')}
      ${recordItem('🧭', 'Caminata más larga', recSess ? new Date(recSess.start).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }) + ' · ' + fmt(recSess.steps) + ' pasos' : 'Sin datos', recSess ? fmtDur(recSess.seconds) : '–', '')}
      ${recordItem('⚡', 'Ritmo más rápido', recPace ? 'Caminatas de 5 min o más' : 'Sin datos', recPace ? fmt(recPace.p) : '–', 'p/min')}
      ${recordItem('🔥', 'Racha más larga', 'Días seguidos cumpliendo el objetivo', st.best, st.best === 1 ? 'día' : 'días')}
    </div>
    `;
  };
  const recordItem = (ic, t, sub, v, u) => `<div class="item"><div class="item__icon">${ic}</div><div class="item__main"><div class="item__title">${t}</div><div class="item__sub">${sub}</div></div><div class="item__end num">${v}<small>${u}</small></div></div>`;

  function barChart(days, goal) {
    const W = 340, H = 170, padL = 30, padB = 22, padT = 10;
    const n = days.length;
    const max = Math.max(goal * 1.15, ...days.map(d => d.steps)) || 1;
    const nice = Math.ceil(max / 2000) * 2000;
    const cw = (W - padL) / n, bw = Math.max(2, Math.min(26, cw - 2));
    const y = v => padT + (H - padT - padB) * (1 - v / nice);
    const ticks = [0, nice / 2, nice];
    const lblEvery = n <= 7 ? 1 : n <= 31 ? 5 : 15;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pasos por día">`;
    ticks.forEach(t => { s += `<line class="grid-line" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-lbl" x="${padL - 6}" y="${y(t) + 3}" text-anchor="end">${fmtK(t)}</text>`; });
    days.forEach((d, i) => {
      const x = padL + i * cw + (cw - bw) / 2;
      const h = Math.max(0, H - padB - y(d.steps));
      const r = Math.min(4, bw / 2, h);
      const yt = y(d.steps), yb = H - padB;
      // barra con extremo superior redondeado anclada a la base
      const path = h > 0 ? `M${x},${yb} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bw - r} Q${x + bw},${yt} ${x + bw},${yt + r} V${yb} Z` : '';
      s += `<rect class="hit" x="${padL + i * cw}" y="${padT}" width="${cw}" height="${H - padT - padB}" data-i="${i}"/>`;
      if (path) s += `<path class="bar ${d.steps >= goal ? 'is-met' : ''}" d="${path}" data-bar="${i}"/>`;
      if (i % lblEvery === 0 || i === n - 1) {
        const lbl = n <= 7 ? DOW[(d.d.getDay() + 6) % 7] : `${d.d.getDate()}/${d.d.getMonth() + 1}`;
        if (!(n > 7 && i === n - 1 && (n - 1) % lblEvery < lblEvery * .6 && (n - 1) % lblEvery !== 0)) s += `<text class="axis-lbl" x="${padL + i * cw + cw / 2}" y="${H - 6}" text-anchor="middle">${lbl}</text>`;
      }
    });
    s += `<line class="goal-line" x1="${padL}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}"/>`;
    s += `</svg>`;
    chartData = days.map(d => ({ tip: `${fmt(d.steps)} pasos<small>${d.d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtDur(d.secs)}</small>` }));
    return `<div class="chart" id="chart" style="margin-top:12px">${s}<div class="tooltip" id="tip"></div></div>`;
  }
  let chartData = [];

  // ================= Vista: Logros =================
  views.logros = () => {
    const st = computeStats();
    const cat = badgeCatalog(st);
    const lv = levelInfo(st.total);
    const unlocked = cat.filter(b => b.count > 0).length;
    const groups = [...new Set(cat.map(b => b.group))];
    return `
    <h1 class="page-title">Logros</h1>
    <p class="page-sub">${unlocked} de ${cat.length} insignias conseguidas</p>
    <div class="level-card" style="margin-top:12px">
      <div class="mascot-wrap">${mascotSVG(unlocked ? 'happy' : 'happy')}</div>
      <div style="flex:1;min-width:0">
        <div class="level-card__lvl">Nivel ${lv.level}</div>
        <div class="level-card__title">${lv.title}</div>
        <div class="bar-progress"><i style="width:${lv.pct * 100}%"></i></div>
        <div class="level-card__sub">${fmt(lv.left)} pasos para el nivel ${lv.level + 1}</div>
      </div>
    </div>
    ${groups.map(g => `
      <div class="section-title">${g} <small>${cat.filter(b => b.group === g && b.count).length}/${cat.filter(b => b.group === g).length}</small></div>
      <div class="badge-grid">
        ${cat.filter(b => b.group === g).map(b => `
          <button class="badge ${b.count ? '' : 'is-locked'}" data-badge="${b.id}">
            ${b.count > 1 ? `<span class="badge__count">×${b.count}</span>` : ''}
            ${medal(b)}
            <div class="badge__name">${esc(b.name)}</div>
            ${b.count ? `<div class="badge__sub">${S.badges[b.id] ? new Date(S.badges[b.id].at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '¡Conseguida!'}</div>` : `<div class="bar-progress"><i style="width:${clamp(b.progress, 0, 1) * 100}%"></i></div>`}
          </button>`).join('')}
      </div>`).join('')}
    <p class="page-sub" style="text-align:center;margin:22px 0 4px">Puedes ajustar los hitos en <button data-act="settings" style="color:var(--primary);font-weight:900">Ajustes</button></p>
    `;
  };

  // ================= Enlaces de eventos =================
  function bindView() {
    const v = $('#view');
    v.onclick = e => {
      const t = e.target.closest('[data-act],[data-go],[data-day],[data-range],[data-badge],[data-hide]');
      if (!t) return;
      if (t.dataset.act) {
        const a = t.dataset.act;
        if (a === 'manual') manualSheet();
        else if (a === 'enable') enableCounter();
        else if (a === 'battery') { Native && Native.openBatterySettings(); S.settings.hideTips.battery = true; save(); setTimeout(() => refreshCounter().then(() => render({ soft: true })), 4000); }
        else if (a === 'app-settings') { Native && Native.openAppSettings(); }
        else if (a === 'cal-prev') { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); render(); }
        else if (a === 'cal-next') { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); render(); }
        else if (a === 'demo') { loadDemo(); }
        else if (a === 'settings') settingsSheet();
        return;
      }
      if (t.dataset.hide) { S.settings.hideTips[t.dataset.hide] = true; save(); return render({ soft: true }); }
      if (t.dataset.go) return setTab(t.dataset.go);
      if (t.dataset.range) { statRange = +t.dataset.range; return render(); }
      if (t.dataset.badge) return badgeSheet(t.dataset.badge);
      if (t.dataset.sess) return sessionSheet(t.dataset.day, t.dataset.sess);
      if (t.dataset.day) return daySheet(t.dataset.day);
    };
    const chart = $('#chart');
    if (chart) {
      const tip = $('#tip');
      const show = el => {
        const i = +el.dataset.i, d = chartData[i];
        $$('.bar', chart).forEach(b => b.classList.toggle('is-hover', +b.dataset.bar === i));
        const r = el.getBoundingClientRect(), cr = chart.getBoundingClientRect();
        tip.innerHTML = d.tip;
        tip.style.left = clamp(r.left - cr.left + r.width / 2, 50, cr.width - 50) + 'px';
        tip.style.top = '10px';
        tip.classList.add('is-on');
      };
      const hide = () => { tip.classList.remove('is-on'); $$('.bar', chart).forEach(b => b.classList.remove('is-hover')); };
      chart.addEventListener('pointermove', e => { const el = e.target.closest('.hit'); el ? show(el) : hide(); });
      chart.addEventListener('pointerleave', hide);
      chart.addEventListener('click', e => { const el = e.target.closest('.hit'); if (el) { e.stopPropagation(); show(el); } });
    }
  }

  // ================= Hojas (modales) =================
  function openSheet(html, onMount) {
    const root = $('#sheet-root');
    root.innerHTML = `<div class="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true"><div class="sheet__grab"></div>${html}</div></div>`;
    const bd = $('.sheet-backdrop', root);
    bd.addEventListener('click', e => { if (e.target === bd || e.target.closest('[data-close]')) closeSheet(); });
    document.addEventListener('keydown', escClose);
    onMount && onMount($('.sheet', root));
    const f = $('.sheet input, .sheet button.btn', root); f && setTimeout(() => f.focus({ preventScroll: true }), 50);
  }
  function escClose(e) { if (e.key === 'Escape') closeSheet(); }
  function closeSheet() { $('#sheet-root').innerHTML = ''; document.removeEventListener('keydown', escClose); }

  function manualSheet(prefill) {
    const p = prefill || {};
    const d = p.start ? new Date(p.start) : new Date();
    const edit = !!p.id;
    openSheet(`
      <h2 class="sheet__title">${edit ? 'Editar registro' : 'Añadir pasos'}</h2>
      <p class="sheet__sub">${edit ? 'Corrige los pasos o la duración.' : '¿Caminaste sin la app? Apúntalo aquí (por ejemplo, desde el contador de tu móvil o reloj).'}</p>
      <div class="field"><label for="f-steps">Pasos</label>
        <div class="stepper"><button type="button" data-d="-500">−</button><input class="input num" id="f-steps" type="number" inputmode="numeric" min="0" max="200000" value="${p.steps ?? 1000}"><button type="button" data-d="500">+</button></div>
      </div>
      <div class="chips" style="margin:-4px 0 14px">${[1000, 2500, 5000, 8000, 10000].map(v => `<button class="chip" type="button" data-v="${v}">${fmtK(v)}</button>`).join('')}</div>
      <div class="field-row">
        <div class="field"><label for="f-min">Duración (min)</label><input class="input num" id="f-min" type="number" inputmode="numeric" min="0" max="1440" value="${p.seconds != null ? Math.round(p.seconds / 60) : 10}"></div>
        <div class="field"><label for="f-time">Hora</label><input class="input" id="f-time" type="time" value="${pad(d.getHours())}:${pad(d.getMinutes())}"></div>
      </div>
      <div class="field"><label for="f-date">Día</label><input class="input" id="f-date" type="date" max="${todayKey()}" value="${keyOf(d)}"></div>
      <div class="sheet__actions">
        <button class="btn btn--soft" data-close>Cancelar</button>
        <button class="btn btn--primary" id="f-save">${edit ? 'Guardar' : 'Añadir'}</button>
      </div>`, sh => {
      const inp = $('#f-steps', sh);
      $$('.stepper button', sh).forEach(b => b.onclick = () => { inp.value = Math.max(0, (+inp.value || 0) + +b.dataset.d); });
      $$('.chip', sh).forEach(b => b.onclick = () => { inp.value = b.dataset.v; });
      $('#f-save', sh).onclick = () => {
        const steps = Math.round(+inp.value || 0), mins = +$('#f-min', sh).value || 0;
        const [hh, mm] = ($('#f-time', sh).value || '12:00').split(':').map(Number);
        const date = parseKey($('#f-date', sh).value || todayKey()); date.setHours(hh, mm, 0, 0);
        if (steps <= 0) { toast('Introduce un número de pasos'); return; }
        if (edit) removeSession(keyOf(new Date(p.start)), p.id);
        addSession(keyOf(date), { id: p.id || 'm' + Date.now(), start: date.getTime(), end: date.getTime() + mins * 60000, steps, seconds: mins * 60, source: p.source || 'manual' });
        save(); closeSheet(); render(); toast(edit ? 'Registro actualizado' : `+${fmt(steps)} pasos añadidos 🎉`); checkBadges();
      };
    });
  }
  function removeSession(k, id) {
    if (!S.days[k]) return;
    S.days[k].sessions = S.days[k].sessions.filter(s => s.id !== id);
    if (!hasData(k)) delete S.days[k];
  }

  function sessionSheet(k, id) {
    const s = sessionsOf(k).find(x => x.id === id); if (!s) return;
    const auto = s.source === 'auto';
    const t1 = new Date(s.start), t2 = new Date(s.end);
    const hm = d => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    openSheet(`
      <h2 class="sheet__title">${s.source === 'manual' ? '✍️ Registro manual' : '👟 Caminata'}</h2>
      <p class="sheet__sub" style="text-transform:capitalize">${t1.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })} · ${hm(t1)} – ${hm(t2)}</p>
      <div class="kpis">
        <div class="kpi"><div class="kpi__lbl">Pasos</div><div class="kpi__val num">${fmt(s.steps)}</div></div>
        <div class="kpi"><div class="kpi__lbl">Duración</div><div class="kpi__val num">${fmtDur(s.seconds)}</div></div>
        <div class="kpi"><div class="kpi__lbl">Distancia</div><div class="kpi__val num">${fmtKm(kmOf(s.steps))}<small> km</small></div></div>
        <div class="kpi"><div class="kpi__lbl">Ritmo</div><div class="kpi__val num">${s.seconds > 60 ? fmt(s.steps / (s.seconds / 60)) : '–'}<small> p/min</small></div></div>
      </div>
      ${auto ? `<p class="sheet__sub" style="margin-top:14px">👟 Detectada automáticamente por el contador del móvil.</p><div class="sheet__actions"><button class="btn btn--soft" data-close>Cerrar</button></div>` : `
      <div class="sheet__actions">
        <button class="btn btn--danger" id="s-del">Eliminar</button>
        <button class="btn btn--soft" id="s-edit">Editar</button>
      </div>`}`, sh => {
      if (auto) return;
      $('#s-del', sh).onclick = () => { if (confirm('¿Eliminar este registro?')) { removeSession(k, id); save(); closeSheet(); render(); toast('Registro eliminado'); } };
      $('#s-edit', sh).onclick = () => { closeSheet(); manualSheet(s); };
    });
  }

  function daySheet(k) {
    const d = parseKey(k), steps = daySteps(k), secs = daySecs(k), goal = S.settings.dailyGoal;
    const ss = sessionsOf(k).reverse();
    openSheet(`
      <h2 class="sheet__title" style="text-transform:capitalize">${d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
      <p class="sheet__sub">${steps >= goal ? '✓ Objetivo cumplido' : `${Math.round(steps / goal * 100)}% del objetivo`}</p>
      <div class="kpis">
        <div class="kpi"><div class="kpi__lbl">Pasos</div><div class="kpi__val num">${fmt(steps)}</div></div>
        <div class="kpi"><div class="kpi__lbl">Tiempo</div><div class="kpi__val num">${fmtDur(secs)}</div></div>
        <div class="kpi"><div class="kpi__lbl">Distancia</div><div class="kpi__val num">${fmtKm(kmOf(steps))}<small> km</small></div></div>
        <div class="kpi"><div class="kpi__lbl">Calorías</div><div class="kpi__val num">${fmt(kcalOf(steps))}<small> kcal</small></div></div>
      </div>
      <div class="section-title" style="margin-top:18px">Caminatas</div>
      ${ss.length ? `<div class="list">${ss.map(sessionItem).join('')}</div>` : '<div class="empty">Sin registros este día</div>'}
      <div class="sheet__actions"><button class="btn btn--soft" id="d-add">+ Añadir pasos a este día</button></div>`, sh => {
      sh.onclick = e => { const t = e.target.closest('[data-sess]'); if (t) { closeSheet(); sessionSheet(t.dataset.day, t.dataset.sess); } };
      $('#d-add', sh).onclick = () => { closeSheet(); const x = parseKey(k); x.setHours(18, 0); manualSheet({ start: x.getTime(), steps: 1000, seconds: 600 }); };
    });
  }

  function badgeSheet(id) {
    const b = badgeCatalog(computeStats()).find(x => x.id === id); if (!b) return;
    const got = b.count > 0;
    openSheet(`
      <div class="celebrate">
        <div class="medal ${b.tier}" style="${got ? '' : 'filter:grayscale(1);opacity:.5'}">${b.icon}</div>
        <div class="celebrate__kicker">${b.group}</div>
        <h2>${esc(b.name)}</h2>
        <p>${esc(b.desc)}</p>
        <p style="margin-top:10px;color:var(--muted)">${got ? `Conseguida el ${new Date(S.badges[b.id]?.at || Date.now()).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}${b.count > 1 ? ` · ¡${b.count} veces!` : ''}` : `Progreso: ${Math.floor(clamp(b.progress, 0, 1) * 100)}%`}</p>
        ${got ? '' : `<div class="bar-progress" style="max-width:240px;margin:12px auto 0"><i style="width:${clamp(b.progress, 0, 1) * 100}%"></i></div>`}
      </div>
      <div class="sheet__actions"><button class="btn btn--soft" data-close>Cerrar</button></div>`);
  }

  function celebrate(list) {
    const main = [...list].reverse().find(x => x.group !== 'Especiales') || list[list.length - 1];
    const b = main; const others = list.filter(x => x !== main);
    const cheers = ['¡Increíble!', '¡Bravo!', '¡Lo has conseguido!', '¡Qué máquina!'];
    openSheet(`
      <div class="celebrate">
        <div class="mascot-wrap">${mascotSVG('party')}</div>
        <div class="medal ${b.tier}">${b.icon}</div>
        <div class="celebrate__kicker">Nueva insignia · ${b.group}</div>
        <h2>${esc(b.name)}</h2>
        <p>${cheers[Math.floor(Math.random() * cheers.length)]} Reto superado: ${esc(b.desc.charAt(0).toLowerCase() + b.desc.slice(1))}.</p>
        ${others.length ? `<div class="celebrate__more">${others.slice(-5).map(x => medal(x)).join('')}</div><p style="margin-top:6px;font-size:13px;color:var(--muted)">y ${others.length} insignia${others.length > 1 ? 's' : ''} más</p>` : ''}
      </div>
      <div class="sheet__actions"><button class="btn btn--soft" data-close>Seguir</button><button class="btn btn--primary" id="c-see">Ver logros</button></div>`, sh => {
      $('#c-see', sh).onclick = () => { closeSheet(); setTab('logros'); };
    });
    confetti();
    if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
  }

  // ================= Ajustes =================
  const COLORS = ['#FF8A4C', '#B39CFF', '#D29A66', '#FF5C9A', '#5FCB72', '#3BA6FF', '#F5B301', '#19B394'];
  function avatarPicker(sel, color) {
    return Object.entries(AVATARS).map(([id, a]) => `<button type="button" class="avatar-opt ${id === sel ? 'is-active' : ''}" data-av="${id}" aria-pressed="${id === sel}">
      ${mascotSVG(id === sel ? 'party' : 'happy', id, id === sel ? color : a.color)}<span>${a.name}</span></button>`).join('');
  }
  function counterSettings() {
    if (!Native) return `<p>El contador automático funciona en la app de Android. En el navegador puedes añadir los pasos a mano.</p>`;
    if (!counter) return `<p>Comprobando el contador…</p>`;
    const row = (ok, txt) => `<div class="check-row"><span class="${ok ? 'ok' : 'ko'}">${ok ? '✓' : '!'}</span>${txt}</div>`;
    return `${row(counter.available, counter.available ? 'Tu móvil tiene contador de pasos' : 'Tu móvil no tiene contador de pasos')}
      ${row(counter.permission === 'granted', counter.permission === 'granted' ? 'Permiso de actividad física concedido' : 'Falta el permiso de actividad física')}
      ${row(counter.running, counter.running ? 'Contando en segundo plano' : 'El contador está parado')}
      ${row(!counter.batteryOptimized, counter.batteryOptimized ? 'Android puede pararlo para ahorrar batería' : 'Sin restricciones de batería')}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${!counter.running || counter.permission !== 'granted' ? `<button class="btn btn--primary btn--sm" id="s-enable">Activar contador</button>` : ''}
        ${counter.batteryOptimized ? `<button class="btn btn--soft btn--sm" id="s-battery">Quitar restricción de batería</button>` : ''}
      </div>`;
  }
  function milestoneEditor(key, label) {
    return `<div class="field"><label>${label}</label><div class="chips" data-ms="${key}">
      ${S.settings[key].slice().sort((a, b) => a - b).map(v => `<span class="chip">${fmtK(v)}<button type="button" data-rm="${v}" aria-label="Quitar ${fmt(v)}">✕</button></span>`).join('')}
      <button class="chip chip--add" type="button" data-add="${key}">+ Añadir</button>
    </div></div>`;
  }
  function settingsSheet() {
    const c = S.settings;
    openSheet(`
      <h2 class="sheet__title">Ajustes</h2>
      <p class="sheet__sub">Personaliza tus objetivos, tu mascota y tus hitos.</p>

      <div class="settings-group">
        <h3>🎯 Objetivos</h3>
        <div class="field"><label for="s-daily">Objetivo diario (pasos)</label>
          <div class="stepper"><button type="button" data-step="s-daily" data-d="-500">−</button><input class="input num" id="s-daily" type="number" inputmode="numeric" min="500" step="500" value="${c.dailyGoal}"><button type="button" data-step="s-daily" data-d="500">+</button></div></div>
        <div class="field"><label for="s-weekly">Objetivo semanal (pasos)</label>
          <div class="stepper"><button type="button" data-step="s-weekly" data-d="-5000">−</button><input class="input num" id="s-weekly" type="number" inputmode="numeric" min="1000" step="5000" value="${c.weeklyGoal}"><button type="button" data-step="s-weekly" data-d="5000">+</button></div></div>
      </div>

      <div class="settings-group">
        <h3>🏅 Hitos e insignias</h3>
        <p>Cada hito se convierte en una insignia. Añade o quita los que quieras.</p>
        ${milestoneEditor('dailyMilestones', 'Hitos diarios')}
        ${milestoneEditor('weeklyMilestones', 'Retos semanales')}
        ${milestoneEditor('totalMilestones', 'Pasos acumulados')}
      </div>

      <div class="settings-group">
        <h3>🐾 Tu mascota</h3>
        <p>Elige quién te acompaña. Cada una celebra tus logros a su manera.</p>
        <div class="avatars" id="s-avatars">${avatarPicker(c.avatar, c.mascotColor)}</div>
        <div class="field" style="margin-top:14px"><label for="s-mname">Nombre</label><input class="input" id="s-mname" maxlength="16" value="${esc(c.mascotName)}"></div>
        <label style="font-weight:800;font-size:14px;color:var(--ink-2);display:block;margin-bottom:8px">Color</label>
        <div class="swatches">${COLORS.map(col => `<button class="swatch ${col === c.mascotColor ? 'is-active' : ''}" data-col="${col}" style="background:${col}" aria-label="Color ${col}"></button>`).join('')}</div>
      </div>

      <div class="settings-group">
        <h3>🙂 Tú</h3>
        <div class="field"><label for="s-name">Tu nombre</label><input class="input" id="s-name" maxlength="20" value="${esc(c.name)}" placeholder="¿Cómo te llamas?"></div>
        <div class="field-row">
          <div class="field"><label for="s-stride">Zancada (cm)</label><input class="input num" id="s-stride" type="number" min="30" max="130" value="${c.strideCm}"></div>
          <div class="field"><label for="s-weight">Peso (kg)</label><input class="input num" id="s-weight" type="number" min="25" max="250" value="${c.weightKg}"></div>
        </div>
        <small style="color:var(--muted);font-weight:700;font-size:12px">Se usan para estimar distancia y calorías. Zancada ≈ altura × 0,415.</small>
      </div>

      <div class="settings-group">
        <h3>📱 Contador automático</h3>
        ${counterSettings()}
      </div>

      <div class="settings-group">
        <h3>🎨 Apariencia</h3>
        <div class="field"><label>Tema</label><div class="chips" id="s-theme">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<button type="button" class="chip ${c.theme === v ? 'is-active' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
      </div>

      <div class="settings-group">
        <h3>💾 Tus datos</h3>
        <p>Todo se guarda solo en este dispositivo. Haz copias de seguridad de vez en cuando.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn--soft btn--sm" id="s-export">Exportar copia</button>
          <label class="btn btn--soft btn--sm" style="cursor:pointer">Importar<input type="file" id="s-import" accept="application/json" hidden></label>
          <button class="btn btn--soft btn--sm" id="s-demo">Datos de ejemplo</button>
          <button class="btn btn--danger btn--sm" id="s-reset">Borrar todo</button>
        </div>
      </div>

      <div class="sheet__actions"><button class="btn btn--primary" id="s-save">Guardar cambios</button></div>`, sh => {
      let color = c.mascotColor, avatar = c.avatar, theme = c.theme;
      const redrawAv = () => { $('#s-avatars', sh).innerHTML = avatarPicker(avatar, color); $$('.swatch', sh).forEach(x => x.classList.toggle('is-active', x.dataset.col === color)); };
      const en = $('#s-enable', sh); if (en) en.onclick = () => { closeSheet(); enableCounter(); };
      const bt = $('#s-battery', sh); if (bt) bt.onclick = () => { Native.openBatterySettings(); closeSheet(); setTimeout(() => refreshCounter().then(() => render({ soft: true })), 4000); };
      const ms = { dailyMilestones: [...c.dailyMilestones], weeklyMilestones: [...c.weeklyMilestones], totalMilestones: [...c.totalMilestones] };
      const redrawMs = key => {
        const box = $(`[data-ms="${key}"]`, sh);
        box.innerHTML = ms[key].slice().sort((a, b) => a - b).map(v => `<span class="chip">${fmtK(v)}<button type="button" data-rm="${v}" aria-label="Quitar ${fmt(v)}">✕</button></span>`).join('') + `<button class="chip chip--add" type="button" data-add="${key}">+ Añadir</button>`;
      };
      sh.addEventListener('click', e => {
        const st = e.target.closest('[data-step]');
        if (st) { const i = $('#' + st.dataset.step, sh); i.value = Math.max(500, (+i.value || 0) + +st.dataset.d); return; }
        const rm = e.target.closest('[data-rm]');
        if (rm) { const key = rm.closest('[data-ms]').dataset.ms; ms[key] = ms[key].filter(v => v !== +rm.dataset.rm); redrawMs(key); return; }
        const add = e.target.closest('[data-add]');
        if (add) {
          const key = add.dataset.add;
          const v = Math.round(+String(prompt('¿Cuántos pasos para el nuevo hito?', key === 'dailyMilestones' ? '12000' : key === 'weeklyMilestones' ? '60000' : '2000000') || '').replace(/\D/g, ''));
          if (v > 0 && !ms[key].includes(v)) { ms[key].push(v); redrawMs(key); }
          return;
        }
        const sw = e.target.closest('[data-col]');
        if (sw) { color = sw.dataset.col; redrawAv(); return; }
        const av = e.target.closest('[data-av]');
        if (av) { const nm = $('#s-mname', sh); if (!nm.value.trim() || nm.value.trim() === AVATARS[avatar].name) nm.value = AVATARS[av.dataset.av].name; avatar = av.dataset.av; color = AVATARS[avatar].color; redrawAv(); return; }
        const tv = e.target.closest('#s-theme [data-v]');
        if (tv) { theme = tv.dataset.v; $$('#s-theme .chip', sh).forEach(x => x.classList.toggle('is-active', x === tv)); applyTheme(theme); return; }
      });
      $('#s-export', sh).onclick = () => {
        const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pasito-copia-${todayKey()}.json`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };
      $('#s-import', sh).onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        try { const d = JSON.parse(await f.text()); if (!d.days || !d.settings) throw 0; S = { ...defaults(), ...d, settings: { ...defaults().settings, ...d.settings } }; save(); closeSheet(); applyTheme(S.settings.theme); render(); toast('Copia importada ✔'); }
        catch { toast('Ese archivo no parece una copia de Pasito'); }
      };
      $('#s-demo', sh).onclick = () => { closeSheet(); loadDemo(); };
      $('#s-reset', sh).onclick = () => {
        if (confirm('¿Seguro? Se borrarán todos tus pasos, historial e insignias.')) { const keep = S.settings; S = defaults(); S.settings = { ...keep }; save(); closeSheet(); render(); toast('Datos borrados'); }
      };
      $('#s-save', sh).onclick = () => {
        Object.assign(S.settings, {
          dailyGoal: clamp(Math.round(+$('#s-daily', sh).value || 8000), 500, 100000),
          weeklyGoal: clamp(Math.round(+$('#s-weekly', sh).value || 50000), 1000, 700000),
          name: $('#s-name', sh).value.trim(),
          mascotName: $('#s-mname', sh).value.trim() || 'Pipo',
          mascotColor: color, avatar,
          strideCm: clamp(+$('#s-stride', sh).value || 72, 30, 130),
          weightKg: clamp(+$('#s-weight', sh).value || 70, 25, 250),
          theme, ...ms,
        });
        save(); closeSheet(); render(); toast('Ajustes guardados'); checkBadges();
        if (Native) Native.setGoal({ goal: S.settings.dailyGoal }).catch(() => {});
      };
    });
  }

  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }

  // ================= Bienvenida =================
  function onboarding() {
    let avatar = S.settings.avatar, goal = 8000;
    openSheet(`
      <div class="celebrate">
        <div class="mascot-wrap" id="o-hero">${mascotSVG('party', avatar, AVATARS[avatar].color)}</div>
        <div class="celebrate__kicker">Bienvenida a Pasito</div>
        <h2 id="o-hello">¡Hola! Soy ${esc(AVATARS[avatar].name)} 👋</h2>
        <p>Contaré tus pasos solo, celebraré tus hitos y te daré insignias. ¿Quién quieres que te acompañe?</p>
      </div>
      <div class="avatars" id="o-avatars" style="margin-top:14px">${avatarPicker(avatar, AVATARS[avatar].color)}</div>
      <div style="margin-top:18px">
        <div class="field"><label for="o-name">¿Cómo te llamas?</label><input class="input" id="o-name" maxlength="20" placeholder="Tu nombre (opcional)"></div>
        <div class="field"><label>¿Cuántos pasos quieres dar al día?</label>
          <div class="chips" id="o-goal">${[5000, 6000, 8000, 10000, 12000].map(v => `<button type="button" class="chip ${v === 8000 ? 'is-active' : ''}" data-v="${v}">${fmt(v)}</button>`).join('')}</div>
          <small>Muchos estudios sitúan un beneficio claro entre 7.000 y 10.000 pasos. Lo puedes cambiar cuando quieras.</small>
        </div>
      </div>
      <div class="sheet__actions" style="flex-direction:column">
        <button class="btn btn--primary btn--block" id="o-go">${Native ? '¡Empezar a contar pasos!' : '¡Vamos a caminar!'}</button>
        <button class="btn btn--soft btn--block" id="o-demo">Explorar con datos de ejemplo</button>
      </div>
      ${Native ? `<p class="sheet__sub" style="text-align:center;margin-top:12px;font-size:12px">Te pediré permiso de actividad física para leer el contador de pasos del móvil. Tus datos no salen del teléfono.</p>` : ''}`, sh => {
      $('#o-goal', sh).onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; goal = +b.dataset.v; $$('#o-goal .chip', sh).forEach(x => x.classList.toggle('is-active', x === b)); };
      $('#o-avatars', sh).onclick = e => {
        const b = e.target.closest('[data-av]'); if (!b) return;
        avatar = b.dataset.av; const a = AVATARS[avatar];
        $('#o-avatars', sh).innerHTML = avatarPicker(avatar, a.color);
        $('#o-hero', sh).innerHTML = mascotSVG('party', avatar, a.color);
        $('#o-hello', sh).textContent = `¡Hola! Soy ${a.name} 👋`;
      };
      const finish = demo => {
        Object.assign(S.settings, {
          name: $('#o-name', sh).value.trim(), dailyGoal: goal, weeklyGoal: Math.round(goal * 6.25 / 5000) * 5000,
          avatar, mascotName: AVATARS[avatar].name, mascotColor: AVATARS[avatar].color, onboarded: true,
        });
        save(); closeSheet();
        if (demo) loadDemo(); else render();
        if (Native) enableCounter();
      };
      $('#o-go', sh).onclick = () => finish(false);
      $('#o-demo', sh).onclick = () => finish(true);
    });
  }

  // ================= Datos de ejemplo =================
  function loadDemo() {
    if (allKeys().length && !confirm('Se añadirán 10 semanas de datos de ejemplo a tu historial. ¿Continuar?')) return;
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    for (let i = 70; i >= 0; i--) {
      if (i === 0 && Native) continue; // hoy se cuentan los pasos reales
      const d = addDays(now, -i), k = keyOf(d);
      if (hasData(k)) continue;
      if (rnd() < .06 && i > 0) continue;
      const wd = (d.getDay() + 6) % 7;
      const target = i === 0 ? 4300 : ((wd >= 5 ? 9500 : 7200) + (70 - i) * 25) * (.45 + rnd());
      const day = ensureDay(k);
      const put = (m, v) => { if (i === 0 && m > nowMin) return; day.auto[m] = (day.auto[m] || 0) + v; };
      // pasos sueltos durante el día (casa, trabajo…)
      let loose = target * .3;
      while (loose > 0) { const m = 450 + Math.floor(rnd() * 900), v = 4 + Math.floor(rnd() * 10); put(m, v); loose -= v; }
      // caminatas
      let walk = target * .7;
      const starts = [7 * 60 + 40, 13 * 60 + 50, 18 * 60 + 15, 20 * 60 + 40, 21 * 60 + 10];
      let j = 0; const off = Math.floor(rnd() * 5);
      while (walk > 300 && j < 4) {
        const pace = 95 + rnd() * 25, mins = Math.max(5, Math.round(Math.min(walk, 2500 + rnd() * 5000) / pace));
        const st = starts[(off + j) % starts.length] + Math.floor(rnd() * 20);
        for (let m = 0; m < mins; m++) { const v = Math.round(pace * (.85 + rnd() * .3)); put(st + m, v); walk -= v; }
        j++;
      }
      if (rnd() < .15 && i > 0) {
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 11, 0).getTime();
        addSession(k, { id: `demo${k}`, start: t, end: t + 1500000, steps: 2600, seconds: 1500, source: 'manual' });
      }
    }
    save(); render();
    checkBadges({ silent: true });
    toast('Datos de ejemplo cargados. ¡Echa un vistazo a Historial y Logros!');
  }

  // ================= Confeti =================
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = $('#confetti'), ctx = cv.getContext('2d');
    const dpr = devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.scale(dpr, dpr);
    const cols = ['#FF6A3D', '#FF9F43', '#7B61FF', '#19B394', '#F5B301', '#FF5C9A'];
    const ps = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 80, y: innerHeight * .35,
      vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 4,
      r: 4 + Math.random() * 5, c: cols[Math.floor(Math.random() * cols.length)],
      a: Math.random() * 6, va: (Math.random() - .5) * .4, shape: Math.random() < .5,
    }));
    let frame = 0;
    (function tick() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ps.forEach(p => {
        p.vy += .32; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c;
        if (p.shape) ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); else { ctx.beginPath(); ctx.arc(0, 0, p.r / 2.4, 0, 7); ctx.fill(); }
        ctx.restore();
      });
      if (++frame < 200) requestAnimationFrame(tick); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })();
  }

  // ================= Arranque =================
  $$('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#btn-settings').addEventListener('click', () => refreshCounter().finally(settingsSheet));
  applyTheme(S.settings.theme);
  const h0 = location.hash.slice(1);
  setTab(views[h0] ? h0 : 'hoy');
  if (!S.settings.onboarded) onboarding();
  else checkBadges();

  if (Native) {
    refreshCounter().then(async () => {
      // Si ya estaba activado pero Android lo paró, lo volvemos a lanzar.
      if (counter && counter.enabled && counter.permission === 'granted' && !counter.running) { try { counter = await Native.enable(); } catch { /* nada */ } }
      if (S.settings.onboarded) Native.setGoal({ goal: S.settings.dailyGoal }).catch(() => {});
      if (!$('.sheet')) render({ soft: true });
      sync();
    });
    // Al volver a la app y cada 20 s mientras está abierta, recogemos los pasos nuevos.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshCounter().then(() => { if (!$('.sheet')) render({ soft: true }); sync(); });
    });
    setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 20000);
  }

  // Cambio de día a medianoche
  let lastDay = todayKey();
  setInterval(() => { if (todayKey() !== lastDay) { lastDay = todayKey(); if (!$('.sheet')) render({ soft: true }); } }, 60000);

  if (!Native && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
