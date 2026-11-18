// Pixel Anni: an 8-bit twin drawn pixel by pixel. This window is a puppet:
// Anni's own window directs the fight and sends position, animation and lines here.
const api = window.anniAPI || { onTwinState(cb) { window.__twinCb = cb; }, twinClicked() { window.__clicked = (window.__clicked || 0) + 1; } };   // stub for testing
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const cvs = document.getElementById('c'), ctx = cvs.getContext('2d');
const bubble = document.getElementById('bubble'), hpEl = document.getElementById('hp'), hpFill = hpEl.querySelector('i');

const LW = 48;                     // logical (chunky) pixels across the window
let LH = 60, PX = 4;               // logical height, screen pixels per logical pixel
function resize() {
  LH = Math.max(40, Math.round(LW * innerHeight / innerWidth));
  cvs.width = LW; cvs.height = LH; PX = innerWidth / LW;
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', resize); resize();

/* ---------------------------------------------------------------- sprite */
const PAL = { o: '#4a0b05', r: '#c42a1a', d: '#951a0e', h: '#e8613f', s: '#6f1209', w: '#f4f0e6', k: '#111111', b: '#2a0603' };
const SW = 32, SH = 29;
const cache = new Map();

// eyes: open | x | happy | closed ; legL/legR: how far each leg is lifted (walk cycle)
function sprite(eyes = 'open', legL = 0, legR = 0) {
  const key = eyes + legL + legR;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas'); c.width = SW; c.height = SH;
  const g = c.getContext('2d');
  const put = (x, y, col) => { g.fillStyle = PAL[col]; g.fillRect(x, y, 1, 1); };

  // stubby legs (behind the body)
  const leg = (x0, lift) => {
    const bottom = 27 - lift;
    for (let y = 19; y <= bottom; y++) for (let x = x0; x < x0 + 4; x++) {
      const edge = x === x0 || x === x0 + 3 || y === bottom;
      put(x, y, edge ? 'o' : x === x0 + 1 ? 'h' : 'r');
    }
  };
  leg(8, legL); leg(20, legR);

  // corduroy body: an outlined ellipse with vertical wales, highlight and shade
  const cx = 16, cy = 11.5, rx = 13.5, ry = 10.5;
  const inside = (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    if (!inside(x, y)) continue;
    const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry, wale = x % 3 === 1;
    let col = edge ? 'o' : wale ? 'd' : 'r';
    if (!edge) {
      if (v > 0.6) col = wale ? 's' : 'd';
      else if (u < -0.2 && v < -0.2 && !wale) col = 'h';
    }
    put(x, y, col);
  }

  // felt eyes (6x5), mirrored around the body centre
  const eye = (x0, right) => {
    const y0 = 9;
    if (eyes === 'open') {
      for (let y = y0; y < y0 + 5; y++) for (let x = x0; x < x0 + 6; x++) put(x, y, 'w');
      for (let y = y0 + 1; y < y0 + 3; y++) for (let x = x0 + 3; x < x0 + 5; x++) put(x, y, 'k');   // pupils look forward
    } else if (eyes === 'x') {
      for (let i = 0; i < 5; i++) { put(x0 + i, y0 + i, 'k'); put(x0 + 4 - i, y0 + i, 'k'); }
    } else if (eyes === 'happy') {
      [[0, 3], [1, 2], [2, 1], [3, 1], [4, 2], [5, 3]].forEach(([dx, dy]) => put(x0 + dx, y0 + dy, 'k'));
    } else {
      for (let x = x0; x < x0 + 6; x++) put(x, y0 + 2, 'k');
    }
    // angry brows: this is the *evil* twin
    if (eyes !== 'happy') {
      const brow = right ? [[5, -3], [4, -3], [3, -2], [2, -2], [1, -1], [0, -1]] : [[0, -3], [1, -3], [2, -2], [3, -2], [4, -1], [5, -1]];
      brow.forEach(([dx, dy]) => put(x0 + dx, y0 + dy, 'b'));
    }
  };
  eye(7, false); eye(19, true);

  const pixels = [];               // for spawn / derez effects
  const data = g.getImageData(0, 0, SW, SH).data;
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const i = (y * SW + x) * 4;
    if (data[i + 3] > 0) pixels.push({ x, y, c: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`, r: Math.random(), vx: (Math.random() - 0.5) * 30, vy: -10 - Math.random() * 40 });
  }
  const out = { c, pixels };
  cache.set(key, out);
  return out;
}

/* ---------------------------------------------------------------- state from Anni's window */
let S = null, anim = '', animStart = 0;
const now = () => performance.now() / 1000;

let typeTimer = 0, bubbleTimer = 0;
function say(text) {
  text = String(text).toUpperCase();
  clearInterval(typeTimer); clearTimeout(bubbleTimer);
  const shown = document.createElement('span'), rest = document.createElement('span');
  rest.className = 'rest'; rest.textContent = text;
  bubble.replaceChildren(shown, rest); bubble.classList.add('show');
  let i = 0;
  typeTimer = setInterval(() => {
    i = Math.min(text.length, i + 1); shown.textContent = text.slice(0, i); rest.textContent = text.slice(i);
    if (i >= text.length) clearInterval(typeTimer);
  }, 32);
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 1600 + text.length * 70);
}
function pop(text) {
  const el = document.createElement('div');
  el.className = 'pop'; el.textContent = text;
  el.style.left = (50 + (Math.random() - 0.5) * 20) + '%';
  el.style.top = (innerHeight - SH * PX * 0.9) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

api.onTwinState((st) => {
  if (st.anim !== anim) { anim = st.anim; animStart = now(); }
  S = st;
  hpFill.style.width = clamp(st.hp, 0, 100) + '%';
  hpEl.classList.toggle('low', st.hp < 30);
  if (st.say) say(st.say);
  if (st.fx) pop(st.fx);
});
cvs.addEventListener('pointerdown', (e) => { if (e.button === 0) api.twinClicked(); });

/* ---------------------------------------------------------------- drawing */
function frame() {
  requestAnimationFrame(frame);
  ctx.clearRect(0, 0, LW, LH);
  if (!S) return;
  const t = now(), at = t - animStart;
  let eyes = 'open', legL = 0, legR = 0, sx = 1, sy = 1, dx = 0, dy = 0, flash = false, glitch = false, stars = false;

  switch (anim) {
    case 'idle': dy = Math.floor(t * 2.5) % 2 ? 0 : -1; break;
    case 'walk': { const ph = Math.floor(t * 9) % 2; legL = ph ? 2 : 0; legR = ph ? 0 : 2; dy = -ph; break; }
    case 'windup': sx = 1.15; sy = 0.85; dx = -1; break;
    case 'attack': sx = 1.2; sy = 0.9; dx = 2; break;
    case 'glitch': sx = 1.15; sy = 0.92; dx = 2; glitch = true; break;
    case 'hit': eyes = 'x'; sx = 0.9; sy = 1.08; dx = -1; flash = at < 0.32 && Math.floor(at * 18) % 2 === 0; break;
    case 'ko': eyes = 'x'; sx = 1.25; sy = 0.55; stars = true; break;
    case 'victory': eyes = 'happy'; dy = -Math.round(Math.abs(Math.sin(at * 7)) * 6); break;
  }

  const spr = sprite(eyes, legL, legR);
  const w = Math.round(SW * sx), h = Math.round(SH * sy);
  const hop = Math.round((S.hop || 0) / PX);
  const x0 = Math.round(LW / 2 - w / 2 + dx), y0 = LH - 1 - hop + dy - h;

  ctx.save();
  if (S.face < 0) { ctx.translate(LW, 0); ctx.scale(-1, 1); }   // sprite faces right; mirror to face left

  if (anim === 'spawn' || anim === 'derez') {
    // materialise pixel by pixel / scatter into flying pixels
    const base = sprite('open');
    const p = anim === 'spawn' ? clamp(at / 1.1, 0, 1) : clamp(at / 1.0, 0, 1);
    const bx = Math.round(LW / 2 - SW / 2), by = LH - 1 - SH;
    for (const q of base.pixels) {
      if (anim === 'spawn') {
        if (q.r > p) continue;
        const drop = (p - q.r) < 0.15 ? Math.round((0.15 - (p - q.r)) * 40) : 0;   // fresh pixels fall into place
        ctx.fillStyle = q.c; ctx.fillRect(bx + q.x, by + q.y - drop, 1, 1);
      } else {
        const k = clamp((p - q.r * 0.4) / 0.6, 0, 1);
        if (k >= 1) continue;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = q.c; ctx.fillRect(Math.round(bx + q.x + q.vx * k), Math.round(by + q.y + q.vy * k), 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  } else if (glitch) {
    for (let y = 0; y < h; y += 3) {
      const off = Math.round((Math.random() - 0.5) * 4);
      ctx.drawImage(spr.c, 0, (y / h) * SH, SW, (3 / h) * SH, x0 + off, y0 + y, w, 3);
    }
    ctx.globalAlpha = 0.45; ctx.drawImage(spr.c, x0 - 2, y0, w, h); ctx.globalAlpha = 1;
  } else {
    ctx.drawImage(spr.c, x0, y0, w, h);
    if (flash) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x0, y0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  if (stars) {
    for (let k = 0; k < 3; k++) {
      const a = t * 4 + k * 2.094;
      ctx.fillStyle = Math.floor(t * 6 + k) % 2 ? '#ffe14a' : '#ffffff';
      ctx.fillRect(Math.round(LW / 2 + Math.cos(a) * 10), Math.round(y0 - 3 + Math.sin(a) * 2), 1, 1);
    }
  }
  ctx.restore();
}
requestAnimationFrame(frame);

window.__twin = { get state() { return S; }, sprite };
