import { processVideo, detectImage } from './pose.js';
import { analyze, angle, LM } from './analysis.js';
import { BIKE_TYPES, GOALS, METRICS, targets, recommend, mobilityClass, stemOptions } from './fit.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const FPS = 30;
const state = { videoURL: null, frames: null, result: null, report: null, tgt: null };

// ---- Navigation & form controls ----------------------------------------------------------------
function showStep(name) {
  $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
  $$('#steps button').forEach((b) => b.classList.toggle('active', b.dataset.step === name));
  if (name === 'results') startReplay(); else stopReplay();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('#steps button').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.step)));
$$('[data-next]').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.next)));

$('#bike').innerHTML = Object.entries(BIKE_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
$('#goal').innerHTML = Object.entries(GOALS)
  .map(([k, v]) => `<button data-v="${k}" class="${k === 'balanced' ? 'on' : ''}" title="${v}">${v.split(' — ')[0]}</button>`).join('');

$$('.seg').forEach((seg) =>
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    updateFlex();
  }));
const segVal = (id) => $(`#${id} button.on`)?.dataset.v;
const num = (id) => { const v = parseFloat($(`#${id}`).value); return Number.isFinite(v) ? v : null; };

function rider() {
  return {
    heightCm: num('height'), crankMm: parseFloat($('#crank').value),
    bike: $('#bike').value, goal: segVal('goal'),
    setup: { saddleHeight: num('saddleHeight'), length: num('stemLength') ?? 100, angle: num('stemAngle') ?? -6, spacers: num('spacers') ?? 20, headAngle: num('headAngle') ?? 73 },
  };
}
function mobility() {
  return { slr: num('slr') ?? NaN, toeTouch: segVal('toeTouch'), backPain: $('#backPain').checked, kneePain: segVal('kneePain') };
}

// ---- Mobility ------------------------------------------------------------------------------------
function updateFlex() {
  const mob = mobility();
  const cls = mobilityClass(mob);
  const t = targets({ bike: $('#bike').value, goal: segVal('goal'), mobility: mob });
  $('#flexResult').innerHTML = `<span class="pill">${cls}</span>
    <span class="note">Your ${BIKE_TYPES[$('#bike').value].toLowerCase()} target: knee extension <b>${t.kneeExt.join('–')}°</b>,
    back angle <b>${t.torso.join('–')}°</b>, hip angle at least <b>${t.hipClosed[0]}°</b>.</span>`;
}
['#slr', '#backPain', '#bike'].forEach((s) => $(s).addEventListener('input', updateFlex));
updateFlex();

$('#slrPhoto').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('#slrMsg').textContent = 'Measuring…';
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  try {
    const lm = await detectImage(img, $('#model').value);
    if (!lm) throw new Error('No person found in the photo.');
    const W = img.naturalWidth, H = img.naturalHeight;
    const pt = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
    const hip = { x: (pt(23).x + pt(24).x) / 2, y: (pt(23).y + pt(24).y) / 2 };
    // The raised leg is the one whose ankle is higher in the frame.
    const [up, down] = pt(27).y < pt(28).y ? [pt(27), pt(28)] : [pt(28), pt(27)];
    const a = Math.round(angle(up, hip, down));
    $('#slr').value = a;
    const c = $('#slrCanvas');
    c.width = W; c.height = H; c.hidden = false;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    ctx.lineWidth = Math.max(3, W / 250); ctx.strokeStyle = '#ef6f53'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(up.x, up.y); ctx.lineTo(hip.x, hip.y); ctx.lineTo(down.x, down.y); ctx.stroke();
    label(ctx, `${a}°`, hip.x, hip.y - W / 40, W / 45);
    $('#slrMsg').textContent = `Straight-leg raise: ${a}°. Check the lines follow your legs; type a value to override.`;
    updateFlex();
  } catch (err) {
    $('#slrMsg').textContent = err.message;
  }
});

