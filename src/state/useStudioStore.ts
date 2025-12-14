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
  setVolume: (trackId: TrackId, volume: number) => void;
  reset: () => void;
  randomize: () => void;
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
    color: '#EC4899', // Magenta
    volume: 0.95,
    pattern: patternFrom([0, 4, 8, 12]),
  },
  {
    id: 'snare',
    name: 'Snare',
    color: '#8B5CF6', // Primary violet
    volume: 0.8,
    pattern: patternFrom([4, 12]),
  },
  {
    id: 'hat',
    name: 'Hat',
    color: '#A855F7', // Bright violet
    volume: 0.75,
    pattern: patternFrom([0, 2, 4, 6, 8, 10, 12, 14]),
  },
  {
    id: 'clap',
    name: 'Clap',
    color: '#F472B6', // Pink
    volume: 0.7,
    pattern: patternFrom([4, 12]),
  },
  {
    id: 'percussion',
    name: 'Perc',
    color: '#22C55E', // Keep green for contrast
    volume: 0.6,
    pattern: patternFrom([3, 7, 11, 15]),
  },
  {
    id: 'openhat',
    name: 'OHat',
    color: '#C084FC', // Light violet
    volume: 0.65,
    pattern: patternFrom([2, 6, 10, 14]),
  },
  {
    id: 'bass',
    name: 'Bass',
    color: '#7C3AED', // Deep violet
    volume: 0.85,
    pattern: patternFrom([0, 3, 7, 10]),
  },
  {
    id: 'chord',
    name: 'Stab',
    color: '#FBBF24', // Keep yellow for contrast
    volume: 0.6,
    pattern: patternFrom([0, 8]),
  },
  {
    id: 'vocal',
    name: 'Synth',
    color: '#A78BFA', // Soft violet
    volume: 0.65,
    pattern: patternFrom([1, 5, 9, 13]),
  },
  {
    id: 'riser',
    name: 'Riser',
    color: '#FB7185', // Rose/coral
    volume: 0.5,
    pattern: patternFrom([15]),
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

      setVolume: (trackId, volume) =>
        set((state) => ({
          tracks: state.tracks.map((track) =>
            track.id === trackId ? { ...track, volume } : track
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

      reset: () => {
        // Create empty patterns (all false) and mute all tracks
        const emptyPattern = Array.from({ length: STEPS_PER_BAR }, () => false);
        const resetTracks = defaultTracks.map((track) => ({
          ...track,
          pattern: emptyPattern,
          muted: true,
        }));
        set({ tracks: resetTracks });
      },

      randomize: () => {
        // Generate random patterns for each track, preserve mute state
        set((state) => ({
          tracks: state.tracks.map((track) => ({
            ...track,
            pattern: Array.from({ length: STEPS_PER_BAR }, () => Math.random() > 0.6),
          })),
        }));
      },
    }),
    {
      name: 'beats-studio-storage',
      version: 2,
      partialize: (state) => ({
        tempo: state.tempo,
        tracks: state.tracks,
      }),
      migrate: (persistedState: any, version: number) => {
        // Always check if we need migration based on track count
        const currentTrackCount = persistedState?.tracks?.length || 0;
        const expectedTrackCount = defaultTracks.length;

        if (version < 2 || currentTrackCount !== expectedTrackCount) {
          console.log(`Migrating from ${currentTrackCount} to ${expectedTrackCount} tracks`);
          const oldTracks = (persistedState?.tracks || []) as Track[];

          // Create a map of existing tracks by ID
          const existingTracksMap = new Map<TrackId, Track>(
            oldTracks.map((track) => [track.id, track])
          );

          // Merge old tracks with new defaults, preserving user patterns
          const migratedTracks = defaultTracks.map((defaultTrack) => {
            const existingTrack = existingTracksMap.get(defaultTrack.id);
            if (existingTrack) {
              // Preserve user's pattern, volume, and muted state
              return {
                ...defaultTrack,
                pattern: existingTrack.pattern,
                volume: existingTrack.volume ?? defaultTrack.volume,
                muted: existingTrack.muted,
              };
            }
            // New track, use defaults
            return defaultTrack;
          });

          return {
            tempo: persistedState?.tempo || 92,
            tracks: migratedTracks,
          };
        }
        return persistedState;
      },
    }
  )
);
