// Anni's brain: scene, animation and behaviour.
import * as THREE from './vendor/three.module.js';
import { buildAnni, R, STAND_HEAD_Y, STAND_HIP_Y, SIT_HEAD_Y, SIT_HIP_Y, HIP_X } from './model.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const nowS = () => performance.now() / 1000;

/* ------------------------------------------------ Electron bridge (or a stub for browser testing) */
function mockApi() {
  const cbs = {};
  window.__anniCbs = cbs;
  return {
    init: async () => ({ settings: { walk: true, sound: false, follow: false, size: 'medium' }, bounds: { x: 400, y: 200, width: innerWidth, height: innerHeight }, platform: 'test' }),
    onTick: (cb) => (cbs.tick = cb), onBounds: (cb) => (cbs.bounds = cb), onAction: (cb) => (cbs.action = cb), onSettings: (cb) => (cbs.settings = cb),
    setPos: (x, y) => { window.__lastPos = [x, y]; }, setIgnore: () => {}, contextMenu: () => {},
    twinOpen: (b) => { window.__twinOpen = b; }, twinUpdate: (st) => { window.__twinState = st; }, twinClose: () => { window.__twinOpen = null; },
    onTwinClick: (cb) => (cbs.twinClick = cb),
  };
}
const api = window.anniAPI || mockApi();

/* ------------------------------------------------ three.js scene */
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: !window.anniAPI });
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 60);
const VIS_H = 4.15;                                   // world units visible top-to-bottom at the character
const CAM_DIST = VIS_H / (2 * Math.tan(THREE.MathUtils.degToRad(12)));
camera.position.set(0, 1.95, CAM_DIST);
camera.lookAt(0, 1.68, 0);

scene.add(new THREE.HemisphereLight(0xfff0e6, 0x74402e, 0.95));
const key = new THREE.DirectionalLight(0xfff1e0, 2.0); key.position.set(-3.5, 5.5, 6); scene.add(key);
const fill = new THREE.DirectionalLight(0xbfd2ff, 0.55); fill.position.set(5, 1.5, 3); scene.add(fill);
const rim = new THREE.DirectionalLight(0xff9a70, 1.3); rim.position.set(1, 3, -5); scene.add(rim);

const anni = buildAnni(renderer);
scene.add(anni.root, anni.shadow);
const { root, head, legs, eyes } = anni;

/* ------------------------------------------------ state */
let winW = innerWidth, winH = innerHeight, winX = 0, winY = 0;
let work = { x: 0, y: 0, width: 1920, height: 1040 };
let footPad = 12;
let settings = { walk: true, sound: true, follow: false };
let platform = 'win32';

const cursor = { x: -9999, y: -9999, px: -9999, py: -9999, sx: 0, sy: 0, lastX: 0, lastY: 0, lastT: 0, speed: 0, moved: 0, still: 0, init: false };
let hover = false, ignoring = null;
let lastActivity = nowS();
let napLock = 0;                                    // a requested nap can't be interrupted for a few seconds

let mode = 'idle', modeT = 0, modeDur = 0;
let t = 0;
let idleLeft = 3, sitLeft = 0, danceLeft = 0, hopsLeft = 0;
let walkTarget = 0, walkDir = 1, chaseTalk = false;
let spinAngle = 0, spinT = -1, flipAngle = 0, flipT = -1;
let vy = 0, vx = 0, bounced = false, launched = false, hopPower = 8.4, hopVX = 0, airTime = 0.6;
const GRAVITY = 30;                                  // hop gravity, world units / s^2
const MAX = 99;                                      // "as high as fits": capped by maxHopY
let maxHopY = 1.4;                                   // highest hop that keeps Anni inside the window (set in resize)
// launch a jump, never higher than the headroom left above her current height (she may already be mid-air)
function launchHop(v) {
  P.hopV = Math.min(v, Math.sqrt(2 * GRAVITY * Math.max(0, maxHopY - P.hopY)));
  P.hopY = Math.max(P.hopY, 0.001);
  airTime = (P.hopV + Math.sqrt(P.hopV * P.hopV + 2 * GRAVITY * P.hopY)) / GRAVITY;
}
let lookAway = 0, lookAwayX = 0, lookAwayY = 0;

// personality / interaction state
let lastSpoke = 0, chatterAt = nowS() + rand(40, 80), breakAt = nowS() + 50 * 60, sleepTalkAt = 0, sleptAt = 0;
let petAmt = 0, petIdle = 0, fxT = 0, purrT = 0;
let startleCool = 3, reachT = 0, reachCool = 0, reachTries = 0, reachHop = false;
let clicks = [], grumpyDir = 1;
let shake = { lastSign: 0, flips: [] }, dizzyPending = false, dragTalked = false;
let sneezed = false, excused = false;
let talkLeft = 0;

const P = {
  sit: 0, lid: 0, lookYaw: 0, lookPitch: 0, pupX: 0, pupY: 0, bodyYaw: 0, tilt: 0,
  sq: 0, sqV: 0, sqTarget: 0, hopY: 0, hopV: 0, bounce: 0, phase: 0, swing: 0, dangle: 0, asleep: 0,
};
let blinkT = 2.5, blinking = false, blinkP = 0;

/* ------------------------------------------------ expressions (eyes only: Anni has no mouth) */
const EXPR = {
  none: {}, happy: { squint: 0.62, pupil: 1.06 }, content: { squint: 0.78 }, annoyed: { up: 0.45 },
  surprised: { pupil: 0.68, eye: 1.13 }, dizzy: { dizzy: 1, squint: 0.85 }, yawn: { squint: 0.28 },
};
const X = { up: 0, lo: 0, pupil: 1, eye: 1, squint: 1, dizzy: 0 };
let expr = 'none', exprLeft = 0;
function emote(name, secs = 1.6) { expr = name; exprLeft = secs; }

/* ------------------------------------------------ sizing / projection */
function resize() {
  winW = innerWidth; winH = innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(winW, winH, false);
  camera.aspect = winW / winH; camera.updateProjectionMatrix();
  const g = new THREE.Vector3(0, 0, 0).project(camera);
  footPad = Math.max(0, winH - (1 - g.y) / 2 * winH) - 2;   // pixels between feet and window bottom
  // world height of the window's top edge at Anni's depth, minus her tallest extent while airborne:
  // body top (head centre + radius) or, mid-backflip, her feet (pivot 1.1 + 1.1), plus mid-air stretch
  const top = new THREE.Raycaster(); top.setFromCamera(new THREE.Vector2(0, 1), camera);
  const yTop = top.ray.origin.y + top.ray.direction.y * (-top.ray.origin.z / top.ray.direction.z);
  const tallest = Math.max(STAND_HEAD_Y + R.b, 2.2) * 1.06;
  maxHopY = Math.max(0.5, yTop - tallest - 0.16);
  document.documentElement.style.setProperty('--s', scale().toFixed(3));
}
addEventListener('resize', resize);

const scale = () => winW / 360;
const groundY = () => Math.round(work.y + work.height - winH + footPad);
const minX = () => work.x - winW * 0.28;
const maxX = () => work.x + work.width - winW + winW * 0.28;
const cursorTargetX = () => clamp(cursor.sx - winW / 2, minX(), maxX());
let sentX = NaN, sentY = NaN;
function pushPos() {
  const x = Math.round(winX), y = Math.round(winY);
  if (x !== sentX || y !== sentY) { sentX = x; sentY = y; api.setPos(x, y); }
}
const tmpV = new THREE.Vector3();
function headScreen(up = 0) {                       // screen point on Anni's body centre (+ up world units)
  head.getWorldPosition(tmpV); tmpV.y += up; tmpV.project(camera);
  return { x: (tmpV.x * 0.5 + 0.5) * winW, y: (1 - (tmpV.y * 0.5 + 0.5)) * winH };
}

