// Target fit windows and the geometry that turns angle gaps into millimetre adjustments.
// Windows follow common fitting practice (Holmes / Retül-style ranges), shifted by bike type,
// fit goal and the rider's mobility.

export const BIKE_TYPES = {
  road: 'Road', gravel: 'Gravel', mtb: 'Mountain', tri: 'Triathlon', tt: 'Time trial',
  hybrid: 'Hybrid / city', spin: 'Spin bike', smart: 'Smart bike',
};
export const GOALS = {
  comfort: 'Comfort — relaxed, long days',
  balanced: 'Balanced — endurance with some speed',
  performance: 'Performance — low, aggressive, fast',
};

const BASE = {
  //            knee extension          torso (° from horizontal)                  hip closed min   shoulder    elbow       KOPS mm
  road:   { knee: [[138, 146], [140, 148], [142, 150]], torso: [[45, 55], [38, 48], [30, 40]], hip: [50, 45, 40], shoulder: [75, 95], elbow: [145, 165], kops: [-15, 15] },
  gravel: { knee: [[138, 146], [140, 148], [141, 149]], torso: [[48, 58], [42, 52], [35, 45]], hip: [52, 47, 43], shoulder: [72, 92], elbow: [148, 168], kops: [-15, 15] },
  mtb:    { knee: [[136, 144], [138, 146], [140, 148]], torso: [[50, 60], [45, 55], [40, 50]], hip: [55, 50, 46], shoulder: [68, 90], elbow: [150, 170], kops: [-25, 10] },
  tri:    { knee: [[140, 148], [141, 149], [142, 150]], torso: [[18, 26], [13, 21], [8, 16]],  hip: [45, 42, 40], shoulder: [85, 100], elbow: [85, 110], kops: [0, 40] },
  tt:     { knee: [[140, 148], [141, 149], [142, 150]], torso: [[16, 24], [11, 19], [6, 14]],  hip: [44, 41, 38], shoulder: [85, 100], elbow: [85, 110], kops: [0, 40] },
  hybrid: { knee: [[136, 144], [137, 145], [139, 147]], torso: [[58, 72], [52, 64], [46, 58]], hip: [60, 55, 50], shoulder: [55, 80], elbow: [155, 175], kops: [-25, 10] },
  spin:   { knee: [[138, 146], [140, 148], [141, 149]], torso: [[50, 65], [44, 56], [38, 48]], hip: [55, 50, 45], shoulder: [65, 90], elbow: [150, 170], kops: [-15, 15] },
  smart:  { knee: [[138, 146], [140, 148], [142, 150]], torso: [[45, 55], [38, 48], [30, 40]], hip: [50, 45, 40], shoulder: [75, 95], elbow: [145, 165], kops: [-15, 15] },
};
const GOAL_INDEX = { comfort: 0, balanced: 1, performance: 2 };

export const METRICS = {
  kneeExt: { label: 'Knee extension', unit: '°', hint: 'Knee angle at the bottom of the stroke. Main driver of saddle height.' },
  hipClosed: { label: 'Hip angle (closed)', unit: '°', hint: 'Smallest torso-to-thigh angle, at the top of the stroke.' },
  torso: { label: 'Back angle', unit: '°', hint: 'Torso angle from horizontal. Set by handlebar reach and drop.' },
  shoulder: { label: 'Shoulder angle', unit: '°', hint: 'Torso-to-upper-arm angle. Shows how stretched or cramped you are.' },
  elbow: { label: 'Elbow angle', unit: '°', hint: 'A soft bend absorbs shock; locked or very bent elbows point to reach.' },
  kops: { label: 'Knee over pedal', unit: 'mm', hint: 'Knee ahead (+) or behind (−) the pedal spindle at 3 o\'clock. A starting point for saddle fore-aft.' },
};

// Mobility assessment → flexibility class.
export function mobilityClass(m) {
  let score = 0;
  if (Number.isFinite(m.slr)) score += m.slr < 65 ? -2 : m.slr < 80 ? 0 : 2;
  score += { palms: 1, fingers: 0, shins: -1, knees: -2 }[m.toeTouch] ?? 0;
  return score <= -2 ? 'tight' : score >= 2 ? 'flexible' : 'average';
}

