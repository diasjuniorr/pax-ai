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