/* ------------------------------------------------ speech bubble, particles */
const bubble = document.getElementById('bubble'), zzz = document.getElementById('zzz'), fx = document.getElementById('fx');
let bubbleTimer = 0, typeTimer = 0;
function say(text, ms) {
  const dur = ms || clamp(1500 + text.length * 60, 1700, 5200);
  clearTimeout(bubbleTimer); clearInterval(typeTimer);
  const shown = document.createElement('span'), rest = document.createElement('span');
  rest.className = 'rest'; rest.textContent = text;
  bubble.replaceChildren(shown, rest); bubble.classList.add('show');
  let i = 0;
  typeTimer = setInterval(() => {                   // typewriter; hidden remainder keeps the bubble size fixed
    i = Math.min(text.length, i + 1);
    shown.textContent = text.slice(0, i); rest.textContent = text.slice(i);
    if (i >= text.length) clearInterval(typeTimer);
  }, 26);
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), dur + text.length * 26);
  talkLeft = clamp(text.length * 0.045, 0.3, 2);
  lastSpoke = nowS();
  babble(text);
}
function puff(ch, { color = '#ff6fa3', n = 1, spread = 36, size = 18, up = 0.8 } = {}) {
  const h = headScreen(up), sc = scale();
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.className = 'p'; s.textContent = typeof ch === 'function' ? ch() : ch;
    s.style.left = (h.x + rand(-spread, spread) * sc) + 'px';
    s.style.top = (h.y + rand(-8, 8) * sc) + 'px';
    s.style.color = color;
    s.style.fontSize = Math.max(11, size * sc * rand(0.8, 1.2)) + 'px';
    s.style.setProperty('--dx', rand(-28, 28) * sc + 'px');
    s.style.setProperty('--r', rand(-25, 25) + 'deg');
    s.style.animationDelay = (i * 0.12) + 's';
    fx.appendChild(s);
    setTimeout(() => s.remove(), 1800 + i * 120);
  }
}

/* ------------------------------------------------ sound */
let ac = null, noiseBuf = null;
function audio() {
  if (!settings.sound) return null;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    return ac;
  } catch (e) { return null; }
}
function tone(f0, f1, dur, { type = 'triangle', vol = 0.15, delay = 0, f2 = 0 } = {}) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), s = a.currentTime + delay;
  o.type = type; o.frequency.setValueAtTime(f0, s);
  if (f2) { o.frequency.exponentialRampToValueAtTime(f1, s + dur * 0.4); o.frequency.exponentialRampToValueAtTime(f2, s + dur * 0.8); }
  else o.frequency.exponentialRampToValueAtTime(f1, s + dur);
  g.gain.setValueAtTime(0.0001, s);
  g.gain.exponentialRampToValueAtTime(vol, s + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
  o.connect(g).connect(a.destination); o.start(s); o.stop(s + dur + 0.02);
}
const squeak = (p = 1) => tone(520 * p, 1180 * p, 0.21, { f2: 820 * p, vol: 0.22 });
function babble(text) {                             // soft "animal-talk" blips while the bubble types
  if (text.startsWith('*')) return;
  const n = clamp(Math.ceil(text.replace(/[^a-z]/gi, '').length / 3), 1, 9);
  for (let i = 0; i < n; i++) { const f = rand(380, 640); tone(f, f * rand(0.8, 1.25), 0.07, { type: 'sine', vol: 0.07, delay: i * 0.085 }); }
}
function purr() {
  const a = audio(); if (!a) return;
  const s = a.currentTime, o = a.createOscillator(), g = a.createGain(), lfo = a.createOscillator(), lg = a.createGain();
  o.type = 'triangle'; o.frequency.value = 95; lfo.frequency.value = 22; lg.gain.value = 0.03;
  g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(0.04, s + 0.1); g.gain.linearRampToValueAtTime(0.0001, s + 0.9);
  lfo.connect(lg).connect(g.gain); o.connect(g).connect(a.destination);
  o.start(s); lfo.start(s); o.stop(s + 0.95); lfo.stop(s + 0.95);
}
function noise(dur = 0.35, vol = 0.16) {
  const a = audio(); if (!a) return;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), s = a.currentTime;
  src.buffer = noiseBuf; f.type = 'bandpass';
  f.frequency.setValueAtTime(2400, s); f.frequency.exponentialRampToValueAtTime(700, s + dur);
  g.gain.setValueAtTime(vol, s); g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
  src.connect(f).connect(g).connect(a.destination); src.start(s); src.stop(s + dur);
}
function melody() {                                 // a little random pentatonic tune; returns its length
  const notes = [523, 587, 659, 784, 880, 1047];
  let d = 0;
  for (let i = 0; i < 9; i++) { const f = pick(notes), len = pick([0.2, 0.2, 0.4]); tone(f, f * 1.01, len * 0.95, { type: 'sine', vol: 0.09, delay: d }); d += len; }
  return d;
}

/* ------------------------------------------------ things Anni says */
const HI = ["Hi! I'm Anni!", 'Boop!', 'Hehe!', 'Hello!', 'That tickles!', 'Squeak!', 'Hi hi hi!', 'You rang?', 'Yes?', 'Hi there!'];
const CHATTER = [
  'What are you working on?', 'Corduroy is very comfy, you know.', 'I like it down here.', 'Is it snack time yet?',
  "You're doing great!", "Don't forget to drink some water!", '*hums quietly*', "I wonder what's behind the screen...",
  'Psst... wiggle the mouse on me. I like pets.', "I'm keeping an eye on things. Two eyes, actually.",
  'Have you blinked lately? I just did.', 'This is a nice desktop.', 'Remember to stretch!',
  'Try holding the mouse just above my head...', 'You can throw me, you know. Gently.',
];
const SLEEP_TALK = ['...mmm... cookies...', 'zzz... five more minutes...', '*snore*', '...fluffy clouds...', 'zz... no, YOU\'RE a plush...'];
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return pick(["You're up late!", 'Burning the midnight oil?']);
  if (h < 12) return pick(['Good morning!', 'Morning! Sleep well?']);
  if (h < 17) return pick(['Good afternoon!', "Hi! I'm Anni!"]);
  if (h < 22) return pick(['Good evening!', 'Evening! Long day?']);
  return pick(["It's getting late...", 'Hi! Still working?']);
}
function chatterLine() {
  const h = new Date().getHours();
  if ((h >= 23 || h < 5) && Math.random() < 0.35) return pick(["It's really late... bed soon?", '*yawn* ...are you still up?']);
  return pick(CHATTER);
}

/* ------------------------------------------------ behaviour */
function setMode(m, dur = 0) {
  mode = m; modeT = 0; modeDur = dur; launched = false;
  zzz.classList.toggle('show', m === 'sleep');
}
function toIdle(a = 2, b = 4) { setMode('idle'); idleLeft = rand(a, b); }
const active = () => (lastActivity = nowS());
const canReact = () => mode === 'idle' || mode === 'sit' || mode === 'walk' || mode === 'chase';

