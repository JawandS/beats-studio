export type TickHandler = (step: number, time: number) => void;

export class LookaheadScheduler {
  private intervalId: number | null;
  private nextStepTime: number;
  private currentStep: number;
  private secondsPerStep: number;
  private readonly scheduleAheadTime: number;
  private readonly lookaheadMs: number;
  private context: AudioContext;
  private stepsPerBar: number;

  constructor(context: AudioContext, stepsPerBar: number) {
    this.context = context;
    this.stepsPerBar = stepsPerBar;
    this.intervalId = null;
    this.nextStepTime = 0;
    this.currentStep = 0;
    this.secondsPerStep = 0;
    this.scheduleAheadTime = 0.18; // seconds
    this.lookaheadMs = 25; // how often we check the queue
  }

  start(bpm: number, onTick: TickHandler) {
    this.stop();

    this.currentStep = 0;
    this.secondsPerStep = this.getSecondsPerStep(bpm);
    this.nextStepTime = this.context.currentTime + 0.05; // small offset to avoid first-click

    this.intervalId = window.setInterval(() => {
      const now = this.context.currentTime;

      while (this.nextStepTime < now + this.scheduleAheadTime) {
        onTick(this.currentStep, this.nextStepTime);
        this.advanceStep();
      }
    }, this.lookaheadMs);
  }

  stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  setTempo(bpm: number) {
    this.secondsPerStep = this.getSecondsPerStep(bpm);
  }

  private advanceStep() {
    this.nextStepTime += this.secondsPerStep;
    this.currentStep = (this.currentStep + 1) % this.stepsPerBar;
  }

  private getSecondsPerStep(bpm: number) {
    const beatsPerSecond = bpm / 60;
    const sixteenthNotePerSecond = beatsPerSecond * 4;
    return 1 / sixteenthNotePerSecond;
  }
}
