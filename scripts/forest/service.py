"""Private, resumable Catalonia LiDAR worker. No procedural tree inventory.
Run: GINGER_FOREST_DATA=... uvicorn service:app --host 127.0.0.1 --port 8788
"""
from contextlib import asynccontextmanager
import concurrent.futures as futures
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import threading
import time
import uuid

import laspy
import numpy as np
import requests
import rasterio
from rasterio.transform import from_origin
from pyproj import Transformer
from scipy import ndimage
from skimage.feature import peak_local_max
from skimage.segmentation import watershed
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

ROOT=Path(os.environ.get('GINGER_FOREST_DATA',str(Path.home()/'ginger-data')))
ROOT.mkdir(parents=True,exist_ok=True)
BASE='https://datacloud.icgc.cat/datacloud/lidar-territorial/'
CATALOG_URL=BASE+'json/lidar-territorial-tall.json'
TO_WGS=Transformer.from_crs(25831,4326,always_xy=True)
TO_UTM=Transformer.from_crs(4326,25831,always_xy=True)
POOL=futures.ThreadPoolExecutor(max_workers=2)
LOCK=threading.Lock()
CATALOG={}

def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def db():
 c=sqlite3.connect(ROOT/'forest.sqlite',timeout=30);c.row_factory=sqlite3.Row;return c
with db() as c:
 c.executescript('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS tiles(id TEXT PRIMARY KEY,state TEXT,trees INTEGER DEFAULT 0,error TEXT,updated TEXT); CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,state TEXT,stage TEXT,error TEXT,result TEXT);')

@asynccontextmanager
async def lifespan(app):
 with db() as c:
  c.execute("UPDATE tiles SET state='interrupted',error='Worker restarted; request this tile again.' WHERE state IN ('queued','running')")
  c.execute("UPDATE jobs SET state='interrupted',stage='Worker restarted' WHERE state IN ('queued','running')")
 yield
app=FastAPI(title='Ginger forest worker',docs_url=None,redoc_url=None,lifespan=lifespan)

def atomic_json(path,value):
 path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
 temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(value,separators=(',',':'),allow_nan=False));temp.replace(path)

def load_catalog():
 p=ROOT/'catalog.json'
 if not p.exists():
  r=requests.get(CATALOG_URL,timeout=60);r.raise_for_status();atomic_json(p,r.json())
 data=json.loads(p.read_text())
 if data.get('crs',{}).get('properties',{}).get('name')!='EPSG:25831':raise ValueError('Unexpected LiDAR catalog CRS')
 for f in data['features']:
  p=f['properties'];ring=f['geometry']['coordinates'][0];x=min(v[0] for v in ring);y=min(v[1] for v in ring)
  w,s=TO_WGS.transform(x,y);e,n=TO_WGS.transform(x+1000,y+1000)
  CATALOG[p['ID1K']]={'id':p['ID1K'],'group':p['ID10K'],'x':x,'y':y,'bbox':[w,s,e,n]}
load_catalog()

def bounds_arg(bbox):
 try:b=[float(v) for v in bbox.split(',')]
 except Exception:raise HTTPException(400,'Invalid bounds')
 if len(b)!=4 or not all(math.isfinite(v) for v in b) or not (-180<=b[0]<b[2]<=180 and -90<=b[1]<b[3]<=90):raise HTTPException(400,'Invalid bounds')
 return b

def intersects(a,b):return a[0]<=b[2] and a[2]>=b[0] and a[1]<=b[3] and a[3]>=b[1]
def tile_states():
 with db() as c:return {r['id']:dict(r) for r in c.execute('SELECT * FROM tiles')}
def tile_info(t,states):
 s=states.get(t['id'],{})
 return {'id':t['id'],'bbox':t['bbox'],'state':s.get('state','unprocessed'),'treeCount':s.get('trees',0),'error':s.get('error')}

@app.get('/status')
def status():
 states=tile_states();ready=[s for s in states.values() if s['state']=='completed']
 return {'catalogTiles':len(CATALOG),'readyTiles':len(ready),'trees':sum(s['trees'] for s in ready),'activeJobs':sum(s['state'] in ['running','queued'] for s in states.values()),'engine':os.environ.get('ELMFIRE_BIN','Not installed'),'windEngine':shutil.which('WindNinja_cli') or 'Open-Meteo forecast; terrain wind solver unavailable','tiles':[tile_info(CATALOG[s['id']],states) for s in states.values() if s['id'] in CATALOG],'warnings':['LiDAR acquired 2021–2023. Crown segmentation estimates individual overstory trees; hidden or merged trees can be missed.','Species are unknown unless independently supplied. Regional stand types are not individual-tree identifications.']}