function startHop(n = 1, power = 8.4, sideways = 0) { hopsLeft = n - 1; hopPower = power; hopVX = sideways; setMode('hop'); }
function startSpin() { spinT = 0; startHop(1, MAX); mode = 'spin'; }
function startFlip() { flipT = 0; startHop(1, MAX); mode = 'flip'; }
function startWalk() {
  const lo = minX() + winW * 0.28, hi = maxX() - winW * 0.28;
  let target = rand(lo, hi), tries = 0;
  while (Math.abs(target - winX) < 160 * scale() && tries++ < 8) target = rand(lo, hi);
  walkTarget = target; walkDir = Math.sign(target - winX) || 1; setMode('walk');
}
function startChase(talk) { chaseTalk = talk; setMode('chase', 9); }
function startDance() {
  danceLeft = rand(2.4, 3.6); setMode('dance'); squeak(1.15); emote('happy', danceLeft);
  if (Math.random() < 0.5) say(pick(['Dance party!', '♪ Wiggle wiggle ♪', 'Check out these moves!']), 1800);
}
function startSit() { sitLeft = rand(7, 16); setMode('sit'); }
function startSing() {
  const len = melody(); setMode('sing', len + 0.4); emote('content', len + 0.4);
  say(pick(['♪ La la la~', '♪ Hmm hmm hmm~', '♪ Doo bee doo~', '♪ Corduroy, corduroy~']), (len + 0.4) * 1000);
}
function startYawn() { setMode('yawn', 2.2); emote('yawn', 1.8); say('*yaaawn*', 1800); tone(320, 170, 1.1, { type: 'sine', vol: 0.06 }); }
function startSneeze() { setMode('sneeze', 2.8); sneezed = excused = false; say('Ah... ah...', 1300); }
function startLookAround() { setMode('lookaround', 3.2); say(pick(['Hmm?', 'What was that?', 'Did you hear something?']), 1600); puff('?', { color: '#ffffff' }); }
function startGrumpy() {
  grumpyDir = -Math.sign(cursor.x - winW / 2) || 1;
  setMode('grumpy', 3.6); emote('annoyed', 3.6);
  say(pick(['Hey! Quit poking me!', 'Rude!', 'Hmph!', 'Okay, that\'s enough poking.']), 1800);
  tone(300, 190, 0.25, { type: 'square', vol: 0.04 });
}
function startDizzy() {
  setMode('dizzy', 3); emote('dizzy', 3);
  say(pick(["Ugh... the room is spinning", '@_@ whoa...', "Everything's wobbly..."]), 2400);
  puff('✦', { color: '#ffd84a', n: 4, spread: 50 });
}
function startPet() {
  setMode('pet'); petIdle = 0; fxT = 0; purrT = 0; emote('happy', 99);
  say(pick(['Ooh, pets!', "Hehe~ that's nice", 'More please!', '*happy squeaks*']), 1800);
}
function chatter() { say(chatterLine()); emote('content', 2); }
function wake() {
  if (mode !== 'sleep') return;
  setMode('wake'); emote('surprised', 0.8); say('...huh?', 1400);
  if (nowS() - sleptAt > 20) setTimeout(() => { if (mode !== 'sleep') say(pick(["Oh! You're back!", "I wasn't sleeping! Promise.", 'Did I miss anything?'])); }, 1500);
}
function goSleep() { setMode('sleep'); sleptAt = nowS(); sleepTalkAt = sleptAt + rand(25, 50); }

function pickAction() {
  const far = Math.abs(cursorTargetX() - winX) > 350 * scale();
  const options = [['look', 1.5], ['hop', 1.5], ['sit', 1.1], ['spin', 0.6], ['dance', 0.7], ['sing', 0.6], ['flip', 0.4],
    ['yawn', 0.4], ['sneeze', 0.3], ['lookaround', 0.6]];
  if (nowS() - lastSpoke > 20) options.push(['chatter', 1]);
  if (settings.walk) options.push(['walk', 4.5]);
  if (settings.walk && far) options.push(['visit', 1.5]);
  let r = Math.random() * options.reduce((s, o) => s + o[1], 0);
  for (const [name, w] of options) { if ((r -= w) <= 0) return name; }
  return 'look';
}
function doAction(a) {
  switch (a) {
    case 'walk': startWalk(); break;
    case 'visit': startChase(true); say(pick(['Wait for me!', 'Coming!', 'Where ya going?']), 1400); break;
    case 'hop': startHop(Math.random() < 0.3 ? 2 : 1); break;
    case 'sit': startSit(); break;
    case 'spin': startSpin(); if (Math.random() < 0.4) say('Wheee!', 1100); break;
    case 'dance': startDance(); break;
    case 'sing': startSing(); break;
    case 'flip': startFlip(); break;
    case 'yawn': startYawn(); break;
    case 'sneeze': startSneeze(); break;
    case 'lookaround': startLookAround(); break;
    case 'chatter': chatter(); break;
    default: lookAway = rand(0.8, 1.6); lookAwayX = rand(-1, 1); lookAwayY = rand(-0.5, 0.5);
  }
}

// reactions to where the mouse is and what it is doing
function mouseReactions(dt, now, sc) {
  const moved = cursor.moved; cursor.moved = 0;
  if (drag || mode === 'fall' || mode === 'drag' || mode === 'sleep' || mode === 'fight') { petAmt = 0; return; }
  const c = headScreen(0);
  const dx = cursor.x - c.x;
  // distance from Anni to the path the cursor swept since the last tick (fast flicks skip past otherwise)
  const sx = cursor.x - cursor.px, sy = cursor.y - cursor.py, sl = sx * sx + sy * sy;
  const u = sl > 0 ? clamp(((c.x - cursor.px) * sx + (c.y - cursor.py) * sy) / sl, 0, 1) : 1;
  const dist = Math.hypot(cursor.px + sx * u - c.x, cursor.py + sy * u - c.y);

  // petting: wiggle the mouse over Anni
  if (hover) petAmt += moved;
  petAmt = Math.max(0, petAmt - 260 * sc * dt);
  if (mode === 'pet') { if (hover && moved > 1) petIdle = 0; return; }
  if (petAmt > 450 * sc && (canReact() || mode === 'dance' || mode === 'sing')) { petAmt = 0; startPet(); return; }

  // startle: the mouse whooshes past close by
  if (startleCool <= 0 && cursor.speed > 2600 && dist < 150 * sc && !hover && canReact()) {
    startleCool = 4;
    if (Math.random() < 0.6) {
      startleCool = 10;
      emote('surprised', 1.2); puff('!', { color: '#ffd84a', size: 24 });
      say(pick(['Eep!', 'Whoa!', 'Yikes!', 'Careful!']), 1100);
      startHop(1, 7.5, -(Math.sign(dx) || 1) * 230 * sc);
      return;
    }
  }

  // reach: the mouse hovers just above Anni's head
  const top = headScreen(0.85);
  const above = Math.abs(cursor.x - top.x) < 60 * sc && cursor.y < top.y - 6 && cursor.y > top.y - (maxHopY / VIS_H * winH + 30 * sc);
  if (above && cursor.still > 0.5 && (mode === 'idle' || mode === 'sit') && reachCool <= 0) {
    reachT += dt;
    if (reachT > 0.9) {
      reachT = 0; reachCool = 2.2; reachTries++; reachHop = true;
      startHop(1, MAX);
      say(pick(reachTries > 2 ? ['So close!', 'Almost!', 'Hold still!', 'Grr, so high!'] : ["I'll get it!", 'Hup!', 'Gonna catch it!']), 1100);
    }
  } else if (!above) { reachT = 0; if (cursor.still < 0.2) reachTries = 0; }

  // did that reach-hop actually touch the cursor?
  if (reachHop && mode === 'hop' && launched && Math.abs(P.hopV) < 2.5 && Math.hypot(cursor.x - top.x, cursor.y - top.y) < 40 * sc) {
    reachHop = false; reachTries = 0; reachCool = 5;
    say(pick(['Got it!', 'Gotcha!', 'Caught it!']), 1400); emote('happy', 2); puff('✦', { color: '#ffd84a', n: 3, up: 1 });
  }
}

