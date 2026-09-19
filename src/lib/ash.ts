import type {Assessment} from './assessment';

export function buildAshReply(question: string, assessment: Assessment, now = Date.now()) {
  const q = question.toLowerCase();
  const fresh = (time: string, age: number) => Number.isFinite(Date.parse(time)) && now - Date.parse(time) >= 0 && now - Date.parse(time) <= age;
  const sources = assessment.sources.map(s => ({...s, status: s.status === 'live' && !fresh(s.retrievedAt, s.source.includes('OpenStreetMap') ? 86400000 : 1800000) ? 'stale' as const : s.status}));
  const weatherSource = sources.find(s => s.source === 'Open-Meteo');
  const satelliteSource = sources.find(s => /FIRMS|satellite|VIIRS|MODIS/i.test(s.source));
  const current = assessment.weather.current;
  const weather = weatherSource?.status === 'live' && current && fresh(current.time, 3600000) ? current : null;
  const hotspots = satelliteSource?.status === 'live' ? assessment.satellite.hotspots.filter(h => fresh(h.provenance.observedAt, 6 * 3600000)).length : null;
  const weatherText = weather ? `Modelled weather: ${weather.temperatureC} degrees Celsius, ${weather.humidityPct}% humidity. Wind ${weather.windKmh} kilometres per hour, from ${weather.windFromDegrees} degrees north. Valid at ${weather.time}.` : 'Current weather is unavailable or stale.';
  const fireText = hotspots === null ? 'Satellite evidence is unavailable or stale.' : `${hotspots} satellite thermal detections within 10 kilometres in the past six hours. These are not confirmed fires; zero detections is not an all-clear.`;
  let answer: string;
  let topic: string;
  if (/\b(safe|escape|evacuat\w*|route|arrival|spread)\b/.test(q)) {
    topic = 'Unverified operational information';
    answer = 'Ginger has no validated fire arrival times, evacuation routes or road closures for this location. Ash cannot establish a safe route. ' + assessment.forecast.reason;
  } else if (/\b(weather|wind|humid\w*|temperature|rain)\b/.test(q)) {
    topic = 'Weather'; answer = weatherText;
  } else if (/\b(fire|satellite|hotspot\w*|detection\w*)\b/.test(q)) {
    topic = 'Satellite observations'; answer = fireText;
  } else if (/\b(brief\w*|update\w*|status|situation|changed|happening)\b/.test(q)) {
    topic = 'Field briefing'; answer = `${weatherText} ${fireText} Validated fire spread and road closures are unavailable.`;
  } else {
    topic = 'More context needed'; answer = 'I can summarize Ginger weather, satellite detections and the current briefing at the selected location. Ask about one of those. I do not have crew positions, radio traffic or dispatch orders.';
  }
  return {mode:'connected' as const, topic, answer, generatedAt: new Date(now).toISOString(), location: assessment.location, weather, hotspots, sources, missing: assessment.completeness.missing};
}
