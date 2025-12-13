import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import audioEngine from '../audio/audioEngine';
import { STEPS_PER_BAR } from '../types';
import type { Track, TrackId } from '../types';

type StudioState = {
  tempo: number;
  isPlaying: boolean;
  currentStep: number;
  tracks: Track[];
  audioReady: boolean;
};

type StudioActions = {
  toggleStep: (trackId: TrackId, step: number) => void;
  setTempo: (tempo: number) => void;
  start: () => Promise<void>;
  stop: () => void;
  toggleMute: (trackId: TrackId) => void;
};

const clampTempo = (tempo: number) => Math.min(180, Math.max(60, Math.round(tempo)));

const patternFrom = (indices: number[]) => {
  const pattern = Array.from({ length: STEPS_PER_BAR }, () => false);
  indices.forEach((index) => {
    if (index >= 0 && index < pattern.length) {
      pattern[index] = true;
    }
  });
  return pattern;
};

const defaultTracks: Track[] = [
  {
    id: 'kick',
    name: 'Kick',
    color: '#f97316',
    volume: 0.95,
    pattern: patternFrom([0, 4, 8, 12]),
  },
  {
    id: 'snare',
    name: 'Snare',
    color: '#22d3ee',
    volume: 0.8,
    pattern: patternFrom([4, 12]),
  },
  {
    id: 'hat',
    name: 'Hat',
    color: '#a855f7',
    volume: 0.75,
    pattern: patternFrom([0, 2, 4, 6, 8, 10, 12, 14]),
  },
];

export const useStudioStore = create<StudioState & StudioActions>()(
  persist(
    (set, get) => ({
      tempo: 92,
      isPlaying: false,
      currentStep: 0,
      tracks: defaultTracks,
      audioReady: false,

      toggleStep: (trackId, step) =>
        set((state) => ({
          tracks: state.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  pattern: track.pattern.map((isOn, idx) => (idx === step ? !isOn : isOn)),
                }
              : track
          ),
        })),

      toggleMute: (trackId) =>
        set((state) => ({
          tracks: state.tracks.map((track) =>
            track.id === trackId ? { ...track, muted: !track.muted } : track
          ),
        })),

      setTempo: (tempo) => {
        const clamped = clampTempo(tempo);
        set({ tempo: clamped });
        audioEngine.setTempo(clamped);
      },

      start: async () => {
        const { tempo } = get();
        await audioEngine.init();

        audioEngine.start({
          tempo,
          getTracks: () => get().tracks,
          onStep: (step) => set({ currentStep: step }),
        });

        set({ isPlaying: true, audioReady: true });
      },

      stop: () => {
        audioEngine.stop();
        set({ isPlaying: false, currentStep: 0 });
      },
    }),
    {
      name: 'beats-studio-storage',
      partialize: (state) => ({
        tempo: state.tempo,
        tracks: state.tracks,
      }),
    }
  )
);
