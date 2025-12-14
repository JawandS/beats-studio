import JSZip from 'jszip';
import { useEffect, useRef, useState } from 'react';
import { listStems, loadStemsZip } from '../utils/stemStorage';

type StoredEntry = { id: string; displayName: string; createdAt: number };
type SampleEntry = { id: string; label: string; url: string };
type StemId = 'drums' | 'bass' | 'vocals' | 'other';

type StemControl = {
  id: StemId;
  gain: number;
  pitch: number; // semitones
  pan: number;
  width: number;
  reverbSend: number;
  macros: {
    vocalClean: boolean;
    drumPunch: boolean;
    bassTighten: boolean;
  };
};

type WidthStage = {
  input: GainNode;
  output: ChannelMergerNode;
  setWidth: (value: number) => void;
};

type FilterStage = {
  hp: BiquadFilterNode;
  tone: BiquadFilterNode;
  lp: BiquadFilterNode;
};

type StemNodes = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  width: WidthStage;
  reverbSend: GainNode | null;
  filters: FilterStage;
};

const STEM_FILES: Record<StemId, string> = {
  drums: 'drums.wav',
  bass: 'bass.wav',
  vocals: 'vocals.wav',
  other: 'other.wav',
};

const STEM_IDS: StemId[] = ['drums', 'bass', 'vocals', 'other'];

const DEFAULT_MACROS = {
  vocalClean: false,
  drumPunch: false,
  bassTighten: false,
};

const baseControlForId = (id: StemId): StemControl => ({
  id,
  gain: 0.9,
  pitch: 0,
  pan: 0,
  width: 1,
  reverbSend: 0,
  macros: { ...DEFAULT_MACROS },
});

const normalizeControl = (id: StemId, incoming?: Partial<StemControl>): StemControl => ({
  ...baseControlForId(id),
  ...incoming,
  macros: { ...DEFAULT_MACROS, ...(incoming?.macros ?? {}) },
});

const normalizeControls = (incoming?: StemControl[]): StemControl[] =>
  STEM_IDS.map((id) => {
    const match = incoming?.find((c) => c.id === id);
    return normalizeControl(id, match);
  });

const createDefaultControls = () => normalizeControls();
const DEFAULT_CONTROLS = createDefaultControls();

type PerEntryState = Record<string, { controls: StemControl[]; tempo: number }>;

const decodeStemsFromZip = async (zipBuffer: ArrayBuffer, ctx: AudioContext) => {
  const zip = await JSZip.loadAsync(zipBuffer);
  const decoded = new Map<StemId, AudioBuffer>();
  let duration: number | null = null;

  for (const stemId of Object.keys(STEM_FILES) as StemId[]) {
    const file = zip.file(STEM_FILES[stemId]);
    if (!file) continue;
    const audioData = await file.async('arraybuffer');
    const buf = await ctx.decodeAudioData(audioData.slice(0));
    decoded.set(stemId, buf);
    if (duration === null) duration = buf.duration;
  }
  return { decoded, duration };
};

const pitchToRate = (semitones: number) => 2 ** (semitones / 12);
const REMIX_STATE_KEY = 'beatstudio_remix_state_v1';
const MIN_METER_DB = -60;
type MacroKey = keyof StemControl['macros'];
type StutterRate = 'none' | '1/4' | '1/8';

const playbackRateForControl = (control: StemControl, tempoValue: number) =>
  pitchToRate(control.pitch) * tempoValue;

const encodeWav = (buffer: AudioBuffer) => {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const bufferLength = 44 + numFrames * blockAlign;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numFrames * blockAlign, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, numFrames * blockAlign, true);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch += 1) {
    channelData.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < numFrames; i += 1) {
    for (let ch = 0; ch < numChannels; ch += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return arrayBuffer;
};
const createImpulseResponse = (ctx: BaseAudioContext) => {
  const seconds = 1.5;
  const decay = 2.5;
  const rate = ctx.sampleRate;
  const length = rate * seconds;
  const impulse = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const channelData = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      channelData[i] = (Math.random() * 2 - 1) * Math.exp((-3 * i) / (rate * decay));
    }
  }
  return impulse;
};

