"""Read bounded Sentinel-2 L2A COG windows. JSON stdin/stdout, no local-file inputs."""
import sys, json, io, base64
from urllib.parse import urlparse
import numpy as np
import rasterio
from rasterio.warp import transform, reproject, Resampling
from rasterio.windows import from_bounds, Window
from rasterio.transform import from_origin
from PIL import Image

def index(a, b, mask):
    valid = mask & np.isfinite(a) & np.isfinite(b) & (a >= 0) & (b >= 0) & ((a+b) > 1e-6)
    out = np.full(a.shape, np.nan, dtype='float32')
    np.divide(a-b, a+b, out=out, where=valid)
    return out

def render(values, span=1):
    good = np.isfinite(values)
    t = np.clip((np.nan_to_num(values)+span)/(2*span), 0, 1)
    low, high = np.array([181, 93, 64]), np.array([92, 183, 135])
    rgb = (low[None,None,:]*(1-t[:,:,None])+high[None,None,:]*t[:,:,None]).astype('uint8')
    rgba = np.dstack([rgb, good.astype('uint8')*255])
    b = io.BytesIO(); Image.fromarray(rgba).save(b, format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()

def summary(v, span=1):
    good = v[np.isfinite(v)]
    return {'mean':float(good.mean()) if good.size else None,'min':float(good.min()) if good.size else None,'max':float(good.max()) if good.size else None,'validPct':round(float(good.size/v.size*100),2),'image':render(v,span),'values':[[round(float(x),6) if np.isfinite(x) else None for x in row] for row in v]}

def read_scene(scene, lat, lon, grid=None):
    assets=scene['assets']
    for key in ['red','nir','swir22','scl']:
        u=urlparse(assets[key]['href'])
        if u.scheme!='https' or u.netloc!='e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com': raise ValueError('Unsupported asset host')
    if grid is None:
        with rasterio.open(assets['scl']['href']) as ds:
            x,y=transform('EPSG:4326',ds.crs,[lon],[lat]); grid=(ds.crs,from_origin(x[0]-1280,y[0]+1280,20,20))
    crs, affine=grid
    arrays={}
    for key in ['red','nir','swir22','scl']:
        a=assets[key]
        with rasterio.open(a['href']) as ds:
            # Only read the small intersection around the target, never an entire tile.
            from rasterio.warp import transform_bounds
            from rasterio.transform import array_bounds
            b=transform_bounds(crs,ds.crs,*array_bounds(128,128,affine),densify_pts=21)
            requested=from_bounds(*b,transform=ds.transform).round_offsets().round_lengths()
            try: window=requested.intersection(Window(0,0,ds.width,ds.height))
            except rasterio.errors.WindowError: raise ValueError('Scene does not cover this location')
            raw=ds.read(1,window=window).astype('float32')
            invalid=raw==ds.nodata if ds.nodata is not None else np.zeros(raw.shape,dtype=bool)
            if key!='scl': raw=raw*a['scale']+a['offset']
            raw[invalid]=np.nan
            target=np.full((128,128),np.nan,dtype='float32')
            reproject(raw,target,src_transform=ds.window_transform(window),src_crs=ds.crs,src_nodata=np.nan,dst_transform=affine,dst_crs=crs,dst_nodata=np.nan,resampling=Resampling.nearest)
            arrays[key]=target
    # Keep vegetation / bare land only. Clouds, shadows, water, snow, uncertain classes excluded.
    mask=np.isin(arrays['scl'],[4,5])
    return {'ndvi':index(arrays['nir'],arrays['red'],mask),'nbr':index(arrays['nir'],arrays['swir22'],mask)},grid

def main():
    q=json.load(sys.stdin); lat=float(q['lat']);lon=float(q['lon'])
    if not (-85<=lat<=85 and -180<=lon<=180): raise ValueError('Invalid location')
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif',GDAL_HTTP_TIMEOUT='12',GDAL_HTTP_MAX_RETRY='0',GDAL_CACHEMAX=32):
        after,grid=read_scene(q['scene'],lat,lon)
        out={'scene':q['scene']['id'],'time':q['scene']['time'],'resolutionM':20,'widthM':2560,'ndvi':summary(after['ndvi']),'nbr':summary(after['nbr']),'mask':'SCL vegetation/bare land only; clouds, shadows, water, snow and uncertain pixels excluded.'}
        out['grid']={'crs':str(grid[0]),'transform':list(grid[1])[:6],'shape':[128,128]};out['provenance']={'collection':'sentinel-2-c1-l2a','assets':q['scene']['assets'],'reflectance':'DN * STAC scale + STAC offset','resampling':'nearest','indices':{'ndvi':'(B08-B04)/(B08+B04)','nbr':'(B08-B12)/(B08+B12)','dnbr':'earlier NBR - later NBR'}}
        if q.get('before'):
            before,_=read_scene(q['before'],lat,lon,grid)
            out['provenance']['beforeAssets']=q['before']['assets'];out['beforeScene']=q['before']['id'];out['beforeTime']=q['before']['time'];out['dnbr']=summary(before['nbr']-after['nbr'],2)
        print(json.dumps(out,allow_nan=False))
if __name__=='__main__':
    try: main()
    except Exception as e:
        print(json.dumps({'error':str(e)[:160]}));sys.exit(1)
