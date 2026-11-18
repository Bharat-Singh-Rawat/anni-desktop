// Anni's body, built entirely from code: a red corduroy plush with felt eyes,
// corduroy eyelids and two stubby legs. No external model files needed.
import * as THREE from './vendor/three.module.js';

export const R = { a: 1.0, b: 0.8, c: 0.92 };   // body ellipsoid radii
export const STAND_HEAD_Y = 1.30;                // body centre height when standing
export const STAND_HIP_Y = 0.7;                  // leg joint height when standing
export const SIT_HEAD_Y = 0.85;
export const SIT_HIP_Y = 0.24;
export const HIP_X = 0.38;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------- textures */

// Corduroy: 8 raised ridges ("wales") per tile, with narrow grooves between,
// a colour map (grooves darker), and a matching normal map for real relief.
function cordTextures(maxAniso) {
  const W = 256, H = 256, RIDGES = 8, rnd = mulberry32(11);
  const h = new Float32Array(W * H);
  const ridgeVar = Array.from({ length: RIDGES }, () => 1 + (rnd() - 0.5) * 0.10);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const f = (x / W * RIDGES) % 1, d = Math.abs(f - 0.5) * 2;
    let v = 1 - Math.pow(d, 3.6);
    v *= 1 - 0.85 * smooth(0.84, 1, d);
    h[y * W + x] = v + (rnd() - 0.5) * 0.12;
  }
  const col = document.createElement('canvas'); col.width = W; col.height = H;
  const nor = document.createElement('canvas'); nor.width = W; nor.height = H;
  const cctx = col.getContext('2d'), nctx = nor.getContext('2d');
  const cd = cctx.createImageData(W, H), nd = nctx.createImageData(W, H);
  const S = 5.0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, p = i * 4;
    const k = Math.floor(x / W * RIDGES);
    const v = clamp(h[i], 0, 1);
    const m = (0.56 + 0.44 * Math.pow(v, 0.8)) * ridgeVar[k] * (0.94 + 0.12 * rnd());
    cd.data[p] = clamp(198 * m, 0, 255); cd.data[p + 1] = clamp(38 * m, 0, 255); cd.data[p + 2] = clamp(27 * m, 0, 255); cd.data[p + 3] = 255;
    const hx = (h[y * W + (x + 1) % W] - h[y * W + (x - 1 + W) % W]) * 0.5;
    const hy = (h[((y + 1) % H) * W + x] - h[((y - 1 + H) % H) * W + x]) * 0.5;
    let nx = -hx * S, ny = hy * S, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    nd.data[p] = (nx * 0.5 + 0.5) * 255; nd.data[p + 1] = (ny * 0.5 + 0.5) * 255; nd.data[p + 2] = (nz * 0.5 + 0.5) * 255; nd.data[p + 3] = 255;
  }
  cctx.putImageData(cd, 0, 0); nctx.putImageData(nd, 0, 0);
  const map = new THREE.CanvasTexture(col); map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(nor);
  for (const t of [map, normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; }
  return { map, normalMap };
}

function cordMaterial(tex, repX, repY = 1) {
  const map = tex.map.clone(), normalMap = tex.normalMap.clone();
  for (const t of [map, normalMap]) { t.repeat.set(repX, repY); t.needsUpdate = true; }
  return new THREE.MeshPhysicalMaterial({
    map, normalMap, normalScale: new THREE.Vector2(0.75, 0.75),
    roughness: 0.93, metalness: 0,
    sheen: 1.0, sheenColor: new THREE.Color(0xe0553a), sheenRoughness: 0.6,
  });
}

function feltTexture(hex, amount = 0.07) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = hex; g.fillRect(0, 0, 128, 128);
  const d = g.getImageData(0, 0, 128, 128), rnd = mulberry32(5);
  for (let i = 0; i < d.data.length; i += 4) {
    const n = 1 + (rnd() - 0.5) * 2 * amount;
    d.data[i] *= n; d.data[i + 1] *= n; d.data[i + 2] *= n;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
  return t;
}

function maskTexture(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#fff'; draw(g);
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return t;
}
const chamferRect = (cut, round) => (g) => {
  const m = 3, s = 256 - m, k = cut, r = round;
  g.beginPath();
  g.moveTo(m + k, m); g.lineTo(s - k, m); g.quadraticCurveTo(s - k + r, m + 0, s, m + k);
  g.lineTo(s, s - k); g.quadraticCurveTo(s, s - k + r, s - k, s);
  g.lineTo(m + k, s); g.quadraticCurveTo(m + k - r, s, m, s - k);
  g.lineTo(m, m + k); g.quadraticCurveTo(m, m + k - r, m + k, m);
  g.closePath(); g.fill();
};
const roundRect = (rad) => (g) => {
  const m = 2, s = 256 - m;
  g.beginPath();
  g.moveTo(m + rad, m); g.arcTo(s, m, s, s, rad); g.arcTo(s, s, m, s, rad); g.arcTo(m, s, m, m, rad); g.arcTo(m, m, s, m, rad);
  g.closePath(); g.fill();
};

/* ---------------------------------------------------------------- geometry */

