import { simulatorWeatherSchema, type AircraftTelemetry, type ServerSnapshot } from '@pax/shared';

const unknownWeather = () => ({
  available: false, precipitation: 'unknown', cloudAtAircraft: 'unknown',
  visibility: 'unknown', wind: 'unknown', skyCoverage: 'unknown',
});

// Only local simulator observations. High particle visibility or no local rain/cloud
// cannot establish a clear sky, sunshine, scenery, or a smooth/safe flight.
export function passengerWeather(sample?: AircraftTelemetry | null) {
  const result = simulatorWeatherSchema.safeParse(sample?.weather);
  if (!result.success || !sample) return unknownWeather();
  const weather = result.data;
  const age = sample.timestamp - weather.timestamp; // Same source clock, not server time.
  if (age < 0 || age > 2500) return unknownWeather();
  return {
    available: [weather.precipitation, weather.inCloud, weather.visibilityMeters, weather.windSpeedKnots].some(value => value !== null),
    precipitation: weather.precipitation ?? 'unknown',
    cloudAtAircraft: weather.inCloud === null ? 'unknown' : weather.inCloud ? 'inside cloud' : 'outside cloud; surrounding sky unknown',
    visibility: weather.inCloud === true ? 'obscured by cloud' : weather.visibilityMeters === null ? 'unknown'
      : weather.visibilityMeters < 1000 ? 'very limited by haze or airborne particles'
      : weather.visibilityMeters < 5000 ? 'limited by haze or airborne particles' : 'overall visibility unknown; no strong particle restriction reported',
    wind: weather.windSpeedKnots === null ? 'unknown' : weather.windSpeedKnots < 5 ? 'light wind around the aircraft'
      : weather.windSpeedKnots < 20 ? 'some wind around the aircraft' : 'strong wind around the aircraft',
    skyCoverage: 'unknown',
  };
}

// Model boundary: passenger-level observations only. Instrument readings remain in
// dashboard telemetry; identity/freshness checks remain in the server control path.
export function flightContext(snapshot?: ServerSnapshot, now = Date.now()) {
  const sample = snapshot?.telemetry;
  const valid = snapshot?.bridgeConnected && snapshot.simulatorConnected && snapshot.simulation?.active
    && snapshot.simulation.aircraftId && snapshot.flight?.status === 'tracking' && snapshot.telemetryState === 'live'
    && snapshot.lastReceivedAt !== null && now - snapshot.lastReceivedAt >= 0 && now - snapshot.lastReceivedAt <= 3000;
  if (!valid || !sample) return { available: false as const, weather: unknownWeather(), location: 'unknown' };
  return {
    available: true as const,
    motion: sample.onGround ? 'on the ground' : sample.verticalSpeedFpm > 150 ? 'climbing'
      : sample.verticalSpeedFpm < -150 ? 'descending' : 'flying approximately level',
    location: 'unknown',
    weather: passengerWeather(sample),
  };
}

// Safe categorical metadata for debugging what the passenger was told, without
// storing prompts, profile text, transcripts or numerical flight readings.
export function contextDiagnostics(context: ReturnType<typeof flightContext>) {
  return { contextAvailable: context.available, weatherAvailable: context.weather.available,
    weatherPrecipitation: context.weather.precipitation, weatherVisibility: context.weather.visibility,
    weatherCloud: context.weather.cloudAtAircraft, weatherWind: context.weather.wind };
}
