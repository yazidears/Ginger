import assert from 'node:assert/strict';
import {createMapStore} from '../src/components/shared-map-store';
import type {TerrainMapProps} from '../src/components/terrain-map';
const empty = {type:'FeatureCollection' as const,features:[]};
const props:TerrainMapProps = {center:[1.7,41.7],focusKey:0,hotspots:empty,buildings:empty,assets:empty,landcover:empty,onSelectPoint:()=>{}};
const store=createMapStore(),prevent=Symbol(),satellite=Symbol(),simulation=Symbol();
let notifications=0;
const unsubscribe=store.subscribe(()=>notifications++);
store.set(prevent,{priority:0,props});
assert.equal(store.getSnapshot()?.focusKey,0);
// Inspect changes local overlays and zoom preference without requesting camera movement.
store.set(prevent,{priority:0,props:{...props,center:[1.83,41.73],initialZoom:12.5,selectedRadiusM:1500}});
assert.equal(store.getSnapshot()?.focusKey,0);
// Explicit selection moves the camera once, while data refreshes do not.
store.set(prevent,{priority:0,props:{...props,focusKey:1}});
assert.equal(store.getSnapshot()?.focusKey,1);
store.set(prevent,{priority:0,props:{...props,focusKey:1,hotspotKind:'observed'}});
assert.equal(store.getSnapshot()?.focusKey,1);
// Switching to another tab with its own local focus counter never resets the camera.
store.set(satellite,{priority:1,props:{...props,center:[-3,40]}});
assert.equal(store.getSnapshot()?.focusKey,1);
assert.deepEqual(store.getSnapshot()?.center,[-3,40]);
store.set(satellite,{priority:1,props:{...props,focusKey:1}});
assert.equal(store.getSnapshot()?.focusKey,2);
// Background updates cannot take over an active simulation.
store.set(simulation,{priority:2,props:{...props,hotspotKind:'simulated'}});
store.set(prevent,{priority:0,props:{...props,focusKey:2}});
assert.equal(store.getSnapshot()?.hotspotKind,'simulated');
assert.equal(store.getSnapshot()?.focusKey,2);
store.remove(simulation);
store.remove(satellite);
assert.equal(store.getSnapshot()?.hotspotKind,undefined);
assert.equal(store.getSnapshot()?.focusKey,2);
store.remove(prevent);
assert.equal(store.getSnapshot()?.focusKey,2);
assert.equal(store.getSnapshot()?.simulation,undefined);
assert.equal(store.getSnapshot()?.receptivity,undefined);
assert.equal(store.getSnapshot()?.selectedRadiusM,0);
assert.deepEqual(store.getSnapshot()?.hotspots,empty);
assert.notEqual(store.getSnapshot()?.onSelectPoint,props.onSelectPoint);
// An equal-priority background publisher must not trigger the active camera.
const tied=createMapStore();
tied.set(prevent,{priority:0,props});
tied.set(satellite,{priority:0,props});
tied.set(satellite,{priority:0,props:{...props,focusKey:1}});
assert.equal(tied.getSnapshot()?.focusKey,0);
unsubscribe();
const before=notifications;
store.set(prevent,{priority:0,props});
assert.equal(notifications,before);
console.log('Shared map: tab continuity, explicit focus, overlay priority, cleanup and subscriptions passed.');
