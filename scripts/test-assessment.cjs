// Run server-module tests with Node's real react-server export condition.
if (!process.execArgv.includes('--conditions=react-server') && !(process.env.NODE_OPTIONS || '').includes('--conditions=react-server')) {
  const result = require('node:child_process').spawnSync(process.execPath, ['--conditions=react-server', __filename, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {parseWeather,parseGeography,validateLocation}=require('../src/lib/assessment.ts');
let count=0;function test(name,fn){fn();console.log('PASS',name);count++;}
const now=Date.parse('2026-09-19T12:15Z');
function fixture(){const time=Array.from({length:97},(_,i)=>new Date(Date.parse('2026-09-16T12:00Z')+i*3600000).toISOString().slice(0,16));return{elevation:300,hourly_units:{temperature_2m:'°C',relative_humidity_2m:'%',wind_speed_10m:'km/h',wind_direction_10m:'°',precipitation:'mm'},hourly:{time,temperature_2m:time.map(()=>30),relative_humidity_2m:time.map(()=>20),wind_speed_10m:time.map(()=>28),wind_direction_10m:time.map(()=>180),precipitation:time.map(()=>.5)}};}
test('coordinates reject nonfinite and out of range',()=>{for(const p of [[NaN,0],[0,Infinity],[91,0],[0,-181]])assert.throws(()=>validateLocation(...p));validateLocation(-90,180);});
test('forecast has exact UTC hours and preceding 72h rain',()=>{const w=parseWeather(fixture(),now);assert.equal(w.outlook.length,24);assert.equal(w.current.time,'2026-09-19T12:00Z');assert.equal(w.outlook[23].time,'2026-09-20T11:00Z');assert.equal(w.past72hPrecipitationMm,36);assert.equal(w.current.windFromDegrees,180);});
test('unexpected units rejected instead of relabelled',()=>{const f=fixture();f.hourly_units.wind_speed_10m='mph';assert.throws(()=>parseWeather(f,now));});
test('missing forecast hour cannot silently shift slider',()=>{const f=fixture();f.hourly.temperature_2m[80]=null;assert.throws(()=>parseWeather(f,now));});
test('duplicate forecast timestamp rejected',()=>{const f=fixture();f.hourly.time[80]=f.hourly.time[79];assert.throws(()=>parseWeather(f,now));});
test('missing historical rain remains unknown',()=>{const f=fixture();f.hourly.precipitation[10]=null;assert.equal(parseWeather(f,now).past72hPrecipitationMm,null);});
test('invalid future date and offset timezone rejected',()=>{for(const timestamp of ['2026-02-30T12:00','2026-09-19T13:00+01:00']){const f=fixture();f.hourly.time[72]=timestamp;assert.throws(()=>parseWeather(f,now));}});
const geometry=[{lon:1,lat:1},{lon:2,lat:1},{lon:2,lat:2},{lon:1,lat:1}];
const b=tags=>parseGeography([{type:'way',id:1,tags:{building:'yes',...tags},geometry}]).buildings.features[0].properties;
test('OSM explicit height preserved with attribution',()=>{assert.equal(b({height:'12 m'}).heightM,12);assert.equal(b({height:'12'}).heightSource,'osm-height');});
test('levels-derived height marked estimate',()=>{assert.equal(b({'building:levels':'3'}).heightM,9);assert.equal(b({'building:levels':'3'}).heightSource,'estimated-levels');});
test('unknown heights are null, unsupported feet not treated as metres',()=>{assert.equal(b({}).heightM,null);assert.equal(b({height:'30 ft'}).heightM,null);});
test('incomplete polygon not invented; landcover style class exposed',()=>{assert.equal(parseGeography([{type:'way',id:1,tags:{building:'yes'},geometry:geometry.slice(0,3)}]).buildings.features.length,0);assert.equal(parseGeography([{type:'way',id:2,tags:{natural:'wood'},geometry}]).landcover.features[0].properties.natural,'wood');});
test('road capacity and asset population stay unknown',()=>{const g=parseGeography([{type:'way',id:3,tags:{highway:'primary'},geometry},{type:'node',id:4,lat:1,lon:1,tags:{amenity:'school'}}]);assert.equal(g.roads.features[0].properties.capacity,null);assert.equal(g.assets.features[0].properties.population,null);});
test('missing unit metadata cannot silently become Celsius',()=>{const f=fixture();delete f.hourly_units;assert.throws(()=>parseWeather(f,now));});
test('invalid polygon vertex does not silently reconstruct a footprint',()=>{const bad=[...geometry.slice(0,2),{lon:999,lat:2},...geometry.slice(2)];assert.equal(parseGeography([{type:'way',id:9,tags:{building:'yes'},geometry:bad}]).buildings.features.length,0);});
test('invalid asset coordinates are omitted',()=>{assert.equal(parseGeography([{type:'node',id:10,lat:100,lon:1,tags:{amenity:'school'}}]).assets.features.length,0);});
console.log(`${count} assessment checks passed`);
