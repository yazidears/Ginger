import assert from 'node:assert/strict';
import {crownArrivalMinutes} from '../src/lib/forest/arrival';
import type {ForestTree} from '../src/lib/forest/types';
const cell=(arrival:number):GeoJSON.Feature=>({type:'Feature',properties:{arrival},geometry:{type:'Polygon',coordinates:[[[2,41],[2.0002,41],[2.0002,41.0002],[2,41.0002],[2,41]]]}});
const trees=[{lon:2.0001,lat:41.0001},{lon:2.0004,lat:41.0001}] as ForestTree[];
assert.deepEqual(crownArrivalMinutes(trees,{type:'FeatureCollection',features:[cell(10),cell(5)]}),[5,Infinity]);
assert.deepEqual(crownArrivalMinutes(trees,{type:'FeatureCollection',features:[]}),[Infinity,Infinity]);
console.log('Crown arrival: polygon membership, earliest overlap, and unmodelled crowns passed');
