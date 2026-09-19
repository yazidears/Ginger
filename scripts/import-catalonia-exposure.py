"""Build a server-side exposure inventory from the complete Geofabrik Catalonia PBF.
Requires osmium (requirements-exposure.txt). No per-assessment network queries.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import urllib.request
import osmium

URL = 'https://download.geofabrik.de/europe/spain/cataluna-latest.osm.pbf'
CATEGORIES = ('school', 'healthcare', 'complex', 'road', 'gathering')


def classify(t):
    amenity = t.get('amenity', '')
    if amenity in ('school', 'kindergarten', 'college', 'university'):
        return 'school', amenity
    if amenity in ('hospital', 'clinic', 'nursing_home') or t.get('healthcare') in ('hospital', 'clinic') or t.get('social_facility') in ('nursing_home', 'assisted_living'):
        return 'healthcare', amenity or t.get('healthcare') or t.get('social_facility')
    if t.get('highway') in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'):
        return 'road', t['highway']
    if amenity in ('marketplace', 'bus_station', 'place_of_worship', 'community_centre', 'theatre', 'cinema', 'conference_centre') or t.get('leisure') in ('stadium', 'sports_centre', 'water_park', 'amusement_arcade') or t.get('tourism') in ('camp_site', 'caravan_site', 'hotel', 'attraction', 'theme_park') or t.get('railway') == 'station' or t.get('shop') == 'mall' or t.get('place') == 'square' or t.get('natural') == 'beach':
        return 'gathering', amenity or t.get('leisure') or t.get('tourism') or t.get('railway') or t.get('shop') or t.get('place') or t.get('natural')
    if t.get('landuse') in ('residential', 'commercial', 'industrial', 'retail'):
        return 'complex', t['landuse']
    return None


def parse_poly(text):
    polygons, ring, hole = [], None, False
    for line in text.splitlines()[1:]:
        line = line.strip()
        if not line:
            continue
        if line == 'END':
            if ring is not None:
                if ring[0] != ring[-1]:
                    ring.append(ring[0])
                if hole:
                    polygons[-1].append(ring)
                else:
                    polygons.append([ring])
                ring = None
            else:
                break
        elif ring is None:
            hole, ring = line.startswith('!'), []
        else:
            ring.append([float(n) for n in line.split()])
    if not polygons:
        raise ValueError('Missing extract coverage')
    return {'type': 'MultiPolygon', 'coordinates': polygons}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pbf', type=Path, default=Path('.ginger-data/exposure/cataluna.osm.pbf'))
    parser.add_argument('--output', type=Path, default=Path(os.environ.get('GINGER_EXPOSURE_FILE', '.ginger-data/exposure/catalonia.geojson')))
    parser.add_argument('--download', action='store_true', help='Download latest extract before importing')
    args = parser.parse_args()
    args.pbf.parent.mkdir(parents=True, exist_ok=True)
    if args.download:
        temporary = args.pbf.with_suffix('.download')
        with urllib.request.urlopen(URL, timeout=120) as response, temporary.open('wb') as out:
            while block := response.read(1024 * 1024):
                out.write(block)
        temporary.replace(args.pbf)
    with urllib.request.urlopen('https://download.geofabrik.de/europe/spain/cataluna.poly', timeout=30) as response:
        coverage = parse_poly(response.read().decode())
    reader = osmium.io.Reader(str(args.pbf))
    source_date = reader.header().get('osmosis_replication_timestamp')
    reader.close()
    if not source_date:
        raise ValueError('PBF has no source timestamp; refusing an undated inventory')
    features, skipped = {}, 0
    factory = osmium.geom.GeoJSONFactory()
    for obj in osmium.FileProcessor(str(args.pbf)).with_areas():
        if not len(obj.tags):
            continue
        match = classify(obj.tags)
        if not match:
            continue
        category, kind = match
        try:
            if obj.is_node():
                geometry = json.loads(factory.create_point(obj))
                identity = f'node/{obj.id}'
            elif obj.is_way() and category == 'road':
                geometry = json.loads(factory.create_linestring(obj))
                identity = f'way/{obj.id}'
            elif obj.is_area() and category != 'road':
                geometry = json.loads(factory.create_multipolygon(obj))
                identity = f'{"way" if obj.from_way() else "relation"}/{obj.orig_id()}'
            else:
                continue
        except (RuntimeError, ValueError):
            skipped += 1
            continue
        tags = obj.tags
        features[identity] = {'type': 'Feature', 'id': identity, 'geometry': geometry, 'properties': {
            'id': identity, 'name': tags.get('name') or tags.get('name:ca') or tags.get('ref') or kind.replace('_', ' '),
            'category': category, 'kind': kind, 'source': 'OpenStreetMap / Geofabrik',
            'sourceUrl': f'https://www.openstreetmap.org/{identity}', 'occupancy': None}}
    counts = Counter(f['properties']['category'] for f in features.values())
    if any(counts[c] == 0 for c in CATEGORIES):
        raise ValueError(f'Incomplete category inventory: {counts}')
    data = {'type': 'FeatureCollection', 'metadata': {
        'version': 1, 'importedAt': datetime.now(timezone.utc).isoformat(), 'sourceDate': source_date,
        'source': 'OpenStreetMap / Geofabrik Catalonia extract', 'sourceUrl': URL,
        'license': 'ODbL-1.0 © OpenStreetMap contributors', 'skipped': skipped, 'coverage': coverage,
        'counts': dict(counts)}, 'features': list(features.values())}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix('.tmp')
    with temporary.open('w') as out:
        json.dump(data, out, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
        out.flush()
        os.fsync(out.fileno())
    temporary.replace(args.output)
    print(json.dumps({'path': str(args.output), 'features': len(features), 'counts': counts, 'skipped': skipped, 'sourceDate': source_date}))


if __name__ == '__main__':
    main()
