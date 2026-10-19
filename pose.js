// MediaPipe Pose Landmarker (vendored, runs fully offline) and frame-by-frame video processing.
import { FilesetResolver, PoseLandmarker } from './vendor/vision_bundle.mjs';

const MODELS = { heavy: './vendor/pose_landmarker_heavy.task', full: './vendor/pose_landmarker_full.task' };
let fileset;
const cache = new Map();

async function create(model, mode) {
  fileset ??= await FilesetResolver.forVisionTasks('./vendor/wasm');
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODELS[model], delegate },
    runningMode: mode,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  // MediaPipe uploads every frame through WebGL, even on the CPU delegate.
  if (!hasWebGL2()) {
    throw new Error('Pose tracking needs WebGL2, which is unavailable in this browser. Turn on hardware acceleration (or try Chrome, Edge, Firefox or Safari) and reload.');
  }
  if (!forceCPU) {
    try {
      return await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch { /* fall through to CPU */ }
  }
  return await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
}

// Set once GPU inference has failed, so later landmarkers go straight to CPU.
let forceCPU = false;
const hasWebGL2 = () => {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
};

// Run detection; if the GPU path fails at inference time, rebuild on CPU and retry once.
async function detectWithFallback(kind, model, mode, run) {
  try {
    return run(cache.get(kind) ?? (await rebuild(kind, model, mode)));
  } catch (err) {
    if (forceCPU) throw err;
    forceCPU = true;
    return run(await rebuild(kind, model, mode));
  }
}
async function rebuild(kind, model, mode) {
  cache.get(kind)?.close();
  const lm = await create(model, mode);
  cache.set(kind, lm);
  return lm;
}

// VIDEO mode keeps tracking state between frames, so each video run gets a fresh instance.
export const videoLandmarker = (model = 'heavy') => rebuild('video', model, 'VIDEO');

const seek = (video, t) =>
  new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });

/**
 * Step through the video at `fps`, running pose detection on each frame.
 * Returns [{ t, lm }] with lm = 33 normalized landmarks or null.
 */
export async function processVideo(video, { fps = 30, maxSeconds = 30, model = 'heavy', onProgress, signal } = {}) {
  await videoLandmarker(model);
  const end = Math.min(video.duration, maxSeconds);
  const frames = [];
  const step = 1 / fps;
  video.pause();
  for (let t = 0; t < end; t += step) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    await seek(video, t);
    const ts = Math.round(t * 1000) + 1;
    const res = await detectWithFallback('video', model, 'VIDEO', (lm) => lm.detectForVideo(video, ts));
    frames.push({ t, lm: res.landmarks?.[0] ?? null });
    onProgress?.(t / end, frames[frames.length - 1]);
  }
  onProgress?.(1);
  return frames;
}

export async function detectImage(img, model = 'heavy') {
  const res = await detectWithFallback(`image:${model}`, model, 'IMAGE', (lm) => lm.detect(img));
  return res.landmarks?.[0] ?? null;
}
