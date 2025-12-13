import { useShallow } from 'zustand/react/shallow';
import { useStudioStore } from '../state/useStudioStore';
import '../App.css';

const MIN_BPM = 60;
const MAX_BPM = 180;

export function TransportBar() {
  const { tempo, setTempo, isPlaying, start, stop, audioReady } = useStudioStore(
    useShallow((state) => ({
      tempo: state.tempo,
      setTempo: state.setTempo,
      isPlaying: state.isPlaying,
      start: state.start,
      stop: state.stop,
      audioReady: state.audioReady,
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
    if (confirm('Reset to default tracks? This will clear all your patterns and reload the page.')) {
      localStorage.removeItem('beats-studio-storage');
      window.location.reload();
    }
  };

  return (
    <div className="transport">
      <div className="tempo-field">
        <div className="tempo-row">
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
      </div>

      <div className="transport-left">
        <button className={`pill-button ${isPlaying ? 'secondary' : 'primary'}`} onClick={handleToggle}>
          {isPlaying ? 'Stop' : 'Play'}
        </button>
        <div className={`status-dot ${audioReady ? 'ready' : 'locked'}`} />
      </div>

      <button
        className="pill-button secondary"
        onClick={handleReset}
        title="Reset"
        style={{ marginLeft: 'auto' }}
      >
        Reset
      </button>
    </div>
  );
}
