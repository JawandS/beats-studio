import JSZip from 'jszip';
import { useEffect, useRef, useState } from 'react';
import './SongAnalysis.css';

type StemId = 'drums' | 'bass' | 'vocals' | 'other';

type Stem = {
  id: StemId;
  name: string;
  color: string;
  gain: number;
  muted: boolean;
};

type Status = 'idle' | 'processing' | 'ready' | 'playing' | 'error';

const DEFAULT_STEMS: Stem[] = [
  { id: 'drums', name: 'Drums / Perc', color: '#22d3ee', gain: 0.9, muted: false },
  { id: 'bass', name: 'Bass', color: '#f97316', gain: 0.9, muted: false },
  { id: 'vocals', name: 'Vocals', color: '#a855f7', gain: 0.9, muted: false },
  { id: 'other', name: 'Other', color: '#e2e8f0', gain: 0.9, muted: false },
];

const STEM_FILES: Record<StemId, string> = {
  drums: 'drums.wav',
  bass: 'bass.wav',
  vocals: 'vocals.wav',
  other: 'other.wav',
};

const formatSeconds = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';
const STEM_STORAGE_KEY = 'beatstudio_stems_v1';
const ZIP_STORAGE_KEY = 'beatstudio_stems_zip_v1';

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToArrayBuffer = (base64: string) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

const decodeStemsFromZip = async (
  zipBuffer: ArrayBuffer,
  ctx: AudioContext
): Promise<{ decoded: Map<StemId, AudioBuffer>; duration: number | null }> => {
  const zip = await JSZip.loadAsync(zipBuffer);
  const decoded = new Map<StemId, AudioBuffer>();
  let firstDuration: number | null = null;

  for (const stemId of Object.keys(STEM_FILES) as StemId[]) {
    const fileName = STEM_FILES[stemId];
    const file = zip.file(fileName);
    if (!file) continue;
    const audioData = await file.async('arraybuffer');
    const buf = await ctx.decodeAudioData(audioData.slice(0));
    decoded.set(stemId, buf);
    if (firstDuration === null) firstDuration = buf.duration;
  }

  return { decoded, duration: firstDuration };
};