const createWidthStage = (ctx: BaseAudioContext, widthAmount: number): WidthStage => {
  const input = ctx.createGain();
  const splitter = ctx.createChannelSplitter(2);
  const inverter = ctx.createGain();
  inverter.gain.value = -1;
  const mid = ctx.createGain();
  mid.gain.value = 0.5;
  const side = ctx.createGain();
  side.gain.value = 0.5;
  const sideAdjust = ctx.createGain();
  sideAdjust.gain.value = widthAmount;
  const sideInvertOut = ctx.createGain();
  sideInvertOut.gain.value = -1;
  const merger = ctx.createChannelMerger(2);

  input.connect(splitter);
  splitter.connect(mid, 0);
  splitter.connect(mid, 1);
  splitter.connect(side, 0);
  splitter.connect(inverter, 1);
  inverter.connect(side);

  side.connect(sideAdjust);

  mid.connect(merger, 0, 0);
  mid.connect(merger, 0, 1);
  sideAdjust.connect(merger, 0, 0);
  sideAdjust.connect(sideInvertOut);
  sideInvertOut.connect(merger, 0, 1);

  return {
    input,
    output: merger,
    setWidth: (value: number) => {
      sideAdjust.gain.value = value;
    },
  };
};

const createFilterStage = (ctx: BaseAudioContext): FilterStage => {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 20;
  hp.Q.value = 0.707;

  const tone = ctx.createBiquadFilter();
  tone.type = 'peaking';
  tone.frequency.value = 1000;
  tone.gain.value = 0;
  tone.Q.value = 0.707;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 20000;
  lp.Q.value = 0.707;

  return { hp, tone, lp };
};

const applyMacroSettings = (control: StemControl, nodes: StemNodes, ctx: BaseAudioContext) => {
  const { macros, id } = control;
  const { hp, tone, lp } = nodes.filters;
  const now = ctx.currentTime;
  // Reset to neutral
  hp.type = 'highpass';
  hp.frequency.setTargetAtTime(20, now, 0.05);
  hp.Q.setTargetAtTime(0.707, now, 0.05);
  tone.type = 'peaking';
  tone.frequency.setTargetAtTime(1000, now, 0.05);
  tone.gain.setTargetAtTime(0, now, 0.05);
  tone.Q.setTargetAtTime(0.707, now, 0.05);
  lp.type = 'lowpass';
  lp.frequency.setTargetAtTime(20000, now, 0.05);
  lp.Q.setTargetAtTime(0.707, now, 0.05);

  if (macros.vocalClean && id === 'vocals') {
    hp.frequency.setTargetAtTime(90, now, 0.05);
    tone.frequency.setTargetAtTime(3200, now, 0.05);
    tone.gain.setTargetAtTime(3, now, 0.05);
  }
  if (macros.drumPunch && id === 'drums') {
    hp.frequency.setTargetAtTime(45, now, 0.05);
    tone.frequency.setTargetAtTime(6000, now, 0.05);
    tone.gain.setTargetAtTime(2, now, 0.05);
  }
  if (macros.bassTighten && id === 'bass') {
    hp.frequency.setTargetAtTime(35, now, 0.05);
    lp.frequency.setTargetAtTime(5000, now, 0.05);
  }
};

