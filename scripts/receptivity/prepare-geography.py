#!/usr/bin/env python3
"""Prepare reproducible Barcelona 200 m UTM cells from public raster data.
No weather or fabricated measurements. Re-run for updated static/satellite layers.
"""
import concurrent.futures, datetime, io, json, math, os
from pathlib import Path
import numpy as np
import requests
import rasterio
from rasterio.warp import reproject, Resampling, transform_bounds
from rasterio.windows import from_bounds
from rasterio.transform import from_origin
from pyproj import Transformer
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'data/receptivity';OUT.mkdir(parents=True,exist_ok=True)
CACHE=ROOT/'.ginger-data/receptivity/static';CACHE.mkdir(parents=True,exist_ok=True)
BBOX=[1.82,41.27,2.40,41.62];CELL=200;SAMPLE=20
forward=Transformer.from_crs(4326,25831,always_xy=True);inverse=Transformer.from_crs(25831,4326,always_xy=True)
b=transform_bounds(4326,25831,*BBOX)
x0=math.floor(b[0]/CELL)*CELL;y0=math.ceil(b[3]/CELL)*CELL
cols=math.ceil((b[2]-x0)/CELL);rows=math.ceil((y0-b[1])/CELL)
shape=(rows*10,cols*10);dst_transform=from_origin(x0,y0,SAMPLE,SAMPLE)
URL='https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N39E000_Map.tif'
ENV=dict(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',GDAL_HTTP_TIMEOUT='45',GDAL_HTTP_MAX_RETRY='2',GDAL_CACHEMAX=128)
def raster_asset(url,fill=0,dtype='uint8'):
 out=np.full(shape,fill,dtype=dtype)
 with rasterio.Env(**ENV), rasterio.open(url) as ds:
  bounds=transform_bounds(25831,ds.crs,x0,y0-rows*CELL,x0+cols*CELL,y0,densify_pts=21)
  win=from_bounds(*bounds,ds.transform).round_offsets().round_lengths()
  a=ds.read(1,window=win,boundless=True,fill_value=fill)
  reproject(a,out,src_transform=ds.window_transform(win),src_crs=ds.crs,dst_transform=dst_transform,dst_crs='EPSG:25831',resampling=Resampling.nearest,src_nodata=fill,dst_nodata=fill)
 return out
print('Reading ESA WorldCover 2021 categorical COG (public range requests)',flush=True)
landfile=CACHE/'worldcover.npy'
if landfile.exists():cover=np.load(landfile)
else:cover=raster_asset(URL);np.save(landfile,cover)
assert cover.shape==shape
# Classification fractions from 100 samples per cell, not canopy density.
classes={10:'Tree cover',20:'Shrubland',30:'Grassland',40:'Cropland'}
fractions={k:(cover==k).reshape(rows,10,cols,10).mean(axis=(1,3)) for k in classes}
burn=sum(fractions.values());dominant=np.array(list(classes))[np.argmax(np.stack(list(fractions.values())),axis=0)]
print('Reading terrain tiles',flush=True)
yy,xx=np.indices((rows+2,cols+2));lon,lat=inverse.transform(x0+(xx-.5)*CELL,y0-(yy-.5)*CELL)
z=12;n=256*2**z;px=(lon+180)/360*n;py=(1-np.arcsinh(np.tan(np.radians(lat)))/np.pi)/2*n
keys=set(zip((px//256).astype(int).flat,(py//256).astype(int).flat))
def tile(key):
 x,y=key;p=CACHE/f'dem-{z}-{x}-{y}.png'
 try:
  if not p.exists():
   r=requests.get(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',timeout=30);r.raise_for_status();p.write_bytes(r.content)
  a=np.array(Image.open(p).convert('RGB'),dtype=float);return key,a[:,:,0]*256+a[:,:,1]+a[:,:,2]/256-32768
 except Exception as e:print('Missing DEM tile',key,str(e),flush=True);return key,None
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:tiles=dict(pool.map(tile,keys))
elevation=np.full(px.shape,np.nan)
for key,a in tiles.items():
 if a is None:continue
 mask=((px//256)==key[0])&((py//256)==key[1]);elevation[mask]=a[(py[mask].astype(int)%256),(px[mask].astype(int)%256)]
dx=(elevation[1:-1,2:]-elevation[1:-1,:-2])/(2*CELL);dy=(elevation[:-2,1:-1]-elevation[2:,1:-1])/(2*CELL)
slope=np.degrees(np.arctan(np.sqrt(dx*dx+dy*dy)));aspect=(np.degrees(np.arctan2(-dx,-dy))+360)%360
cells=[]
for r,c in zip(*np.where(burn>=.3)):
 lo,la=inverse.transform(x0+(c+.5)*CELL,y0-(r+.5)*CELL)
 if not (BBOX[0]<=lo<=BBOX[2] and BBOX[1]<=la<=BBOX[3]):continue
 corners=[list(map(lambda v:round(v,6),inverse.transform(x0+cc*CELL,y0-rr*CELL))) for rr,cc in [(r,c),(r,c+1),(r+1,c+1),(r+1,c),(r,c)]]
 terrain={}
 for k,v in [('elevation',elevation[r+1,c+1]),('slope',slope[r,c]),('aspect',aspect[r,c])]:
  if np.isfinite(v):terrain[k]=round(float(v),1)
 cells.append({'id':f'utm31-200-{int(x0+c*CELL)}-{int(y0-(r+1)*CELL)}','center':[round(lo,6),round(la,6)],'ring':corners,'fuel':{'type':classes[int(dominant[r,c])],'burnableFraction':round(float(burn[r,c]),2),'fractions':{classes[k]:round(float(v[r,c]),2) for k,v in fractions.items() if v[r,c]>0},'source':'ESA WorldCover 2021 v200','epoch':'2021'},'terrain':terrain,'grid':[int(r),int(c)]})
# Neighborhood continuity is mapped vegetation fraction, not inferred fuel load.
for cell in cells:
 r,c=cell.pop('grid');cell['fuel']['continuity']=round(float(burn[max(0,r-1):r+2,max(0,c-1):c+2].mean()),2)
result={'version':1,'preparedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'bbox':BBOX,'cellSizeM':CELL,'crs':'EPSG:25831','areaKm2':round((BBOX[2]-BBOX[0])*111.32*math.cos(math.radians(41.45))*(BBOX[3]-BBOX[1])*111.32),'cells':cells,'sources':[{'name':'ESA WorldCover','url':URL,'edition':'2021 v200','detail':'10 m categorical land cover sampled every 20 m; 200 m cell fractions. Minimum 30% mapped tree, shrub, grass or cropland. Land-cover age limits confidence.'},{'name':'Mapzen Terrarium DEM','url':'https://github.com/tilezen/joerd/blob/master/docs/attribution.md','detail':'Zoom 12 elevation tiles. Slope/aspect from 200 m central differences; not fine terrain or local wind modelling.'}]}
p=OUT/'barcelona-grid.json';tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps(result,separators=(',',':'),allow_nan=False));tmp.replace(p)
print(json.dumps({'cells':len(cells),'areaKm2':result['areaKm2'],'path':str(p),'bytes':p.stat().st_size}),flush=True)
