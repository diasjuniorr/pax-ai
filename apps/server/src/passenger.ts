import { randomInt, randomUUID } from 'node:crypto';
import { flightSessionInputSchema, flightSessionSchema, passengerProfileSchema, type FlightSession, type PassengerProfile } from '@pax/shared';

// Coherent starter profiles; generation is one source of the same editable model.
const profiles: PassengerProfile[] = [
  { name: 'Sofia Martins', age: 34, gender: 'Woman', occupation: 'Architect', tripReason: 'Visiting a friend for a long weekend', personalityTraits: ['observant', 'warm', 'thoughtful'], flightDisposition: 'curious' },
  { name: 'Daniel Reed', age: 46, gender: 'Man', occupation: 'Teacher', tripReason: 'Traveling to a family reunion', personalityTraits: ['friendly', 'patient', 'talkative'], flightDisposition: 'calm' },
  { name: 'Alex Chen', age: 27, gender: 'Nonbinary', occupation: 'Photographer', tripReason: 'Taking landscape photos on a short holiday', personalityTraits: ['creative', 'inquisitive', 'adventurous'], flightDisposition: 'enthusiastic' },
  { name: 'Maya Patel', age: 39, gender: 'Woman', occupation: 'Baker', tripReason: 'Visiting a sibling who recently moved away', personalityTraits: ['kind', 'practical', 'reserved'], flightDisposition: 'nervous' },
];
export function generatePassenger(): PassengerProfile {
  return passengerProfileSchema.parse(profiles[randomInt(profiles.length)]);
}
export class FlightSessionStore {
  private session: FlightSession | null = null;
  snapshot() { return { session: this.session ? flightSessionSchema.parse(this.session) : null }; }
  start(input: unknown) {
    const parsed = flightSessionInputSchema.parse(input);
    if (this.session) return null;
    this.session = { ...parsed, id: randomUUID(), startedAt: Date.now() };
    return this.snapshot().session!;
  }
  end(id: string) {
    if (!this.session || this.session.id !== id) return false;
    this.session = null;
    return true;
  }
}
