// Web Audio API 기반 사운드 시스템
let audioCtx: AudioContext | null = null;

function ensureAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  } catch (_e) {
    console.warn('AudioContext 생성 실패:', _e);
    return null;
  }
}

// 숫자 입력 효과음 (짧은 클릭)
export function playTapSound() {
  const ctx = ensureAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.06);
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.1);
  osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}

// 1줄(행/열/박스) 완성 효과음 - 상승하는 3음 차임
export function playLineCompleteSound() {
  const ctx = ensureAudioContext();
  if (!ctx) return;

  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5

  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    const t = ctx.currentTime + i * 0.12;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.4, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

    osc.start(t);
    osc.stop(t + 0.4);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  });
}

// 퍼즐 전체 완성 효과음 - 화려한 상승 아르페지오
export function playPuzzleCompleteSound() {
  const ctx = ensureAudioContext();
  if (!ctx) return;

  // C5 -> E5 -> G5 -> C6 -> E6 -> G6 -> C7
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98, 2093.0];

  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    const t = ctx.currentTime + i * 0.13;
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);

    osc.start(t);
    osc.stop(t + 0.8);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  });

  // 화음 레이어
  const chordDelay = notes.length * 0.13 + 0.1;
  const chord = [523.25, 659.25, 783.99, 1046.5];
  chord.forEach(freq => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    const t = ctx.currentTime + chordDelay;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 2.0);

    osc.start(t);
    osc.stop(t + 2.0);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  });
}

// 오답 효과음
export function playErrorSound() {
  const ctx = ensureAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(250, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.3);
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.3);
  osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}

// ─── BGM ───
let bgmInterval: ReturnType<typeof setInterval> | null = null;
let bgmGain: GainNode | null = null;
let bgmOscillators: OscillatorNode[] = [];
let bgmPlaying = false;

const BGM_NOTES: [number, number][] = [
  [261.63, 329.63], // C4, E4
  [293.66, 349.23], // D4, F4
  [329.63, 392.00], // E4, G4
  [349.23, 440.00], // F4, A4
  [392.00, 493.88], // G4, B4
  [349.23, 440.00], // F4, A4
  [329.63, 392.00], // E4, G4
  [293.66, 349.23], // D4, F4
];

export function startBGM() {
  if (bgmPlaying) return;
  const ctx = ensureAudioContext();
  if (!ctx) return;

  bgmGain = ctx.createGain();
  bgmGain.gain.setValueAtTime(0.06, ctx.currentTime);
  bgmGain.connect(ctx.destination);

  let noteIndex = 0;
  bgmPlaying = true;

  const playNote = () => {
    bgmOscillators.forEach(o => { try { o.stop(); } catch (_e) { /* */ } });
    bgmOscillators = [];

    if (!bgmPlaying || !bgmGain) return;

    const [freq1, freq2] = BGM_NOTES[noteIndex % BGM_NOTES.length];

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq1, ctx.currentTime);
    osc1.connect(bgmGain);
    osc1.start(ctx.currentTime);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq2, ctx.currentTime);
    osc2.connect(bgmGain);
    osc2.start(ctx.currentTime);

    bgmOscillators = [osc1, osc2];
    noteIndex++;
  };

  playNote();
  bgmInterval = setInterval(playNote, 2000);
}

export function stopBGM() {
  bgmPlaying = false;
  if (bgmInterval) { clearInterval(bgmInterval); bgmInterval = null; }
  bgmOscillators.forEach(o => { try { o.stop(); } catch (_e) { /* */ } });
  bgmOscillators = [];
  if (bgmGain) { try { bgmGain.disconnect(); } catch (_e) { /* */ } bgmGain = null; }
}

export function isBGMPlaying() {
  return bgmPlaying;
}
