// Cute chiptune sound effects & background music via Web Audio API
let _ctx = null;
let _bgTimers = [];
let _muted = false;
let _bgRunning = false;

function _ctx_() {
  if (!_ctx) {
    try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  return _ctx;
}

function _tone(freq, dur, type = 'square', vol = 0.13, delay = 0) {
  if (_muted) return;
  const ctx = _ctx_();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    gain.gain.setValueAtTime(vol, ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + dur + 0.02);
  } catch(e) {}
}

// ── Sound effects ──
export function sfxCard() {
  _tone(622, 0.07, 'square', 0.12);       // Eb5 — crisp click
  _tone(784, 0.05, 'square', 0.08, 0.06); // G5 — quick tail
}

export function sfxPass() {
  _tone(370, 0.10, 'triangle', 0.09);
  _tone(294, 0.12, 'triangle', 0.07, 0.09);
}

export function sfxTrickWon() {
  _tone(523, 0.10, 'square', 0.12);
  _tone(659, 0.10, 'square', 0.12, 0.10);
  _tone(784, 0.18, 'square', 0.15, 0.20);
}

export function sfxBomb() {
  _tone(110, 0.30, 'sawtooth', 0.22);
  _tone(147, 0.25, 'sawtooth', 0.16, 0.05);
  _tone(87,  0.40, 'sawtooth', 0.10, 0.15);
}

export function sfxFinish(place) {
  if (place === 1) {
    [523, 659, 784, 1047].forEach((f, i) => _tone(f, 0.18, 'square', 0.16, i * 0.13));
  } else if (place === 2) {
    _tone(523, 0.12, 'square', 0.11);
    _tone(659, 0.16, 'square', 0.13, 0.12);
  } else {
    _tone(392, 0.12, 'square', 0.09);
  }
}

export function sfxTichu(isGrand) {
  if (isGrand) {
    [392, 523, 659, 784, 1047, 1319].forEach((f, i) => _tone(f, 0.18, 'square', 0.18, i * 0.10));
  } else {
    [523, 659, 784, 1047].forEach((f, i) => _tone(f, 0.16, 'square', 0.15, i * 0.11));
  }
}

export function sfxDragon() {
  _tone(220, 0.4, 'sawtooth', 0.18);
  _tone(277, 0.3, 'sawtooth', 0.14, 0.08);
  _tone(330, 0.3, 'square',   0.12, 0.20);
}

export function sfxRoundOver() {
  // Short cheerful 5-note sting
  [392, 523, 659, 523, 784].forEach((f, i) => _tone(f, 0.14, 'square', 0.15, i * 0.11));
}

export function sfxError() {
  _tone(220, 0.08, 'square', 0.18);
  _tone(185, 0.14, 'square', 0.14, 0.07);
}

// ── Background music ──
// Simple pentatonic loop: C D E G A (cute, non-annoying)
const _BG = [
  [262, 0.35], [294, 0.35], [330, 0.35], [392, 0.35],
  [440, 0.35], [392, 0.35], [330, 0.35], [294, 0.35],
  [262, 0.7 ], [330, 0.35], [392, 0.35],
  [440, 0.35], [523, 0.35], [440, 0.35], [392, 0.7 ],
];
let _bgIdx = 0;

function _bgTick() {
  if (!_bgRunning) return;
  if (!_muted) _tone(_BG[_bgIdx % _BG.length][0], _BG[_bgIdx % _BG.length][1] * 0.85, 'triangle', 0.045);
  const nextDelay = _BG[_bgIdx % _BG.length][1] * 1000;
  _bgIdx++;
  _bgTimers.push(setTimeout(_bgTick, nextDelay));
}

export function startBgMusic() {
  if (_bgRunning) return;
  _bgRunning = true;
  _bgTick();
}

export function stopBgMusic() {
  _bgRunning = false;
  _bgTimers.forEach(clearTimeout);
  _bgTimers = [];
}

export function toggleMute() {
  _muted = !_muted;
  return _muted;
}

export function isMuted() { return _muted; }
