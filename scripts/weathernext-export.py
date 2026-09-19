#!/usr/bin/env python3
"""Authenticated WeatherNext 3 point forecasts; never substitutes simulated values."""
import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

COLLECTION = 'projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p1deg'
CATALOG = 'https://developers.google.com/earth-engine/datasets/catalog/projects_gcp-public-data-weathernext_assets_weathernext_3_0_0_0p1deg'
STATS = ('mean', 'p10', 'p25', 'p50', 'p75', 'p90')
# Catalog-verified names and units, 2026-09-19. Direct wind speed statistics
# avoid the invalid practice of deriving wind-speed quantiles from U/V quantiles.
VARIABLES = {
    'temperature2m': ('temperature_2m', 'K', 'degC', 1, -273.15),
    'dewpoint2m': ('dewpoint_temperature_2m', 'K', 'degC', 1, -273.15),
    'windSpeed10m': ('wind_speed_10m', 'm/s', 'km/h', 3.6, 0),
    'windU10m': ('u_component_of_wind_10m', 'm/s', 'm/s', 1, 0),
    'windV10m': ('v_component_of_wind_10m', 'm/s', 'm/s', 1, 0),
    'precipitation1h': ('total_precipitation_1hr', 'm', 'mm', 1000, 0),
}
BANDS = [f'{v[0]}_{stat}' for v in VARIABLES.values() for stat in STATS]


def iso(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise argparse.ArgumentTypeError('Timestamp requires timezone, e.g. 2026-09-19T12:00:00Z')
    return parsed.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def normalize(properties):
    values = properties['values']
    variables = {}
    for name, (base, original_unit, unit, multiplier, offset) in VARIABLES.items():
        stats = {}
        for stat in STATS:
            raw = values.get(f'{base}_{stat}')
            stats[stat] = round(raw * multiplier + offset, 6) if isinstance(raw, (float, int)) and math.isfinite(raw) else None
        variables[name] = {'unit': unit, 'sourceUnit': original_unit, 'statistics': stats,
                           'bands': {stat: f'{base}_{stat}' for stat in STATS}}
    return {'issuedAt': properties['issuedAt'], 'validAt': properties['validAt'],
            'forecastHour': properties['forecastHour'], 'ingestionTimeUtc': properties.get('ingestionTimeUtc'),
            'variables': variables, 'complete': all(v is not None for item in variables.values() for v in item['statistics'].values())}


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--lat', type=float, required=True)
    p.add_argument('--lon', type=float, required=True)
    p.add_argument('--valid-at', type=iso, help='First desired valid time (UTC or timezone-aware ISO); default now')
    p.add_argument('--steps', type=int, default=24, help='Hourly steps to export, 1–48 (default 24)')
    p.add_argument('--output', type=Path, help='Output JSON path; default stdout')
    p.add_argument('--dry-schema', action='store_true', help='Print contract and verified bands without credentials or network')
    return p


def main():
    p = parser()
    args = p.parse_args()
    if not math.isfinite(args.lat) or not -90 <= args.lat <= 90 or not math.isfinite(args.lon) or not -180 <= args.lon <= 180:
        p.error('Coordinates must be finite and within latitude ±90, longitude ±180')
    if not 1 <= args.steps <= 48:
        p.error('--steps must be between 1 and 48')
    if args.dry_schema:
        print(json.dumps({'schemaVersion': 1, 'status': 'schema-only', 'collection': COLLECTION,
                          'catalog': CATALOG, 'bands': BANDS, 'statistics': STATS,
                          'location': {'latitude': args.lat, 'longitude': args.lon},
                          'outputFields': ['issuedAt', 'validAt', 'forecastHour', 'variables', 'complete'],
                          'liveAccessTested': False}, indent=2))
        return 0
    project = os.environ.get('GOOGLE_CLOUD_PROJECT', '').strip()
    if not project:
        p.error('Set GOOGLE_CLOUD_PROJECT to your registered Earth Engine project')
    # Lazy imports keep --help / --dry-schema usable without optional dependencies.
    import ee
    import google.auth
    credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
    ee.Initialize(credentials=credentials, project=project)
    ee.data.setDeadline(60000)
    now = datetime.now(timezone.utc)
    requested = args.valid_at or now.isoformat().replace('+00:00', 'Z')
    point = ee.Geometry.Point([args.lon, args.lat])
    collection = ee.ImageCollection(COLLECTION).filterBounds(point)
    # Sort initialization, not valid time: the latter selects furthest forecast.
    latest = collection.sort('start_time', False).first()
    issued = latest.get('start_time').getInfo()
    if not issued:
        raise RuntimeError('No accessible WeatherNext initialization found')
    run = (collection.filter(ee.Filter.eq('start_time', issued))
           .filter(ee.Filter.gte('end_time', requested))
           .sort('forecast_hour').limit(args.steps))
    count = run.size().getInfo()
    if not count:
        raise RuntimeError('Latest run has no valid forecast at or after requested time')
    actual_bands = ee.Image(run.first()).bandNames().getInfo()
    missing = sorted(set(BANDS) - set(actual_bands))
    if missing:
        raise RuntimeError('Provider schema changed; missing verified bands: ' + ', '.join(missing))

    def sample(image):
        image = ee.Image(image)
        values = image.select(BANDS).reduceRegion(reducer=ee.Reducer.first(), geometry=point,
                                                  scale=10000, maxPixels=100)
        return ee.Feature(None, {'issuedAt': image.get('start_time'), 'validAt': image.get('end_time'),
                                'forecastHour': image.get('forecast_hour'),
                                'ingestionTimeUtc': image.get('ingestion_time_utc'), 'values': values})

    features = ee.FeatureCollection(run.toList(count).map(sample)).getInfo()['features']
    forecasts = [normalize(feature['properties']) for feature in features]
    if not any(f['complete'] for f in forecasts):
        raise RuntimeError('No complete point samples returned; output withheld')
    payload = {'schemaVersion': 1, 'status': 'live' if all(f['complete'] for f in forecasts) else 'partial',
               'source': {'provider': 'Google DeepMind WeatherNext 3', 'collection': COLLECTION, 'catalog': CATALOG,
                          'gridResolutionDegrees': 0.1, 'sampleScaleMeters': 10000, 'actualBands': actual_bands},
               'retrievedAt': now.isoformat().replace('+00:00', 'Z'), 'issuedAt': issued,
               'requestedValidAt': requested, 'location': {'latitude': args.lat, 'longitude': args.lon},
               'forecasts': forecasts,
               'limitations': ['Experimental model forecast; not an observation or official warning.',
                               'Marginal quantiles are not coherent joint weather scenarios.',
                               'Point sample represents a coarse grid cell, not local terrain-resolved wind.']}
    content = json.dumps(payload, indent=2, allow_nan=False) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + '.tmp')
        temporary.write_text(content, encoding='utf-8')
        temporary.replace(args.output)
    else:
        print(content, end='')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        # No credentials, request URLs or raw remote response bodies in logs.
        print(f'WeatherNext export failed ({type(exc).__name__}). Check ADC, project registration, '
              'allowlist access, forecast availability and documented band schema.', file=sys.stderr)
        sys.exit(1)