function updateBehaviour(dt) {
  const now = nowS();
  const sc = scale();
  startleCool -= dt; reachCool -= dt;

  // wake up / fall asleep
  if (mode === 'sleep' && now > napLock && now - lastActivity < 1) wake();
  if ((mode === 'idle' || mode === 'sit') && now - lastActivity > 120) goSleep();
  if (mode === 'sleep' && now > sleepTalkAt) { sleepTalkAt = now + rand(40, 80); say(pick(SLEEP_TALK), 2600); }

  mouseReactions(dt, now, sc);

  switch (mode) {
    case 'idle':
      if (settings.follow && settings.walk && Math.abs(cursorTargetX() - winX) > 140 * sc) { startChase(false); break; }
      if (now > breakAt) { breakAt = now + 50 * 60; startHop(1); say("You've been at it a while. Stretch break?", 4000); break; }
      if (now > chatterAt && now - lastSpoke > 20) { chatterAt = now + rand(60, 120); chatter(); }
      idleLeft -= dt;
      if (idleLeft <= 0) { idleLeft = rand(3.5, 8); doAction(pickAction()); }
      break;

    case 'walk': {
      const speed = 105 * sc;
      winX += walkDir * Math.min(speed * dt, Math.abs(walkTarget - winX));
      winX = clamp(winX, minX(), maxX());
      P.phase += dt * 9.5;
      if (Math.abs(walkTarget - winX) < 1 || winX <= minX() || winX >= maxX()) setMode('idle');
      break;
    }

    case 'chase': {
      const d = cursorTargetX() - winX;
      if (Math.abs(d) > 2) walkDir = Math.sign(d);
      winX = clamp(winX + walkDir * Math.min(175 * sc * dt, Math.abs(d)), minX(), maxX());
      P.phase += dt * 13;
      const arrived = Math.abs(d) < 30 * sc;
      if (arrived || modeT > modeDur) {
        if (settings.follow) toIdle(0.5, 1.2); else toIdle();
        if (chaseTalk && arrived) { startHop(1); say(pick(['Found you!', 'Hi again!', 'Here I am!']), 1500); }
      }
      break;
    }

    case 'hop':
    case 'spin':
    case 'flip':
      if (!launched && modeT > 0.15) {
        launched = true; launchHop(hopPower); squeak(1.2 + Math.random() * 0.2);
        if (mode === 'flip') say(pick(['Hup!', 'Watch this!']), 900);
      }
      if (launched && P.hopY > 0) winX = clamp(winX + hopVX * dt, minX(), maxX());
      if (launched && P.hopY <= 0 && P.hopV <= 0) {
        P.sq = Math.max(P.sq, 0.2); P.sqV = 0; P.hopY = 0; P.hopV = 0;
        if (mode === 'spin') { spinT = -1; spinAngle = 0; }
        if (mode === 'flip') {
          flipT = -1; flipAngle = 0;
          say(pick(['Ta-da!', 'Nailed it!', 'Ten out of ten!']), 1500); emote('happy', 1.5);
          puff('✦', { color: '#ffd84a', n: 3, spread: 50 });
        }
        reachHop = false;
        if (hopsLeft > 0) { hopsLeft--; modeT = 0; launched = false; }
        else { hopVX = 0; setMode('idle'); }
      }
      break;

    case 'dance':
      danceLeft -= dt; P.phase += dt * 11;
      if ((fxT -= dt) <= 0) { fxT = 0.7; puff(() => pick(['♪', '♫']), { color: '#ffffff' }); }
      if (danceLeft <= 0) setMode('idle');
      break;

    case 'sing':
      if ((fxT -= dt) <= 0) { fxT = 0.55; puff(() => pick(['♪', '♫']), { color: '#ffffff', up: 0.9 }); }
      if (modeT > modeDur) toIdle();
      break;

    case 'sneeze':
      if (!sneezed && modeT > 1.15) {
        sneezed = true; noise(); squeak(0.7); say('ACHOO!', 1100); emote('surprised', 0.6);
        P.sq = -0.14; P.sqV = -2; puff('✦', { color: '#ffffff', n: 3, spread: 30, up: 0.2 });
      }
      if (sneezed && !excused && modeT > 2.0) { excused = true; say(pick(['...excuse me.', 'Bless me!', 'Oops. Corduroy fluff.']), 1700); }
      if (modeT > modeDur) toIdle();
      break;

    case 'lookaround':
      lookAway = 0.1; lookAwayY = -0.15;
      lookAwayX = modeT < 1 ? -0.95 : modeT < 2.1 ? 0.95 : 0;
      if (modeT > modeDur) { lookAway = 0; toIdle(); }
      break;

    case 'yawn':
    case 'grumpy':
    case 'dizzy':
      if (modeT > modeDur) {
        if (mode === 'grumpy') say(pick(['...okay, I forgive you.', 'Fine. Hi.', 'Hmph. Okay.']), 1600);
        toIdle();
      }
      break;

    case 'pet':
      petIdle += dt;
      if (petIdle < 0.4) {
        if ((fxT -= dt) <= 0) { fxT = 0.6; puff('♥', { color: '#ff6fa3' }); }
        if ((purrT -= dt) <= 0) { purrT = 0.9; purr(); }
      }
      if (petIdle > 1.4) {
        emote('content', 2); say(pick(['That was nice.', 'Mmm, thanks!', 'More later?', '*content squeak*']), 1600);
        toIdle(3, 5);
      }
      break;

    case 'sit':
      sitLeft -= dt;
      if (sitLeft <= 0) toIdle();
      break;

    case 'wake':
      if (modeT > 1.0) toIdle();
      break;

    case 'fall': {
      vy += 2800 * sc * dt; winY += vy * dt; winX += vx * dt;
      if (winX < minX()) { winX = minX(); vx = Math.abs(vx) * 0.55; squeak(0.9); say('Ow!', 900); }
      if (winX > maxX()) { winX = maxX(); vx = -Math.abs(vx) * 0.55; squeak(0.9); say('Ow!', 900); }
      vx *= Math.exp(-0.6 * dt);
      const g = groundY();
      if (winY >= g) {
        winY = g;
        if (vy > 1500 * sc && !bounced) { bounced = true; vy = -vy * 0.32; P.sq = 0.3; P.sqV = 0; squeak(0.8); }
        else {
          const hard = vy > 1400 * sc;
          P.sq = clamp(vy / 2600, 0.12, 0.32); P.sqV = 0; vy = 0; vx = 0; squeak(0.8);
          if (dizzyPending) { dizzyPending = false; startDizzy(); }
          else { toIdle(1.5, 3); if (hard && now - lastSpoke > 1.2) say(pick(['Oof!', 'Safe!', 'Ta-da!', 'I meant to do that.']), 1500); }
        }
      }
      break;
    }

    case 'fight': updateFight(dt, sc); break;

    case 'drag':
      if (modeT > 4 && !dragTalked) { dragTalked = true; say(pick(['Can you put me down now?', 'Where are we going?', 'Nice view up here!']), 2000); }
      break;
  }

  // spin / flip animation (runs on top of hopping)
  if (spinT >= 0 && launched) {
    spinT = Math.min(1, spinT + dt / (airTime * 0.92));
    spinAngle = spinT * spinT * (3 - 2 * spinT) * Math.PI * 2;
  }
  if (flipT >= 0 && launched) {
    flipT = Math.min(1, flipT + dt / (airTime * 0.92));
    flipAngle = -flipT * flipT * (3 - 2 * flipT) * Math.PI * 2;
  }
  // interrupted mid-air (drag, another action...): settle back upright instead of freezing
  const TAU = Math.PI * 2;
  if (mode !== 'spin' && spinT >= 0) spinT = -1;
  if (mode !== 'flip' && flipT >= 0) flipT = -1;
  const settle = (ang) => { const to = Math.round(ang / TAU) * TAU, v = damp(ang, to, 12, dt); return Math.abs(v - to) < 0.002 ? 0 : v; };
  if (spinT < 0 && spinAngle !== 0 && mode !== 'fight') spinAngle = settle(spinAngle);
  if (flipT < 0 && flipAngle !== 0) flipAngle = settle(flipAngle);

  if (mode !== 'fall' && mode !== 'drag') { // stay glued to the ground (e.g. if taskbar moved)
    const g = groundY(); if (Math.abs(winY - g) > 1) { winY = damp(winY, g, 8, dt); }
  }
  if (mode !== 'drag') pushPos();

  if (lookAway > 0) lookAway -= dt;
}

