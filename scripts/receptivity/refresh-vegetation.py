#!/usr/bin/env python3
"""Cloud-mask Sentinel-2 surface reflectance; retain nulls where no clear pixels.
Updates geographic artifact atomically; never fills cloud gaps with invented NDVI.
"""
import datetime,json,math,os
from pathlib import Path
import numpy as np
import requests,rasterio
from rasterio.warp import reproject,Resampling,transform_bounds
from rasterio.windows import from_bounds
from rasterio.transform import from_origin
ROOT=Path(__file__).resolve().parents[2];path=ROOT/'data/receptivity/barcelona-grid.json'
grid=json.loads(path.read_text());bbox=grid['bbox'];now=datetime.datetime.now(datetime.timezone.utc)
params={'collections':'sentinel-2-l2a','bbox':','.join(map(str,bbox)),'datetime':f'{(now-datetime.timedelta(days=30)).isoformat()}/{now.isoformat()}','limit':60,'sortby':'-properties.datetime'}
r=requests.get('https://earth-search.aws.element84.com/v1/search',params=params,timeout=30);r.raise_for_status();features=r.json()['features']
scenes={}
for f in features:
 tile=f['id'].split('_')[1]
 if tile not in scenes and f['properties'].get('eo:cloud_cover',100)<30:scenes[tile]=f
# Grid envelope from actual cell IDs; 200 m aggregates, 20 m reflectance sampling.
coords=[list(map(int,c['id'].split('-')[-2:])) for c in grid['cells']]
x0=min(p[0] for p in coords);y0=max(p[1] for p in coords)+200
cols=(max(p[0] for p in coords)-x0)//200+1;rows=(y0-min(p[1] for p in coords))//200
shape=(rows*10,cols*10);transform=from_origin(x0,y0,20,20)
ndvi=np.full(shape,np.nan,dtype='float32');ndmi=ndvi.copy();dates=np.zeros(shape,dtype='int16');scene_dates=[]
env=dict(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',GDAL_HTTP_TIMEOUT='35',GDAL_HTTP_MAX_RETRY='1',GDAL_CACHEMAX=128)
def read(asset,dtype='float32'):
 out=np.full(shape,np.nan,dtype='float32')
 with rasterio.Env(**env),rasterio.open(asset['href']) as ds:
  b=transform_bounds(25831,ds.crs,x0,y0-rows*200,x0+cols*200,y0)
  w=from_bounds(*b,ds.transform).round_offsets().round_lengths()
  a=ds.read(1,window=w,boundless=True,fill_value=0).astype('float32');valid=a!=0
  band=asset.get('raster:bands',[{}])[0];a=a*band.get('scale',1)+band.get('offset',0);a[~valid]=np.nan
  reproject(a,out,src_transform=ds.window_transform(w),src_crs=ds.crs,dst_transform=transform,dst_crs='EPSG:25831',src_nodata=np.nan,dst_nodata=np.nan,resampling=Resampling.nearest)
 return out
for scene in scenes.values():
 print('Reading',scene['id'],flush=True)
 try:
  assets=scene['assets'];scl=read(assets['scl']);red=read(assets['red']);nir=read(assets['nir']);swir=read(assets['swir16'])
  # Only SCL vegetation/non-vegetated terrestrial pixels. No cloud, shadow, water, snow.
  valid=np.isin(scl,[4,5]) & np.isfinite(red) & np.isfinite(nir) & np.isfinite(swir) & ((nir+red)>0) & ((nir+swir)>0) & ~np.isfinite(ndvi)
  with np.errstate(invalid='ignore',divide='ignore'):
   ndvi[valid]=((nir-red)/(nir+red))[valid];ndmi[valid]=((nir-swir)/(nir+swir))[valid]
  scene_dates.append(scene['properties']['datetime']);dates[valid]=len(scene_dates)
 except Exception as e:print('Scene unavailable',scene['id'],str(e),flush=True)
count=0
for c,(x,y) in zip(grid['cells'],coords):
 rr=(y0-y-200)//200;cc=(x-x0)//200;a=ndvi[rr*10:(rr+1)*10,cc*10:(cc+1)*10];b=ndmi[rr*10:(rr+1)*10,cc*10:(cc+1)*10];d=dates[rr*10:(rr+1)*10,cc*10:(cc+1)*10]
 valid=np.isfinite(a)&np.isfinite(b)&(np.abs(a)<=1)&(np.abs(b)<=1)
 # Require at least 50% clear observations. Otherwise keep missing.
 for key in ['ndvi','ndmi','satelliteAt','satelliteCoverage']:c['fuel'].pop(key,None)
 if valid.mean()>=.5:
  c['fuel'].update(ndvi=round(float(np.median(a[valid])),3),ndmi=round(float(np.median(b[valid])),3),satelliteCoverage=round(float(valid.mean()),2),satelliteAt=min(scene_dates[i-1] for i in np.unique(d[valid]) if i));count+=1
if count:
 grid['sources']=[s for s in grid['sources'] if s['name']!='Copernicus Sentinel-2']
 grid['sources'].append({'name':'Copernicus Sentinel-2','url':'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a','detail':f'{count} cells with >=50% clear pixels. Median NDVI/NDMI from surface reflectance at 20 m. SCL excludes cloud/shadow/water/snow. Spectral indices are context, not measured live fuel moisture. Dates: {", ".join(sorted(set(scene_dates)))}'})
 tmp=path.with_suffix('.satellite.tmp');tmp.write_text(json.dumps(grid,separators=(',',':'),allow_nan=False));tmp.replace(path)
print(json.dumps({'satelliteCells':count,'totalCells':len(grid['cells'])}),flush=True)