// ---- Video input ---------------------------------------------------------------------------------
const video = $('#video');
function setVideo(blobOrFile) {
  if (state.videoURL) URL.revokeObjectURL(state.videoURL);
  state.videoURL = URL.createObjectURL(blobOrFile);
  video.srcObject = null;
  video.src = state.videoURL;
  video.controls = true;
  video.loop = true;
  $('#analyzeBtn').disabled = false;
  $('#videoError').textContent = '';
  clearCanvas($('#overlay'));
}
$('#videoFile').addEventListener('change', (e) => e.target.files[0] && setVideo(e.target.files[0]));

$('#recordBtn').addEventListener('click', async () => {
  const cd = $('#countdown');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'environment' }, audio: false });
  } catch (err) {
    $('#videoError').textContent = `Camera unavailable: ${err.message}`;
    return;
  }
  video.src = ''; video.controls = false; video.srcObject = stream; await video.play();
  cd.hidden = false; cd.classList.remove('rec');
  for (let n = 5; n > 0; n--) { cd.textContent = n; await wait(1000); }
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start();
  cd.classList.add('rec');
  for (let s = 20; s > 0; s--) { cd.textContent = `● REC ${s}s`; await wait(1000); }
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  cd.hidden = true;
  setVideo(new Blob(chunks, { type: rec.mimeType }));
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

$('#analyzeBtn').addEventListener('click', async () => {
  const r = rider();
  if (!r.heightCm) { $('#videoError').textContent = 'Enter your height on step 1 first.'; return; }
  const btn = $('#analyzeBtn');
  btn.disabled = true;
  $('#videoError').textContent = '';
  const prog = $('#progress');
  prog.hidden = false;
  const overlay = $('#overlay');
  await waitMeta(video);
  // Some recorded WebM blobs report Infinity duration until seeked to the end.
  if (!Number.isFinite(video.duration)) { video.currentTime = 1e9; await new Promise((res) => (video.ondurationchange = res)); }
  overlay.width = video.videoWidth; overlay.height = video.videoHeight;
  try {
    setProgress(0, 'Loading pose model…');
    state.frames = await processVideo(video, {
      fps: FPS, model: $('#model').value,
      onProgress: (p, f) => {
        setProgress(p, `Tracking joints… ${Math.round(p * 100)}%`);
        if (f) drawLive(overlay, f.lm);
      },
    });
    setProgress(1, 'Analysing pedal strokes…');
    state.result = analyze(state.frames, video.videoWidth, video.videoHeight, r);
    state.tgt = targets({ bike: r.bike, goal: r.goal, mobility: mobility() });
    state.report = recommend(state.result, state.tgt, mobility());
    await renderReport(r);
    saveHistory(r);
    $('#steps [data-step="results"]').disabled = false;
    showStep('results');
  } catch (err) {
    console.error(err);
    $('#videoError').textContent = err.message;
  } finally {
    btn.disabled = false;
    prog.hidden = true;
  }
});
function setProgress(p, text) {
  $('#progress div').style.width = `${p * 100}%`;
  $('#progress span').textContent = text;
}
const waitMeta = (v) => (v.readyState >= 1 ? Promise.resolve() : new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true })));
const seekTo = (v, t) => new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = t; });

// ---- Drawing helpers -----------------------------------------------------------------------------
const COLORS = { leg: '#ef6f53', arm: '#5aa9ff', torso: '#ffd166', joint: '#ffffff' };
function clearCanvas(c) { c.getContext('2d').clearRect(0, 0, c.width, c.height); }

function label(ctx, text, x, y, size) {
  ctx.font = `700 ${size}px ui-sans-serif, -apple-system, sans-serif`;
  const w = ctx.measureText(text).width + size * 0.8;
  ctx.fillStyle = 'rgba(13,18,27,0.85)';
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - size * 0.75, w, size * 1.5, size * 0.4); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + size * 0.05);
}

