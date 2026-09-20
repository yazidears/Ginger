import assert from 'node:assert/strict';
import {parseHomeLocations} from '../src/lib/home-geocoding';
assert.throws(() => parseHomeLocations({}));
assert.deepEqual(parseHomeLocations({features: []}), []);
const good = {geometry: {type: 'Point', coordinates: [2.17, 41.39]}, properties: {street: 'Example street', housenumber: '1', city: 'Barcelona', country: 'Spain'}};
assert.deepEqual(parseHomeLocations({features: [good]}), [{label: 'Example street 1, Barcelona, Spain', lat: 41.39, lon: 2.17}]);
for (const coordinates of [[181, 41], [2, 91], [null, 41], ['2', 41], [NaN, 41]]) assert.deepEqual(parseHomeLocations({features: [{...good, geometry: {type: 'Point', coordinates}}]}), []);
assert.deepEqual(parseHomeLocations({features: [{...good, geometry: {type: 'Polygon', coordinates: [2, 41]}}, null]}), []);
console.log('PASS home geocoding: result labels, invalid coordinates, malformed payloads, and empty results');
for (const placeType of ['school','hospital'] as const) {
 const result = parseHomeLocations({features: [{...good, properties: {...good.properties, osm_key: 'amenity', osm_value: placeType}}]})[0];
 assert.equal(result.placeType, placeType);
}
assert.equal(parseHomeLocations({features: [{...good, properties: {...good.properties, name: 'Hospital Street'}}]})[0].placeType, undefined);
console.log('PASS place types: explicit school and hospital tags; no classification guessed from names');
