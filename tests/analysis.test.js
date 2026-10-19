import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, angle } from '../analysis.js';
import { syntheticRider } from './synthetic-rider.js';

const run = (opts) => {
  const s = syntheticRider(opts);
  return { s, res: analyze(s.frames, s.width, s.height, s.rider) };
};
const near = (actual, expected, tol, what) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: expected ${expected} ± ${tol}, got ${actual.toFixed(2)}`);

test('angle() returns the interior angle', () => {
  near(angle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }), 90, 1e-9, 'right angle');
  near(angle({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), 180, 1e-9, 'straight');
});

test('recovers knee extension, back angle and scale for a known rider', () => {
  const { s, res } = run({ kneeExt: 145, torsoDeg: 30 });
  near(res.metrics.kneeExt.value, 145, 1, 'knee extension');
  near(res.metrics.torso.value, 30, 1, 'back angle');
  near(res.scaleBody, s.pxPerMm, 0.01, 'body scale');
  near(res.scaleCrank, s.pxPerMm, 0.01, 'crank scale');
  assert.equal(res.side, 'left');
  assert.deepEqual(res.warnings, []);
});

test('counts pedal strokes and cadence', () => {
  const { res } = run({ rpm: 90, seconds: 12 });
  near(res.cadence, 90, 3, 'cadence');
  assert.ok(res.cycles >= 15, `expected ≥ 15 strokes, got ${res.cycles}`);
});

test('works for a rider facing left', () => {
  const { res } = run({ facing: -1, kneeExt: 140 });
  assert.equal(res.dir, -1);
  near(res.metrics.kneeExt.value, 140, 1, 'knee extension');
});

test('tracks knee extension across saddle heights', () => {
  for (const k of [135, 142, 150]) near(run({ kneeExt: k }).res.metrics.kneeExt.value, k, 1, `knee ${k}`);
});

test('survives occasional near/far leg swaps from the pose model', () => {
  const { res } = run({ kneeExt: 145, swapEvery: 7, noisePx: 1.5 });
  near(res.metrics.kneeExt.value, 145, 1.5, 'knee extension with swaps');
});

test('rejects a video with no usable tracking', () => {
  const frames = Array.from({ length: 100 }, (_, i) => ({ t: i / 30, lm: null }));
  assert.throws(() => analyze(frames, 1280, 720, { heightCm: 178, crankMm: 172.5 }), /track/);
});
