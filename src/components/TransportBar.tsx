import { useShallow } from 'zustand/react/shallow';
import { useStudioStore } from '../state/useStudioStore';
import '../App.css';

const MIN_BPM = 60;
const MAX_BPM = 180;

export function TransportBar() {
  const { tempo, setTempo, isPlaying, start, stop, audioReady, reset, randomize } = useStudioStore(
    useShallow((state) => ({
      tempo: state.tempo,
      setTempo: state.setTempo,
      isPlaying: state.isPlaying,
      start: state.start,
      stop: state.stop,
      audioReady: state.audioReady,
      reset: state.reset,
      randomize: state.randomize,
    }))
  );

  const handleToggle = async () => {
    if (isPlaying) {
      stop();
      return;
    }

    await start();
  };

  const handleReset = () => {
    if (confirm('Reset all tracks? This will mute all instruments and clear all patterns.')) {
      if (isPlaying) {
        stop();
      }
      reset();
    }
  };

  const handleRandomize = () => {
    randomize();
  };

  return (
    <div className="transport">
      {/* Primary: Play/Stop with status */}
      <div className="transport-primary">
        <button
          className={`play-button ${isPlaying ? 'playing' : ''}`}
          onClick={handleToggle}
          aria-label={isPlaying ? 'Stop playback' : 'Start playback'}
        >
          {isPlaying ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.14v14.72a1 1 0 001.5.86l11-7.36a1 1 0 000-1.72l-11-7.36a1 1 0 00-1.5.86z" />
            </svg>
          )}
          <span>{isPlaying ? 'Stop' : 'Play'}</span>
        </button>
        <div className="status-indicator">
          <div className={`status-dot ${audioReady ? 'ready' : 'locked'}`} />
          <span className="status-text">{audioReady ? 'Ready' : 'Click to init'}</span>
        </div>
      </div>

      {/* Tempo controls */}
      <div className="transport-tempo">
        <label className="tempo-label">BPM</label>
        <div className="tempo-stepper">
          <button aria-label="Decrease tempo" onClick={() => setTempo(tempo - 1)}>
            −
          </button>
          <input
            id="tempo"
            type="number"
            min={MIN_BPM}
            max={MAX_BPM}
            step={1}
            value={tempo}
            inputMode="numeric"
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) {
                setTempo(next);
              }
            }}
          />
          <button aria-label="Increase tempo" onClick={() => setTempo(tempo + 1)}>
            +
          </button>
        </div>
        <input
          className="tempo-slider"
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          step={1}
          value={tempo}
          onChange={(e) => setTempo(Number(e.target.value))}
        />
      </div>

      {/* Secondary actions */}
      <div className="transport-actions">
        <button
          className="action-button"
          onClick={handleRandomize}
          title="Randomize all patterns"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 3h5v5" />
            <path d="M4 20L21 3" />
            <path d="M21 16v5h-5" />
            <path d="M15 15l6 6" />
            <path d="M4 4l5 5" />
          </svg>
          <span>Shuffle</span>
        </button>
        <button
          className="action-button danger"
          onClick={handleReset}
          title="Reset all tracks"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          <span>Reset</span>
        </button>
      </div>
    </div>
  );
}