/* ------------------------------------------------ pixel twin fight */
// Anni's window directs the whole fight; the twin window (twin.js) just draws what it is told.
const hpEl = document.getElementById('hp'), hpFill = hpEl.querySelector('i');
const F = { on: false, phase: '', t: 0, said: {}, gen: 0 };
const ANNI_HIT = ['Ow!', 'Hey!', 'Not the corduroy!', 'Oof!', 'Rude!'];
const ANNI_BRAG = ['Take that!', 'Boop of justice!', 'Hi-yah!', 'Corduroy power!'];
const ANNI_DODGE = ['Too slow!', 'Missed me!', 'Nope!'];
const TWIN_HIT = ['OW. RUDE.', 'ERROR 404: DIGNITY', 'LAG!!', 'MY PIXELS!', 'CTRL+Z! CTRL+Z!'];
const TWIN_BRAG = ['8-BIT IS BEST BIT.', 'YOU ARE THE COPY.', 'GET PIXELATED.', 'HIGH SCORE!'];
const TWIN_DODGE = ['TOO SLOW.', 'MISSED. LOL.', 'DODGE ROLL!'];
const once = (time, key, fn) => { if (F.t >= time && !F.said[key]) { F.said[key] = true; fn(); } };
const setPhase = (p) => { F.phase = p; F.t = 0; F.said = {}; };
const anniCX = () => winX + winW / 2;
const twinY = () => Math.round(work.y + work.height - F.th + F.tw / 48);   // twin's feet sit 1 chunky pixel up
const twinMin = () => work.x + F.tw * 0.3, twinMax = () => work.x + work.width - F.tw * 0.3;
const chip = () => tone(880, 440, 0.09, { type: 'square', vol: 0.05 });
function updateHP() { hpFill.style.width = Math.max(0, F.aHP) + '%'; hpEl.classList.toggle('low', F.aHP < 30); }
function sendTwin(extra) {
  if (!F.on) return;
  const anim = F.tHitT > 0 ? 'hit' : F.tAnim;
  api.twinUpdate({ x: Math.round(F.tx - F.tw / 2), y: twinY(), hop: F.tHop, anim, face: F.tFace, hp: Math.max(0, F.tHP), ...(extra || {}) });
}
function startFight() {
  if (F.on) { endFight(true); return; }
  const tw = Math.round(winW * 0.8), th = Math.round(winH * 0.85);
  const cx = anniCX(), side = cx > work.x + work.width / 2 ? -1 : 1;           // spawn on the roomier side
  const tx = clamp(cx + side * winW * 1.2, work.x + tw / 2, work.x + work.width - tw / 2);
  F.gen++;
  Object.assign(F, { on: true, phase: 'intro', t: 0, said: {}, tx, tw, th, tHop: 0, tHopV: 0, tAnim: 'spawn', tFace: -side, tHP: 100, aHP: 100,
    tKnock: 0, aKnock: 0, aAnim: 'idle', aWalk: false, aFace: side, aHitT: 0, tHitT: 0, ex: null, pause: 0, vT: 0 });
  spinT = -1; flipT = -1; P.hopY = 0; P.hopV = 0; setMode('fight');
  api.twinOpen({ x: Math.round(tx - tw / 2), y: twinY(), w: tw, h: th });
  document.body.classList.add('fight'); updateHP();
  emote('surprised', 1.5); say('Huh?! Is that... me?!', 2000);
  tone(200, 1600, 0.6, { type: 'square', vol: 0.04 });
}
function endFight(abort) {                          // stop early: twin dissolves, Anni calms down
  if (!F.on) return;
  F.tAnim = 'derez'; F.tHitT = 0; sendTwin(abort ? { say: 'FINE. TRUCE.' } : undefined);
  F.on = false; spinAngle = 0;
  const gen = F.gen; setTimeout(() => { if (F.gen === gen && !F.on) api.twinClose(); }, 1100);
  document.body.classList.remove('fight');
  if (abort) say('Truce! Okay, truce.', 1600);
  toIdle();
}
function finishFight() { F.on = false; api.twinClose(); document.body.classList.remove('fight'); toIdle(); }

function resolveHit(e) {
  const A = e.att === 'a', sc = scale();
  if (e.dodge) {
    if (A) { F.tHopV = 700 * sc; sendTwin({ say: pick(TWIN_DODGE) }); }
    else { launchHop(8); say(pick(ANNI_DODGE), 1000); }
    tone(600, 900, 0.08, { type: 'square', vol: 0.04 });
    return;
  }
  const dmg = Math.round(rand(9, 17) * (e.special ? 1.5 : 1) * (e.crit ? 1.6 : 1));
  noise(0.14, 0.12); tone(240, 90, 0.16, { type: 'square', vol: 0.06 });
  const word = pick(['POW!', 'BAM!', 'BONK!', 'WHAM!']) + (e.crit ? ' CRIT!' : '');
  if (A) {
    F.tHP -= dmg; F.tHitT = 0.45; F.tKnock = F.aFace * 900 * sc;
    sendTwin({ fx: word, say: Math.random() < 0.45 ? pick(TWIN_HIT) : undefined });
    if (Math.random() < 0.35) say(pick(ANNI_BRAG), 1100);
  } else {
    F.aHP -= dmg; F.aHitT = 0.45; F.aAnim = 'hit'; F.aKnock = F.tFace * 900 * sc; emote('surprised', 0.5);
    puff(word, { color: '#ffe14a', size: 20, up: 0.3 });
    if (Math.random() < 0.5) say(pick(ANNI_HIT), 1000);
    else if (Math.random() < 0.4) sendTwin({ say: pick(TWIN_BRAG) });
    updateHP();
  }
}