function line(ctx, pts, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
}

// Skeleton of the camera-side limbs from analysis points (pixel coords).
function drawPose(ctx, p, W, { angles = true } = {}) {
  const lw = Math.max(2, W / 320);
  line(ctx, [p.ear, p.shoulder, p.hip], COLORS.torso, lw);
  line(ctx, [p.shoulder, p.elbow, p.wrist], COLORS.arm, lw);
  line(ctx, [p.hip, p.knee, p.ankle, p.heel, p.toe, p.ankle], COLORS.leg, lw);
  ctx.fillStyle = COLORS.joint;
  for (const j of ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']) {
    ctx.beginPath(); ctx.arc(p[j].x, p[j].y, lw * 1.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#7CFFB2';
  ctx.beginPath(); ctx.arc(p.ball.x, p.ball.y, lw * 1.8, 0, Math.PI * 2); ctx.fill();
  if (!angles) return;
  const fs = Math.max(12, W / 55);
  const off = (j, dx, dy) => [p[j].x + dx * fs, p[j].y + dy * fs];
  const d = state.result.dir;
  label(ctx, `${Math.round(angle(p.hip, p.knee, p.ankle))}°`, ...off('knee', 2.2 * d, 0), fs);
  label(ctx, `${Math.round(angle(p.shoulder, p.hip, p.knee))}°`, ...off('hip', -2.2 * d, 0.4), fs);
  label(ctx, `${Math.round(angle(p.shoulder, p.elbow, p.wrist))}°`, ...off('elbow', 0, 1.6), fs);
  label(ctx, `${Math.round(angle(p.hip, p.shoulder, p.elbow))}°`, ...off('shoulder', -1.4 * d, -1.4), fs);
}

// Live preview during processing: raw landmarks of the more visible side.
function drawLive(canvas, lm) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lm) return;
  const W = canvas.width, H = canvas.height;
  const side = (lm[25].visibility ?? 0) >= (lm[26].visibility ?? 0) ? 'left' : 'right';
  const ids = LM[side];
  const pt = (j) => ({ x: lm[ids[j]].x * W, y: lm[ids[j]].y * H });
  const lw = Math.max(2, W / 320);
  line(ctx, [pt('ear'), pt('shoulder'), pt('hip')], COLORS.torso, lw);
  line(ctx, [pt('shoulder'), pt('elbow'), pt('wrist')], COLORS.arm, lw);
  line(ctx, [pt('hip'), pt('knee'), pt('ankle'), pt('heel'), pt('toe'), pt('ankle')], COLORS.leg, lw);
}

// ---- Report --------------------------------------------------------------------------------------
const fmt = (v, unit) => `${unit === 'mm' && v > 0 ? '+' : ''}${Math.round(v)}${unit === 'mm' ? ' mm' : '°'}`;

