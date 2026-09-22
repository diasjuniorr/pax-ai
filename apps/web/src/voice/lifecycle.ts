export type VoicePhase = 'disconnected' | 'connecting' | 'idle' | 'listening' | 'processing' | 'speaking';
type Event = { type: string; response?: { status?: string; usage?: unknown }; transcript?: string };
export type VoiceEffects = {
  send: (event: { type: string }) => void; microphone: (enabled: boolean) => void;
  changed: (phase: VoicePhase) => void; failed: (message: string) => void;
  transcript: (text: string) => void; usage: (usage: unknown) => void;
};

// Transport-independent PTT state. No automatic response, barge-in or background hotkey.
export class VoiceLifecycle {
  phase: VoicePhase = 'disconnected';
  private timer?: ReturnType<typeof setTimeout>;
  private flush?: ReturnType<typeof setTimeout>;
  private recordingAt?: number;
  private responseDone = false;
  private playbackDone = false;
  private clearsPending = 0;
  constructor(private readonly effects: VoiceEffects, private readonly now = Date.now) {}
  private change(phase: VoicePhase) { this.phase = phase; this.effects.changed(phase); }
  private deadline(ms: number, work: () => void) { clearTimeout(this.timer); this.timer = setTimeout(work, ms); }
  connecting() { this.change('connecting'); this.deadline(35000, () => this.fail('Voice connection timed out. Try connecting again.')); }
  ready() { if (this.phase !== 'connecting') return; clearTimeout(this.timer); this.change('idle'); }
  down() {
    if (this.phase !== 'idle') return;
    this.recordingAt = undefined;
    this.change('listening');
    this.clearsPending++;
    this.effects.send({ type: 'input_audio_buffer.clear' });
    // Sending may synchronously close a failed channel and reset the lifecycle.
    if ((this.phase as VoicePhase) !== 'listening') return;
    this.deadline(3000, () => this.fail('Voice input did not become ready. Please reconnect.'));
  }
  up() {
    if (this.phase !== 'listening') return;
    this.effects.microphone(false);
    if (this.recordingAt === undefined || this.now() - this.recordingAt < 250) { this.cancel(); return; }
    this.change('processing'); this.recordingAt = undefined;
    this.responseDone = this.playbackDone = false;
    // RTP audio and data events travel separately; allow the last microphone frames to arrive.
    this.flush = setTimeout(() => {
      if (this.phase !== 'processing') return;
      this.effects.send({ type: 'input_audio_buffer.commit' });
      if (this.phase === 'processing') this.effects.send({ type: 'response.create' });
    }, 150);
    this.deadline(45000, () => this.fail('The voice reply timed out. Please reconnect.'));
  }
  cancel() {
    if (this.phase !== 'listening') return;
    this.effects.microphone(false); this.recordingAt = undefined;
    clearTimeout(this.timer); this.clearsPending++; this.change('idle'); this.effects.send({ type: 'input_audio_buffer.clear' });
  }
  receive(event: Event) {
    if (this.phase === 'disconnected') return;
    if (event.type === 'error') { this.fail('The realtime service reported an error. Check API access/quota and reconnect.'); return; }
    if (event.type === 'input_audio_buffer.cleared') this.clearsPending = Math.max(0, this.clearsPending - 1);
    if (event.type === 'input_audio_buffer.cleared' && this.clearsPending === 0 && this.phase === 'listening' && this.recordingAt === undefined) {
      this.recordingAt = this.now(); this.effects.microphone(true);
      this.deadline(25000, () => this.up());
    }
    if (event.type === 'response.output_audio_transcript.done' && typeof event.transcript === 'string')
      this.effects.transcript(event.transcript.slice(0, 8000));
    if (event.type === 'output_audio_buffer.started' && (this.phase === 'processing' || this.phase === 'speaking')) {
      this.playbackDone = false; this.change('speaking');
    }
    if (event.type === 'output_audio_buffer.stopped') { this.playbackDone = true; this.finished(); }
    if (event.type === 'response.done') {
      this.effects.usage(event.response?.usage);
      if (event.response?.status !== 'completed') { this.fail('The voice reply did not complete. Please reconnect.'); return; }
      this.responseDone = true; this.finished();
    }
  }
  private finished() {
    if (this.responseDone && this.playbackDone && (this.phase === 'processing' || this.phase === 'speaking')) {
      clearTimeout(this.timer); this.change('idle');
    }
  }
  fail(message: string) { this.close(); this.effects.failed(message); }
  close() {
    clearTimeout(this.timer); clearTimeout(this.flush); this.recordingAt = undefined; this.clearsPending = 0;
    this.effects.microphone(false); this.change('disconnected');
  }
}
