"""Auditable native ELMFIRE experiments over processed LiDAR, not operational forecasts."""
import json, math, os, shutil, subprocess, warnings
from pathlib import Path
import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.enums import Resampling
from rasterio.warp import reproject
from rasterio.transform import xy
from pyproj import Transformer

TO_WGS=Transformer.from_crs(25831,4326,always_xy=True)
TO_UTM=Transformer.from_crs(4326,25831,always_xy=True)
RES=20

def write_grid(path,a,transform,dtype='float32'):
 with rasterio.open(path,'w',driver='GTiff',width=a.shape[1],height=a.shape[0],count=1,dtype=dtype,crs='EPSG:25831',transform=transform,nodata=-9999) as out:out.write(a.astype(dtype),1)

def wind_field(folder,dem,transform,speed,direction):
 """WindNinja mass-consistent terrain field at ELMFIRE's 20-foot reference height."""
 binary=shutil.which('WindNinja_cli')
 if not binary:raise RuntimeError('WindNinja is unavailable; refusing to substitute a terrain wind field')
 output=folder/'wind';output.mkdir()
 cmd=[binary,'--num_threads','4','--elevation_file',str(dem),'--initialization_method','domainAverageInitialization','--input_speed',str(speed),'--input_speed_units','kph','--input_direction',str(direction),'--input_wind_height','10','--units_input_wind_height','m','--output_wind_height','6.096','--units_output_wind_height','m','--output_speed_units','mph','--vegetation','trees','--mesh_resolution',str(RES),'--units_mesh_resolution','m','--write_ascii_output','true','--output_path',str(output)]
 with (folder/'windninja.log').open('w') as log:subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=180)
 with rasterio.open(dem) as ds:shape=ds.shape
 values=[]
 for suffix in ['vel','ang']:
  files=list(output.glob('*_'+suffix+'.asc'))
  if not files:raise RuntimeError('WindNinja did not produce '+suffix+' raster; inspect windninja.log')
  with rasterio.open(files[0]) as src:
   arr=np.full(shape,np.nan,np.float32)
   reproject(src.read(1),arr,src_transform=src.transform,src_crs=src.crs or 'EPSG:25831',src_nodata=src.nodata,dst_transform=transform,dst_crs='EPSG:25831',dst_nodata=np.nan,resampling=Resampling.nearest)
   if not np.isfinite(arr).all():raise RuntimeError('WindNinja field does not cover simulation domain')
   values.append(arr)
 return values

