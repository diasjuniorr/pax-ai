import { z } from 'zod';

const finite = z.number().finite();
export const aircraftTelemetrySchema = z.object({
  timestamp: finite.int().nonnegative(), // UTC Unix milliseconds, bridge capture time
  latitude: finite.min(-90).max(90),
  longitude: finite.min(-180).max(180),
  altitudeMslFeet: finite,
  altitudeAglFeet: finite,
  indicatedAirspeedKnots: finite,
  verticalSpeedFpm: finite,
  headingTrueDegrees: finite.min(0).lt(360),
  onGround: z.boolean(),
  gearExtensionPercent: finite.min(0).max(100),
  flapsLeftExtensionPercent: finite.min(0).max(100),
  flapsRightExtensionPercent: finite.min(0).max(100),
});
export type AircraftTelemetry = z.infer<typeof aircraftTelemetrySchema>;

// A full snapshot doubles as a heartbeat. No telemetry replay on a dead SimConnect session.
export const bridgeMessageSchema = z.object({
  version: z.literal(1), type: z.literal('bridgeSnapshot'),
  simulatorConnected: z.boolean(),
  telemetry: aircraftTelemetrySchema.nullable(),
}).refine(m => m.simulatorConnected || m.telemetry === null,
  'Disconnected snapshots must not contain telemetry');
export type BridgeMessage = z.infer<typeof bridgeMessageSchema>;

export const serverSnapshotSchema = z.object({
  version: z.literal(1), type: z.literal('snapshot'),
  bridgeConnected: z.boolean(), simulatorConnected: z.boolean(),
  telemetryState: z.enum(['waiting', 'live', 'stale']),
  lastReceivedAt: finite.nullable(), telemetry: aircraftTelemetrySchema.nullable(),
});
export type ServerSnapshot = z.infer<typeof serverSnapshotSchema>;

const shortText = (max: number) => z.string().trim().min(1).max(max);
export const passengerProfileSchema = z.object({
  name: shortText(80), age: z.number().int().min(1).max(120),
  gender: shortText(60), occupation: shortText(100), tripReason: shortText(400),
  personalityTraits: z.array(shortText(40)).min(1).max(6).refine(values =>
    new Set(values.map(value => value.toLowerCase())).size === values.length, 'Use distinct personality traits'),
  flightDisposition: z.enum(['calm', 'curious', 'nervous', 'enthusiastic']),
}).strict();
export type PassengerProfile = z.infer<typeof passengerProfileSchema>;
export const flightSessionInputSchema = z.object({
  passenger: passengerProfileSchema,
  expectedDurationMinutes: z.number().int().min(1).max(1440),
  origin: shortText(120).optional(), destination: shortText(120).optional(),
}).strict();
export const flightSessionSchema = flightSessionInputSchema.extend({
  id: z.string().uuid(), startedAt: z.number().int().nonnegative(),
});
export type FlightSession = z.infer<typeof flightSessionSchema>;
export const flightSessionStateSchema = z.object({ session: flightSessionSchema.nullable() });

export const conversationInputSchema = z.object({
  sessionId: z.string().uuid(), requestId: z.string().uuid(), message: shortText(2000),
}).strict();
export const conversationStateSchema = z.object({
  voiceActive: z.boolean().optional(),
  sessionId: z.string().uuid().nullable(), configured: z.boolean(), status: z.enum(['idle', 'processing']),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).max(20),
});
export type ConversationState = z.infer<typeof conversationStateSchema>;

export const voiceOwnerSchema = z.object({ sessionId: z.string().uuid(), connectionId: z.string().uuid() }).strict();
export const voiceStartSchema = voiceOwnerSchema.extend({ sdp: z.string().min(1).max(100000).startsWith('v=0') });
export const voiceAvailabilitySchema = z.object({ configured: z.boolean(), active: z.boolean() });
