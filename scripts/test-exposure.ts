import assert from 'node:assert/strict';
import {ExposureIndex, distanceToGeometry, emptyCounts, unavailableExposure, highReceptivityTrigger} from '../src/lib/exposure/model';
import type {ExposureDataset, ExposureFeature, ExposureCategory, ExposureGeometry} from '../src/lib/exposure/types';
assert.equal(highReceptivityTrigger(65,false),true);assert.equal(highReceptivityTrigger(64.9,false),false);assert.equal(highReceptivityTrigger(95,true),false);assert.equal(highReceptivityTrigger(null,false),false);assert.equal(highReceptivityTrigger(NaN,false),false);
const now=Date.parse('2026-09-19T12:00:00Z');
const feature=(id:string, category:ExposureCategory, geometry:ExposureGeometry):ExposureFeature=>({type:'Feature',geometry,properties:{id,name:id,category,kind:category,source:'Fixture',sourceUrl:'https://example.com',occupancy:null}});
const square=(d:number):number[][]=>[[2-d,41-d],[2+d,41-d],[2+d,41+d],[2-d,41+d],[2-d,41-d]];
const point=(id:string,category:ExposureCategory,distanceM:number)=>feature(id,category,{type:'Point',coordinates:[2,41+distanceM/111195]});
const data=(features:ExposureFeature[]):ExposureDataset=>({type:'FeatureCollection',features,metadata:{version:1,importedAt:'2026-09-19T11:00:00Z',sourceDate:'2026-09-18T20:00:00Z',source:'fixture',sourceUrl:'fixture',license:'fixture',skipped:0,coverage:{type:'MultiPolygon',coordinates:[[square(1)]]},counts:emptyCounts()}});
const index=new ExposureIndex(data([point('school','school',100),point('hospital','healthcare',1000),point('edge','gathering',2000),point('outside','complex',3000),feature('road','road',{type:'LineString',coordinates:[[1.9,41],[2.1,41]]})]));
const active=index.summary(2,41,1500,true,now),inactive=index.summary(2,41,1500,false,now);
assert.equal(active.total,4);assert.equal(active.counts?.complex,0);assert.equal(active.uplift,22);assert.equal(inactive.uplift,0);assert.equal(inactive.score,22);
assert.equal(active.nearby.find(f=>f.properties.id==='road')?.properties.distanceM,0);
assert.equal(distanceToGeometry(2,41,{type:'Polygon',coordinates:[square(.1)]}),0);
assert.ok(distanceToGeometry(2,41,{type:'Polygon',coordinates:[square(.1),square(.01)]})>800,'holes are outside the footprint');
assert.equal(distanceToGeometry(2,41,{type:'MultiPolygon',coordinates:[[square(.1)]]}),0);
assert.equal(new ExposureIndex(data(Array.from({length:1000},(_,i)=>point(`road${i}`,'road',10)))).summary(2,41,1500,true,now).uplift,6,'road segmentation is capped');
const dense=new ExposureIndex(data(Array.from({length:1000},(_,i)=>point(`school${i}`,'school',10)))).summary(2,41,1500,true,now);
assert.equal(dense.total,1000);assert.equal(dense.nearby.length,100);assert.equal(dense.uplift,16,'summary cap does not change full count');
assert.equal(index.summary(10,50,1500,true,now).total,null);
assert.equal(unavailableExposure(1500,true).score,null);
assert.equal(index.summary(2,41,1500,true,now+40*86400000).status,'stale');
assert.equal(index.summary(2.999,41,1500,true,now).status,'partial');
assert.equal(new ExposureIndex(data([])).summary(2,41,1500,true,now).total,0);
const points=Array.from({length:200},(_,i)=>point(`p${i}`,'school',i*31));
const indexed=new ExposureIndex(data(points)).summary(2,41,1500,true,now);
assert.equal(indexed.total,points.filter(f=>distanceToGeometry(2,41,f.geometry)<=2500).length,'index matches brute-force geometry query');
console.log('Exposure checks passed: geometry, holes, crossing roads, distance decay, caps, hazard gating, coverage, missing/stale data, complete scoring despite display limits.');

async function checkStore() {
  const {mkdtemp, writeFile, rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {readExposureIndex,readExposure}=await import('../src/lib/exposure/store');
  const dir=await mkdtemp(join(tmpdir(),'ginger-exposure-test-'));
  const prior=process.env.GINGER_EXPOSURE_FILE;
  try {
    process.env.GINGER_EXPOSURE_FILE=join(dir,'inventory.geojson');
    assert.equal((await readExposure(2,41,1500,true)).status,'unavailable');
    await writeFile(process.env.GINGER_EXPOSURE_FILE,JSON.stringify(data([point('s','school',10)])));
    assert.equal((await readExposureIndex()).summary(2,41,1500,true,now).total,1);
    await writeFile(process.env.GINGER_EXPOSURE_FILE,JSON.stringify(data([point('s','school',10),point('h','healthcare',10)])));
    assert.equal((await readExposureIndex()).summary(2,41,1500,true,now).total,2,'replacement reloads without server restart');
    const {GET}=await import('../src/app/api/exposure/route');
    assert.equal((await GET(new Request('http://localhost/api/exposure?bbox=bad'))).status,400);
    assert.equal((await GET(new Request('http://localhost/api/exposure?categories=__proto__'))).status,400);
    const schools=await (await GET(new Request('http://localhost/api/exposure?bbox=1.9,40.9,2.1,41.1&categories=school'))).json();
    assert.equal(schools.features.length,1);assert.equal(schools.features[0].properties.category,'school');
    assert.equal((await GET(new Request('http://localhost/api/exposure?bbox=-180,-85,180,85'))).status,200);
    await writeFile(process.env.GINGER_EXPOSURE_FILE,JSON.stringify(data([...Array.from({length:5100},(_,i)=>point(`s${i}`,'school',10)),point('h','healthcare',10)])));
    const capped=await (await GET(new Request('http://localhost/api/exposure?bbox=1.9,40.9,2.1,41.1'))).json();
    assert.equal(capped.features.length,5000);assert.equal(capped.total,5101);assert.equal(capped.truncated,true);
    assert.ok(capped.features.some((f:ExposureFeature)=>f.properties.category==='healthcare'),'map cap preserves sparse categories');
    assert.equal((await readExposureIndex()).summary(2,41,1500,true,now).total,5101);
    await writeFile(process.env.GINGER_EXPOSURE_FILE,'{invalid');
    assert.equal((await readExposure(2,41,1500,true)).status,'unavailable','corrupt data never means no assets');
    assert.equal((await GET(new Request('http://localhost/api/exposure'))).status,503);
    console.log('Exposure persistence/API checks passed: missing file, load, replacement, corruption, category filters, invalid queries, world bounds, map caps and full server scoring.');
  } finally {
    if(prior===undefined)delete process.env.GINGER_EXPOSURE_FILE;else process.env.GINGER_EXPOSURE_FILE=prior;
    await rm(dir,{recursive:true,force:true});
  }
}
void checkStore().catch(error=>{console.error(error);process.exitCode=1;});
