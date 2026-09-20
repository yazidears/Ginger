import assert from 'node:assert/strict';
import {crownArrivalLookup,crownExposureState} from '../src/lib/sage/crown-exposure';
const lookup=crownArrivalLookup({type:'FeatureCollection',features:[{type:'Feature',properties:{arrivalCentral:50},geometry:{type:'Polygon',coordinates:[[[2,41],[2.001,41],[2.001,41.001],[2,41.001],[2,41]]] }},{type:'Feature',properties:{arrivalCentral:null,arrivalMin:10},geometry:{type:'Polygon',coordinates:[[[3,41],[3.001,41],[3.001,41.001],[3,41.001],[3,41]]]}}]});
assert.equal(lookup(2.0005,41.0005),50);assert.equal(lookup(3.0005,41.0005),null);assert.equal(lookup(4,40),null);
assert.equal(crownExposureState(50,49),'unreached');assert.equal(crownExposureState(50,50),'front');assert.equal(crownExposureState(50,54),'reached');assert.equal(crownExposureState(50,0),'unreached');assert.equal(crownExposureState(null,240),'unreached');
console.log('Crown exposure: central-only arrival, outside coverage, forward and backward scrub passed.');