@app.get('/tiles')
def tiles(bbox:str):
 b=bounds_arg(bbox);states=tile_states();matching=[t for t in CATALOG.values() if intersects(t['bbox'],b)]
 return {'tiles':[tile_info(t,states) for t in matching[:500]],'total':len(matching),'truncated':len(matching)>500}

@app.get('/trees')
def trees(bbox:str):
 b=bounds_arg(bbox);states=tile_states();out=[];found=[];limit=60000;truncated=False
 matching=[t for t in CATALOG.values() if intersects(t['bbox'],b)]
 if len(matching)>36:raise HTTPException(400,'Zoom closer to load individual trees (maximum 36 km² per request).')
 for t in matching:
  found.append(tile_info(t,states));p=ROOT/'tiles'/t['id']/'trees.json'
  if states.get(t['id'],{}).get('state')!='completed' or not p.exists():continue
  for tree in json.loads(p.read_text())['trees']:
   if b[0]<=tree['lon']<=b[2] and b[1]<=tree['lat']<=b[3]:
    if len(out)==limit:truncated=True;break
    out.append(tree)
  if truncated:break
 return {'trees':out,'tiles':found,'truncated':truncated,'limit':limit,'method':'1 m canopy surface, local maxima and watershed crown segmentation; estimated overstory trees','source':'ICGC LiDAR Territorial, CC BY 4.0','acquired':'2021–2023 (tile LAS acquisition metadata retained)','warnings':['Crown positions are not surveyed trunk positions. Edge crowns may be incomplete.'],'sourceUrl':BASE,'coverageKm2':sum(t['state']=='completed' for t in found)}

def update_tile(tile,state,error=None,count=0):
 with db() as c:c.execute('INSERT INTO tiles VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,trees=excluded.trees,error=excluded.error,updated=excluded.updated',(tile,state,count,error,now()))

def stage(job,state,message,error=None,result=None):
 with db() as c:c.execute('INSERT INTO jobs VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,stage=excluded.stage,error=excluded.error,result=excluded.result',(job,state,message,error,json.dumps(result) if result is not None else None))

class ProcessRequest(BaseModel):
 lat:float=Field(ge=40.4,le=42.95)
 lon:float=Field(ge=0.1,le=3.4)
 radiusM:int=Field(default=500,ge=0,le=1500)

@app.post('/process',status_code=202)
def process(req:ProcessRequest):
 x,y=TO_UTM.transform(req.lon,req.lat)
 selected=[t for t in CATALOG.values() if t['x']<=x+req.radiusM and t['x']+1000>=x-req.radiusM and t['y']<=y+req.radiusM and t['y']+1000>=y-req.radiusM]
 if not selected:raise HTTPException(422,'No Catalonia LiDAR tile covers this location')
 selected.sort(key=lambda t:(t['x']+500-x)**2+(t['y']+500-y)**2)
 with LOCK:
  states=tile_states();active=sum(s['state'] in ['queued','running'] for s in states.values())
  pending=[t for t in selected if states.get(t['id'],{}).get('state') not in ['completed','queued','running']]
  if active+len(pending)>24:raise HTTPException(429,'Processing queue full; wait for current tiles to finish')
  job=uuid.uuid4().hex;stage(job,'queued','Preparing LiDAR tiles')
  for t in pending:update_tile(t['id'],'queued');POOL.submit(process_tile,t)
  stage(job,'completed','Tiles queued',result={'tiles':[t['id'] for t in selected]})
 return {'id':job,'tiles':[t['id'] for t in selected],'queued':len(pending)}

@app.get('/jobs/{job}')
@app.get('/runs/{job}')
def job_status(job:str):
 if not re.fullmatch('[a-f0-9]{32}',job):raise HTTPException(400,'Invalid job')
 with db() as c:r=c.execute('SELECT * FROM jobs WHERE id=?',(job,)).fetchone()
 if not r:raise HTTPException(404,'Job not found')
 out=dict(r);out['result']=json.loads(out['result']) if out['result'] else None;return out

