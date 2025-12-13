import { useShallow } from 'zustand/react/shallow';
import { useStudioStore } from '../state/useStudioStore';
import '../App.css';

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

  return (
    <div className="transport">
      <div className="transport-left">
        <button className={`pill-button ${isPlaying ? 'secondary' : 'primary'}`} onClick={handleToggle}>
          {isPlaying ? 'Stop' : 'Play'}
        </button>
        <div className={`status-dot ${audioReady ? 'ready' : 'locked'}`} />
        <span className="status-label">{audioReady ? 'Audio ready' : 'Tap play to unlock audio'}</span>
      </div>

      <div className="tempo-field">
        <label htmlFor="tempo">Tempo</label>
        <input
          id="tempo"
          type="number"
          min={60}
          max={180}
          step={1}
          value={tempo}
          onChange={(e) => setTempo(Number(e.target.value))}
        />
        <span className="tempo-unit">BPM</span>
      </div>
    </div>
  );
}