async function renderReport(r) {
  const res = state.result, rep = state.report, tgt = state.tgt;
  $('#summary').innerHTML = `${BIKE_TYPES[r.bike]} · ${GOALS[r.goal].split(' — ')[0]} goal · <b>${tgt.flex}</b> mobility ·
    ${res.cycles} pedal strokes · ${Math.round(res.cadence)} rpm · filmed from the ${res.side} side`;
  $('#warnings').innerHTML = res.warnings.map((w) => `<div>⚠ ${w}</div>`).join('');

  $('#recs').innerHTML = rep.recs.map((x) => {
    let extra = '';
    if (x.delta?.saddleHeight && r.setup.saddleHeight) extra = `New saddle height: ${r.setup.saddleHeight} → <b>${r.setup.saddleHeight + x.delta.saddleHeight} mm</b>`;
    return `<li><div class="area">${x.area}</div><div><h3>${x.title}</h3><p>${x.detail}</p>${extra ? `<p class="newval">${extra}</p>` : ''}</div></li>`;
  }).join('');

  $('#windowNote').textContent = `Green bands are your target window for a ${BIKE_TYPES[r.bike].toLowerCase()} bike, ${r.goal} goal and ${tgt.flex} mobility. The grey bar shows stroke-to-stroke variation.`;
  $('#gauges').innerHTML = rep.checks.map(gauge).join('');

  // Replay / snapshots share a second video element so the input preview stays untouched.
  const replay = $('#replay');
  replay.src = state.videoURL;
  await waitMeta(replay);
  const W = video.videoWidth, H = video.videoHeight;
  $('#replayOverlay').width = W; $('#replayOverlay').height = H;

  const snaps = [['Top · 12 o\'clock', res.rep.top], ['Forward · 3 o\'clock', res.rep.front], ['Bottom · 6 o\'clock', res.rep.bottom]];
  const box = $('#snaps');
  box.innerHTML = '';
  for (const [title, s] of snaps) {
    await seekTo(replay, s.t);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(replay, 0, 0, W, H);
    drawPose(ctx, res.points[s.i], W);
    const div = document.createElement('div');
    div.className = 'snap';
    div.innerHTML = `<h3>${title}</h3><div class="kv">
      <span>Knee</span><span>${Math.round(s.knee)}°</span><span>Hip</span><span>${Math.round(s.hip)}°</span>
      <span>Ankle</span><span>${Math.round(s.ankle)}°</span><span>Back</span><span>${Math.round(s.torso)}°</span></div>`;
    div.prepend(c);
    box.append(div);
  }
  await seekTo(replay, 0);

  drawTraces(W, H);
  const m = res.metrics;
  $('#movement').innerHTML = [
    ['Hip bounce (vertical)', `${Math.round(m.hipBounce.value)} mm`],
    ['Hip shift (fore-aft)', `${Math.round(m.hipShift.value)} mm`],
    ['Shoulder movement', `${Math.round(m.shoulderMove.value)} mm`],
    ['Knee at top of stroke', `${Math.round(m.kneeFlex.value)}°`],
    ['Ankle range', `${Math.round(m.ankleRange.value)}°`],
    ['Cadence', `${Math.round(res.cadence)} rpm`],
    ['Scale', `${res.scale.toFixed(2)} px/mm`],
  ].map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');

  drawChart();
  $('#dReach').value = rep.delta.reach;
  $('#dStack').value = rep.delta.stack;
  renderStem();
}

function gauge(c) {
  const [lo, hi] = c.window;
  const span = hi - lo;
  const min = Math.min(lo - span * 0.8, c.value - span * 0.3);
  const max = Math.max(hi + span * 0.8, c.value + span * 0.3);
  const pos = (v) => `${Math.max(0, Math.min(1, (v - min) / (max - min))) * 100}%`;
  const word = { ok: 'in window', low: 'too low', high: 'too high' }[c.status];
  return `<div class="gauge">
    <div class="name">${c.label}<small>${c.hint}</small></div>
    <div class="bar">
      <div class="track"></div>
      <div class="band" style="left:${pos(lo)};width:calc(${pos(hi)} - ${pos(lo)})"></div>
      <div class="sdband" style="left:${pos(c.value - c.sd)};width:calc(${pos(c.value + c.sd)} - ${pos(c.value - c.sd)})"></div>
      <div class="dot ${c.status}" style="left:${pos(c.value)}"></div>
      <div class="tick" style="left:${pos(lo)}">${lo}</div><div class="tick" style="left:${pos(hi)}">${hi}</div>
    </div>
    <div class="val ${c.status}">${fmt(c.value, c.unit)}<small>${word}</small></div>
  </div>`;
}

