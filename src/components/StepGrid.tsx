import { Layer, Rect, Stage } from 'react-konva';
import { useShallow } from 'zustand/react/shallow';
import { useState, useEffect } from 'react';
import { useStudioStore } from '../state/useStudioStore';
import { STEPS_PER_BAR } from '../types';
import type { TrackId } from '../types';

const CELL_SIZE_DESKTOP = 52;
const CELL_SIZE_MOBILE_LANDSCAPE = 36;
const ROW_HEIGHT_DESKTOP = 68;
const ROW_HEIGHT_MOBILE_LANDSCAPE = 44;
const CELL_INSET = 8;

export function StepGrid() {
  const { tracks, toggleStep, toggleMute, setVolume, currentStep, isPlaying } = useStudioStore(
    useShallow((state) => ({
      tracks: state.tracks,
      toggleStep: state.toggleStep,
      toggleMute: state.toggleMute,
      setVolume: state.setVolume,
      currentStep: state.currentStep,
      isPlaying: state.isPlaying,
    }))
  );

  const [isMobileLandscape, setIsMobileLandscape] = useState(false);
  const [showScrollHint, setShowScrollHint] = useState(true);

  useEffect(() => {
    const checkViewport = () => {
      const isLandscape = window.innerWidth <= 900 && window.innerHeight <= 500;
      setIsMobileLandscape(isLandscape);
    };

    checkViewport();
    window.addEventListener('resize', checkViewport);
    return () => window.removeEventListener('resize', checkViewport);
  }, []);

  useEffect(() => {
    const wrapper = document.querySelector('.stage-wrapper');
    if (!wrapper) return;

    const handleScroll = () => {
      setShowScrollHint(false);
    };

    wrapper.addEventListener('scroll', handleScroll, { once: true });
    return () => wrapper.removeEventListener('scroll', handleScroll);
  }, []);

  const CELL_SIZE = isMobileLandscape ? CELL_SIZE_MOBILE_LANDSCAPE : CELL_SIZE_DESKTOP;
  const ROW_HEIGHT = isMobileLandscape ? ROW_HEIGHT_MOBILE_LANDSCAPE : ROW_HEIGHT_DESKTOP;

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
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="range"
                className="volume-slider"
                min="0"
                max="1"
                step="0.01"
                value={track.volume ?? 1}
                onChange={(e) => setVolume(track.id, parseFloat(e.target.value))}
                title={`Volume: ${Math.round((track.volume ?? 1) * 100)}%`}
              />
              <button
                className="mute-button"
                onClick={() => toggleMute(track.id)}
                title={track.muted ? 'Unmute' : 'Mute'}
                style={{ padding: '0.375rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {track.muted ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="stage-wrapper" role="region" aria-label="Step sequencer grid - swipe to scroll">
        {showScrollHint && (
          <div className="scroll-hint">
            <div className="scroll-hint-icon">‹</div>
            <div className="scroll-hint-text">Swipe</div>
          </div>
        )}
        <Stage width={stageWidth} height={stageHeight}>
          <Layer>
            {tracks.map((_, rowIndex) => (
              <Rect
                key={`row-bg-${rowIndex}`}
                x={0}
                y={rowIndex * ROW_HEIGHT}
                width={stageWidth}
                height={ROW_HEIGHT}
                fill={rowIndex % 2 === 0 ? '#1A1025' : '#150D1E'}
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
                  fill={isBar ? 'rgba(139, 92, 246, 0.06)' : undefined}
                  stroke="rgba(139, 92, 246, 0.12)"
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
                fill="rgba(139, 92, 246, 0.2)"
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
                    fill={isOn ? track.color : '#1F1630'}
                    stroke={isOn ? '#F1E8FF' : '#3D2854'}
                    strokeWidth={isHot ? 2.8 : 1.2}
                    shadowBlur={isOn ? 12 : 0}
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