export function SongAnalysis() {
  const [status, setStatus] = useState<Status>('idle');
  const [stems, setStems] = useState<Stem[]>(DEFAULT_STEMS);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [isDecoding, setIsDecoding] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  const [loopCount, setLoopCount] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const progressTimerRef = useRef<number | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const stemBuffersRef = useRef<Map<StemId, AudioBuffer>>(new Map());
  const sourcesRef = useRef<Map<StemId, { source: AudioBufferSourceNode; gain: GainNode }>>(new Map());
  const masterGainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    return () => {
      stopPlayback();
      audioCtxRef.current?.close().catch(() => {});
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const restore = async () => {
      try {
        const cachedZip = localStorage.getItem(ZIP_STORAGE_KEY);
        const cachedLegacy = localStorage.getItem(STEM_STORAGE_KEY);
        const ctx = await ensureContext(false);

        if (cachedZip) {
          const zipBuffer = base64ToArrayBuffer(cachedZip);
          const { decoded, duration: dur } = await decodeStemsFromZip(zipBuffer, ctx);
          if (decoded.size > 0) {
            stemBuffersRef.current = decoded;
            setDuration(dur);
            setStatus('ready');
            setError(null);
            return;
          }
        }

        if (cachedLegacy) {
          const parsed: { stems?: Record<StemId, string> } = JSON.parse(cachedLegacy);
          if (!parsed?.stems) return;
          const decoded = new Map<StemId, AudioBuffer>();
          let firstDuration: number | null = null;
          await Promise.all(
            (Object.keys(parsed.stems) as StemId[]).map(async (stemId) => {
              const buf = base64ToArrayBuffer(parsed.stems![stemId]);
              const audioBuf = await ctx.decodeAudioData(buf.slice(0));
              decoded.set(stemId, audioBuf);
              if (firstDuration === null) firstDuration = audioBuf.duration;
            })
          );
          if (decoded.size > 0) {
            stemBuffersRef.current = decoded;
            setDuration(firstDuration);
            setStatus('ready');
            setError(null);
          }
        }
      } catch {
        // ignore cache errors
      }
    };
    restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureContext = async (resumeAudio = false) => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        throw new Error('Web Audio API not supported in this browser.');
      }
      const ctx = new AudioCtx();
      const master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
      audioCtxRef.current = ctx;
      masterGainRef.current = master;
    }
    if (resumeAudio && audioCtxRef.current?.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    return audioCtxRef.current!;
  };

  const ensureBuffersAvailable = async (ctx: AudioContext) => {
    if (stemBuffersRef.current.size > 0) return;
    const cachedZip = localStorage.getItem(ZIP_STORAGE_KEY);
    if (!cachedZip) return;
    try {
      const zipBuffer = base64ToArrayBuffer(cachedZip);
      const { decoded } = await decodeStemsFromZip(zipBuffer, ctx);
      if (decoded.size > 0) {
        stemBuffersRef.current = decoded;
      }
    } catch {
      /* ignore */
    }
  };

  const handleFileChange = (file: File | null) => {
    if (!file) return;
    setSelectedFile(file);
    setBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setDuration(null);
    setStatus('idle');
    setError(null);
    stemBuffersRef.current.clear();
    setStems(DEFAULT_STEMS);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      setRecordSeconds(0);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], 'recording.webm', { type: 'audio/webm' });
        handleFileChange(file);
        setRecording(false);
        if (recordTimerRef.current) {
          window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      if (recordTimerRef.current) {
        window.clearInterval(recordTimerRef.current);
      }
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      setError('Microphone permission denied or unavailable.');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const analyze = async () => {
    if (!selectedFile) {
      setError('Pick a file or record audio first.');
      return;
    }
    setError(null);
    setIsDecoding(true);
    setStatus('processing');
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const ctx = await ensureContext(true);
      const resp = await fetch(`${API_BASE}/separate`, {
        method: 'POST',
        body: formData,
      });

      if (!resp.ok) {
        let message = `Separation failed (${resp.status})`;
        try {
          const data = await resp.json();
          if (data?.detail) {
            message = Array.isArray(data.detail)
              ? data.detail.map((d: { msg?: string }) => d.msg ?? String(d)).join(', ')
              : data.detail;
          }
        } catch {
          try {
            message = await resp.text();
          } catch {
            /* ignore */
          }
        }
        throw new Error(message);
      }

      const zipBuffer = await resp.arrayBuffer();
      const { decoded: decodedStems, duration: dur } = await decodeStemsFromZip(zipBuffer, ctx);

      if (decodedStems.size === 0) {
        throw new Error('No stems returned from backend.');
      }

      stemBuffersRef.current = decodedStems;
      setDuration(dur ?? null);
      setStatus('ready');

      try {
        localStorage.setItem(ZIP_STORAGE_KEY, arrayBufferToBase64(zipBuffer));
        localStorage.removeItem(STEM_STORAGE_KEY); // drop legacy cache to save space
      } catch {
        // ignore cache failures
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to separate audio.');
      setStatus('error');
    } finally {
      setIsDecoding(false);
    }
  };

  const stopPlayback = () => {
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
    setPlayProgress(0);
    setLoopCount(0);
  };

  const play = async () => {
    const ctx = await ensureContext(true);
    await ensureBuffersAvailable(ctx);
    if (stemBuffersRef.current.size === 0) {
      setError('Analyze with Demucs first.');
      return;
    }
    stopPlayback();
    const master = masterGainRef.current;
    if (!master) return;
    stems.forEach((stem) => {
      const stemBuffer = stemBuffersRef.current.get(stem.id);
      if (!stemBuffer) return;
      const source = ctx.createBufferSource();
      source.buffer = stemBuffer;
      // Loop stems until manually stopped
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = stemBuffer.duration;
      const gain = ctx.createGain();
      gain.gain.value = stem.muted ? 0 : stem.gain;
      source.connect(gain).connect(master);
      source.start();
      sourcesRef.current.set(stem.id, { source, gain });
    });
    const first = stemBuffersRef.current.values().next().value as AudioBuffer;
    if (first && !Number.isNaN(first.duration) && first.duration > 0) {
      const start = ctx.currentTime;
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
      }
      progressTimerRef.current = window.setInterval(() => {
        const elapsed = ctx.currentTime - start;
        const normalized = (elapsed % first.duration) / first.duration;
        setPlayProgress(normalized);
        setLoopCount(Math.floor(elapsed / first.duration));
      }, 200);
    }
    setStatus('playing');
  };

  const stop = () => {
    stopPlayback();
    setStatus(stemBuffersRef.current.size > 0 ? 'ready' : 'idle');
  };

  const updateGain = (id: StemId, gainValue: number) => {
    setStems((prev) =>
      prev.map((stem) => (stem.id === id ? { ...stem, gain: gainValue } : stem))
    );
    const node = sourcesRef.current.get(id)?.gain;
    if (node && audioCtxRef.current) {
      node.gain.setValueAtTime(gainValue, audioCtxRef.current.currentTime);
    }
  };

  const toggleMute = (id: StemId) => {
    setStems((prev) =>
      prev.map((stem) => (stem.id === id ? { ...stem, muted: !stem.muted } : stem))
    );
    const node = sourcesRef.current.get(id)?.gain;
    if (node && audioCtxRef.current) {
      const targetStem = stems.find((s) => s.id === id);
      const nextMuted = targetStem ? !targetStem.muted : false;
      node.gain.setValueAtTime(nextMuted ? 0 : targetStem?.gain ?? 0.9, audioCtxRef.current.currentTime);
    }
  };

  return (
    <section className="analysis">
      <div className="analysis-card">
        <div className="analysis-upload">
          <div className="upload-box">
            <input
              type="file"
              accept="audio/*"
              id="audio-upload"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
            <label htmlFor="audio-upload">
              <strong>Choose audio</strong> or drop a file here
            </label>
            <p className="hint">Supported: wav, mp3, aac, flac</p>
            {selectedFile && (
              <p className="hint">
                Selected: {selectedFile.name}
                {duration ? ` · ${formatSeconds(duration)}` : ''}
              </p>
            )}
          </div>

          <div className="record-row">
            <button
              type="button"
              className={`pill-button ${recording ? 'secondary' : 'primary'}`}
              onClick={recording ? stopRecording : startRecording}
            >
              {recording ? 'Stop recording' : 'Record from mic'}
            </button>
            <div className={`record-indicator ${recording ? 'live' : ''}`}>
              <span />
              {recording ? `Recording… ${formatSeconds(recordSeconds)}` : 'Mic ready'}
            </div>
          </div>

            <div className="analysis-actions">
              <button
                type="button"
                className="pill-button primary"
                onClick={analyze}
                disabled={isDecoding}
              >
                {isDecoding ? 'Analyzing…' : 'Analyze with Demucs'}
              </button>
              <div className="status-chip">
                {status === 'processing' && 'Processing…'}
                {status === 'ready' && 'Stems ready · press play'}
                {status === 'playing' && `Playing stems · loop ${loopCount + 1}`}
                {status === 'idle' && 'Load audio to analyze'}
              </div>
            </div>

            <div className="playback-row">
            <button
              type="button"
              className={`pill-button ${status === 'playing' ? 'secondary' : 'primary'}`}
                onClick={status === 'playing' ? stop : play}
                disabled={stemBuffersRef.current.size === 0 || status === 'processing'}
              >
                {status === 'playing' ? 'Stop playback' : 'Play stems'}
              </button>
              {status === 'playing' && (
                <div className="progress-wrap">
                  <div className="progress-label">Loop {loopCount + 1}</div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${playProgress * 100}%` }} />
                  </div>
                </div>
              )}
              {blobUrl && (
                <audio src={blobUrl} controls className="inline-audio" />
              )}
            </div>

          {error && <div className="error">{error}</div>}
        </div>

        <div className="analysis-notes">
          <h3>Stem mixer</h3>
          <div className="stem-list">
            {stems.map((stem) => (
              <div className="stem-row" key={stem.id}>
                <div className="stem-meta">
                  <span className="stem-chip" style={{ background: stem.color }} />
                  <div>
                    <div className="stem-name">{stem.name}</div>
                    <div className="stem-sub">{stem.id}</div>
                  </div>
                </div>
                <div className="stem-controls">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={stem.gain}
                    onChange={(e) => updateGain(stem.id, Number(e.target.value))}
                  />
                  <button
                    type="button"
                    className={`mute-button ${stem.muted ? 'muted' : ''}`}
                    onClick={() => toggleMute(stem.id)}
                  >
                    {stem.muted ? 'Unmute' : 'Mute'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
