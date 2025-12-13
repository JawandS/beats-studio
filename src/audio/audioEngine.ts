import { LookaheadScheduler } from './lookaheadScheduler';
import { STEPS_PER_BAR } from '../types';
import type { Track, TrackId } from '../types';

type StartConfig = {
  tempo: number;
  getTracks: () => Track[];
  onStep?: (step: number) => void;
};

class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private scheduler?: LookaheadScheduler;
  private noiseBuffer?: AudioBuffer;
  private isRunning: boolean;

  constructor() {
    this.isRunning = false;
  }

  async init() {
    if (!this.context) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioCtx) {
        throw new Error('Web Audio API is not available in this browser.');
      }

      this.context = new AudioCtx();
      this.master = this.context.createGain();
      this.master.gain.value = 0.82;
      this.master.connect(this.context.destination);
      this.scheduler = new LookaheadScheduler(this.context, STEPS_PER_BAR);
      this.noiseBuffer = this.createNoiseBuffer();
    }

    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }
  }

  start(config: StartConfig) {
    if (!this.context || !this.scheduler || !this.master) {
      throw new Error('Audio engine is not initialized');
    }

    if (this.isRunning) {
      this.stop();
    }

    this.scheduler.start(config.tempo, (step, time) => {
      const tracks = config.getTracks();

      tracks.forEach((track) => {
        if (track.muted) return;
        if (track.pattern[step]) {
          this.triggerTrack(track.id, time, track.volume ?? 1);
        }
      });

      config.onStep?.(step);
    });

    this.isRunning = true;
  }

  stop() {
    this.scheduler?.stop();
    this.isRunning = false;
  }

  setTempo(bpm: number) {
    this.scheduler?.setTempo(bpm);
  }

  isPlaying() {
    return this.isRunning;
  }

  private triggerTrack(id: TrackId, time: number, velocity: number) {
    if (!this.context || !this.master) return;

    switch (id) {
      case 'kick':
        this.triggerKick(time, velocity);
        break;
      case 'snare':
        this.triggerSnare(time, velocity);
        break;
      case 'hat':
        this.triggerHat(time, velocity);
        break;
      default:
        break;
    }
  }

  private triggerKick(time: number, velocity: number) {
    if (!this.context || !this.master) return;

    const osc = this.context.createOscillator();
    const gain = this.context.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.22);

    gain.gain.setValueAtTime(1.0 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.32);

    osc.connect(gain).connect(this.master);
    osc.start(time);
    osc.stop(time + 0.5);
  }

  private triggerSnare(time: number, velocity: number) {
    if (!this.context || !this.master || !this.noiseBuffer) return;

    const noiseSource = this.context.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;

    const bandpass = this.context.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1800;
    bandpass.Q.value = 0.8;

    const highpass = this.context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 1200;

    const noiseGain = this.context.createGain();
    noiseGain.gain.setValueAtTime(0.45 * velocity, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);

    noiseSource.connect(bandpass).connect(highpass).connect(noiseGain).connect(this.master);
    noiseSource.start(time);
    noiseSource.stop(time + 0.3);

    const osc = this.context.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, time);
    osc.frequency.exponentialRampToValueAtTime(120, time + 0.12);

    const toneGain = this.context.createGain();
    toneGain.gain.setValueAtTime(0.28 * velocity, time);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);

    osc.connect(toneGain).connect(this.master);
    osc.start(time);
    osc.stop(time + 0.3);
  }

  private triggerHat(time: number, velocity: number) {
    if (!this.context || !this.master || !this.noiseBuffer) return;

    const noiseSource = this.context.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;

    const highpass = this.context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 8000;

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.22 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);

    noiseSource.connect(highpass).connect(gain).connect(this.master);
    noiseSource.start(time);
    noiseSource.stop(time + 0.15);
  }

  private createNoiseBuffer() {
    if (!this.context) return undefined;
    const buffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    return buffer;
  }
}

const audioEngine = new AudioEngine();

export default audioEngine;