def simulate(ident,req,tile,root,engine,stage):
 folder=Path(root)/'runs'/ident;folder.mkdir(parents=True)
 try:
  stage(ident,'running','Preparing 20 m terrain and canopy grids')
  # Only adjacent, completed sources with metadata are eligible; no generated tree inventory.
  paths=[]
  for p in (Path(root)/'tiles').glob('*/dem.tif'):
   if not (p.parent/'metadata.json').exists():continue
   with rasterio.open(p) as ds:
    if abs(ds.bounds.left-tile['x'])<=1000 and abs(ds.bounds.bottom-tile['y'])<=1000:paths.append(p)
  datasets=[rasterio.open(p) for p in paths]
  try:dem3,transform=merge(datasets,res=RES,resampling=Resampling.average,nodata=-9999)
  finally:
   for ds in datasets:ds.close()
  dem=dem3[0];valid=dem!=-9999
  if not valid.all():raise ValueError('Prepare a contiguous rectangular group of tiles before simulation; gaps cannot be treated as measured terrain')
  arrays={}
  for name in ['cover','canopy']:
   datasets=[rasterio.open(p.parent/(name+'.tif')) for p in paths]
   try:arrays[name]=merge(datasets,res=RES,resampling=Resampling.average,nodata=-9999)[0][0]
   finally:
    for ds in datasets:ds.close()
  cover=np.maximum(arrays['cover'],0);height=np.maximum(arrays['canopy'],0)
  dy,dx=np.gradient(dem,RES);slope=np.degrees(np.arctan(np.hypot(dx,dy)));aspect=(np.degrees(np.arctan2(-dx,dy))+360)%360
  fuels=np.where(cover>=.1,8,91).astype(np.int16)
  x,y=TO_UTM.transform(req['lon'],req['lat']);col=int((x-transform.c)/RES);row=int((transform.f-y)/RES)
  if fuels[row,col]==91:raise ValueError('Ignition is outside reconstructed tree cover. Select a forest crown; surface fuels outside the canopy are not mapped yet.')
  write_grid(folder/'terrain.tif',dem,transform)
  stage(ident,'running','Resolving terrain wind with WindNinja')
  ws,wd=wind_field(folder,folder/'terrain.tif',transform,req['windKmh'],req['windFrom'])
  vectors=[]
  for rr in range(2,dem.shape[0],5):
   for cc in range(2,dem.shape[1],5):
    lon,lat=TO_WGS.transform(*xy(transform,rr,cc));vectors.append({'lon':lon,'lat':lat,'speedKmh':round(float(ws[rr,cc])*1.609344,2),'fromDegrees':round(float(wd[rr,cc]),2)})
  arrivals=[];parameters=[]
  for k in range(req['members']):
   stage(ident,'running',f'ELMFIRE member {k+1} / {req["members"]}')
   member=folder/f'member-{k:02d}';inputs=member/'inputs';outputs=member/'outputs';scratch=member/'scratch'
   for p in [inputs,outputs,scratch]:p.mkdir(parents=True)
   speed_factor=[.8,1,1.2][k%3];direction_delta=[-15,0,15][(k//3)%3];moisture_delta=[0,2,-2][(k+k//3)%3]
   moisture=max(2,req['moisture']+moisture_delta)
   grids={'dem':dem,'asp':aspect,'slp':slope,'fbfm40':fuels,'cc':cover*100,'ch':height*10,'cbh':np.minimum(height,req['canopyBaseM'])*10,'cbd':np.where(cover>=.1,req['canopyBulkKgM3']*100,0),'adj':np.ones_like(dem),'phi':np.ones_like(dem),'ws':ws*speed_factor,'wd':(wd+direction_delta)%360,'m1':np.full_like(dem,moisture),'m10':np.full_like(dem,moisture+1),'m100':np.full_like(dem,moisture+2)}
   for name,a in grids.items():write_grid(inputs/(name+'.tif'),a,transform,'int16' if name in ['asp','slp','fbfm40','cc','ch','cbh','cbd'] else 'float32')
   text="&INPUTS\nFUELS_AND_TOPOGRAPHY_DIRECTORY='./inputs'\nWEATHER_DIRECTORY='./inputs'\n"
   for name in grids:
    key='FBFM' if name=='fbfm40' else name.upper();text+=f"{key}_FILENAME='{name}'\n"
   text+="DT_METEOROLOGY=3600.\nLH_MOISTURE_CONTENT=60.\nLW_MOISTURE_CONTENT=90.\n/\n"
   text+=f"&OUTPUTS\nOUTPUTS_DIRECTORY='./outputs'\nDTDUMP={req['minutes']*60}.\nDUMP_TIME_OF_ARRIVAL=.TRUE.\nDUMP_FLIN=.TRUE.\nDUMP_SPREAD_RATE=.TRUE.\nCONVERT_TO_GEOTIFF=.FALSE.\n/\n&COMPUTATIONAL_DOMAIN\nA_SRS='EPSG:25831'\nCOMPUTATIONAL_DOMAIN_CELLSIZE={RES}.\nCOMPUTATIONAL_DOMAIN_XLLCORNER={transform.c}\nCOMPUTATIONAL_DOMAIN_YLLCORNER={transform.f-dem.shape[0]*RES}\n/\n&TIME_CONTROL\nSIMULATION_DT=30.\nSIMULATION_TSTOP={req['minutes']*60}.\n/\n&SIMULATOR\nNUM_IGNITIONS=1\nX_IGN(1)={x}\nY_IGN(1)={y}\nT_IGN(1)=0.\nCROWN_FIRE_MODEL={1 if req['crown'] else 0}\nWX_BILINEAR_INTERPOLATION=.TRUE.\nRANDOMIZE_RANDOM_SEED=.FALSE.\n/\n&MONTE_CARLO\nSEED={2024+k}\n/\n&SPOTTING\nENABLE_SPOTTING={'.TRUE.' if req['spotting'] else '.FALSE.'}\nMEAN_SPOTTING_DIST=100.\nNORMALIZED_SPOTTING_DIST_VARIANCE=0.5\nCROWN_FIRE_SPOTTING_PERCENT=10.\n/\n&MISCELLANEOUS\nPATH_TO_GDAL='/usr/bin'\nSCRATCH='./scratch'\n/\n"
   (member/'elmfire.data').write_text(text)
   with (member/'engine.log').open('w') as log:subprocess.run([engine,'elmfire.data'],cwd=member,env={**os.environ,'OMP_NUM_THREADS':'4'},stdout=log,stderr=subprocess.STDOUT,timeout=180,check=True)
   files=list(outputs.glob('time_of_arrival*.bil'))
   if not files:raise RuntimeError(f'ELMFIRE member {k+1} produced no arrival raster; see retained engine.log')
   with rasterio.open(files[-1]) as ds:a=ds.read(1).astype(float)
   if a.shape!=dem.shape:raise RuntimeError('Native output dimensions differ from terrain')
   a=np.where((a>=0)&(a<=req['minutes']*60),a/60,np.nan);arrivals.append(a)
   parameters.append({'member':k,'seed':2024+k,'windScale':speed_factor,'directionOffset':direction_delta,'deadMoisture':moisture})
  stack=np.stack(arrivals);fraction=np.isfinite(stack).mean(axis=0)
  with warnings.catch_warnings():
   warnings.simplefilter('ignore');arrival=np.nanmedian(stack,axis=0)
  features=[]
  for rr,cc in zip(*np.where(fraction>0)):
   west=transform.c+int(cc)*RES;north=transform.f-int(rr)*RES
   ring=[TO_WGS.transform(xx,yy) for xx,yy in [(west,north),(west+RES,north),(west+RES,north-RES),(west,north-RES),(west,north)]]
   features.append({'type':'Feature','geometry':{'type':'Polygon','coordinates':[ring]},'properties':{'arrival':round(float(arrival[rr,cc]),2),'fraction':float(fraction[rr,cc])}})
  bounds=[*TO_WGS.transform(transform.c,transform.f-dem.shape[0]*RES),*TO_WGS.transform(transform.c+dem.shape[1]*RES,transform.f)]
  notes=['Experimental sensitivity ensemble, not calibrated burn probability or an operational prediction.','Fuel model 8 (forest litter) is assumed under >=10% canopy. Unmapped open vegetation is excluded, not proven nonburnable. Roads and buildings within canopy cells are unresolved.','Canopy height and terrain derive from 2021–2023 LiDAR; crown base, bulk density and moisture are scenario assumptions.','WindNinja uses uniform tree roughness and a single 10 m input wind, output at 6.096 m. Ensemble perturbs this resolved field; atmospheric feedback and evolving weather are not modeled.','Arrival is the median among members that reach a cell. Color is final ensemble fraction; it is not time-dependent burn probability.','Tile-edge crown reconciliation and individual species identification remain unavailable.']
  if any(np.any(fraction[s]>0) for s in [0,-1]) or np.any(fraction[:,0]>0) or np.any(fraction[:,-1]>0):notes.append('Fire reaches the prepared domain boundary. Area is truncated; reconstruct surrounding tiles before interpreting extent.')
  if req['spotting']:notes.append('Spotting assumptions: 100 m mean distance, normalized variance 0.5, 10% crown-fire spotting; uncalibrated.')
  result={'engine':'ELMFIRE 2025.0717 + pointer-init patch + WindNinja','resolutionM':RES,'members':len(arrivals),'areaHa':len(features)*RES*RES/10000,'maxMinutes':req['minutes'],'bounds':bounds,'cells':{'type':'FeatureCollection','features':features},'warnings':notes,'sources':[json.loads((p.parent/'metadata.json').read_text()) for p in paths],'wind':{'speedKmh':req['windKmh'],'fromDegrees':req['windFrom'],'vectors':vectors},'inputs':req,'parameters':parameters}
  write_grid(folder/'ensemble_fraction.tif',fraction,transform);write_grid(folder/'median_arrival_minutes.tif',np.nan_to_num(arrival,nan=-9999),transform)
  (folder/'result.json').write_text(json.dumps(result,allow_nan=False));stage(ident,'completed','Native ensemble completed',result=result)
 except Exception as exc:stage(ident,'failed','Simulation failed; logs retained',error=str(exc)[:700])
