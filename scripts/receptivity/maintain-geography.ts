import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
/** Static/slow-changing layers are refreshed independently of observations. */
export async function maintainGeography(){
 const root=process.cwd(),file=join(root,'data/receptivity/barcelona-grid.json');
 let geo:{preparedAt?:string;vegetationUpdatedAt?:string}={};try{geo=JSON.parse(await readFile(file,'utf8'));}catch{}
 const python=process.env.GINGER_RASTER_PYTHON||join(root,'.venv-receptivity/bin/python');
 const now=Date.now();
 if(!geo.preparedAt||now-Date.parse(geo.preparedAt)>30*86400000){const r=await exec(python,[join(root,'scripts/receptivity/prepare-geography.py')],{timeout:600000,maxBuffer:2_000_000});console.log(r.stdout);}
 if(!geo.vegetationUpdatedAt||now-Date.parse(geo.vegetationUpdatedAt)>86400000){const r=await exec(python,[join(root,'scripts/receptivity/refresh-vegetation.py')],{timeout:600000,maxBuffer:2_000_000});console.log(r.stdout);}
}