function updateFight(dt, sc) {
  F.t += dt; F.aHitT -= dt; F.tHitT -= dt;
  // knockback slides, twin hop physics
  winX = clamp(winX + F.aKnock * dt, minX(), maxX());
  F.tx = clamp(F.tx + F.tKnock * dt, twinMin(), twinMax());
  const k = Math.exp(-6 * dt); F.aKnock *= k; F.tKnock *= k;
  if (F.tHop > 0 || F.tHopV > 0) { F.tHopV -= 2200 * sc * dt; F.tHop = Math.max(0, F.tHop + F.tHopV * dt); if (F.tHop === 0) F.tHopV = 0; }
  // always face each other
  const d = F.tx - anniCX();
  if (Math.abs(d) > 4) { F.aFace = Math.sign(d); F.tFace = -F.aFace; }
  walkDir = F.aFace; F.aWalk = false;
  if (F.aAnim === 'hit' && F.aHitT <= 0) F.aAnim = 'idle';

  switch (F.phase) {
    case 'intro':
      once(1.1, 'idle', () => { F.tAnim = 'idle'; });
      once(1.3, 'claim', () => sendTwin({ say: 'I AM THE REAL ANNI.' }));
      once(3.0, 'on', () => { emote('annoyed', 2.5); say("Oh, it's ON.", 1500); });
      once(4.1, 'go', () => { sendTwin({ say: 'ROUND 1... FIGHT!' }); chip(); setPhase('approach'); });
      break;

    case 'approach':
      if (Math.abs(d) > winW * 0.78 + 4) {
        F.aWalk = true; F.tAnim = 'walk'; P.phase += dt * 11;
        winX = clamp(winX + F.aFace * 115 * sc * dt, minX(), maxX());
        F.tx = clamp(F.tx + F.tFace * 115 * sc * dt, twinMin(), twinMax());
      } else {
        F.tAnim = 'idle';
        const att = Math.random() < 0.5 ? 'a' : 't';
        setPhase('ex');
        F.ex = { att, special: Math.random() < 0.22, hit: false, dodge: Math.random() < 0.18, crit: Math.random() < 0.12 };
        if (F.ex.special) { if (att === 'a') say('Spin attack!', 1200); else sendTwin({ say: pick(['PIXEL PUNCH!', 'GLITCH STRIKE!']) }); }
      }
      break;

    case 'ex': {                                    // windup -> lunge (hit lands) -> step back
      const e = F.ex, A = e.att === 'a', lungeV = winW * 0.3 / 0.22;
      const fwd = A ? F.aFace : F.tFace;
      if (F.t < 0.4) { if (A) F.aAnim = 'windup'; else F.tAnim = 'windup'; }
      else if (F.t < 0.62) {
        if (A) {
          F.aAnim = 'lunge'; winX = clamp(winX + fwd * lungeV * dt, minX(), maxX());
          if (e.special) spinAngle = ((F.t - 0.4) / 0.22) * Math.PI * 2;
        } else { F.tAnim = e.special ? 'glitch' : 'attack'; F.tx = clamp(F.tx + fwd * lungeV * dt, twinMin(), twinMax()); }
        if (!e.hit && F.t >= 0.55) { e.hit = true; resolveHit(e); }
      } else if (F.t < 1.0) {
        if (A) { if (F.aAnim === 'lunge') F.aAnim = 'idle'; spinAngle = 0; winX = clamp(winX - fwd * lungeV * 0.4 * dt, minX(), maxX()); }
        else { F.tAnim = 'idle'; F.tx = clamp(F.tx - fwd * lungeV * 0.4 * dt, twinMin(), twinMax()); }
      } else if (F.aHP <= 0 || F.tHP <= 0) setPhase('ko');
      else { setPhase('pause'); F.pause = rand(0.5, 1.2); }
      break;
    }

    case 'pause':
      if (F.t > F.pause) setPhase(F.aHP <= 0 || F.tHP <= 0 ? 'ko' : 'approach');
      break;

    case 'ko': {
      const twinLost = F.tHP <= 0;
      once(0, 'ko', () => {
        F.aHitT = 0; F.tHitT = 0;
        if (twinLost) {
          F.tAnim = 'ko'; F.aAnim = 'victory'; sendTwin({ say: 'GAME OVER' });
          emote('happy', 4); say('I win! There can only be one Anni!', 2600); melody();
        } else {
          F.aAnim = 'ko'; F.tAnim = 'victory'; sendTwin({ say: 'GG EZ.' });
          emote('dizzy', 5); say("Ugh... I've been pixel-punched...", 2400);
          tone(400, 100, 0.8, { type: 'square', vol: 0.05 });
        }
      });
      if (F.aAnim === 'victory' && P.hopY <= 0 && (F.vT -= dt) <= 0) { F.vT = 0.65; launchHop(6.5); }
      if (twinLost) {
        once(2.4, 'derez', () => { F.tAnim = 'derez'; });
        once(3.6, 'end', () => { finishFight(); say('...I kind of miss my twin already.', 2200); });
      } else {
        once(2.6, 'coin', () => sendTwin({ say: 'INSERT COIN TO CONTINUE' }));
        once(4.2, 'derez', () => { F.tAnim = 'derez'; });
        once(5.2, 'end', () => { finishFight(); emote('annoyed', 2); say('Best two out of three?!', 2000); });
      }
      break;
    }
  }
  sendTwin();
}

// you can help: clicking the twin bonks it
api.onTwinClick && api.onTwinClick(() => {
  if (!F.on || F.phase === 'intro' || F.phase === 'ko') return;
  F.tHP -= 6; F.tHitT = 0.35; F.tKnock = F.aFace * 400 * scale();
  chip(); sendTwin({ fx: 'BOOP!', say: Math.random() < 0.6 ? pick(['HEY! 2 V 1?!', 'NO FAIR!', 'OUCH. RUDE.', 'REPORTED.']) : undefined });
  if (Math.random() < 0.4) say(pick(['Thanks for the help!', 'Go team!', 'Yeah, get it!']), 1200);
  if (F.tHP <= 0 && F.phase !== 'ex') setPhase('ko');
});