export function targets({ bike, goal, mobility }) {
  const b = BASE[bike] ?? BASE.road;
  const g = GOAL_INDEX[goal] ?? 1;
  const flex = mobilityClass(mobility);
  const shift = { tight: { knee: -2, torso: 5, hip: 3 }, average: { knee: 0, torso: 0, hip: 0 }, flexible: { knee: 1, torso: -3, hip: -3 } }[flex];
  const backPain = mobility.backPain ? 3 : 0;
  const add = ([lo, hi], d) => [lo + d, hi + d];
  const hipLo = b.hip[g] + shift.hip + backPain;
  return {
    flex,
    kneeExt: add(b.knee[g], shift.knee),
    torso: add(b.torso[g], shift.torso + backPain),
    hipClosed: [hipLo, hipLo + 22],
    shoulder: b.shoulder,
    elbow: b.elbow,
    kops: b.kops,
  };
}

const rad = (d) => (d * Math.PI) / 180;
// Distance between the ends of two segments joined at an angle (law of cosines).
const span = (a, b, angDeg) => Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(rad(angDeg)));
const mmRound = (mm) => Math.round(mm);
// Compared at the whole-unit precision we display, so "37° vs 27–37°" never reads as out of range.
const status = (v, [lo, hi]) => (Math.round(v) < lo ? 'low' : Math.round(v) > hi ? 'high' : 'ok');
const aim = (v, [lo, hi]) => {
  // Aim a little inside the window rather than at its edge.
  const pad = Math.min(1.5, (hi - lo) / 4);
  return v < lo ? lo + pad : v > hi ? hi - pad : v;
};

/**
 * Returns { checks, recs } where checks rate each metric against its window and recs are concrete changes.
 */
