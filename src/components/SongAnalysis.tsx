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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const stemBuffersRef = useRef<Map<StemId, AudioBuffer>>(new Map());
  const sourcesRef = useRef<Map<StemId, { source: AudioBufferSourceNode; gain: GainNode }>>(new Map());
  const masterGainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    return () => {
      stopPlayback();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const ensureContext = async () => {
    if (!audioCtxRef.current) {
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
    if (audioCtxRef.current?.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    return audioCtxRef.current!;
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
      const ctx = await ensureContext();
      const formData = new FormData();
      formData.append('file', selectedFile);

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
      const zip = await JSZip.loadAsync(zipBuffer);

      const decodedStems = new Map<StemId, AudioBuffer>();
      for (const stemId of Object.keys(STEM_FILES) as StemId[]) {
        const fileName = STEM_FILES[stemId];
        const file = zip.file(fileName);
        if (!file) continue;
        const audioData = await file.async('arraybuffer');
        const buf = await ctx.decodeAudioData(audioData.slice(0));
        decodedStems.set(stemId, buf);
      }

      if (decodedStems.size === 0) {
        throw new Error('No stems returned from backend.');
      }

      stemBuffersRef.current = decodedStems;
      const firstStem = decodedStems.values().next().value as AudioBuffer;
      setDuration(firstStem?.duration ?? null);
      setStatus('ready');
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
  };

  const play = async () => {
    if (stemBuffersRef.current.size === 0) {
      setError('Analyze with Demucs first.');
      return;
    }
    stopPlayback();
    const ctx = await ensureContext();
    const master = masterGainRef.current;
    if (!master) return;
    stems.forEach((stem) => {
      const stemBuffer = stemBuffersRef.current.get(stem.id);
      if (!stemBuffer) return;
      const source = ctx.createBufferSource();
      source.buffer = stemBuffer;
      const gain = ctx.createGain();
      gain.gain.value = stem.muted ? 0 : stem.gain;
      source.connect(gain).connect(master);
      source.start();
      sourcesRef.current.set(stem.id, { source, gain });
    });
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
      <div className="analysis-header">
        <div>
          <p className="eyebrow">Song intelligence</p>
          <h2>Analyze & remix a track</h2>
          <p className="lede">
            Record or upload a song, separate stems (Demucs pipeline placeholder), and tweak levels to remix.
          </p>
        </div>
        <div className="pill secondary subtle">Demucs-ready · 4-stem split</div>
      </div>

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
              {status === 'playing' && 'Playing stems'}
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
