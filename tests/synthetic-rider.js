// Generates MediaPipe-shaped landmark frames for a rider with known geometry, so the analysis can be
// checked against ground truth without a video.

const RAD = Math.PI / 180;

// Small deterministic PRNG so tests are repeatable.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * opts: { heightCm, crankMm, kneeExt (target max knee angle, °), torsoDeg, facing (1 right, -1 left),
 *         rpm, seconds, fps, noisePx, swapEvery (inject a near/far leg swap every N frames) }
 */
export function syntheticRider(opts = {}) {
  const o = { heightCm: 178, crankMm: 172.5, kneeExt: 145, torsoDeg: 30, facing: 1, rpm: 85, seconds: 15, fps: 30,
    noisePx: 1, swapEvery: 0, seed: 1, ...opts };
  const W = 1280, H = 720, pxmm = 0.5;
  const rand = rng(o.seed);
  const thigh = 0.245 * o.heightCm * 10, shank = 0.246 * o.heightCm * 10;
  const ankleOff = { x: -110, y: -60 }; // ankle relative to the pedal spindle (mm, x forward, y up)
  const hipX = -180;

  // Hip height such that the longest hip-to-ankle distance gives the requested knee extension.
  const want = Math.sqrt(thigh ** 2 + shank ** 2 - 2 * thigh * shank * Math.cos(o.kneeExt * RAD));
  const maxReach = (hy) => {
    let m = 0;
    for (let a = 0; a < 360; a++) {
      const ax = -o.crankMm * Math.sin(a * RAD) + ankleOff.x, ay = -o.crankMm * Math.cos(a * RAD) + ankleOff.y;
      m = Math.max(m, Math.hypot(ax - hipX, ay - hy));
    }
    return m;
  };
  let lo = 300, hi = 1200; // maxReach grows with hip height: bisect
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; maxReach(mid) < want ? (lo = mid) : (hi = mid); }
  const hipY = (lo + hi) / 2;

  const torso = 0.288 * o.heightCm * 10, upper = 0.186 * o.heightCm * 10, fore = 0.146 * o.heightCm * 10;
  const bb = { x: 640, y: 560 };
  const toNorm = (p) => ({
    x: (bb.x + p.x * pxmm * o.facing + (rand() - 0.5) * 2 * o.noisePx) / W,
    y: (bb.y - p.y * pxmm + (rand() - 0.5) * 2 * o.noisePx) / H,
    z: 0, visibility: 0.99,
  });

  const leg = (r) => {
    // Forward pedalling: from the bottom the foot sweeps backwards.
    const ball = { x: -o.crankMm * Math.sin(r), y: -o.crankMm * Math.cos(r) };
    const ankle = { x: ball.x + ankleOff.x, y: ball.y + ankleOff.y };
    const hip = { x: hipX, y: hipY };
    const d = Math.hypot(ankle.x - hip.x, ankle.y - hip.y);
    const a = (thigh ** 2 - shank ** 2 + d ** 2) / (2 * d);
    const h = Math.sqrt(Math.max(0, thigh ** 2 - a ** 2));
    const ux = (ankle.x - hip.x) / d, uy = (ankle.y - hip.y) / d;
    const mx = hip.x + a * ux, my = hip.y + a * uy;
    let knee = { x: mx - h * uy, y: my + h * ux };
    if (knee.x < mx) knee = { x: mx + h * uy, y: my - h * ux }; // knee bends forward
    const heel = { x: ankle.x - 40, y: ankle.y - 30 };
    const toe = { x: heel.x + (ball.x - heel.x) / 0.7, y: heel.y + (ball.y - heel.y) / 0.7 };
    return { hip, knee, ankle, heel, toe, ball };
  };

  const frames = [];
  for (let k = 0; k < o.seconds * o.fps; k++) {
    const t = k / o.fps;
    const r = (t * o.rpm / 60) * 2 * Math.PI;
    const near = leg(r), far = leg(r + Math.PI);
    const sh = { x: near.hip.x + torso * Math.cos(o.torsoDeg * RAD), y: near.hip.y + torso * Math.sin(o.torsoDeg * RAD) };
    const elbow = { x: sh.x + upper * Math.cos(-75 * RAD), y: sh.y + upper * Math.sin(-75 * RAD) };
    const wrist = { x: elbow.x + fore * Math.cos(-15 * RAD), y: elbow.y + fore * Math.sin(-15 * RAD) };
    const ear = { x: sh.x + 120, y: sh.y + 150 };
    const swapped = o.swapEvery && k % o.swapEvery === 0;
    const [n, f] = swapped ? [far, near] : [near, far];
    // Near side = left (index 7, 11, …); far side = right, slightly less visible.
    const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
    const set = (i, p, vis = 0.99) => { lm[i] = { ...toNorm(p), visibility: vis }; };
    set(7, ear); set(11, sh); set(13, elbow); set(15, wrist);
    set(23, n.hip); set(25, n.knee); set(27, n.ankle); set(29, n.heel); set(31, n.toe);
    set(8, ear, 0.5); set(12, sh, 0.5); set(14, elbow, 0.5); set(16, wrist, 0.5);
    set(24, f.hip, 0.6); set(26, f.knee, 0.6); set(28, f.ankle, 0.6); set(30, f.heel, 0.6); set(32, f.toe, 0.6);
    frames.push({ t, lm });
  }
  return { frames, width: W, height: H, pxPerMm: pxmm, rider: { heightCm: o.heightCm, crankMm: o.crankMm }, opts: o };
}