export function Remix() {
  const [entries, setEntries] = useState<StoredEntry[]>([]);
  const [sampleEntries, setSampleEntries] = useState<SampleEntry[]>([]);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [controls, setControls] = useState<StemControl[]>(DEFAULT_CONTROLS);
  const [tempo, setTempo] = useState(1);
  const [perEntryControls, setPerEntryControls] = useState<PerEntryState>({});
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'playing' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [loopCount, setLoopCount] = useState(0);
  const [limiterEnabled, setLimiterEnabled] = useState(true);
  const [meterDb, setMeterDb] = useState<number>(MIN_METER_DB);
  const [stutterRate, setStutterRate] = useState<StutterRate>('none');
  const [isBuilding, setIsBuilding] = useState(false);
  const [isTaping, setIsTaping] = useState(false);
  const [isMixingDown, setIsMixingDown] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const stemBuffersRef = useRef<Map<StemId, AudioBuffer>>(new Map());
  const masterGainRef = useRef<GainNode | null>(null);
  const stutterGainRef = useRef<GainNode | null>(null);
  const masterFiltersRef = useRef<{ hp: BiquadFilterNode; lp: BiquadFilterNode } | null>(null);
  const limiterRef = useRef<DynamicsCompressorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const reverbConvolverRef = useRef<ConvolverNode | null>(null);
  const reverbReturnRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef<Map<StemId, StemNodes>>(new Map());
  const progressTimerRef = useRef<number | null>(null);
  const stutterTimerRef = useRef<number | null>(null);
  const tapeTimerRef = useRef<number | null>(null);
  const buildTimerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const tempoRef = useRef<number>(1);
  const limiterEnabledRef = useRef(true);

  const connectMasterChain = (ctx: AudioContext) => {
    const master = masterGainRef.current;
    const stutter = stutterGainRef.current;
    const filters = masterFiltersRef.current;
    const limiter = limiterRef.current;
    const analyser = analyserRef.current;
    const reverbReturn = reverbReturnRef.current;
    if (!master || !analyser || !stutter || !filters) return;

    try {
      master.disconnect();
    } catch {
      /* ignore */
    }
    try {
      reverbReturn?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      limiter?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      analyser.disconnect();
    } catch {
      /* ignore */
    }
    try {
      stutter.disconnect();
    } catch {
      /* ignore */
    }
    try {
      filters.hp.disconnect();
      filters.lp.disconnect();
    } catch {
      /* ignore */
    }

    if (reverbReturn) {
      reverbReturn.connect(master);
    }
    master.connect(stutter);
    stutter.connect(filters.hp);
    filters.hp.connect(filters.lp);
    if (limiter && limiterEnabledRef.current) {
      filters.lp.connect(limiter);
      limiter.connect(analyser);
    } else {
      filters.lp.connect(analyser);
    }
    analyser.connect(ctx.destination);
  };

  useEffect(() => {
    return () => {
      stop();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  useEffect(() => {
    limiterEnabledRef.current = limiterEnabled;
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') return;
    connectMasterChain(ctx);
  }, [limiterEnabled]);

  useEffect(() => {
    const hydrate = async () => {
      const stored = await listStems();
      setEntries(stored);

      try {
        const raw = localStorage.getItem(REMIX_STATE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            tempo?: number;
            controls?: StemControl[];
            entryId?: string | null;
            perEntryControls?: Record<string, { controls: StemControl[]; tempo: number }>;
          };
          if (parsed.perEntryControls) {
            const normalizedPerEntry = Object.entries(parsed.perEntryControls).reduce<PerEntryState>(
              (acc, [key, value]) => {
                if (!value) return acc;
                acc[key] = {
                  controls: normalizeControls(value.controls),
                  tempo: value.tempo ?? 1,
                };
                return acc;
              },
              {}
            );
            setPerEntryControls(normalizedPerEntry);
          }
          if (parsed.tempo) setTempo(parsed.tempo);
          if (parsed.controls) setControls(normalizeControls(parsed.controls));
          if (parsed.entryId) setActiveEntryId(parsed.entryId);
        }
      } catch {
        /* ignore */
      }
    };
    hydrate();
  }, []);

  useEffect(() => {
    const loadManifest = async () => {
      try {
        const resp = await fetch('/sample-stems/manifest.json', { cache: 'no-cache' });
        if (!resp.ok) return;
        const data = (await resp.json()) as SampleEntry[];
        setSampleEntries(Array.isArray(data) ? data : []);
      } catch {
        // ignore
      }
    };
    loadManifest();
  }, []);

  useEffect(() => {
    const analyser = analyserRef.current;
    if (!analyser || (status !== 'playing' && status !== 'ready')) {
      setMeterDb(MIN_METER_DB);
      return;
    }
    const buffer = new Uint8Array(analyser.fftSize);
    let rafId = 0;
    const update = () => {
      analyser.getByteTimeDomainData(buffer);
      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const v = (buffer[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / buffer.length);
      const db = 20 * Math.log10(rms || 1e-8);
      setMeterDb(Math.max(MIN_METER_DB, db));
      rafId = window.requestAnimationFrame(update);
    };
    rafId = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(rafId);
  }, [status]);

  const ensureContext = async () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) throw new Error('Web Audio API not supported.');
      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = 1;
      audioCtxRef.current = ctx;
      masterGainRef.current = master;
    }

    const ctx = audioCtxRef.current!;
    if (!masterGainRef.current) {
      masterGainRef.current = ctx.createGain();
      masterGainRef.current.gain.value = 1;
    }
    if (!stutterGainRef.current) {
      stutterGainRef.current = ctx.createGain();
      stutterGainRef.current.gain.value = 1;
    }
    if (!masterFiltersRef.current) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 20;
      hp.Q.value = 0.707;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 20000;
      lp.Q.value = 0.707;
      masterFiltersRef.current = { hp, lp };
    }

    if (!limiterRef.current || !analyserRef.current || !reverbConvolverRef.current || !reverbReturnRef.current) {
      const master = masterGainRef.current;
      const limiter = limiterRef.current ?? ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 30;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;

      const analyser = analyserRef.current ?? ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;

      const reverb = reverbConvolverRef.current ?? ctx.createConvolver();
      if (!reverb.buffer) {
        reverb.buffer = createImpulseResponse(ctx);
      }
      const reverbReturn = reverbReturnRef.current ?? ctx.createGain();
      reverbReturn.gain.value = 0.35;

      reverb.connect(reverbReturn);

      limiterRef.current = limiter;
      analyserRef.current = analyser;
      reverbConvolverRef.current = reverb;
      reverbReturnRef.current = reverbReturn;
    }

    connectMasterChain(ctx);

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ctx;
  };

  const stopStutter = () => {
    if (stutterTimerRef.current) {
      window.clearInterval(stutterTimerRef.current);
      stutterTimerRef.current = null;
    }
    setStutterRate('none');
    const stutter = stutterGainRef.current;
    if (stutter && audioCtxRef.current) {
      stutter.gain.setValueAtTime(1, audioCtxRef.current.currentTime);
    }
  };

  const clearAutomation = () => {
    stopStutter();
    setIsBuilding(false);
    setIsTaping(false);
    if (tapeTimerRef.current) {
      window.clearTimeout(tapeTimerRef.current);
      tapeTimerRef.current = null;
    }
    if (buildTimerRef.current) {
      window.clearTimeout(buildTimerRef.current);
      buildTimerRef.current = null;
    }
  };

  const triggerBuild = () => {
    const ctx = audioCtxRef.current;
    const filters = masterFiltersRef.current;
    if (!ctx || !filters) return;
    const now = ctx.currentTime;
    const sweepDuration = 2;
    const releaseDuration = 0.5;
    setIsBuilding(true);
    filters.lp.frequency.cancelScheduledValues(now);
    filters.hp.frequency.cancelScheduledValues(now);
    filters.lp.frequency.setValueAtTime(filters.lp.frequency.value, now);
    filters.hp.frequency.setValueAtTime(filters.hp.frequency.value, now);
    filters.lp.frequency.linearRampToValueAtTime(500, now + sweepDuration);
    filters.hp.frequency.linearRampToValueAtTime(180, now + sweepDuration);
    filters.lp.frequency.linearRampToValueAtTime(20000, now + sweepDuration + releaseDuration);
    filters.hp.frequency.linearRampToValueAtTime(20, now + sweepDuration + releaseDuration);
    if (buildTimerRef.current) window.clearTimeout(buildTimerRef.current);
    buildTimerRef.current = window.setTimeout(() => setIsBuilding(false), (sweepDuration + releaseDuration) * 1000);
  };

  const triggerTape = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const stopDuration = 0.7;
    const holdDuration = 0.2;
    const resumeDuration = 0.6;
    const now = ctx.currentTime;
    setIsTaping(true);
    sourcesRef.current.forEach((nodes, id) => {
      const control = controls.find((c) => c.id === id);
      if (!control) return;
      const targetRate = playbackRateForControl(control, tempoRef.current);
      nodes.source.playbackRate.cancelScheduledValues(now);
      nodes.source.playbackRate.setValueAtTime(nodes.source.playbackRate.value, now);
      nodes.source.playbackRate.linearRampToValueAtTime(0.01, now + stopDuration);
      nodes.source.playbackRate.linearRampToValueAtTime(targetRate, now + stopDuration + holdDuration + resumeDuration);
    });
    if (tapeTimerRef.current) window.clearTimeout(tapeTimerRef.current);
    tapeTimerRef.current = window.setTimeout(
      () => setIsTaping(false),
      (stopDuration + holdDuration + resumeDuration) * 1000
    );
  };

  const startStutter = (rate: Exclude<StutterRate, 'none'>) => {
    const stutter = stutterGainRef.current;
    const ctx = audioCtxRef.current;
    if (!stutter || !ctx) return;
    if (stutterTimerRef.current) {
      window.clearInterval(stutterTimerRef.current);
      stutterTimerRef.current = null;
    }
    const intervalMs = rate === '1/4' ? 250 : 125;
    setStutterRate(rate);
    stutterTimerRef.current = window.setInterval(() => {
      const now = ctx.currentTime;
      stutter.gain.cancelScheduledValues(now);
      stutter.gain.setValueAtTime(0, now);
      stutter.gain.linearRampToValueAtTime(1, now + 0.05);
    }, intervalMs);
  };

  const toggleStutter = (rate: Exclude<StutterRate, 'none'>) => {
    if (stutterRate === rate) {
      stopStutter();
      return;
    }
    startStutter(rate);
  };

  const stop = () => {
    sourcesRef.current.forEach(({ source, gain, pan, width, reverbSend, filters }) => {
      try {
        source.stop();
      } catch {
        /* ignore */
      }
      try {
        source.disconnect();
        gain.disconnect();
        pan.disconnect();
        width.input.disconnect();
        width.output.disconnect();
        reverbSend?.disconnect();
        filters.hp.disconnect();
        filters.tone.disconnect();
        filters.lp.disconnect();
      } catch {
        /* ignore */
      }
    });
    sourcesRef.current.clear();
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    clearAutomation();
    setProgress(0);
    setLoopCount(0);
    startTimeRef.current = 0;
    setStatus(stemBuffersRef.current.size > 0 ? 'ready' : 'idle');
  };

  const loadEntry = async (id: string, zipBuffer: ArrayBuffer) => {
    setStatus('loading');
    setError(null);
    try {
      const ctx = await ensureContext();
      const { decoded } = await decodeStemsFromZip(zipBuffer, ctx);
      if (decoded.size === 0) throw new Error('No stems found in zip.');
      stemBuffersRef.current = decoded;
      setActiveEntryId(id);
      const nextControls = normalizeControls(perEntryControls[id]?.controls ?? controls);
      const nextTempo = perEntryControls[id]?.tempo ?? tempo;
      setControls(nextControls);
      setTempo(nextTempo);
      const updatedPerEntry: PerEntryState = { ...perEntryControls, [id]: { controls: nextControls, tempo: nextTempo } };
      setPerEntryControls(updatedPerEntry);
      try {
        localStorage.setItem(
          REMIX_STATE_KEY,
          JSON.stringify({ tempo: nextTempo, controls: nextControls, entryId: id, perEntryControls: updatedPerEntry })
        );
      } catch {
        /* ignore */
      }
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stems.');
      setStatus('error');
    }
  };

  const play = async () => {
    if (stemBuffersRef.current.size === 0) {
      setError('Pick a stem set first.');
      return;
    }
    const ctx = await ensureContext();
    stop();
    const master = masterGainRef.current;
    const reverbNode = reverbConvolverRef.current;
    if (!master) return;

    controls.forEach((control) => {
      const buffer = stemBuffersRef.current.get(control.id);
      if (!buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
      source.playbackRate.value = playbackRateForControl(control, tempoRef.current);
      const gain = ctx.createGain();
      gain.gain.value = control.gain;
      const pan = ctx.createStereoPanner();
      pan.pan.value = control.pan;
      const widthStage = createWidthStage(ctx, control.width);
      const filters = createFilterStage(ctx);
      const reverbSend = reverbNode ? ctx.createGain() : null;
      if (reverbSend) reverbSend.gain.value = control.reverbSend;

      source.connect(filters.hp).connect(filters.tone).connect(filters.lp).connect(gain).connect(pan).connect(widthStage.input);
      widthStage.output.connect(master);
      if (reverbSend && reverbNode) {
        widthStage.output.connect(reverbSend);
        reverbSend.connect(reverbNode);
      }
      applyMacroSettings(control, { source, gain, pan, width: widthStage, reverbSend, filters }, ctx);
      source.start();
      sourcesRef.current.set(control.id, { source, gain, pan, width: widthStage, reverbSend, filters });
    });

    const first = stemBuffersRef.current.values().next().value as AudioBuffer;
    if (first && first.duration > 0) {
      startTimeRef.current = ctx.currentTime;
      progressTimerRef.current = window.setInterval(() => {
        const elapsed = ctx.currentTime - startTimeRef.current;
        const scaledDuration = first.duration / tempoRef.current;
        const normalized = scaledDuration > 0 ? (elapsed % scaledDuration) / scaledDuration : 0;
        setProgress(normalized);
        setLoopCount(scaledDuration > 0 ? Math.floor(elapsed / scaledDuration) : 0);
      }, 200);
    }
    setStatus('playing');
  };

  const resetAll = () => {
    stop();
    const nextControls = createDefaultControls();
    const nextTempo = 1;
    setControls(nextControls);
    setTempo(nextTempo);
    if (activeEntryId) {
      const updatedPerEntry: PerEntryState = { ...perEntryControls, [activeEntryId]: { controls: nextControls, tempo: nextTempo } };
      setPerEntryControls(updatedPerEntry);
      try {
        localStorage.setItem(
          REMIX_STATE_KEY,
          JSON.stringify({
            tempo: nextTempo,
            controls: nextControls,
            entryId: activeEntryId,
            perEntryControls: updatedPerEntry,
          })
        );
      } catch {
        /* ignore */
      }
    } else {
      try {
        localStorage.setItem(
          REMIX_STATE_KEY,
          JSON.stringify({
            tempo: nextTempo,
            controls: nextControls,
            entryId: activeEntryId,
            perEntryControls,
          })
        );
      } catch {
        /* ignore */
      }
    }
    setError(null);
  };

  const updateControl = (id: StemId, key: 'gain' | 'pitch' | 'pan' | 'width' | 'reverbSend', value: number) => {
    const nextControls = controls.map((c) => (c.id === id ? { ...c, [key]: value } : c));
    setControls(nextControls);
    const node = sourcesRef.current.get(id);
    if (node && audioCtxRef.current) {
      if (key === 'gain') node.gain.gain.setValueAtTime(value, audioCtxRef.current.currentTime);
      if (key === 'pan') node.pan.pan.setValueAtTime(value, audioCtxRef.current.currentTime);
      if (key === 'width') node.width.setWidth(value);
      if (key === 'reverbSend' && node.reverbSend) {
        node.reverbSend.gain.setValueAtTime(value, audioCtxRef.current.currentTime);
      }
      if (key === 'pitch') {
        node.source.playbackRate.setValueAtTime(
          pitchToRate(nextControls.find((c) => c.id === id)?.pitch ?? 0) * tempoRef.current,
          audioCtxRef.current.currentTime
        );
      }
      applyMacroSettings(
        nextControls.find((c) => c.id === id) ?? normalizeControl(id),
        node,
        audioCtxRef.current
      );
    }

    const updatedPerEntry = activeEntryId
      ? { ...perEntryControls, [activeEntryId]: { controls: nextControls, tempo } }
      : perEntryControls;
    setPerEntryControls(updatedPerEntry);
    try {
      localStorage.setItem(
        REMIX_STATE_KEY,
        JSON.stringify({ tempo, controls: nextControls, entryId: activeEntryId, perEntryControls: updatedPerEntry })
      );
    } catch {
      /* ignore */
    }
  };

  const toggleMacro = (id: StemId, macro: MacroKey) => {
    const nextControls = controls.map((c) =>
      c.id === id ? { ...c, macros: { ...c.macros, [macro]: !c.macros[macro] } } : c
    );
    setControls(nextControls);
    const node = sourcesRef.current.get(id);
    if (node && audioCtxRef.current) {
      const control = nextControls.find((c) => c.id === id);
      if (control) applyMacroSettings(control, node, audioCtxRef.current);
    }

    const updatedPerEntry = activeEntryId
      ? { ...perEntryControls, [activeEntryId]: { controls: nextControls, tempo } }
      : perEntryControls;
    setPerEntryControls(updatedPerEntry);
    try {
      localStorage.setItem(
        REMIX_STATE_KEY,
        JSON.stringify({ tempo, controls: nextControls, entryId: activeEntryId, perEntryControls: updatedPerEntry })
      );
    } catch {
      /* ignore */
    }
  };

  const mixdown = async () => {
    if (stemBuffersRef.current.size === 0) {
      setError('Pick a stem set first.');
      return;
    }
    const first = stemBuffersRef.current.values().next().value as AudioBuffer;
    if (!first) return;
    setIsMixingDown(true);
    setError(null);
    try {
      const sampleRate = first.sampleRate;
      const durationSeconds = first.duration / Math.max(tempoRef.current, 0.001);
      const length = Math.ceil(durationSeconds * sampleRate);
      const offline = new OfflineAudioContext(2, length, sampleRate);
      const master = offline.createGain();
      master.gain.value = 1;
      const reverb = offline.createConvolver();
      reverb.buffer = createImpulseResponse(offline);
      const reverbReturn = offline.createGain();
      reverbReturn.gain.value = 0.35;
      reverb.connect(reverbReturn).connect(master);

      controls.forEach((control) => {
        const buffer = stemBuffersRef.current.get(control.id);
        if (!buffer) return;
        const source = offline.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.loopStart = 0;
        source.loopEnd = buffer.duration;
        source.playbackRate.value = playbackRateForControl(control, tempoRef.current);

        const gain = offline.createGain();
        gain.gain.value = control.gain;
        const pan = offline.createStereoPanner();
        pan.pan.value = control.pan;
        const width = createWidthStage(offline, control.width);
        const filters = createFilterStage(offline);
        const reverbSend = control.reverbSend > 0 ? offline.createGain() : null;
        if (reverbSend) reverbSend.gain.value = control.reverbSend;

        source.connect(filters.hp).connect(filters.tone).connect(filters.lp).connect(gain).connect(pan).connect(width.input);
        width.output.connect(master);
        if (reverbSend) {
          width.output.connect(reverbSend);
          reverbSend.connect(reverb);
        }

        applyMacroSettings(control, { source, gain, pan, width, reverbSend, filters }, offline);
        source.start();
      });

      master.connect(offline.destination);
      const rendered = await offline.startRendering();
      const wavBuffer = encodeWav(rendered);
      const blob = new Blob([wavBuffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'remix.wav';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mix down.');
    } finally {
      setIsMixingDown(false);
    }
  };

  useEffect(() => {
    tempoRef.current = tempo;
    const ctx = audioCtxRef.current;
    if (status !== 'playing' || !ctx) return;
    sourcesRef.current.forEach(({ source, pan, width, reverbSend }, id) => {
      const control = controls.find((c) => c.id === id);
      if (!control) return;
      source.playbackRate.setValueAtTime(playbackRateForControl(control, tempoRef.current), ctx.currentTime);
      pan.pan.setValueAtTime(control.pan, ctx.currentTime);
      width.setWidth(control.width);
      if (reverbSend) reverbSend.gain.setValueAtTime(control.reverbSend, ctx.currentTime);
    });
  }, [tempo, status, controls]);

  return (
    <section className="analysis">
      <div className="analysis-card">
        <div className="analysis-upload">
          <div className="saved-select">
            <label htmlFor="remix-samples">Sample stems (one at a time)</label>
            <select
              id="remix-samples"
              value={activeEntryId?.startsWith('sample:') ? activeEntryId : ''}
              onChange={async (e) => {
                const nextId = e.target.value;
                if (!nextId) return;
                const sample = sampleEntries.find((s) => `sample:${s.id}` === nextId);
                if (!sample) return;
                const resp = await fetch(sample.url);
                if (!resp.ok) {
                  setError('Failed to fetch sample stems.');
                  return;
                }
                const zip = await resp.arrayBuffer();
                await loadEntry(`sample:${sample.id}`, zip);
              }}
            >
              <option value="">Pick sample…</option>
              {sampleEntries.map((sample) => (
                <option key={sample.id} value={`sample:${sample.id}`}>
                  {sample.label}
                </option>
              ))}
            </select>
          </div>

          <div className="saved-select">
            <label htmlFor="remix-saved">Saved stems</label>
            <select
              id="remix-saved"
              value={activeEntryId?.startsWith('saved:') ? activeEntryId : ''}
              onChange={async (e) => {
                const nextId = e.target.value;
                if (!nextId) return;
                const record = await loadStemsZip(nextId.replace('saved:', ''));
                if (!record) {
                  setError('Stems not found.');
                  return;
                }
                await loadEntry(`saved:${record.id}`, record.zip);
              }}
            >
              <option value="">Select stems…</option>
              {entries.map((entry) => (
                <option key={entry.id} value={`saved:${entry.id}`}>
                  {entry.displayName} · {new Date(entry.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </div>

          <div className="playback-row">
            <div className="control-block">
              <label>Tempo x</label>
              <input
                type="range"
                min={0.5}
                max={1.5}
                step={0.01}
                value={tempo}
                onChange={(e) => setTempo(Number(e.target.value))}
                onMouseUp={() => {
                  try {
                    const updatedPerEntry = activeEntryId
                      ? { ...perEntryControls, [activeEntryId]: { controls, tempo } }
                      : perEntryControls;
                    localStorage.setItem(
                      REMIX_STATE_KEY,
                      JSON.stringify({ tempo, controls, entryId: activeEntryId, perEntryControls: updatedPerEntry })
                    );
                  } catch {
                    /* ignore */
                  }
                }}
                onTouchEnd={() => {
                  try {
                    const updatedPerEntry = activeEntryId
                      ? { ...perEntryControls, [activeEntryId]: { controls, tempo } }
                      : perEntryControls;
                    localStorage.setItem(
                      REMIX_STATE_KEY,
                      JSON.stringify({ tempo, controls, entryId: activeEntryId, perEntryControls: updatedPerEntry })
                    );
                  } catch {
                    /* ignore */
                  }
                }}
              />
            </div>
            <button
              type="button"
              className={`pill-button ${status === 'playing' ? 'secondary' : 'primary'}`}
              onClick={status === 'playing' ? stop : play}
              disabled={status === 'loading'}
            >
              {status === 'playing' ? 'Stop' : 'Play'}
            </button>
            <button type="button" className="pill-button secondary" onClick={resetAll}>
              Reset
            </button>
            {status === 'playing' && (
              <div className="progress-wrap">
                <div className="progress-label">Loop {loopCount + 1}</div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
                </div>
              </div>
            )}
          </div>

          <div className="playback-row">
            <div className="control-block">
              <label>Limiter</label>
              <button
                type="button"
                className={`pill-button ${limiterEnabled ? 'secondary' : 'primary'}`}
                onClick={() => setLimiterEnabled((prev) => !prev)}
              >
                {limiterEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="meter-wrap">
              <div className="meter-label">Output</div>
              <div className="meter-bar">
                <div
                  className="meter-fill"
                  style={{ width: `${Math.max(0, Math.min(100, ((meterDb - MIN_METER_DB) / -MIN_METER_DB) * 100))}%` }}
                />
              </div>
              <div className="meter-read">{`${meterDb.toFixed(1)} dB`}</div>
            </div>
          </div>

          <div className="playback-row automation-row">
            <button type="button" className="pill-button secondary" onClick={triggerBuild} disabled={status === 'loading'}>
              {isBuilding ? 'Build (active)' : 'Build sweep'}
            </button>
            <button type="button" className="pill-button secondary" onClick={triggerTape} disabled={status === 'loading'}>
              {isTaping ? 'Tape…' : 'Tape stop/start'}
            </button>
            <div className="control-block">
              <label>Stutter</label>
              <div className="macro-buttons">
                <button
                  type="button"
                  className={`pill-button ${stutterRate === '1/4' ? 'secondary' : 'primary'}`}
                  onClick={() => toggleStutter('1/4')}
                  disabled={status === 'loading'}
                >
                  1/4
                </button>
                <button
                  type="button"
                  className={`pill-button ${stutterRate === '1/8' ? 'secondary' : 'primary'}`}
                  onClick={() => toggleStutter('1/8')}
                  disabled={status === 'loading'}
                >
                  1/8
                </button>
                <button type="button" className="pill-button secondary" onClick={stopStutter} disabled={status === 'loading'}>
                  Clear
                </button>
              </div>
            </div>
            <button
              type="button"
              className="pill-button primary"
              onClick={mixdown}
              disabled={isMixingDown || stemBuffersRef.current.size === 0 || status === 'loading'}
            >
              {isMixingDown ? 'Mixing…' : 'Mixdown to WAV'}
            </button>
          </div>

          {error && <div className="error">{error}</div>}
        </div>

        <div className="analysis-notes">
          <h3>Stem controls</h3>
          <div className="stem-list">
            {controls.map((c) => (
              <div className="stem-row" key={c.id}>
                <div className="stem-meta">
                  <span className="stem-chip" />
                  <div>
                    <div className="stem-name">{c.id}</div>
                    <div className="stem-sub">vol/pitch</div>
                  </div>
                </div>
                <div className="stem-controls">
                  <div className="control-block">
                    <label>Vol</label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={c.gain}
                      onChange={(e) => updateControl(c.id, 'gain', Number(e.target.value))}
                    />
                  </div>
                  <div className="control-block">
                    <label>Pitch (st)</label>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={1}
                      value={c.pitch}
                      onChange={(e) => updateControl(c.id, 'pitch', Number(e.target.value))}
                    />
                  </div>
                  <div className="control-block">
                    <label>Pan</label>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.01}
                      value={c.pan}
                      onChange={(e) => updateControl(c.id, 'pan', Number(e.target.value))}
                    />
                  </div>
                  <div className="control-block">
                    <label>Width</label>
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.01}
                      value={c.width}
                      onChange={(e) => updateControl(c.id, 'width', Number(e.target.value))}
                    />
                  </div>
                  <div className="control-block">
                    <label>Verb</label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={c.reverbSend}
                      onChange={(e) => updateControl(c.id, 'reverbSend', Number(e.target.value))}
                    />
                  </div>
                  <div className="control-block macro-block">
                    <label>Macros</label>
                    <div className="macro-buttons">
                      <button
                        type="button"
                        className={`pill-button ${c.macros.vocalClean ? 'secondary' : 'primary'}`}
                        onClick={() => toggleMacro(c.id, 'vocalClean')}
                      >
                        Vocal clean
                      </button>
                      <button
                        type="button"
                        className={`pill-button ${c.macros.drumPunch ? 'secondary' : 'primary'}`}
                        onClick={() => toggleMacro(c.id, 'drumPunch')}
                      >
                        Drum punch
                      </button>
                      <button
                        type="button"
                        className={`pill-button ${c.macros.bassTighten ? 'secondary' : 'primary'}`}
                        onClick={() => toggleMacro(c.id, 'bassTighten')}
                      >
                        Bass tight
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
