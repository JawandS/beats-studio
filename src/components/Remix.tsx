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
};

const STEM_FILES: Record<StemId, string> = {
  drums: 'drums.wav',
  bass: 'bass.wav',
  vocals: 'vocals.wav',
  other: 'other.wav',
};

const DEFAULT_CONTROLS: StemControl[] = [
  { id: 'drums', gain: 0.9, pitch: 0 },
  { id: 'bass', gain: 0.9, pitch: 0 },
  { id: 'vocals', gain: 0.9, pitch: 0 },
  { id: 'other', gain: 0.9, pitch: 0 },
];

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

export function Remix() {
  const [entries, setEntries] = useState<StoredEntry[]>([]);
  const [sampleEntries, setSampleEntries] = useState<SampleEntry[]>([]);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [controls, setControls] = useState<StemControl[]>(DEFAULT_CONTROLS);
  const [tempo, setTempo] = useState(1);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'playing' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [loopCount, setLoopCount] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const stemBuffersRef = useRef<Map<StemId, AudioBuffer>>(new Map());
  const masterGainRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef<Map<StemId, { source: AudioBufferSourceNode; gain: GainNode }>>(new Map());
  const progressTimerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const tempoRef = useRef<number>(1);

  useEffect(() => {
    return () => {
      stop();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

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
          };
          if (parsed.tempo) setTempo(parsed.tempo);
          if (parsed.controls) setControls(parsed.controls);
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

  const ensureContext = async () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) throw new Error('Web Audio API not supported.');
      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
      audioCtxRef.current = ctx;
      masterGainRef.current = master;
    }
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const stop = () => {
    sourcesRef.current.forEach(({ source }) => {
      try {
        source.stop();
      } catch {
        /* ignore */
      }
    });
    sourcesRef.current.clear();
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
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
      try {
        localStorage.setItem(
          REMIX_STATE_KEY,
          JSON.stringify({ tempo, controls, entryId: id })
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
    if (!master) return;

    controls.forEach((control) => {
      const buffer = stemBuffersRef.current.get(control.id);
      if (!buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
      source.playbackRate.value = pitchToRate(control.pitch) * tempoRef.current;
      const gain = ctx.createGain();
      gain.gain.value = control.gain;
      source.connect(gain).connect(master);
      source.start();
      sourcesRef.current.set(control.id, { source, gain });
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
    stemBuffersRef.current.clear();
    setTempo(1);
    setControls(DEFAULT_CONTROLS);
    setActiveEntryId(null);
    setError(null);
    try {
      localStorage.removeItem(REMIX_STATE_KEY);
    } catch {
      /* ignore */
    }
  };

  const updateControl = (id: StemId, key: keyof StemControl, value: number) => {
    setControls((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, [key]: value };
        const node = sourcesRef.current.get(id);
        if (node && audioCtxRef.current) {
          if (key === 'gain') node.gain.gain.setValueAtTime(value, audioCtxRef.current.currentTime);
          if (key === 'pitch') {
            node.source.playbackRate.setValueAtTime(
              pitchToRate(value) * tempoRef.current,
              audioCtxRef.current.currentTime
            );
          }
        }
        return next;
      })
    );
    try {
      localStorage.setItem(REMIX_STATE_KEY, JSON.stringify({ tempo, controls: controls.map((c) => (c.id === id ? { ...c, [key]: value } : c)), entryId: activeEntryId }));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    tempoRef.current = tempo;
    const ctx = audioCtxRef.current;
    if (status !== 'playing' || !ctx) return;
    sourcesRef.current.forEach(({ source }, id) => {
      const control = controls.find((c) => c.id === id);
      if (!control) return;
      source.playbackRate.setValueAtTime(
        pitchToRate(control.pitch) * tempoRef.current,
        ctx.currentTime
      );
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
                  localStorage.setItem(REMIX_STATE_KEY, JSON.stringify({ tempo, controls, entryId: activeEntryId }));
                } catch {
                  /* ignore */
                }
              }}
              onTouchEnd={() => {
                try {
                  localStorage.setItem(REMIX_STATE_KEY, JSON.stringify({ tempo, controls, entryId: activeEntryId }));
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
            {status === 'playing' && (
              <div className="progress-wrap">
                <div className="progress-label">Loop {loopCount + 1}</div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
                </div>
              </div>
            )}
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
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
