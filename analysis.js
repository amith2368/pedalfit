// Turns per-frame pose landmarks from a side-view pedalling video into fit metrics.
// All angles are 2D, in the image plane, as a fitter would measure them from a side-on video.

export const LM = {
  left: { ear: 7, shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
  right: { ear: 8, shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
};
const JOINTS = ['ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'toe'];
const LEG = ['hip', 'knee', 'ankle'];
const SWAP = ['knee', 'ankle', 'heel', 'toe'];

// Winter's anthropometric segment lengths as fractions of standing height.
const THIGH_RATIO = 0.245;
const SHANK_RATIO = 0.246;
// Ball of the foot (over the pedal spindle) sits ~70% of the way from heel to toe tip.
const BALL_FRACTION = 0.7;

const deg = (r) => (r * 180) / Math.PI;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Interior angle at b, in degrees.
export function angle(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
  return deg(Math.acos(Math.max(-1, Math.min(1, cos))));
}

export const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (xs, p) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
};
const std = (xs) => {
  const v = xs.filter(Number.isFinite);
  if (v.length < 2) return 0;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};

// Least-squares (Kasa) circle fit: the ball of the foot traces the crank circle.
function fitCircle(pts) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length;
  for (const { x, y } of pts) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] [a b c]^T = [sxz syz sz]^T, circle: x²+y² = a x + b y + c
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const B = [sxz, syz, sz];
  const det3 = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(A);
  if (Math.abs(D) < 1e-9) return null;
  const sol = [0, 1, 2].map((k) => det3(A.map((row, i) => row.map((v, j) => (j === k ? B[i] : v)))) / D);
  const cx = sol[0] / 2, cy = sol[1] / 2;
  return { cx, cy, r: Math.sqrt(sol[2] + cx * cx + cy * cy) };
}

function pickSide(frames) {
  const score = { left: 0, right: 0 };
  for (const f of frames) {
    if (!f.lm) continue;
    for (const side of ['left', 'right'])
      for (const j of LEG.concat('shoulder')) score[side] += f.lm[LM[side][j]].visibility ?? 0;
  }
  return score.left >= score.right ? 'left' : 'right';
}

/**
 * frames: [{ t, lm: [33 × {x,y,z,visibility}] | null }] in normalized image coords.
 * rider: { heightCm, crankMm }
 */
