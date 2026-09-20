"""Run in worker venv. Tests use existing catalog, never download LAZ or start jobs."""
import unittest
import numpy as np
from fastapi import HTTPException
from service import segment_canopy,interpolate_missing,bounds_arg,TO_UTM,TO_WGS,RunRequest

class ForestTests(unittest.TestCase):
 def test_crs_round_trip(self):
  x,y=TO_UTM.transform(2.094,41.43);self.assertTrue(400000<x<450000)
  lon,lat=TO_WGS.transform(x,y);self.assertAlmostEqual(lon,2.094,7);self.assertAlmostEqual(lat,41.43,7)
 def test_two_crowns(self):
  y,x=np.mgrid[:40,:40];a=12*np.exp(-((x-10)**2+(y-10)**2)/20)+18*np.exp(-((x-29)**2+(y-29)**2)/20)
  peaks,labels=segment_canopy(a,np.ones_like(a,dtype=bool));self.assertEqual(len(peaks),2);self.assertEqual(labels.max(),2)
 def test_no_fabricated_trees(self):
  peaks,labels=segment_canopy(np.zeros((20,20)),np.ones((20,20),bool));self.assertEqual(len(peaks),0);self.assertEqual(labels.max(),0)
 def test_no_ground_rejected(self):
  with self.assertRaises(ValueError):interpolate_missing(np.full((3,3),np.inf))
 def test_nearest_ground(self):
  a=np.array([[10,np.inf],[np.inf,20.]])
  b=interpolate_missing(a);self.assertTrue(np.isfinite(b).all());self.assertEqual(b[0,0],10);self.assertEqual(b[1,1],20)
 def test_bounds_reject_nan_or_reversal(self):
  for value in ['nan,0,2,3','2,3,1,4','1,2,3']:
   with self.assertRaises(HTTPException):bounds_arg(value)
 def test_wind_units_input_boundary(self):
  with self.assertRaises(ValueError):RunRequest(lat=41.43,lon=2.094,windFrom=360)
  self.assertFalse(RunRequest(lat=41.43,lon=2.094).crown)
if __name__=='__main__':unittest.main()
