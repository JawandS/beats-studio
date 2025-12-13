export const STEPS_PER_BAR = 16;

export type TrackId = 'kick' | 'snare' | 'hat';

export type Track = {
  id: TrackId;
  name: string;
  color: string;
  pattern: boolean[];
  muted?: boolean;
  volume?: number;
};