// A flat patch (felt eye, eyelid ...) bent onto Anni's ellipsoid surface, centred on
// the front (+Z). Rotating the parent about the body centre slides it over the body.
function bentPlane(w, h, off, { vMin = -h / 2, vMax = h / 2, sx = 22, sy = 16 } = {}) {
  const pos = [], nor = [], uv = [], idx = [];
  for (let j = 0; j <= sy; j++) {
    const tv = j / sy, v = lerp(vMin, vMax, tv);
    for (let i = 0; i <= sx; i++) {
      const tu = i / sx, u = (tu - 0.5) * w;
      const th = u / 0.98, ph = v / 0.88;
      const dx = Math.sin(th) * Math.cos(ph), dy = Math.sin(ph), dz = Math.cos(th) * Math.cos(ph);
      let nx = dx / R.a, ny = dy / R.b, nz = dz / R.c; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      pos.push(dx * R.a + nx * off, dy * R.b + ny * off, dz * R.c + nz * off);
      nor.push(nx, ny, nz); uv.push(tu, tv);
    }
  }
  for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
    const a = j * (sx + 1) + i, b = a + 1, c = a + sx + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// A thin stack of bent patches gives felt/fabric edges some visible thickness.
function patchStack(group, { w, h, base, layers, step, faceMat, edgeMat, vMin, vMax }) {
  const meshes = [];
  for (let k = 0; k < layers; k++) {
    const m = new THREE.Mesh(
      bentPlane(w, h, base + k * step, { vMin, vMax }),
      k === layers - 1 ? faceMat : edgeMat);
    group.add(m); meshes.push(m);
  }
  return meshes;
}

function makeLeg(mat) {
  const pts = [[0.001, 0.03], [0.15, 0.02], [0.235, -0.04], [0.245, -0.2], [0.228, -0.38], [0.225, -0.52],
    [0.24, -0.63], [0.24, -0.72], [0.19, -0.775], [0.1, -0.795], [0.001, -0.8]].map(p => new THREE.Vector2(p[0], p[1]));
  const geo = new THREE.LatheGeometry(new THREE.SplineCurve(pts).getPoints(56), 40);
  const hip = new THREE.Group();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.y = 0.875;   // leg length 0.7
  hip.add(mesh);
  return { hip, mesh };
}

/* ------------------------------------------------------------------- Anni */

export function buildAnni(renderer) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const cord = cordTextures(aniso);
  const bodyMat = cordMaterial(cord, 5, 1);
  const legMat = cordMaterial(cord, 1, 1);
  const lidMat = cordMaterial(cord, 0.5, 0.5);

  const feltWhite = new THREE.MeshStandardMaterial({
    map: feltTexture('#f4f0e6'), alphaMap: maskTexture(chamferRect(30, 12)), alphaTest: 0.5, alphaToCoverage: true, roughness: 1,
  });
  const feltWhiteEdge = new THREE.MeshStandardMaterial({
    map: feltTexture('#c9c3b4'), alphaMap: feltWhite.alphaMap, alphaTest: 0.5, alphaToCoverage: true, roughness: 1,
  });
  const feltBlack = new THREE.MeshStandardMaterial({
    map: feltTexture('#151515', 0.25), alphaMap: maskTexture(roundRect(22)), alphaTest: 0.5, alphaToCoverage: true, roughness: 1,
  });
  const lidMask = maskTexture(roundRect(26));
  lidMat.alphaMap = lidMask; lidMat.alphaTest = 0.5; lidMat.alphaToCoverage = true;
  const lidEdge = new THREE.MeshStandardMaterial({
    color: 0x8c1d0e, alphaMap: lidMask, alphaTest: 0.5, alphaToCoverage: true, roughness: 1,
  });

  const root = new THREE.Group();           // origin on the ground
  const head = new THREE.Group();           // body centre + face
  head.position.y = STAND_HEAD_Y;
  root.add(head);

  // body
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 72), bodyMat);
  body.scale.set(R.a, R.b, R.c);
  head.add(body);

  // eyes
  const EYE_W = 0.5, EYE_H = 0.385, PUP = 0.215;
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.rotation.set(-0.04, side * 0.36, 0, 'YXZ');
    head.add(eye);

    patchStack(eye, { w: EYE_W, h: EYE_H, base: 0.010, layers: 4, step: 0.0042, faceMat: feltWhite, edgeMat: feltWhiteEdge });

    const pupil = new THREE.Group(); eye.add(pupil);
    patchStack(pupil, { w: PUP, h: PUP, base: 0.030, layers: 2, step: 0.004, faceMat: feltBlack, edgeMat: feltBlack });

    const lidH = 0.25;
    const upper = new THREE.Group(); eye.add(upper);
    const lower = new THREE.Group(); eye.add(lower);
    const upperMeshes = patchStack(upper, { w: 0.62, h: lidH, vMin: 0, vMax: lidH, base: 0.040, layers: 3, step: 0.0045, faceMat: lidMat, edgeMat: lidEdge });
    const lowerMeshes = patchStack(lower, { w: 0.62, h: lidH, vMin: -lidH, vMax: 0, base: 0.040, layers: 3, step: 0.0045, faceMat: lidMat, edgeMat: lidEdge });
    upper.visible = lower.visible = false;
    eyes.push({ side, eye, pupil, upper, lower, lidMeshes: [...upperMeshes, ...lowerMeshes] });
  }

  // legs
  const legs = [];
  for (const side of [-1, 1]) {
    const { hip, mesh } = makeLeg(legMat);
    hip.position.set(side * HIP_X, STAND_HIP_Y, 0.06);
    root.add(hip);
    legs.push({ side, hip, mesh });
  }

  // soft contact shadow on the "desktop"
  const sc = document.createElement('canvas'); sc.width = sc.height = 128;
  const sg = sc.getContext('2d'); const grad = sg.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.25)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = grad; sg.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.004;

  return { root, head, body, legs, eyes, shadow, pickables: [body, ...legs.map(l => l.mesh)] };
}