export function analyze(frames, width, height, rider) {
  const side = pickSide(frames);
  const ids = LM[side];

  // Pixel-space joints for the camera-side limbs; drop frames where the leg isn't tracked.
  const other = LM[side === 'left' ? 'right' : 'left'];
  const px = (f, set) => Object.fromEntries(JOINTS.map((j) => [j, { x: f.lm[set[j]].x * width, y: f.lm[set[j]].y * height }]));
  const raw = [];
  for (const f of frames) {
    if (!f.lm || Math.min(...LEG.map((j) => f.lm[ids[j]].visibility ?? 1)) < 0.4) { raw.push(null); continue; }
    const p = px(f, ids);
    // Side-on, the model sometimes swaps near and far legs. Keep whichever lower leg continues the
    // near leg's motion (constant-velocity prediction from the last two frames).
    const [a, b] = [raw[raw.length - 1], raw[raw.length - 2]];
    if (a && b) {
      const q = px(f, other);
      const err = (c) => ['knee', 'ankle'].reduce((e, j) => e + dist(c[j], { x: 2 * a[j].x - b[j].x, y: 2 * a[j].y - b[j].y }), 0);
      if (err(q) < 0.6 * err(p)) for (const j of SWAP) p[j] = q[j];
    }
    raw.push(p);
  }

  // Reject frames whose thigh or shank length is far from typical: those are mistracked.
  const typical = (a, b) => median(raw.filter(Boolean).map((p) => dist(p[a], p[b])));
  const [thighMed, shankMed] = [typical('hip', 'knee'), typical('knee', 'ankle')];
  raw.forEach((p, i) => {
    if (p && (Math.abs(dist(p.hip, p.knee) / thighMed - 1) > 0.2 || Math.abs(dist(p.knee, p.ankle) / shankMed - 1) > 0.2)) raw[i] = null;
  });

  const validFrac = raw.filter(Boolean).length / Math.max(1, frames.length);
  if (raw.filter(Boolean).length < 30) {
    throw new Error('Could not track your leg in enough frames. Film side-on, full body in view, with good light.');
  }

  // No positional smoothing: MediaPipe's VIDEO mode already filters over time, and averaging neighbouring
  // frames at 30 fps would shrink the pedal circle and under-read knee extension by several degrees.
  const P = raw;
  P.forEach((p) => {
    if (!p) return;
    p.ball = { x: p.heel.x + BALL_FRACTION * (p.toe.x - p.heel.x), y: p.heel.y + BALL_FRACTION * (p.toe.y - p.heel.y) };
  });
  const valid = P.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);

  // Rider faces +x (right) when hands are ahead of hips on screen.
  const dir = Math.sign(median(valid.map((i) => P[i].wrist.x - P[i].hip.x))) || 1;

  // Scale (px per mm): body proportions from rider height, cross-checked with crank length.
  const thighPx = percentile(valid.map((i) => dist(P[i].hip, P[i].knee)), 0.9);
  const shankPx = percentile(valid.map((i) => dist(P[i].knee, P[i].ankle)), 0.9);
  // The ankle is tracked far more reliably than heel/toe and circles the spindle at crank radius, so it
  // drives the pedal phase and the crank-length scale.
  const circle = fitCircle(valid.map((i) => P[i].ankle));
  if (!circle) throw new Error('Could not find the pedal circle. Make sure your feet stay in view the whole time.');
  const scaleBody = rider.heightCm ? (thighPx + shankPx) / ((THIGH_RATIO + SHANK_RATIO) * rider.heightCm * 10) : NaN;
  const scaleCrank = circle && rider.crankMm ? circle.r / rider.crankMm : NaN;
  const scale = Number.isFinite(scaleBody) ? scaleBody : scaleCrank;

  // Per-frame angles and crank clock position (0° = top, 90° = forward, 180° = bottom).
  const series = P.map((p, i) => {
    if (!p) return null;
    const dx = (p.ankle.x - circle.cx) * dir;
    const dy = p.ankle.y - circle.cy;
    return {
      i,
      t: frames[i].t,
      knee: angle(p.hip, p.knee, p.ankle),
      hip: angle(p.shoulder, p.hip, p.knee),
      torso: deg(Math.atan2(p.hip.y - p.shoulder.y, (p.shoulder.x - p.hip.x) * dir)),
      shoulder: angle(p.hip, p.shoulder, p.elbow),
      elbow: angle(p.shoulder, p.elbow, p.wrist),
      ankle: angle(p.knee, p.ankle, p.toe),
      clock: (deg(Math.atan2(dx, -dy)) + 360) % 360,
    };
  });

  const cycles = splitCycles(series.filter(Boolean));
  if (cycles.length < 2) {
    throw new Error('Found fewer than two full pedal strokes. Record at least 10–15 seconds of steady pedalling.');
  }

  // Extreme of a per-frame value with sub-frame (parabolic) interpolation, so the frame rate doesn't clip peaks.
  const peak = (cyc, key, sign) => {
    let k = 0;
    cyc.forEach((s, j) => { if (sign * s[key] > sign * cyc[k][key]) k = j; });
    if (k === 0 || k === cyc.length - 1) return cyc[k][key];
    const [a, b, c] = [cyc[k - 1][key], cyc[k][key], cyc[k + 1][key]];
    const den = a - 2 * b + c;
    return den === 0 ? b : b - ((a - c) ** 2) / (8 * den);
  };
  // Value of fn interpolated to an exact crank clock position.
  const at = (cyc, target, fn) => {
    for (let j = 1; j < cyc.length; j++) {
      const a = cyc[j - 1], b = cyc[j];
      const da = ((a.clock - target + 540) % 360) - 180, db = ((b.clock - target + 540) % 360) - 180;
      if (da * db <= 0 && Math.abs(db - da) < 90) { // bracketing pair, either pedalling direction
        const w = db === da ? 0 : -da / (db - da);
        return fn(a) * (1 - w) + fn(b) * w;
      }
    }
    return fn(near(cyc, target));
  };
  const near = (cyc, target) =>
    cyc.reduce((best, s) => {
      const d = Math.abs(((s.clock - target + 540) % 360) - 180);
      return !best || d < best.d ? { s, d } : best;
    }, null).s;

  const perCycle = cycles.map((cyc) => {
    const top = near(cyc, 0), front = near(cyc, 90), bottom = near(cyc, 180);
    const pts = cyc.map((s) => P[s.i]);
    const range = (j, axis) => Math.max(...pts.map((p) => p[j][axis])) - Math.min(...pts.map((p) => p[j][axis]));
    return {
      top, front, bottom,
      kneeExt: peak(cyc, 'knee', 1),
      kneeFlex: peak(cyc, 'knee', -1),
      hipClosed: peak(cyc, 'hip', -1),
      hipOpen: peak(cyc, 'hip', 1),
      torso: median(cyc.map((s) => s.torso)),
      shoulder: median(cyc.map((s) => s.shoulder)),
      elbow: median(cyc.map((s) => s.elbow)),
      ankleBottom: bottom.ankle,
      ankleRange: Math.max(...cyc.map((s) => s.ankle)) - Math.min(...cyc.map((s) => s.ankle)),
      // Knee ahead (+) / behind (−) the pedal spindle with the crank forward.
      kops: at(cyc, 90, (s) => (P[s.i].knee.x - P[s.i].ball.x) * dir) / scale,
      hipBounce: range('hip', 'y') / scale,
      hipShift: range('hip', 'x') / scale,
      shoulderMove: Math.hypot(range('shoulder', 'x'), range('shoulder', 'y')) / scale,
      duration: cyc.duration,
    };
  });

  const keys = ['kneeExt', 'kneeFlex', 'hipClosed', 'hipOpen', 'torso', 'shoulder', 'elbow', 'ankleBottom',
    'ankleRange', 'kops', 'hipBounce', 'hipShift', 'shoulderMove'];
  const metrics = {};
  for (const k of keys) metrics[k] = { value: median(perCycle.map((c) => c[k])), sd: std(perCycle.map((c) => c[k])) };

  const cadence = 60 / median(perCycle.map((c) => c.duration));
  const rep = perCycle.reduce((a, c) =>
    Math.abs(c.kneeExt - metrics.kneeExt.value) < Math.abs(a.kneeExt - metrics.kneeExt.value) ? c : a);

  // Segment lengths in mm, for the geometry used by the recommendations.
  const segPx = (a, b, p = 0.9) => percentile(valid.map((i) => dist(P[i][a], P[i][b])), p);
  const segments = {
    thigh: thighPx / scale,
    shank: shankPx / scale,
    torso: median(valid.map((i) => dist(P[i].hip, P[i].shoulder))) / scale,
    upperArm: segPx('shoulder', 'elbow') / scale,
    forearm: segPx('elbow', 'wrist') / scale,
  };

  const warnings = [];
  if (validFrac < 0.8) warnings.push(`Leg tracked in only ${Math.round(validFrac * 100)}% of frames — results may be noisy.`);
  if (cycles.length < 5) warnings.push(`Only ${cycles.length} full pedal strokes found; 8+ gives steadier numbers.`);
  if (Number.isFinite(scaleBody) && Number.isFinite(scaleCrank) && Math.abs(scaleBody / scaleCrank - 1) > 0.2) {
    warnings.push('Body-height and crank-length scales disagree by >20% — the camera may not be level and square to the bike, so mm values are rough.');
  }
  if (shankPx / thighPx < 0.8 || shankPx / thighPx > 1.25) {
    warnings.push('Your thigh and shin look very different in length on screen — the camera probably isn\'t side-on. Angles from an angled view are distorted; re-film square to the bike.');
  }
  if (metrics.kneeExt.sd > 4) warnings.push('Knee extension varies a lot between strokes — keep a steady cadence and resistance while filming.');

  return {
    side, dir, cadence, metrics, perCycle, rep, segments, series, points: P, circle, scale,
    scaleBody, scaleCrank, cycles: cycles.length, validFrac, warnings,
  };
}