/* ------------------------------------------------ pose */
function updatePose(dt) {
  // where is Anni's head on screen, and where is the cursor relative to it
  tmpV.set(0, STAND_HEAD_Y, 0).project(camera);
  const hx = (tmpV.x * 0.5 + 0.5) * winW, hy = (1 - (tmpV.y * 0.5 + 0.5)) * winH;
  let nx = Math.tanh((cursor.x - hx) / 260), ny = Math.tanh((cursor.y - hy) / 260);
  if (lookAway > 0) { nx = lookAwayX; ny = lookAwayY; }
  if (mode === 'sleep') { nx = 0; ny = 0; }
  if (mode === 'grumpy') { nx = grumpyDir * 0.7; ny = 0.25; }
  if (mode === 'fight' && F.aAnim !== 'ko') { nx = F.aFace * 0.85; ny = 0.05; }   // eyes on the twin

  // expression
  exprLeft -= dt; if (exprLeft <= 0) expr = 'none';
  const ex = EXPR[expr] || EXPR.none;
  X.up = damp(X.up, ex.up || 0, 10, dt); X.lo = damp(X.lo, ex.lo || 0, 10, dt);
  X.pupil = damp(X.pupil, ex.pupil || 1, 12, dt); X.eye = damp(X.eye, ex.eye || 1, 12, dt);
  X.dizzy = damp(X.dizzy, ex.dizzy || 0, 6, dt); X.squint = damp(X.squint, ex.squint || 1, 12, dt);

  const sleepy = mode === 'sleep' ? 1 : 0;
  P.asleep = damp(P.asleep, sleepy, 4, dt);
  P.sit = damp(P.sit, (mode === 'sit' || mode === 'sleep' || (mode === 'fight' && F.aAnim === 'ko')) ? 1 : 0, 7, dt);
  P.dangle = damp(P.dangle, mode === 'drag' ? 1 : 0, 10, dt);

  const walking = mode === 'walk' || mode === 'chase' || (mode === 'fight' && F.aWalk);
  let pitchExtra = 0;
  if (mode === 'sneeze') pitchExtra = !sneezed ? -0.22 * clamp(modeT / 1.15, 0, 1) : modeT < 1.6 ? 0.3 : 0;
  else if (mode === 'yawn') pitchExtra = modeT > 0.2 && modeT < 1.5 ? -0.22 : 0;
  else if (mode === 'sing') pitchExtra = -0.1;
  P.lookYaw = damp(P.lookYaw, walking ? 0 : nx * 0.55, 6, dt);
  P.lookPitch = damp(P.lookPitch, ny * 0.2 + P.asleep * 0.28 + pitchExtra, mode === 'sneeze' && sneezed ? 20 : 6, dt);
  const dz = X.dizzy;
  P.pupX = damp(P.pupX, nx * 0.125, 16, dt);
  P.pupY = damp(P.pupY, ny * 0.075, 16, dt);
  P.bodyYaw = damp(P.bodyYaw, walking ? walkDir * 0.85 : mode === 'grumpy' ? grumpyDir * 1.0 : mode === 'fight' ? F.aFace * 0.45 : 0, 7, dt);

  // tilt: waddle / dance / dragged / moods
  let tiltT = 0;
  if (walking) tiltT = Math.sin(P.phase) * (mode === 'chase' ? 0.1 : 0.08);
  else if (mode === 'dance') tiltT = Math.sin(P.phase) * 0.16;
  else if (mode === 'drag') tiltT = clamp(-dragVx * 0.00045, -0.45, 0.45) + Math.sin(t * 6) * 0.04;
  else if (mode === 'sing') tiltT = Math.sin(t * 3.2) * 0.1;
  else if (mode === 'dizzy') tiltT = Math.sin(t * 4.5) * 0.16;
  else if (mode === 'pet') tiltT = Math.sin(t * 9) * 0.05;
  else if (mode === 'lookaround') tiltT = lookAwayX * 0.05;
  else if (mode === 'fight') {
    const fa = F.aAnim, f = F.aFace;
    tiltT = fa === 'lunge' ? -f * 0.28 : fa === 'hit' ? f * 0.3 : fa === 'ko' ? f * 0.4 : fa === 'windup' ? f * 0.1 : fa === 'victory' ? Math.sin(t * 8) * 0.1 : 0;
  }
  P.tilt = damp(P.tilt, tiltT, 12, dt);

  // squash & stretch spring (volume-ish preserving)
  let sqT = 0;
  if (mode === 'drag') sqT = -0.06;
  else if (mode === 'wake') sqT = modeT < 0.5 ? -0.1 : 0;
  else if (mode === 'hop' || mode === 'spin' || mode === 'flip') sqT = launched ? 0 : 0.2;
  else if (mode === 'yawn') sqT = modeT > 0.2 && modeT < 1.5 ? -0.11 : 0;
  else if (mode === 'sneeze') sqT = !sneezed ? -0.07 * clamp(modeT / 1.15, 0, 1) : 0;
  else if (mode === 'pet') sqT = 0.05 + Math.sin(t * 10) * 0.025;
  else if (mode === 'grumpy') sqT = 0.06;
  else if (mode === 'dizzy') sqT = Math.sin(t * 6) * 0.04;
  else if (mode === 'fight') sqT = F.aAnim === 'windup' ? 0.2 : F.aAnim === 'hit' ? 0.15 : F.aAnim === 'ko' ? 0.1 : 0;

  // hop physics
  if (launched || P.hopY > 0) {
    P.hopV -= GRAVITY * dt; P.hopY += P.hopV * dt;
    if (P.hopY <= 0) { P.hopY = 0; if (P.hopV < 0) { P.hopV = 0; } }
    else sqT = -0.05 * clamp(Math.abs(P.hopV) / 8, 0, 1);
  }
  P.sqTarget = sqT;
  const k = 230, c = 15;
  P.sqV += (-k * (P.sq - P.sqTarget) - c * P.sqV) * dt;
  P.sq += P.sqV * dt;

  // walk / dance bob
  const bob = walking ? Math.abs(Math.sin(P.phase)) * 0.07 : mode === 'dance' ? Math.abs(Math.sin(P.phase)) * 0.16 : 0;
  P.bounce = damp(P.bounce, bob, 25, dt);

  // blinking
  blinkT -= dt;
  if (!blinking && blinkT <= 0) { blinking = true; blinkP = 0; }
  if (blinking) {
    blinkP += dt / 0.2;
    if (blinkP >= 1) { blinking = false; blinkT = Math.random() < 0.2 ? 0.15 : rand(2.2, 5.5); }
  }
  const blinkC = blinking ? Math.pow(Math.sin(Math.PI * blinkP), 0.8) : 0;
  const idleFor = nowS() - lastActivity;
  const droop = mode === 'idle' || mode === 'sit' ? clamp((idleFor - 45) / 40, 0, 0.35) : 0;
  const lidTarget = Math.max(P.asleep, droop, mode === 'wake' && modeT < 0.6 ? 0.8 : 0);
  P.lid = damp(P.lid, lidTarget, mode === 'wake' ? 6 : 4, dt);

  /* ---- apply ---- */
  const sleepBreath = Math.sin(t * 1.3) * 0.018 * P.asleep;
  const breathe = Math.sin(t * 2.1) * 0.012 * (1 - P.asleep) + sleepBreath;
  talkLeft -= dt;
  const talk = talkLeft > 0 ? Math.sin(t * 26) * 0.022 : 0;   // Anni "talks" with little body bobs
  const FLIP_C = 1.1;                                           // flip pivots around the body centre
  root.position.set(0, P.hopY + P.bounce + FLIP_C * (1 - Math.cos(flipAngle)), -FLIP_C * Math.sin(flipAngle));
  root.rotation.set(flipAngle, P.bodyYaw + spinAngle, P.tilt, 'YXZ');
  root.scale.set(1 + P.sq * 0.6, 1 - P.sq, 1 + P.sq * 0.6);

  head.position.y = lerp(STAND_HEAD_Y, SIT_HEAD_Y, P.sit);
  head.scale.set(1 - breathe * 0.5 - talk * 0.5, 1 + breathe + talk, 1 - breathe * 0.5 - talk * 0.5);
  head.rotation.set(P.lookPitch, P.lookYaw, 0, 'YXZ');

  const hipY = lerp(STAND_HIP_Y, SIT_HIP_Y, P.sit);
  const swingA = walking ? 0.62 : mode === 'dance' ? 0.55 : 0;
  P.swing = damp(P.swing, swingA, 14, dt);
  for (const l of legs) {
    const ph = l.side > 0 ? P.phase : P.phase + Math.PI;
    const dang = Math.sin(t * 7 + (l.side > 0 ? 0 : 1.6)) * 0.28 + clamp(dragVx * 0.0005, -0.4, 0.4);
    const kick = mode === 'pet' ? Math.max(0, Math.sin(t * 9 + (l.side > 0 ? 0 : Math.PI))) * 0.25 * (1 - P.sit) : 0;
    const rotX = lerp(Math.sin(ph) * P.swing - kick, -1.38, P.sit) * (1 - P.dangle) + dang * P.dangle;
    l.hip.position.set(l.side * HIP_X, hipY, 0.06 + P.sit * 0.1);
    l.hip.rotation.set(rotX, 0, l.side * (0.04 + 0.18 * P.dangle + 0.1 * P.sit), 'YXZ');
  }

  // eyes: shared lid (sleep/droop/blink) plus per-expression upper/lower lids
  const ease = (v) => v * v * (3 - 2 * v);
  const reach = 0.19 + 0.04;
  const upL = ease(clamp(Math.max(P.lid, X.up, blinkC), 0, 1));
  const loL = ease(clamp(Math.max(P.lid, X.lo, blinkC), 0, 1));
  for (const e of eyes) {
    const spinX = Math.cos(t * 9 * e.side) * 0.11, spinY = Math.sin(t * 9 * e.side) * 0.07;
    e.pupil.rotation.set(lerp(P.pupY, spinY, dz), lerp(P.pupX, spinX, dz), 0, 'YXZ');
    e.pupil.scale.set(X.pupil, X.pupil, 1);
    e.eye.scale.set(X.eye, X.eye * X.squint, 1);
    e.upper.visible = upL > 0.02;
    e.lower.visible = loL > 0.02;
    e.upper.rotation.x = -(lerp(reach, -0.004, upL) / 0.88);
    e.lower.rotation.x = -(lerp(-reach, 0.004, loL) / 0.88);
  }

  // contact shadow
  const sh = 1 / (1 + P.hopY * 0.45);
  anni.shadow.scale.set(2.5 * sh * (1 + P.sq * 0.5 + P.sit * 0.25), 1.55 * sh, 1);
  anni.shadow.material.opacity = 0.9 * sh;
}

