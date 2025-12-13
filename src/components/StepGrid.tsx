import { Layer, Rect, Stage } from 'react-konva';
import { useShallow } from 'zustand/react/shallow';
import { useStudioStore } from '../state/useStudioStore';
import { STEPS_PER_BAR } from '../types';
import type { TrackId } from '../types';

const CELL_SIZE = 52;
const ROW_HEIGHT = 68;
const CELL_INSET = 8;

export function StepGrid() {
  const { tracks, toggleStep, toggleMute, currentStep, isPlaying } = useStudioStore(
    useShallow((state) => ({
      tracks: state.tracks,
      toggleStep: state.toggleStep,
      toggleMute: state.toggleMute,
      currentStep: state.currentStep,
      isPlaying: state.isPlaying,
    }))
  );

  const steps = tracks[0]?.pattern.length ?? STEPS_PER_BAR;
  const stageWidth = steps * CELL_SIZE;
  const stageHeight = tracks.length * ROW_HEIGHT;

  const handleToggle = (trackId: TrackId, step: number) => {
    toggleStep(trackId, step);
  };

  return (
    <div className="sequencer">
      <div className="track-list">
        {tracks.map((track) => (
          <div className="track-label" key={track.id}>
            <span className="track-chip" style={{ background: track.color }} />
            <div className="track-meta">
              <span className="track-name">{track.name}</span>
              <span className="track-sub">{track.muted ? 'Muted' : 'Active'}</span>
            </div>
            <button className="mute-button" onClick={() => toggleMute(track.id)}>
              {track.muted ? 'Unmute' : 'Mute'}
            </button>
          </div>
        ))}
      </div>

      <div className="stage-wrapper">
        <Stage width={stageWidth} height={stageHeight}>
          <Layer>
            {tracks.map((_, rowIndex) => (
              <Rect
                key={`row-bg-${rowIndex}`}
                x={0}
                y={rowIndex * ROW_HEIGHT}
                width={stageWidth}
                height={ROW_HEIGHT}
                fill={rowIndex % 2 === 0 ? '#0d1627' : '#0a1322'}
              />
            ))}

            {Array.from({ length: steps }).map((_, stepIndex) => {
              const isBar = stepIndex % 4 === 0;
              return (
                <Rect
                  key={`grid-${stepIndex}`}
                  x={stepIndex * CELL_SIZE}
                  y={0}
                  width={CELL_SIZE}
                  height={stageHeight}
                  fill={isBar ? 'rgba(255,255,255,0.02)' : undefined}
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth={isBar ? 1.2 : 0.7}
                />
              );
            })}

            {isPlaying && (
              <Rect
                x={currentStep * CELL_SIZE}
                y={0}
                width={CELL_SIZE}
                height={stageHeight}
                fill="rgba(16,185,129,0.12)"
              />
            )}

            {tracks.map((track, rowIndex) =>
              track.pattern.map((isOn, stepIndex) => {
                const x = stepIndex * CELL_SIZE + CELL_INSET;
                const y = rowIndex * ROW_HEIGHT + CELL_INSET;
                const width = CELL_SIZE - CELL_INSET * 2;
                const height = ROW_HEIGHT - CELL_INSET * 2;
                const isHot = isPlaying && currentStep === stepIndex;

                return (
                  <Rect
                    key={`${track.id}-${stepIndex}`}
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    cornerRadius={10}
                    fill={isOn ? track.color : '#121c2f'}
                    stroke={isOn ? '#e2e8f0' : '#30445f'}
                    strokeWidth={isHot ? 2.8 : 1.2}
                    shadowBlur={isOn ? 8 : 0}
                    shadowColor={track.color}
                    opacity={track.muted ? 0.45 : 1}
                    onMouseDown={() => handleToggle(track.id, stepIndex)}
                    onTouchStart={() => handleToggle(track.id, stepIndex)}
                  />
                );
              })
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}