// Split into full revolutions on each pass through 12 o'clock, tolerating noise and the crank direction.
function splitCycles(series) {
  // Unwrap clock angle; pick the rotation direction that dominates (forward pedalling = increasing clock).
  const un = [series[0].clock];
  for (let k = 1; k < series.length; k++) {
    let d = series[k].clock - series[k - 1].clock;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    un.push(un[k - 1] + d);
  }
  const sign = Math.sign(un[un.length - 1] - un[0]) || 1;
  const cycles = [];
  let start = null; // index where the current full revolution began (null until the first top pass)
  let prevRev = Math.floor((sign * un[0]) / 360);
  for (let k = 1; k < series.length; k++) {
    const rev = Math.floor((sign * un[k]) / 360);
    if (rev <= prevRev) continue; // only count new revolutions, so jitter at 12 o'clock can't split a stroke
    prevRev = rev;
    if (start !== null) {
      const cyc = series.slice(start, k);
      // Reject segments with tracking gaps or implausible cadence (< 30 or > 160 rpm).
      const dur = (cyc.duration = series[k].t - series[start].t);
      const maxGap = Math.max(...cyc.slice(1).map((s, j) => s.t - cyc[j].t));
      if (cyc.length >= 8 && dur > 0.37 && dur < 2 && maxGap < 0.2) cycles.push(cyc);
    }
    start = k;
  }
  return cycles;
}