const TRACE = [['shoulder', '#ffd166'], ['wrist', '#5aa9ff'], ['hip', '#ef6f53'], ['knee', '#ff9fd0'], ['ankle', '#7CFFB2']];
function drawTraces(W, H) {
  const res = state.result;
  const c = $('#traces');
  // Crop to the rider's bounding box so the paths are big enough to read.
  const pts = res.points.filter(Boolean);
  const xs = pts.flatMap((p) => TRACE.map(([j]) => p[j].x)), ys = pts.flatMap((p) => TRACE.map(([j]) => p[j].y));
  const pad = W * 0.05;
  const x0 = Math.max(0, Math.min(...xs) - pad), x1 = Math.min(W, Math.max(...xs) + pad);
  const y0 = Math.max(0, Math.min(...ys) - pad), y1 = Math.min(H, Math.max(...ys) + pad);
  c.width = x1 - x0; c.height = y1 - y0;
  const ctx = c.getContext('2d');
  const snap = $$('#snaps canvas').at(-1); // bottom-of-stroke frame as a faint backdrop
  ctx.globalAlpha = 0.35;
  if (snap) ctx.drawImage(snap, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  ctx.globalAlpha = 1;
  ctx.translate(-x0, -y0);
  const lw = Math.max(1.5, W / 600);
  for (const [j, color] of TRACE) {
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.globalAlpha = 0.85; ctx.beginPath();
    let pen = false;
    for (const p of res.points) {
      if (!p) { pen = false; continue; }
      pen ? ctx.lineTo(p[j].x, p[j].y) : ctx.moveTo(p[j].x, p[j].y);
      pen = true;
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([lw * 4, lw * 4]); ctx.strokeStyle = '#7CFFB2'; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(res.circle.cx, res.circle.cy, res.circle.r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  $('#traceLegend').innerHTML = TRACE.map(([j, c]) => `<span><i style="background:${c}"></i>${j}</span>`).join('') +
    '<span><i style="background:#7CFFB2"></i>pedal circle (dashed)</span>';
}

const SERIES = [['knee', '#ef6f53', 'Knee'], ['hip', '#22304a', 'Hip'], ['ankle', '#1f9d6b', 'Ankle'], ['elbow', '#5aa9ff', 'Elbow'], ['torso', '#d98a1c', 'Back']];
function drawChart() {
  const c = $('#chart');
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const s = state.result.series.filter(Boolean);
  const t0 = s[0].t, t1 = Math.min(s[s.length - 1].t, t0 + 8); // first 8 s keeps strokes readable
  const pts = s.filter((x) => x.t <= t1);
  const L = 36, R = 10, T = 10, B = 24;
  const X = (t) => L + ((t - t0) / (t1 - t0)) * (w - L - R);
  const Y = (v) => T + (1 - v / 180) * (h - T - B);
  ctx.font = '11px ui-sans-serif, sans-serif'; ctx.fillStyle = '#6a7384'; ctx.strokeStyle = '#e2e6ec'; ctx.lineWidth = 1;
  for (let v = 0; v <= 180; v += 30) {
    ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(w - R, Y(v)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(`${v}°`, L - 6, Y(v));
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let t = Math.ceil(t0); t <= t1; t++) ctx.fillText(`${t}s`, X(t), h - B + 6);
  const [klo, khi] = state.tgt.kneeExt;
  ctx.fillStyle = 'rgba(31,157,107,0.14)';
  ctx.fillRect(L, Y(khi), w - L - R, Y(klo) - Y(khi));
  for (const [key, color] of SERIES) {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    pts.forEach((p, i) => (i && p.t - pts[i - 1].t < 0.2 ? ctx.lineTo(X(p.t), Y(p[key])) : ctx.moveTo(X(p.t), Y(p[key]))));
    ctx.stroke();
  }
  $('#chartLegend').innerHTML = SERIES.map(([, c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join('') +
    '<span><i style="background:rgba(31,157,107,.35)"></i>Knee extension target</span>';
}
window.addEventListener('resize', () => state.result && !$('[data-panel="results"]').hidden && drawChart());

// Replay overlay follows the video's current time.
let raf = 0;
function startReplay() {
  if (!state.result || raf) return;
  const replay = $('#replay'), c = $('#replayOverlay');
  const frames = state.frames;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const i = Math.min(frames.length - 1, Math.round(replay.currentTime * FPS));
    const p = state.result.points[i];
    if (p) drawPose(ctx, p, c.width);
  };
  tick();
}
function stopReplay() { cancelAnimationFrame(raf); raf = 0; $('#replay').pause(); }

// ---- Stem calculator -----------------------------------------------------------------------------
function renderStem() {
  const r = rider();
  const opts = stemOptions(r.setup, num('dReach') ?? 0, num('dStack') ?? 0, num('maxSpacers') ?? 40);
  const cur = r.setup;
  $('#stemTable').innerHTML = `<tr><th>Stem</th><th>Angle</th><th>Spacers</th><th>Reach Δ</th><th>Height Δ</th><th>Off target</th></tr>
    <tr><td>${cur.length} mm</td><td>${cur.angle}°</td><td>${cur.spacers} mm</td><td colspan="3" class="dim">current</td></tr>` +
    opts.map((o, i) => `<tr class="${i === 0 ? 'best' : ''}"><td>${o.length} mm</td><td>${o.angle > 0 ? '+' : ''}${o.angle}°</td><td>${o.spacers} mm</td>
      <td>${fmt(o.dx, 'mm')}</td><td>${fmt(o.dy, 'mm')}</td><td>${o.err.toFixed(0)} mm</td></tr>`).join('');
}
['#dReach', '#dStack', '#maxSpacers', '#stemLength', '#stemAngle', '#spacers', '#headAngle'].forEach((s) => $(s).addEventListener('input', () => state.result && renderStem()));

// ---- History -------------------------------------------------------------------------------------
const HKEY = 'pedalfit.history';
const loadHistory = () => { try { return JSON.parse(localStorage.getItem(HKEY)) ?? []; } catch { return []; } };
function saveHistory(r) {
  const h = loadHistory();
  const m = state.result.metrics;
  h.unshift({
    date: new Date().toISOString(), bike: r.bike, goal: r.goal, flex: state.tgt.flex,
    kneeExt: m.kneeExt.value, hipClosed: m.hipClosed.value, torso: m.torso.value, elbow: m.elbow.value, kops: m.kops.value,
    rec: state.report.recs[0]?.title,
  });
  try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 50))); } catch { /* storage full or blocked */ }
}
function renderHistory() {
  const h = loadHistory();
  $('#historyBody').innerHTML = h.length ? `<table class="table"><tr><th>Date</th><th>Bike</th><th>Knee</th><th>Hip</th><th>Back</th><th>Elbow</th><th>KOPS</th><th>Top recommendation</th><th></th></tr>` +
    h.map((x, i) => `<tr><td>${new Date(x.date).toLocaleString()}</td><td>${BIKE_TYPES[x.bike]} · ${x.goal}</td>
      <td>${Math.round(x.kneeExt)}°</td><td>${Math.round(x.hipClosed)}°</td><td>${Math.round(x.torso)}°</td><td>${Math.round(x.elbow)}°</td>
      <td>${fmt(x.kops, 'mm')}</td><td>${x.rec ?? ''}</td><td><button class="ghost" data-del="${i}">✕</button></td></tr>`).join('') + '</table>'
    : '<p class="note">No fits yet.</p>';
}
$('#historyBtn').addEventListener('click', () => { renderHistory(); $('#historyDlg').showModal(); });
$('#historyBody').addEventListener('click', (e) => {
  const i = e.target.dataset.del;
  if (i === undefined) return;
  const h = loadHistory(); h.splice(+i, 1);
  try { localStorage.setItem(HKEY, JSON.stringify(h)); } catch { /* ignore */ }
  renderHistory();
});
$('#printBtn').addEventListener('click', () => window.print());

// Expose for debugging in the console.
window.pedalfit = { state, METRICS };
