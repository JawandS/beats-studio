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
      case 'clap':
        this.triggerClap(time, velocity);
        break;
      case 'percussion':
        this.triggerPercussion(time, velocity);
        break;
      case 'openhat':
        this.triggerOpenHat(time, velocity);
        break;
      case 'bass':
        this.trigger808Bass(time, velocity);
        break;
      case 'chord':
        this.triggerChordStab(time, velocity);
        break;
      case 'vocal':
        this.triggerVocalChop(time, velocity);
        break;
      case 'riser':
        this.triggerRiser(time, velocity);
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

  private triggerClap(time: number, velocity: number) {
    if (!this.context || !this.master || !this.noiseBuffer) return;

    // Create multiple short noise bursts for clap effect
    for (let i = 0; i < 3; i++) {
      const delay = i * 0.015;
      const noiseSource = this.context.createBufferSource();
      noiseSource.buffer = this.noiseBuffer;

      const bandpass = this.context.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = 1200;
      bandpass.Q.value = 2;

      const gain = this.context.createGain();
      const amp = 0.3 * velocity * (1 - i * 0.15);
      gain.gain.setValueAtTime(amp, time + delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + delay + 0.08);

      noiseSource.connect(bandpass).connect(gain).connect(this.master);
      noiseSource.start(time + delay);
      noiseSource.stop(time + delay + 0.1);
    }
  }

  private triggerPercussion(time: number, velocity: number) {
    if (!this.context || !this.master) return;

    // High pitched percussion/conga sound
    const osc = this.context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, time);
    osc.frequency.exponentialRampToValueAtTime(200, time + 0.08);

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.3 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);

    osc.connect(gain).connect(this.master);
    osc.start(time);
    osc.stop(time + 0.15);
  }

  private triggerOpenHat(time: number, velocity: number) {
    if (!this.context || !this.master || !this.noiseBuffer) return;

    const noiseSource = this.context.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;

    const highpass = this.context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 7000;

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.25 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.35);

    noiseSource.connect(highpass).connect(gain).connect(this.master);
    noiseSource.start(time);
    noiseSource.stop(time + 0.4);
  }

  private trigger808Bass(time: number, velocity: number) {
    if (!this.context || !this.master) return;

    // 808-style bass with pitch envelope
    const osc = this.context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.1);

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.8 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.5);

    // Add some distortion for grit
    const distortion = this.context.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i - 128) / 128;
      curve[i] = Math.tanh(x * 1.5);
    }
    distortion.curve = curve;

    osc.connect(distortion).connect(gain).connect(this.master);
    osc.start(time);
    osc.stop(time + 0.6);
  }

  private triggerChordStab(time: number, velocity: number) {
    if (!this.context || !this.master) return;

    // Chord stab: play multiple notes simultaneously (major chord)
    const frequencies = [261.63, 329.63, 392.0]; // C, E, G (C major)

    frequencies.forEach((freq) => {
      const osc = this.context!.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;

      const gain = this.context!.createGain();
      gain.gain.setValueAtTime(0.25 * velocity, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);

      osc.connect(gain).connect(this.master!);
      osc.start(time);
      osc.stop(time + 0.35);
    });
  }

  private triggerVocalChop(time: number, velocity: number) {
    if (!this.context || !this.master) return;

    // Pluck synth: short, percussive melodic sound
    const osc = this.context.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 440; // A4

    // Fast attack, quick decay envelope
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.4 * velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.15);

    // Filter envelope for pluck character
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 8;
    filter.frequency.setValueAtTime(3000, time);
    filter.frequency.exponentialRampToValueAtTime(400, time + 0.12);

    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  private triggerRiser(time: number, velocity: number) {
    if (!this.context || !this.master || !this.noiseBuffer) return;

    // Riser: pitch sweep upward with noise
    const osc = this.context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, time);
    osc.frequency.exponentialRampToValueAtTime(2000, time + 1.0);

    const oscGain = this.context.createGain();
    oscGain.gain.setValueAtTime(0.15 * velocity, time);
    oscGain.gain.linearRampToValueAtTime(0.4 * velocity, time + 1.0);

    // Add noise for texture
    const noiseSource = this.context.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;

    const noiseFilter = this.context.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.setValueAtTime(500, time);
    noiseFilter.frequency.exponentialRampToValueAtTime(8000, time + 1.0);

    const noiseGain = this.context.createGain();
    noiseGain.gain.setValueAtTime(0.1 * velocity, time);
    noiseGain.gain.linearRampToValueAtTime(0.3 * velocity, time + 1.0);

    osc.connect(oscGain).connect(this.master);
    noiseSource.connect(noiseFilter).connect(noiseGain).connect(this.master);

    osc.start(time);
    noiseSource.start(time);
    osc.stop(time + 1.1);
    noiseSource.stop(time + 1.1);
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
