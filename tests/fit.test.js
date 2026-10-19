import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../analysis.js';
import { targets, recommend, mobilityClass, barPosition, stemOptions } from '../fit.js';
import { syntheticRider } from './synthetic-rider.js';

const MOB = { slr: 75, toeTouch: 'fingers', backPain: false, kneePain: 'none' };
const fitFor = (riderOpts, fitOpts = { bike: 'road', goal: 'balanced' }) => {
  const s = syntheticRider(riderOpts);
  const res = analyze(s.frames, s.width, s.height, s.rider);
  const tgt = targets({ ...fitOpts, mobility: MOB });
  return recommend(res, tgt, MOB);
};

test('mobility classes', () => {
  assert.equal(mobilityClass({ slr: 55, toeTouch: 'knees' }), 'tight');
  assert.equal(mobilityClass({ slr: 72, toeTouch: 'fingers' }), 'average');
  assert.equal(mobilityClass({ slr: 90, toeTouch: 'palms' }), 'flexible');
});

test('tight riders get a more upright, more forgiving window', () => {
  const avg = targets({ bike: 'road', goal: 'balanced', mobility: MOB });
  const tight = targets({ bike: 'road', goal: 'balanced', mobility: { slr: 50, toeTouch: 'knees' } });
  assert.ok(tight.torso[0] > avg.torso[0]);
  assert.ok(tight.kneeExt[1] < avg.kneeExt[1]);
});

test('a saddle that is too high is lowered by a plausible amount', () => {
  const { delta } = fitFor({ kneeExt: 153 });
  assert.ok(delta.saddleUp < -5 && delta.saddleUp > -25, `got ${delta.saddleUp} mm`);
});

test('a saddle that is too low is raised', () => {
  const { delta } = fitFor({ kneeExt: 134 });
  assert.ok(delta.saddleUp > 5 && delta.saddleUp < 30, `got ${delta.saddleUp} mm`);
});

test('a knee angle inside the window leaves the saddle alone', () => {
  assert.equal(fitFor({ kneeExt: 144 }).delta.saddleUp, 0);
});

test('a too-low back angle raises the bars', () => {
  const { delta, checks } = fitFor({ torsoDeg: 28 });
  assert.equal(checks.find((c) => c.key === 'torso').status, 'low');
  assert.ok(delta.stack > 0, `got stack ${delta.stack}`);
});

// Hand-set metrics, for cases the synthetic rider can't produce exactly.
const TGT = { kneeExt: [143, 151], torso: [27, 37], hipClosed: [37, 59], shoulder: [75, 95], elbow: [145, 165], kops: [-15, 15] };
const fitWith = (over) => {
  const v = { kneeExt: 147, hipClosed: 50, torso: 32, shoulder: 85, elbow: 155, kops: 0, hipBounce: 10, kneeFlex: 75, shoulderMove: 20, ankleBottom: 130, ankleRange: 25, ...over };
  const metrics = Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { value, sd: 0 }]));
  return recommend({ metrics, segments: { thigh: 430, shank: 440, torso: 560, upperArm: 300, forearm: 270 } }, TGT, MOB);
};

test('rocking hips do not lower a saddle whose knee angle is in the lower half of the window', () => {
  const { delta, recs } = fitWith({ kneeExt: 146, hipBounce: 38 });
  assert.equal(delta.saddleUp, 0);
  assert.ok(recs.some((r) => r.title === 'Hips are rocking'));
});

test('rocking hips nudge the saddle down when the knee is in the upper half', () => {
  assert.equal(fitWith({ kneeExt: 150, hipBounce: 38 }).delta.saddleUp, -4);
});

test('a back angle that rounds to the window edge is in range', () => {
  const { checks, delta } = fitWith({ torso: 37.3 });
  assert.equal(checks.find((c) => c.key === 'torso').status, 'ok');
  assert.equal(delta.stack, 0);
});

test('moving the saddle back counts toward the reach the elbows need', () => {
  const alone = fitWith({ elbow: 134 }).delta.reach;
  const withSetback = fitWith({ elbow: 134, kops: 45 }).delta.reach;
  assert.ok(alone > 15, `got ${alone}`);
  assert.equal(withSetback, 0);
  // With the cockpit fine, a big setback move asks for a shorter stem to keep the same reach.
  assert.ok(fitWith({ kops: 45 }).delta.reach < -25);
});

test('stem geometry: a -17° stem on a 73° head tube is level', () => {
  const p = barPosition({ length: 100, angle: -17, spacers: 0, headAngle: 73 });
  assert.ok(Math.abs(p.y) < 1e-9 && Math.abs(p.x - 100) < 1e-9);
});

test('stem options: best match is close to the requested move', () => {
  const [best] = stemOptions({ length: 100, angle: -6, spacers: 20, headAngle: 73 }, -10, 15);
  assert.ok(best.err < 6, `best option is ${best.err.toFixed(1)} mm off`);
});
