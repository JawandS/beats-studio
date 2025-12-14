import JSZip from 'jszip';
import { useEffect, useRef, useState } from 'react';
import { listStems, loadStemsZip, saveStemsZip } from '../utils/stemStorage';
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
type StoredEntry = { id: string; displayName: string; createdAt: number };
type SampleEntry = { id: string; label: string; url: string };

const DEFAULT_STEMS: Stem[] = [
  { id: 'drums', name: 'Drums / Perc', color: '#8B5CF6', gain: 0.9, muted: false },
  { id: 'bass', name: 'Bass', color: '#EC4899', gain: 0.9, muted: false },
  { id: 'vocals', name: 'Vocals', color: '#A855F7', gain: 0.9, muted: false },
  { id: 'other', name: 'Other', color: '#C084FC', gain: 0.9, muted: false },
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
  const [serverAvailable, setServerAvailable] = useState(true);
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
  const [entries, setEntries] = useState<StoredEntry[]>([]);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [sampleEntries, setSampleEntries] = useState<SampleEntry[]>([]);
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
      audioCtxRef.current?.close().catch(() => { });
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const restore = async () => {
      try {
        const stored = await listStems();
        setEntries(stored);
        if (stored.length === 0) return;
        const latest = stored[0];
        setActiveEntryId(latest.id);
        const record = await loadStemsZip(latest.id);
        if (!record) return;
        const ctx = await ensureContext(false);
        const { decoded, duration: dur } = await decodeStemsFromZip(record.zip, ctx);
        if (decoded.size > 0) {
          stemBuffersRef.current = decoded;
          setDuration(dur);
          setStatus('ready');
          setError(null);
        }
      } catch {
        // ignore cache errors
      }
    };
    restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const checkServer = async () => {
      try {
        // Try to hit the health endpoint or root
        const resp = await fetch(`${API_BASE}/health`);
        setServerAvailable(resp.ok);
      } catch {
        setServerAvailable(false);
      }
    };
    checkServer();
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
    if (!activeEntryId) return;
    const cached = await loadStemsZip(activeEntryId);
    if (!cached) return;
    try {
      const { decoded } = await decodeStemsFromZip(cached.zip, ctx);
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
    setActiveEntryId(null);
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

      const entryId =
        selectedFile?.name && selectedFile.name !== 'recording.webm'
          ? selectedFile.name
          : `recording-${Date.now()}`;
      const displayName =
        selectedFile?.name && selectedFile.name !== 'recording.webm'
          ? selectedFile.name
          : `Mic recording ${new Date().toLocaleTimeString()}`;

      await saveStemsZip(entryId, displayName, zipBuffer);
      const stored = await listStems();
      setEntries(stored);
      setActiveEntryId(entryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to separate audio.');
      setStatus('error');
    } finally {
      setIsDecoding(false);
    }
  };

  const loadSample = async (entry: SampleEntry) => {
    setError(null);
    setIsDecoding(true);
    setStatus('processing');
    try {
      const ctx = await ensureContext(true);
      const resp = await fetch(entry.url);
      if (!resp.ok) {
        throw new Error(`Failed to fetch sample (${resp.status})`);
      }
      const zipBuffer = await resp.arrayBuffer();
      const { decoded: decodedStems, duration: dur } = await decodeStemsFromZip(zipBuffer, ctx);

      if (decodedStems.size === 0) {
        throw new Error('No stems in sample zip.');
      }

      stemBuffersRef.current = decodedStems;
      setDuration(dur ?? null);
      setStatus('ready');

      await saveStemsZip(entry.id, entry.label, zipBuffer);
      const stored = await listStems();
      setEntries(stored);
      setActiveEntryId(entry.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sample stems.');
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
          {/* Step 1: Audio Source */}
          <div className="source-section">
            <div className="section-header">
              <span className="section-number">1</span>
              <span className="section-title">Audio Source</span>
            </div>

            {/* Quick load options */}
            {(sampleEntries.length > 0 || entries.length > 0) && (
              <div className="quick-load">
                {sampleEntries.length > 0 && (
                  <select
                    className="source-select"
                    defaultValue=""
                    onChange={async (e) => {
                      const nextId = e.target.value;
                      if (!nextId) return;
                      const sample = sampleEntries.find((s) => s.id === nextId);
                      if (sample) await loadSample(sample);
                    }}
                  >
                    <option value="">Load sample...</option>
                    {sampleEntries.map((sample) => (
                      <option key={sample.id} value={sample.id}>{sample.label}</option>
                    ))}
                  </select>
                )}
                {entries.length > 0 && (
                  <select
                    className="source-select"
                    value={activeEntryId ?? ''}
                    onChange={async (e) => {
                      const nextId = e.target.value || null;
                      setActiveEntryId(nextId);
                      stemBuffersRef.current.clear();
                      if (nextId) {
                        const record = await loadStemsZip(nextId);
                        if (record) {
                          const ctx = await ensureContext(false);
                          const { decoded, duration: dur } = await decodeStemsFromZip(record.zip, ctx);
                          if (decoded.size > 0) {
                            stemBuffersRef.current = decoded;
                            setDuration(dur);
                            setStatus('ready');
                            setError(null);
                            return;
                          }
                        }
                      }
                      setStatus('idle');
                      setDuration(null);
                    }}
                  >
                    <option value="">Load saved...</option>
                    {entries.map((entry) => (
                      <option key={entry.id} value={entry.id}>{entry.displayName}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="source-divider">
              <span>or add new audio</span>
            </div>

            {/* Upload */}
            <div className="upload-box">
              <input
                type="file"
                accept="audio/*"
                id="audio-upload"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />
              <label htmlFor="audio-upload">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span>Upload audio file</span>
              </label>
            </div>

            {/* Record */}
            <button
              type="button"
              className={`record-button ${recording ? 'recording' : ''}`}
              onClick={recording ? stopRecording : startRecording}
            >
              <span className="record-dot" />
              <span>{recording ? `Stop · ${formatSeconds(recordSeconds)}` : 'Record from mic'}</span>
            </button>

            {/* Selected file indicator */}
            {selectedFile && (
              <div className="selected-file">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
                <span className="file-name">{selectedFile.name}</span>
                {duration && <span className="file-duration">{formatSeconds(duration)}</span>}
              </div>
            )}
          </div>

          {/* Step 2: Process */}
          <div className="process-section">
            <div className="section-header">
              <span className="section-number">2</span>
              <span className="section-title">Process</span>
            </div>

            <button
              type="button"
              className={`analyze-button ${isDecoding ? 'processing' : ''}`}
              onClick={analyze}
              disabled={isDecoding || !selectedFile || !serverAvailable}
            >
              {isDecoding ? (
                <>
                  <span className="spinner" />
                  <span>Separating stems...</span>
                </>
              ) : !serverAvailable ? (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.121-17.679" />
                  </svg>
                  <span>Server Not Available</span>
                </>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                  <span>Analyze with Demucs</span>
                </>
              )}
            </button>

            {/* Status */}
            <div className={`status-badge ${!serverAvailable ? 'error' : status}`}>
              {!serverAvailable && 'Server Not Available'}
              {serverAvailable && status === 'processing' && 'Processing audio...'}
              {serverAvailable && status === 'ready' && '✓ Stems ready'}
              {serverAvailable && status === 'playing' && `▶ Loop ${loopCount + 1}`}
              {serverAvailable && status === 'idle' && 'Waiting for audio'}
              {serverAvailable && status === 'error' && 'Error occurred'}
            </div>
          </div>

          {/* Step 3: Playback */}
          <div className="playback-section">
            <div className="section-header">
              <span className="section-number">3</span>
              <span className="section-title">Playback</span>
            </div>

            <div className="playback-controls">
              <button
                type="button"
                className={`play-button ${status === 'playing' ? 'playing' : ''}`}
                onClick={status === 'playing' ? stop : play}
                disabled={stemBuffersRef.current.size === 0 || status === 'processing'}
              >
                {status === 'playing' ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5.14v14.72a1 1 0 001.5.86l11-7.36a1 1 0 000-1.72l-11-7.36a1 1 0 00-1.5.86z" />
                  </svg>
                )}
                <span>{status === 'playing' ? 'Stop' : 'Play'}</span>
              </button>

              <button
                type="button"
                className="action-button"
                onClick={async () => {
                  if (!activeEntryId) {
                    setError('No stems to download.');
                    return;
                  }
                  const record = await loadStemsZip(activeEntryId);
                  if (!record) return;
                  const blob = new Blob([record.zip], { type: 'application/zip' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${record.displayName || 'stems'}.zip`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                }}
                disabled={!activeEntryId}
                title="Download stems as ZIP"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            </div>

            {status === 'playing' && (
              <div className="progress-wrap">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${playProgress * 100}%` }} />
                </div>
              </div>
            )}

            {blobUrl && (
              <div className="original-audio">
                <span className="audio-label">Original</span>
                <audio src={blobUrl} controls className="inline-audio" />
              </div>
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
                    {stem.muted ? '🔇' : '🔊'}
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