export function recommend(result, tgt, mobility) {
  const m = Object.fromEntries(Object.entries(result.metrics).map(([k, v]) => [k, v.value]));
  const seg = result.segments;
  const checks = Object.keys(METRICS).map((k) => ({ key: k, ...METRICS[k], value: m[k], sd: result.metrics[k].sd, window: tgt[k], status: status(m[k], tgt[k]) }));
  const recs = [];

  // 1. Saddle height from knee extension: hip-to-ankle distance at full extension changes ~1:1 with saddle height.
  let saddleUp = 0;
  if (status(m.kneeExt, tgt.kneeExt) !== 'ok') {
    const want = aim(m.kneeExt, tgt.kneeExt);
    saddleUp = span(seg.thigh, seg.shank, want) - span(seg.thigh, seg.shank, m.kneeExt);
  }
  let fromHips = false;
  if (m.hipBounce > 18 && saddleUp === 0) {
    // Rocking hips can mean over-reaching even when the knee reads fine, but only nudge the saddle down when the
    // knee is in the upper half of its window; otherwise a drop would push it toward the bottom edge.
    fromHips = m.kneeExt > (tgt.kneeExt[0] + tgt.kneeExt[1]) / 2;
    if (fromHips) saddleUp = -4;
    recs.push({
      area: 'Saddle', priority: 2, title: 'Hips are rocking',
      detail: `Your hips move ${Math.round(m.hipBounce)} mm up and down each stroke (aim for under ~15 mm). ` + (fromHips
        ? 'With your knee near the top of its window, this suggests the saddle is slightly high.'
        : 'Your knee angle is in range, so leave the saddle height: check from behind for side-to-side rocking, and note that hip tracking from video tends to overstate this.'),
    });
  }
  if (Math.abs(saddleUp) >= 2) {
    const mm = mmRound(saddleUp);
    const step = Math.abs(mm) > 10 ? ' Make the change in steps of 5–10 mm and ride a few days in between.' : '';
    const why = fromHips
      ? 'It is in range, but in the upper half and with rocking hips, so a small drop is worth trying.'
      : mm > 0 ? 'A low saddle overloads the front of the knee and wastes power.' : 'A high saddle strains the back of the knee and makes the hips rock.';
    recs.push({
      area: 'Saddle', priority: 1, delta: { saddleHeight: mm },
      title: `${mm > 0 ? 'Raise' : 'Lower'} your saddle ~${Math.abs(mm)} mm`,
      detail: `Knee extension is ${m.kneeExt.toFixed(0)}° vs a target of ${tgt.kneeExt[0]}–${tgt.kneeExt[1]}°. ${why} Measure along the seat tube from the bottom-bracket centre to the top of the saddle.${step}`,
    });
  }

  // 2. Saddle fore-aft from knee-over-pedal.
  let setback = 0;
  if (status(m.kops, tgt.kops) !== 'ok') {
    const mm = setback = mmRound(m.kops - aim(m.kops, tgt.kops));
    recs.push({
      area: 'Saddle', priority: 3, delta: { saddleSetback: mm },
      title: `Move your saddle ${mm > 0 ? 'back' : 'forward'} ~${Math.abs(mm)} mm`,
      detail: `With the crank forward your knee is ${Math.abs(Math.round(m.kops))} mm ${m.kops > 0 ? 'ahead of' : 'behind'} the pedal spindle. Knee-over-pedal is a starting point, not a rule — if you are comfortable, leave it. Moving the saddle ${mm > 0 ? 'back raises' : 'forward lowers'} its effective height slightly, so recheck height afterwards. It also puts you ~${Math.abs(mm)} mm ${mm > 0 ? 'further from' : 'closer to'} the bars; the handlebar advice already allows for that.`,
    });
  }

  // 3. Cockpit: move the hands with the shoulders to bring the back angle (and closed hip angle) into the window.
  let dTorso = 0;
  if (status(m.torso, tgt.torso) !== 'ok') dTorso = aim(m.torso, tgt.torso) - m.torso;
  if (m.hipClosed < tgt.hipClosed[0]) dTorso = Math.max(dTorso, tgt.hipClosed[0] + 1 - m.hipClosed);
  let reach = 0, stack = 0;
  if (Math.abs(dTorso) >= 1) {
    const a0 = rad(m.torso), a1 = rad(m.torso + dTorso);
    reach += seg.torso * (Math.cos(a1) - Math.cos(a0));
    stack += seg.torso * (Math.sin(a1) - Math.sin(a0));
  }
  // Elbows: straighten or bend toward the window by changing reach (shoulder-to-hand distance).
  if (status(m.elbow, tgt.elbow) !== 'ok') {
    reach += span(seg.upperArm, seg.forearm, aim(m.elbow, tgt.elbow)) - span(seg.upperArm, seg.forearm, m.elbow);
  } else if (status(m.shoulder, tgt.shoulder) !== 'ok' && Math.abs(dTorso) < 1) {
    // Only when the back angle is fine: rotate the arm about the shoulder.
    const arm = seg.upperArm + seg.forearm;
    reach += arm * rad(aim(m.shoulder, tgt.shoulder) - m.shoulder) * 0.8;
  }
  // Moving the saddle back already adds that much reach; take it off, but don't let it flip a needed change
  // into the opposite one (the remaining overshoot stays within the elbow window).
  const needed = reach;
  reach -= setback;
  if (needed !== 0 && Math.sign(reach) !== Math.sign(needed)) reach = 0;
  reach = mmRound(reach); stack = mmRound(stack);
  if (Math.abs(reach) >= 5 || Math.abs(stack) >= 5) {
    const parts = [];
    if (Math.abs(stack) >= 5) parts.push(`${stack > 0 ? 'raise' : 'lower'} the bars ~${Math.abs(stack)} mm`);
    if (Math.abs(reach) >= 5) parts.push(`${reach > 0 ? 'lengthen' : 'shorten'} reach ~${Math.abs(reach)} mm`);
    const why = [];
    if (status(m.torso, tgt.torso) !== 'ok') why.push(`your back angle is ${m.torso.toFixed(0)}° (target ${tgt.torso[0]}–${tgt.torso[1]}°)`);
    if (m.hipClosed < tgt.hipClosed[0]) why.push(`your hip closes to ${m.hipClosed.toFixed(0)}° at the top of the stroke (target ≥ ${tgt.hipClosed[0]}°)`);
    if (status(m.elbow, tgt.elbow) !== 'ok') why.push(`your elbows are at ${m.elbow.toFixed(0)}° (target ${tgt.elbow[0]}–${tgt.elbow[1]}°)`);
    else if (status(m.shoulder, tgt.shoulder) !== 'ok') why.push(`your shoulder angle is ${m.shoulder.toFixed(0)}° (target ${tgt.shoulder[0]}–${tgt.shoulder[1]}°)`);
    if (setback && Math.abs(reach) >= 5) why.push(`moving the saddle ${setback > 0 ? 'back' : 'forward'} ~${Math.abs(setback)} mm changes your reach by the same amount`);
    const cap = parts.join(' and ');
    recs.push({
      area: 'Handlebars', priority: 2, delta: { barReach: reach, barStack: stack },
      title: cap[0].toUpperCase() + cap.slice(1),
      detail: `Because ${why.join(', and ')}. Use spacers or a different-rise stem for height and stem length for reach — the stem calculator below finds combinations.` +
        (Math.abs(stack) > 30 || Math.abs(reach) > 30 ? ' This is more than a stem and spacers usually allow: move part of the way, build flexibility, or look at a frame with more stack / less reach.' : ''),
    });
  }

  if (m.shoulderMove > 35) {
    recs.push({ area: 'Upper body', priority: 4, title: 'Steady your upper body', detail: `Your shoulders move ~${Math.round(m.shoulderMove)} mm each stroke. Excess upper-body movement often means a reach that is too long, a saddle that is too high, or pedalling in too big a gear.` });
  }
  if (m.kneeFlex < 68) {
    recs.push({ area: 'Cranks', priority: 4, title: 'Knee is very closed at the top', detail: `Your knee closes to ${m.kneeFlex.toFixed(0)}° at the top of the stroke. If you feel hip pinching or front-of-knee pain, shorter cranks (e.g. 5 mm shorter) open this up; raise the saddle by the same amount.` });
  }
  if (m.ankleBottom > 150 || m.ankleRange > 35) {
    recs.push({ area: 'Feet', priority: 4, title: 'Lots of ankle movement', detail: `Your toes point down strongly at the bottom (ankle ${m.ankleBottom.toFixed(0)}°, range ${m.ankleRange.toFixed(0)}°). Heavy toe-pointing can hide a saddle that is too high — consider moving cleats slightly back.` });
  }
  if (mobility.kneePain === 'front' && saddleUp <= 0) {
    recs.push({ area: 'Pain', priority: 3, title: 'Front-of-knee pain', detail: 'Anterior knee pain usually comes from a saddle that is too low or too far forward. If it persists, try 3–5 mm higher.' });
  }
  if (mobility.kneePain === 'back' && saddleUp >= 0) {
    recs.push({ area: 'Pain', priority: 3, title: 'Back-of-knee pain', detail: 'Posterior knee pain usually comes from over-extension. If it persists, try 3–5 mm lower.' });
  }
  if (!recs.length) {
    recs.push({ area: 'All good', priority: 5, title: 'Your position is inside your fit window', detail: 'No changes needed for your selected bike type and goal. Re-check after any equipment change.' });
  }
  recs.sort((a, b) => a.priority - b.priority);
  return { checks, recs, delta: { saddleUp: mmRound(saddleUp), reach, stack } };
}

// ---- Stem calculator --------------------------------------------------------------------------
// Bar-clamp position relative to the top of the headset, x forward / y up, in mm.
export function barPosition({ length, angle, spacers, headAngle }) {
  const h = rad(headAngle);
  const elev = rad(90 - headAngle + angle); // stem elevation above horizontal
  return {
    x: -spacers * Math.cos(h) + length * Math.cos(elev),
    y: spacers * Math.sin(h) + length * Math.sin(elev),
  };
}

export function stemOptions(current, dReach, dStack, maxSpacers = 40) {
  const base = barPosition(current);
  const want = { x: base.x + dReach, y: base.y + dStack };
  const out = [];
  for (let length = 60; length <= 140; length += 10)
    for (const angle of [-17, -10, -6, 0, 6, 10, 17])
      for (let spacers = 0; spacers <= maxSpacers; spacers += 5) {
        const p = barPosition({ length, angle, spacers, headAngle: current.headAngle });
        out.push({ length, angle, spacers, dx: p.x - base.x, dy: p.y - base.y, err: Math.hypot(p.x - want.x, p.y - want.y) });
      }
  return out.sort((a, b) => a.err - b.err).slice(0, 6);
}