def interpolate_missing(a):
 missing=~np.isfinite(a)
 if missing.all():raise ValueError('No classified ground returns; cannot infer measured tree heights')
 idx=ndimage.distance_transform_edt(missing,return_distances=False,return_indices=True)
 return a[tuple(idx)]

def segment_canopy(canopy,valid):
 smoothed=ndimage.gaussian_filter(np.where(valid,canopy,0),sigma=0.7)
 peaks=peak_local_max(smoothed,min_distance=3,threshold_abs=3,exclude_border=False,labels=(valid & (canopy>=3)).astype(np.uint8))
 markers=np.zeros(canopy.shape,np.int32)
 if len(peaks):markers[peaks[:,0],peaks[:,1]]=np.arange(1,len(peaks)+1)
 segments=watershed(-smoothed,markers,mask=valid & (canopy>=2))
 return peaks,segments

def process_tile(t):
 ident=t['id'];folder=ROOT/'tiles'/ident;folder.mkdir(parents=True,exist_ok=True);raw=folder/'source.laz'
 try:
  if shutil.disk_usage(ROOT).free<8*1024**3:raise ValueError('Less than 8 GiB scratch space remains; tile was not downloaded')
  update_tile(ident,'running');url=BASE+'vigent/laz_unzip/full10km'+t['group']+'/lidar-territorial-full1km'+ident+'.laz'
  digest=hashlib.sha256();total=0
  with requests.get(url,timeout=(15,120),stream=True) as r:
   r.raise_for_status()
   with raw.open('wb') as f:
    for chunk in r.iter_content(1024*1024):
     total+=len(chunk)
     if total>2_000_000_000:raise ValueError('Tile exceeds 2 GB processing limit')
     f.write(chunk);digest.update(chunk)
  # Streaming aggregation avoids loading a 20-million-point tile into RAM.
  ground=np.full((1000,1000),np.inf,np.float32);surface=np.full((1000,1000),-np.inf,np.float32)
  counts=np.zeros((1000,1000),np.uint32);vegetation=np.zeros((1000,1000),np.uint32)
  ground_hits=np.zeros((1000,1000),bool);classes={};acquisition=None;crs=None
  with laspy.open(raw) as reader:
   acquisition=str(reader.header.creation_date);crs=reader.header.parse_crs()
   if crs is None or crs.to_epsg() not in [25831,3043]:raise ValueError('LAS CRS is missing or not ETRS89 / UTM 31N')
   for pts in reader.chunk_iterator(1_000_000):
    x=np.asarray(pts.x);y=np.asarray(pts.y);z=np.asarray(pts.z,dtype=np.float32);cl=np.asarray(pts.classification)
    for k,v in zip(*np.unique(cl,return_counts=True)):classes[str(int(k))]=classes.get(str(int(k)),0)+int(v)
    col=np.floor(x-t['x']).astype(int);row=np.floor(t['y']+1000-y).astype(int)
    ok=(row>=0)&(row<1000)&(col>=0)&(col<1000)&np.isfinite(z)
    g=ok & np.isin(cl,[2,8]);v=ok & np.isin(cl,[3,4,5])
    np.minimum.at(ground,(row[g],col[g]),z[g]);ground_hits[row[g],col[g]]=True
    np.maximum.at(surface,(row[v],col[v]),z[v]);np.add.at(vegetation,(row[v],col[v]),1)
    np.add.at(counts,(row[ok],col[ok]),1)
  if ground_hits.mean()<0.005:raise ValueError('Insufficient classified ground points; cannot reconstruct this tile reliably')
  dem=interpolate_missing(ground);distance=ndimage.distance_transform_edt(~ground_hits)
  valid=np.isfinite(surface)&(distance<=30);canopy=np.where(valid,np.maximum(surface-dem,0),0)
  valid &= (canopy<=70);canopy=np.where(valid,canopy,0).astype(np.float32)
  peaks,segments=segment_canopy(canopy,valid);out=[];objects=ndimage.find_objects(segments)
  for i,sl in enumerate(objects,1):
   if sl is None:continue
   mask=segments[sl]==i;area=int(mask.sum())
   if area<3:continue
   rr,cc=peaks[i-1];height=float(canopy[sl][mask].max());lon,lat=TO_WGS.transform(t['x']+cc+.5,t['y']+999.5-rr)
   out.append({'id':ident+'-'+str(i),'lon':round(lon,7),'lat':round(lat,7),'heightM':round(height,2),'groundM':round(float(dem[rr,cc]),2),'crownRadiusM':round(math.sqrt(area/math.pi),2),'crownAreaM2':area,'points':int(vegetation[sl][mask].sum()),'species':None,'speciesEvidence':'Unknown. LiDAR geometry does not identify species.','edge':sl[0].start==0 or sl[1].start==0 or sl[0].stop==1000 or sl[1].stop==1000})
  profile={'driver':'GTiff','height':1000,'width':1000,'count':1,'dtype':'float32','crs':'EPSG:25831','transform':from_origin(t['x'],t['y']+1000,1,1),'compress':'deflate','tiled':True,'nodata':-9999}
  for name,array in [('dem',dem),('canopy',np.where(valid,canopy,-9999)),('cover',(canopy>=3).astype(np.float32))]:
   with rasterio.open(folder/(name+'.tif'),'w',**profile) as dst:dst.write(array.astype(np.float32),1)
  meta={'source':url,'sha256':digest.hexdigest(),'bytes':total,'sourceCrs':str(crs),'lasCreationDate':acquisition,'acquired':'2021–2023 campaign; LAS creation date is not acquisition date','processedAt':now(),'method':'ginger-canopy-watershed-v1','resolutionM':1,'pointClasses':classes,'groundCellCoverage':round(float(ground_hits.mean()),4),'heightValidCoverage':round(float(valid.mean()),4),'treeCount':len(out),'warnings':['Tree count is crown detections, not a complete stem census.','Border crowns are flagged; trunks, species and crown base are not measured.']}
  atomic_json(folder/'trees.json',{'trees':out});atomic_json(folder/'metadata.json',meta)
  update_tile(ident,'completed',count=len(out))
 except Exception as e:update_tile(ident,'failed',str(e)[:500])
 finally:raw.unlink(missing_ok=True)

