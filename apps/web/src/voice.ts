import { voiceAvailabilitySchema, voiceTurnSchema, type ServerSnapshot } from '@pax/shared';
import { debugEvent } from './debug-console';
import { VoiceLifecycle } from './voice/lifecycle';
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const connect = button('voice-connect'), disconnect = button('voice-disconnect'), talk = button('voice-talk');
const status = document.getElementById('voice-status')!, error = document.getElementById('voice-error')!;
const transcript = document.getElementById('voice-transcript')!, usage = document.getElementById('voice-usage')!;
const audio = document.getElementById('voice-audio') as HTMLAudioElement;
let sessionId: string | null = null;
let availability = { configured: false, active: false };
let online = false, polling = false, generation = 0;
let resources: { pc: RTCPeerConnection; channel: RTCDataChannel; stream?: MediaStream; owner: { sessionId: string; connectionId: string } } | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let reactionPoll: ReturnType<typeof setInterval> | undefined;
let flight: ServerSnapshot | null = null, flightReceivedAt = 0, reactionsEnabled = false;
let automaticGeneration: string | null = null;
let activeReactionId: string | undefined;
let lastPilotAction = 0;
function liveFlight() {
  return flight?.flight?.status === 'tracking' && flight.telemetryState === 'live'
    && flight.simulation?.active && performance.now() - flightReceivedAt < 3000;
}
const lifecycle = new VoiceLifecycle({
  prepareResponse: async () => {
    activeReactionId = undefined;
    const local = resources;
    if (!local) throw new Error('Voice disconnected');
    const started = performance.now();
    const result = voiceTurnSchema.parse((await request('/turn', local.owner)).turn);
    if (local !== resources || performance.now() - started >= result.validForMs
      || (result.generation && flight && (!liveFlight() || result.generation !== flight.simulation?.generation))) throw new Error('Context expired');
    return result.instructions;
  },
  send: event => {
    try {
      if (resources?.channel.readyState !== 'open') throw new Error('Closed');
      resources.channel.send(JSON.stringify(event));
      if (['response.create', 'response.cancel', 'output_audio_buffer.clear'].includes(event.type))
        debugEvent('VOICE', event.type === 'response.create' ? 'Response requested' : event.type === 'response.cancel' ? 'Response cancellation requested' : 'Audio clear requested',
          { sessionId, connectionId: resources.owner.connectionId, automatic: lifecycle.automatic, eventId: activeReactionId });
    } catch { stop('Voice connection closed. Please reconnect.'); }
  },
  microphone: enabled => { resources?.stream?.getAudioTracks().forEach(track => { track.enabled = enabled; }); },
  changed: phase => { debugEvent('VOICE', 'Phase changed', { phase, sessionId, connectionId: resources?.owner.connectionId }); render(); }, failed: message => stop(message),
  transcript: text => { transcript.textContent = text; },
  usage: value => {
    const data = value as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
    if (typeof data?.input_tokens === 'number' && typeof data.output_tokens === 'number')
      usage.textContent = `Last reply: ${data.input_tokens} input tokens · ${data.output_tokens} output tokens`;
  },
});
function render() {
  const phase = lifecycle.phase;
  connect.disabled = !online || !sessionId || !availability.configured || availability.active || phase !== 'disconnected';
  disconnect.disabled = phase === 'disconnected';
  talk.disabled = phase !== 'idle' && phase !== 'listening' && phase !== 'interrupting' && !lifecycle.automatic;
  talk.setAttribute('aria-pressed', String(phase === 'listening'));
  status.textContent = phase !== 'disconnected' ? ({ connecting: 'Connecting voice…', idle: 'Ready — hold the button to speak',
    listening: 'Listening while held…', processing: 'Passenger is thinking…', speaking: 'Passenger is speaking…', interrupting: 'Stopping the comment for you…' }[phase])
    : !sessionId ? 'Start a flight session to use voice.' : !online ? 'Checking voice availability…'
    : !availability.configured ? 'Voice needs OPENAI_API_KEY in the server environment.'
    : availability.active ? 'Voice is connected in another tab. Disconnect it there or wait for it to expire.' : 'Voice disconnected';
}
async function request(path: string, data?: unknown) {
  const response = await fetch(`/api/voice${path}`, { ...(data === undefined ? { cache: 'no-store' as const }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }), signal: AbortSignal.timeout(path === '/start' ? 35000 : 5000) });
  if (response.status === 401) { stop('Please sign in again.'); throw new Error('Please sign in again.'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Voice request failed.');
  return result;
}
async function refresh() {
  if (polling) return;
  polling = true;
  try { availability = voiceAvailabilitySchema.parse(await request('')); online = true; }
  catch { online = false; }
  finally { polling = false; render(); }
}
function stop(message = '') {
  if (message) debugEvent('VOICE', 'Voice stopped with an error', { sessionId, connectionId: resources?.owner.connectionId }, 'error');
  generation++;
  clearInterval(heartbeat); heartbeat = undefined;
  clearInterval(reactionPoll); reactionPoll = undefined; automaticGeneration = null;
  const old = resources; resources = undefined;
  lifecycle.close();
  if (old) {
    old.stream?.getTracks().forEach(track => track.stop());
    old.channel.close(); old.pc.close();
    // Covers pagehide/refresh; server also expires missing heartbeats.
    navigator.sendBeacon('/api/voice/stop', new Blob([JSON.stringify(old.owner)], { type: 'application/json' }));
  }
  audio.pause(); audio.srcObject = null;
  error.textContent = message; render();
}
connect.addEventListener('click', () => {
  if (connect.disabled || !sessionId) return;
  const current = ++generation;
  error.textContent = ''; transcript.textContent = ''; usage.textContent = '';
  lifecycle.connecting();
  void (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('This browser does not support voice. Use an HTTPS page in a current browser.');
      const pc = new RTCPeerConnection();
      const channel = pc.createDataChannel('oai-events');
      const owner = { sessionId: sessionId!, connectionId: crypto.randomUUID() };
      const local = { pc, channel, owner, stream: undefined as MediaStream | undefined };
      resources = local;
      channel.onopen = () => { if (current === generation) lifecycle.ready(); };
      channel.onmessage = event => {
        if (current !== generation || typeof event.data !== 'string' || event.data.length > 100000) return;
        try {
          const value = JSON.parse(event.data);
          const labels: Record<string, string> = { 'response.created': 'Response created', 'response.done': 'Response generation finished',
            'output_audio_buffer.started': 'Audio playback started', 'output_audio_buffer.stopped': 'Audio playback finished', 'output_audio_buffer.cleared': 'Audio buffer cleared' };
          if (labels[value.type]) debugEvent('VOICE', labels[value.type]!, { sessionId, connectionId: owner.connectionId,
            responseId: value.response?.id ?? value.response_id, status: value.response?.status, eventId: activeReactionId });
          lifecycle.receive(value);
        } catch { stop('Invalid voice event. Please reconnect.'); }
      };
      channel.onclose = () => { if (current === generation) stop('Voice disconnected. Connect again when ready.'); };
      channel.onerror = () => { if (current === generation) stop('Voice connection failed. Please reconnect.'); };
      pc.onconnectionstatechange = () => {
        if (current === generation && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) stop('Voice connection lost. Please reconnect.');
      };
      pc.ontrack = event => {
        if (current !== generation) return;
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => { if (current === generation) stop('Audio playback was blocked. Check browser sound permissions and reconnect.'); });
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (current !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
      local.stream = stream;
      for (const track of stream.getAudioTracks()) {
        track.enabled = false; track.onended = () => { if (current === generation) stop('Microphone disconnected. Please reconnect.'); };
        pc.addTrack(track, stream);
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (current !== generation) return;
      const answer = await request('/start', { ...owner, sdp: offer.sdp });
      if (current !== generation) {
        navigator.sendBeacon('/api/voice/stop', new Blob([JSON.stringify(owner)], { type: 'application/json' })); return;
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      if (current !== generation) return;
      let reactionPending = false;
      reactionPoll = setInterval(() => {
        if (current !== generation) return;
        if (lifecycle.automatic && (!reactionsEnabled || !liveFlight() || flight?.simulation?.generation !== automaticGeneration)) lifecycle.interrupt(false);
        if (reactionPending || !reactionsEnabled || document.hidden || !liveFlight()) return;
        reactionPending = true;
        const started = performance.now(), pilotAction = lastPilotAction;
        void request('/reaction', { ...owner, idle: lifecycle.phase === 'idle' && started - lastPilotAction > 1500 }).then(value => {
          if (!value.turn) return;
          const turn = voiceTurnSchema.parse(value.turn);
          if (current !== generation || !reactionsEnabled || document.hidden || !liveFlight() || pilotAction !== lastPilotAction
            || performance.now() - started >= turn.validForMs || turn.generation !== flight?.simulation?.generation) return;
          automaticGeneration = turn.generation; activeReactionId = turn.reactionId;
          lifecycle.react(turn.instructions, Math.max(1, (turn.reactionRemainingMs ?? 15000) - (performance.now() - started))); // Rechecks idle after the HTTP round trip.
        }).catch(() => { if (current === generation && lifecycle.automatic) lifecycle.interrupt(false); })
          .finally(() => { reactionPending = false; });
      }, 1000);
      let pending = false;
      heartbeat = setInterval(() => {
        if (pending) return;
        pending = true;
        void request('/heartbeat', owner).catch(() => { if (current === generation) stop('The session or server connection ended. Please reconnect.'); }).finally(() => { pending = false; });
      }, 5000);
    } catch (failure) {
      if (current === generation) stop(failure instanceof Error ? failure.message : 'Could not connect voice.');
    }
  })();
});
disconnect.addEventListener('click', () => stop());
talk.addEventListener('pointerdown', event => {
  if (event.button !== 0 || talk.disabled) return;
  event.preventDefault(); lastPilotAction = performance.now(); talk.setPointerCapture(event.pointerId); lifecycle.down();
});
talk.addEventListener('pointerup', () => lifecycle.up());
talk.addEventListener('pointercancel', () => lifecycle.cancel());
talk.addEventListener('lostpointercapture', () => lifecycle.cancel());
talk.addEventListener('keydown', event => {
  if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) { lastPilotAction = performance.now(); lifecycle.down(); } }
});
talk.addEventListener('keyup', event => {
  if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); lifecycle.up(); }
});
talk.addEventListener('blur', () => lifecycle.cancel());
window.addEventListener('blur', () => lifecycle.cancel());
window.addEventListener('pagehide', () => stop());
document.addEventListener('visibilitychange', () => { if (document.hidden && resources) stop('Voice disconnected when the page was hidden.'); });
document.addEventListener('pax-session', event => {
  const next = (event as CustomEvent<string | null>).detail;
  if (next !== sessionId) { stop(); transcript.textContent = ''; usage.textContent = ''; sessionId = next; render(); }
});
document.addEventListener('pax-flight', event => {
  flight = (event as CustomEvent<ServerSnapshot | null>).detail; flightReceivedAt = performance.now();
  if (lifecycle.automatic && (!liveFlight() || flight?.simulation?.generation !== automaticGeneration)) lifecycle.interrupt(false);
});
document.addEventListener('pax-reactions-enabled', event => {
  reactionsEnabled = (event as CustomEvent<boolean>).detail;
  if (!reactionsEnabled && lifecycle.automatic) lifecycle.interrupt(false);
});
void refresh(); setInterval(() => void refresh(), 3000);