/* ------------------------------------------------ main loop */
let last = performance.now(), lastDraw = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt; modeT += dt;
  if (mode === 'sleep' && P.asleep > 0.98 && now - lastDraw < 45) return;   // idle cheaply while asleep
  lastDraw = now;
  updateBehaviour(dt);
  updatePose(dt);
  renderer.render(scene, camera);
}

/* ------------------------------------------------ input */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function hitTest(x, y) {
  if (x < 0 || y < 0 || x > winW || y > winH) return false;
  ndc.set(x / winW * 2 - 1, -(y / winH) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObjects(anni.pickables, false).length > 0;
}
function setHover(h) {
  hover = h;
  const wantIgnore = !h && !drag;
  if (platform !== 'linux' && ignoring !== wantIgnore) { ignoring = wantIgnore; api.setIgnore(wantIgnore); }
}

let drag = null, dragVx = 0, dragVy = 0, lastClick = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !hitTest(e.clientX, e.clientY)) return;
  if (mode === 'fight') { say(pick(["I'm busy fighting!", 'Cheer for me!', 'Click the twin, not me!']), 1200); return; }
  drag = { sx: e.screenX, sy: e.screenY, wx: winX, wy: winY, moved: false, px: winX, py: winY, pt: performance.now() };
  canvas.setPointerCapture(e.pointerId);
  active(); napLock = 0; wake();
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.screenX - drag.sx, dy = e.screenY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) > 5) {
    drag.moved = true; setMode('drag'); P.hopY = 0; P.hopV = 0; spinT = -1; spinAngle = 0; flipT = -1; flipAngle = 0;
    shake = { lastSign: 0, flips: [] }; dizzyPending = false; dragTalked = false;
    squeak(1.35); emote('surprised', 0.8);
    say(pick(['Wheee!', 'Up we go!', 'Whoa, high!', 'Hey!']), 1200);
  }
  if (drag.moved) {
    winX = drag.wx + dx; winY = drag.wy + dy; pushPos();
    const nowT = performance.now(), dtm = Math.max(1, nowT - drag.pt);
    dragVx = lerp(dragVx, (winX - drag.px) / dtm * 1000, 0.35);
    dragVy = lerp(dragVy, (winY - drag.py) / dtm * 1000, 0.35);
    drag.px = winX; drag.py = winY; drag.pt = nowT;
    // shaking side to side makes Anni dizzy
    const sign = Math.sign(dragVx);
    if (Math.abs(dragVx) > 700 && sign !== shake.lastSign) { if (shake.lastSign) shake.flips.push(nowT); shake.lastSign = sign; }
    shake.flips = shake.flips.filter((f) => nowT - f < 1600);
    if (shake.flips.length >= 4 && !dizzyPending) {
      dizzyPending = true; emote('dizzy', 4);
      say(pick(['Aaaah!', 'Stop shaking meee!', 'Whoaaa!']), 1300);
    }
    active();
  }
});
const endDrag = (e) => {
  if (!drag) return;
  const d = drag, tvx = dragVx, tvy = dragVy;
  drag = null; dragVx = 0; dragVy = 0;
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  if (d.moved) {
    const sc = scale();
    vx = clamp(tvx, -2600 * sc, 2600 * sc) * 0.9; vy = clamp(tvy, -1800 * sc, 1200 * sc) * 0.8; bounced = false;
    if (Math.abs(vx) > 900 * sc && !dizzyPending) say('Wheeeee!', 1200);
    setMode('fall');
  } else onClick();
  setHover(hitTest(cursor.x, cursor.y));
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (hitTest(e.clientX, e.clientY)) api.contextMenu(); });

function onClick() {
  const n = performance.now();
  active();
  clicks.push(n); clicks = clicks.filter((c) => n - c < 4000);
  if (mode === 'grumpy') { say(pick(['Hmph.', '...', 'Not talking to you.']), 1000); return; }
  if (clicks.length >= 5) { clicks = []; startGrumpy(); return; }
  if (n - lastClick < 380) { startSpin(); say('Wheee!', 1200); lastClick = 0; return; }
  lastClick = n;
  if (mode === 'sleep') { wake(); return; }
  squeak();
  if (canReact() || mode === 'pet') startHop(1);
  emote('happy', 1.2);
  say(pick(HI), 1800);
}

api.onTick((d) => {
  const tNow = nowS();
  let md = Math.hypot(d.sx - cursor.sx, d.sy - cursor.sy);
  if (!cursor.init) { cursor.init = true; md = 0; }
  const dtt = Math.max(0.016, tNow - (cursor.lastT || tNow));
  cursor.lastT = tNow;
  cursor.speed = lerp(cursor.speed, md / dtt, 0.5);
  cursor.moved += md;
  cursor.still = md > 1.5 ? 0 : cursor.still + dtt;
  cursor.px = cursor.init && md ? cursor.x : d.cx; cursor.py = cursor.init && md ? cursor.y : d.cy;
  cursor.sx = d.sx; cursor.sy = d.sy; cursor.x = d.cx; cursor.y = d.cy; work = d.work || work;
  if (Math.hypot(d.sx - cursor.lastX, d.sy - cursor.lastY) > 6) { cursor.lastX = d.sx; cursor.lastY = d.sy; active(); }
  if (!drag) setHover(hitTest(d.cx, d.cy));
});
api.onBounds((b) => { winX = b.x; winY = b.y; sentX = b.x; sentY = b.y; resize(); });
api.onSettings((s) => {
  settings = { ...settings, ...s };
  if (!settings.walk && (mode === 'walk' || mode === 'chase')) setMode('idle');
  if (s.follow === true) say(pick(["I'll follow you!", 'Lead the way!']), 1500);
});
api.onAction((a) => {
  if (a === 'twin') { active(); if (mode === 'sleep') setMode('idle'); startFight(); return; }
  if (a === 'endfight') { endFight(false); return; }
  if (F.on) { say("Not now, I'm in a fight!", 1300); return; }
  if (a !== 'sleep') { active(); if (mode === 'sleep') wake(); }
  switch (a) {
    case 'hi': squeak(); startHop(1); emote('happy', 1.5); say(pick(HI), 2000); break;
    case 'hop': startHop(2); break;
    case 'spin': startSpin(); break;
    case 'dance': startDance(); break;
    case 'sing': startSing(); break;
    case 'flip': startFlip(); break;
    case 'talk': chatter(); break;
    case 'come': startChase(true); say(pick(['Coming!', 'On my way!']), 1300); break;
    case 'sit': startSit(); sitLeft = 40; break;
    case 'stand': if (mode === 'sit' || mode === 'sleep') toIdle(); break;
    case 'sleep': goSleep(); napLock = nowS() + 6; say('Nap time... zzz', 1800); break;
    case 'walk': startWalk(); break;
  }
});

/* ------------------------------------------------ boot */
(async function boot() {
  const init = await api.init();
  settings = { ...settings, ...init.settings }; platform = init.platform;
  winX = init.bounds.x; winY = init.bounds.y; sentX = winX; sentY = winY;
  resize();
  if (platform !== 'linux') { ignoring = true; api.setIgnore(true); }
  // arrive with a little drop-in from above
  winY = groundY() - 260 * scale(); vy = 0; vx = 0; bounced = false; pushPos();
  setMode('fall');
  setTimeout(() => { say(greeting(), 2600); emote('happy', 2); }, 700);
  requestAnimationFrame(frame);
})();

// handles for testing/debugging in a browser
window.__anni = {
  P, X, setMode, startHop, startSpin, startDance, startSit, startWalk, startSing, startFlip, startSneeze, startYawn,
  startGrumpy, startDizzy, startPet, startLookAround, chatter, say, puff, emote, startFight, endFight, F,
  get mode() { return mode; }, get win() { return [winX, winY]; }, cursor,
};
