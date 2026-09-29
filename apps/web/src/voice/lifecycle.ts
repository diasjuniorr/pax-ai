export type VoicePhase = 'disconnected' | 'connecting' | 'idle' | 'listening' | 'processing' | 'speaking' | 'interrupting';
type Event = { type: string; response_id?: string; response?: { id?: string; status?: string; usage?: unknown }; transcript?: string; error?: { event_id?: string } };
export type VoiceCommand = { type: string; event_id?: string; response?: { instructions: string } };
export type VoiceEffects = {
  send: (event: VoiceCommand) => void;
  prepareResponse?: () => Promise<string>; microphone: (enabled: boolean) => void;
  changed: (phase: VoicePhase) => void; failed: (message: string) => void;
  transcript: (text: string) => void; usage: (usage: unknown) => void;
};

// Transport-independent voice coordination. Pilot PTT can interrupt an automatic comment.
export class VoiceLifecycle {
  phase: VoicePhase = 'disconnected';
  private timer?: ReturnType<typeof setTimeout>;
  private flush?: ReturnType<typeof setTimeout>;
  private recordingAt?: number;
  private responseDone = false;
  private playbackDone = false;
  private clearsPending = 0;
  automatic = false;
  private revision = 0;
  private responseId?: string;
  private ignoredResponses = new Set<string>();
  private resumeRecording = false;
  private cancelEvent?: string;
  private cancelDone = false;
  private outputCleared = false;
  constructor(private readonly effects: VoiceEffects, private readonly now = Date.now) {}
  private change(phase: VoicePhase) { this.phase = phase; this.effects.changed(phase); }
  private deadline(ms: number, work: () => void) { clearTimeout(this.timer); this.timer = setTimeout(work, ms); }
  connecting() { this.change('connecting'); this.deadline(35000, () => this.fail('Voice connection timed out. Try connecting again.')); }
  ready() { if (this.phase !== 'connecting') return; clearTimeout(this.timer); this.change('idle'); }
  react(instructions: string, remainingMs = 15000) {
    if (this.phase !== 'idle' || this.clearsPending !== 0) return false;
    this.automatic = true; this.responseId = undefined;
    this.responseDone = this.playbackDone = false;
    this.change('processing');
    this.effects.send({ type: 'response.create', response: { instructions } });
    if (this.phase as VoicePhase !== 'disconnected') this.deadline(remainingMs, () => this.interrupt(false));
    return true;
  }
  interrupt(record = false) {
    if (!this.automatic || !['processing', 'speaking'].includes(this.phase)) return;
    this.revision++; this.resumeRecording = record; this.cancelDone = this.responseDone; this.outputCleared = false;
    this.cancelEvent = `pax-cancel-${this.revision}`;
    this.change('interrupting');
    if (!this.responseDone) this.effects.send({ type: 'response.cancel', event_id: this.cancelEvent });
    if (this.phase as VoicePhase !== 'interrupting') return;
    this.effects.send({ type: 'output_audio_buffer.clear' });
    if (this.phase as VoicePhase === 'interrupting') this.deadline(3000, () => this.fail('Could not stop the passenger audio. Please reconnect.'));
  }
  private interrupted() {
    if (this.phase !== 'interrupting' || !this.cancelDone || !this.outputCleared) return;
    if (this.responseId) this.ignoredResponses.add(this.responseId);
    if (this.ignoredResponses.size > 16) this.ignoredResponses.delete(this.ignoredResponses.values().next().value!);
    const record = this.resumeRecording;
    this.automatic = false; this.responseId = undefined; this.cancelEvent = undefined;
    clearTimeout(this.timer); this.change('idle');
    if (record) this.down();
  }
  down() {
    if (this.automatic && ['processing', 'speaking'].includes(this.phase)) { this.interrupt(true); return; }
    if (this.phase !== 'idle') return;
    this.revision++; this.automatic = false; this.responseId = undefined;
    this.recordingAt = undefined;
    this.change('listening');
    this.clearsPending++;
    this.effects.send({ type: 'input_audio_buffer.clear' });
    // Sending may synchronously close a failed channel and reset the lifecycle.
    if ((this.phase as VoicePhase) !== 'listening') return;
    this.deadline(3000, () => this.fail('Voice input did not become ready. Please reconnect.'));
  }
  up() {
    if (this.phase === 'interrupting') { this.resumeRecording = false; return; }
    if (this.phase !== 'listening') return;
    this.effects.microphone(false);
    if (this.recordingAt === undefined || this.now() - this.recordingAt < 250) { this.cancel(); return; }
    this.change('processing'); this.recordingAt = undefined;
    this.responseDone = this.playbackDone = false;
    // RTP audio and data events travel separately; allow the last microphone frames to arrive.
    const revision = this.revision;
    this.flush = setTimeout(() => {
      if (this.phase !== 'processing') return;
      this.effects.send({ type: 'input_audio_buffer.commit' });
      if (this.phase !== 'processing') return;
      if (!this.effects.prepareResponse) this.effects.send({ type: 'response.create' });
      else void this.effects.prepareResponse().then(instructions => {
        if (this.revision === revision && this.phase === 'processing')
          this.effects.send({ type: 'response.create', response: { instructions } });
      }).catch(() => { if (this.revision === revision) this.fail('Could not refresh flight context. Please reconnect voice.'); });
    }, 150);
    this.deadline(45000, () => this.fail('The voice reply timed out. Please reconnect.'));
  }
  cancel() {
    if (this.phase === 'interrupting') { this.resumeRecording = false; return; }
    if (this.phase !== 'listening') return;
    this.effects.microphone(false); this.recordingAt = undefined;
    clearTimeout(this.timer); this.clearsPending++; this.change('idle'); this.effects.send({ type: 'input_audio_buffer.clear' });
  }
  receive(event: Event) {
    if (this.phase === 'disconnected') return;
    const id = event.response?.id ?? event.response_id;
    if (id && this.ignoredResponses.has(id)) return;
    if (event.type === 'response.created') this.responseId = event.response?.id;
    if (this.phase === 'interrupting') {
      if (event.type === 'response.done' || (event.type === 'error' && event.error?.event_id === this.cancelEvent)) this.cancelDone = true;
      else if (event.type === 'output_audio_buffer.cleared') this.outputCleared = true;
      else if (event.type === 'error') { this.fail('The realtime service could not interrupt the response.'); return; }
      this.interrupted(); return;
    }
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
      clearTimeout(this.timer); this.automatic = false; this.change('idle');
    }
  }
  fail(message: string) { this.close(); this.effects.failed(message); }
  close() {
    this.revision++; this.automatic = false; this.resumeRecording = false; this.responseId = undefined; this.ignoredResponses.clear();
    clearTimeout(this.timer); clearTimeout(this.flush); this.recordingAt = undefined; this.clearsPending = 0;
    this.effects.microphone(false); this.change('disconnected');
  }
}
