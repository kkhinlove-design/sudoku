// Web Audio API 기반 사운드 시스템
let audioCtx: AudioContext | null = null;
let bgmInterval: ReturnType<typeof setInterval> | null = null;
let bgmGain: GainNode | null = null;
let bgmOscillators: OscillatorNode[] = [];
let bgmPlaying = false;

function getAudioContext(): AudioContext {
  if (typeof window === 'undefined') throw new Error('No window');
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// 숫자 입력 효과음 (짧은 클릭)
export function playTapSound() {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.08);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  } catch { /* ignore */ }
}

// 1줄(행/열/박스) 완성 효과음 - 상승하는 2음 차임
export function playLineCompleteSound() {
  try {
    const ctx = getAudioContext();
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      const startTime = ctx.currentTime + i * 0.1;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.15, startTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);

      osc.start(startTime);
      osc.stop(startTime + 0.3);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    });
  } catch { /* ignore */ }
}

// 퍼즐 전체 완성 효과음 - 화려한 상승 아르페지오
export function playPuzzleCompleteSound() {
  try {
    const ctx = getAudioContext();
    // C5 -> E5 -> G5 -> C6 -> E6 -> G6 -> C7
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98, 2093.0];

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      const startTime = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.18, startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.6);

      osc.start(startTime);
      osc.stop(startTime + 0.6);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    });

    // 화음 레이어 추가
    setTimeout(() => {
      const chord = [523.25, 659.25, 783.99, 1046.5];
      chord.forEach(freq => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 1.5);
        osc.onended = () => { osc.disconnect(); gain.disconnect(); };
      });
    }, notes.length * 120);
  } catch { /* ignore */ }
}

// 오답 효과음
export function playErrorSound() {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'square';
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  } catch { /* ignore */ }
}

// BGM - 잔잔한 앰비언트 루프
const BGM_NOTES = [
  // 부드러운 C major 패턴
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
  try {
    const ctx = getAudioContext();
    bgmGain = ctx.createGain();
    bgmGain.gain.setValueAtTime(0.04, ctx.currentTime);
    bgmGain.connect(ctx.destination);

    let noteIndex = 0;

    const playNote = () => {
      // 이전 오실레이터 정리
      bgmOscillators.forEach(o => {
        try { o.stop(); } catch { /* ignore */ }
      });
      bgmOscillators = [];

      if (!bgmPlaying || !bgmGain) return;

      const [freq1, freq2] = BGM_NOTES[noteIndex % BGM_NOTES.length];

      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq1, ctx.currentTime);
      osc1.connect(bgmGain!);
      osc1.start(ctx.currentTime);

      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq2, ctx.currentTime);
      osc2.connect(bgmGain!);
      osc2.start(ctx.currentTime);

      bgmOscillators = [osc1, osc2];
      noteIndex++;
    };

    bgmPlaying = true;
    playNote();
    bgmInterval = setInterval(playNote, 2000);
  } catch { /* ignore */ }
}

export function stopBGM() {
  bgmPlaying = false;
  if (bgmInterval) {
    clearInterval(bgmInterval);
    bgmInterval = null;
  }
  bgmOscillators.forEach(o => {
    try { o.stop(); } catch { /* ignore */ }
  });
  bgmOscillators = [];
  if (bgmGain) {
    try { bgmGain.disconnect(); } catch { /* ignore */ }
    bgmGain = null;
  }
}

export function isBGMPlaying() {
  return bgmPlaying;
}