@app.get('/weather')
def weather(lat:float,lon:float):
 if not (40.4<=lat<=42.95 and 0.1<=lon<=3.4):raise HTTPException(400,'Select a location in Catalonia')
 fields='temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,vapour_pressure_deficit'
 r=requests.get('https://api.open-meteo.com/v1/forecast',params={'latitude':lat,'longitude':lon,'hourly':fields,'forecast_days':2,'timezone':'UTC','wind_speed_unit':'kmh'},timeout=25);r.raise_for_status();return r.json()

class RunRequest(BaseModel):
 lat:float=Field(ge=40.4,le=42.95)
 lon:float=Field(ge=0.1,le=3.4)
 minutes:int=Field(default=120,ge=30,le=240)
 windKmh:float=Field(default=20,ge=0,le=100)
 windFrom:float=Field(default=270,ge=0,lt=360)
 moisture:float=Field(default=8,ge=2,le=40)
 members:int=Field(default=9,ge=1,le=25)
 crown:bool=False
 spotting:bool=False
 canopyBaseM:float=Field(default=3,ge=0.5,le=30)
 canopyBulkKgM3:float=Field(default=0.15,ge=0.01,le=1)

@app.post('/runs',status_code=202)
def run(req:RunRequest):
 from engine import simulate
 x,y=TO_UTM.transform(req.lon,req.lat)
 tile=next((t for t in CATALOG.values() if t['x']<=x<t['x']+1000 and t['y']<=y<t['y']+1000),None)
 if not tile or tile_states().get(tile['id'],{}).get('state')!='completed':raise HTTPException(409,'Reconstruct the ignition tile before running a forest simulation')
 engine=os.environ.get('ELMFIRE_BIN','')
 if not engine or not Path(engine).is_file():raise HTTPException(503,'Native ELMFIRE engine is unavailable; no substitute forecast is generated')
 with LOCK:
  with db() as c:active=c.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','running')").fetchone()[0]
  if active>=2:raise HTTPException(429,'Two simulations are already active')
  ident=uuid.uuid4().hex;stage(ident,'queued','Preparing native ELMFIRE inputs')
  POOL.submit(simulate,ident,req.model_dump(),tile,ROOT,engine,stage)
 return {'id':ident,'state':'queued','stage':'Preparing native ELMFIRE inputs'}
