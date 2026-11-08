/**
 * Lazy WebAudio gateway for the singing bowl.
 *
 * Same rules as `loadMotion()`: nothing touches `window` at module scope (the
 * landing page is prerendered), the AudioContext is only built on the gesture
 * that asks for it, and the note is synthesised — there is no audio file to
 * download and nothing to decode before the first strike.
 */

export interface BowlVoice {
  /** Strikes the bowl `delay` seconds from now; negative values are ignored. */
  strike(delay?: number): void;
  /** Silences the bowl (or brings it back) and remembers the choice. */
  setMuted(muted: boolean): void;
  /** How long a strike keeps ringing, in seconds. */
  readonly ringTime: number;
  dispose(): void;
}

const MUTE_KEY = 'momkari:bowl-muted';

/** The note the bowl answers with, in Hz. */
const FUNDAMENTAL = 233;

/**
 * Where bronze really rings: a struck bowl has an *inharmonic* spectrum, not a
 * harmonic series. These ratios are what make it read as a bell instead of a
 * synth pad. `decay` is in seconds; the high partials die first.
 */
const PARTIALS = [
  { ratio: 1, gain: 0.5, decay: 4.2 },
  { ratio: 2.76, gain: 0.26, decay: 2.6 },
  { ratio: 5.4, gain: 0.13, decay: 1.5 },
  { ratio: 8.93, gain: 0.06, decay: 0.9 },
];

/** Two oscillators per partial, detuned: the slow beating of a real bowl. */
const DETUNE = 0.0035;
/** Strikes allowed to ring at once, so a frantic tapper cannot clip the mix. */
const MAX_VOICES = 3;

let pending: Promise<BowlVoice | undefined> | undefined;

/** Reads the saved preference; safe to call before the AudioContext exists. */
export function bowlStartsMuted(): boolean {
  return typeof window === 'undefined' ? false : readMuted();
}

/** Loads (once) the bowl voice; resolves to `undefined` if WebAudio is missing. */
export function loadBowlSound(): Promise<BowlVoice | undefined> {
  pending ??= createBowl().catch(() => undefined);
  return pending;
}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const legacy = (window as unknown as { webkitAudioContext?: AudioContextCtor })
    .webkitAudioContext;
  return window.AudioContext ?? legacy;
}

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Private mode: the choice simply does not survive the reload.
  }
}

/** White noise burst of `seconds`, used for the mallet click. */
function noise(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/** Decaying stereo noise: a small, soft room for the bowl to ring in. */
function impulse(context: AudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const fade = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * fade * fade * fade;
    }
  }
  return buffer;
}

async function createBowl(): Promise<BowlVoice | undefined> {
  const Ctor = audioContextCtor();
  if (!Ctor) {
    return undefined;
  }

  const context = new Ctor();

  const reverb = context.createConvolver();
  reverb.buffer = impulse(context, 1.4);

  const dry = context.createGain();
  dry.gain.value = 0.8;
  const wet = context.createGain();
  wet.gain.value = 0.32;

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.ratio.value = 4;

  const master = context.createGain();
  const level = 0.55;

  dry.connect(master);
  reverb.connect(wet);
  wet.connect(master);
  master.connect(compressor);
  compressor.connect(context.destination);

  const ringTime = PARTIALS[0].decay;
  let muted = readMuted();
  master.gain.value = muted ? 0 : level;
  let ringing = 0;

  const strike = (delay = 0): void => {
    if (muted || ringing >= MAX_VOICES) {
      return;
    }
    // Safari and Chrome both need the context nudged inside the gesture.
    if (context.state === 'suspended') {
      void context.resume();
    }

    const start = context.currentTime + Math.max(0, delay);
    ringing++;

    const body = context.createGain();
    body.connect(dry);
    body.connect(reverb);

    for (const partial of PARTIALS) {
      for (const side of [-1, 1]) {
        const oscillator = context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = FUNDAMENTAL * partial.ratio * (1 + side * DETUNE);

        const envelope = context.createGain();
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(partial.gain * 0.5, start + 0.006);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + partial.decay);

        oscillator.connect(envelope);
        envelope.connect(body);
        oscillator.start(start);
        oscillator.stop(start + partial.decay + 0.05);
      }
    }

    // The mallet itself: a very short, bright click of wood on bronze.
    const click = context.createBufferSource();
    click.buffer = noise(context, 0.04);
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2600;
    band.Q.value = 1.1;
    const clickEnvelope = context.createGain();
    clickEnvelope.gain.setValueAtTime(0.45, start);
    clickEnvelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.04);
    click.connect(band);
    band.connect(clickEnvelope);
    clickEnvelope.connect(body);
    click.start(start);
    click.stop(start + 0.05);

    window.setTimeout(
      () => {
        ringing = Math.max(0, ringing - 1);
        body.disconnect();
      },
      (ringTime + 0.6) * 1000,
    );
  };

  const setMuted = (value: boolean): void => {
    muted = value;
    writeMuted(value);
    master.gain.setTargetAtTime(value ? 0 : level, context.currentTime, 0.05);
  };

  const dispose = (): void => {
    if (context.state !== 'closed') {
      void context.close();
    }
  };

  return { strike, setMuted, ringTime, dispose };
}
