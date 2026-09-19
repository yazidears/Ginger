import importlib.util
import numpy as np
s=importlib.util.spec_from_file_location('r','scripts/satellite-raster.py')
r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
a=np.array([[.6,0,-.1],[.2,.4,.4]],dtype='float32')
b=np.array([[.2,0,.2],[.2,.2,.2]],dtype='float32')
mask=np.array([[True,True,True],[False,True,True]])
v=r.index(a,b,mask)
assert abs(v[0,0]-.5)<1e-6
assert np.isnan(v[0,1]) and np.isnan(v[0,2]) and np.isnan(v[1,0])
assert r.summary(v)['validPct']==50
assert r.summary(v)['values'][0][1] is None
assert r.summary(np.full((2,2),np.nan))['mean'] is None
before=np.array([[.8,np.nan]],dtype='float32');after=np.array([[.3,.2]],dtype='float32')
d=r.summary(before-after,2)
assert abs(d['mean']-.5)<1e-6 and d['validPct']==50
assert d['image'].startswith('data:image/png;base64,')
print('PASS calibrated ratios, zero denominator, invalid reflectance, cloud mask, missing coverage, dNBR intersection and numeric export')
