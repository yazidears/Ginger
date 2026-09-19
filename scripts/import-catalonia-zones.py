"""Import the official ZHR v2014 KMZ as WGS84 planning context (not live danger)."""
import io, json, urllib.request, zipfile, xml.etree.ElementTree as ET
from pathlib import Path
URL='https://interior.gencat.cat/web/.content/home/serveis/bases_cartografiques/ZHR/ZHR_v2014.kmz'
root=ET.fromstring(zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(URL,timeout=30).read())).read('doc.kml'))
ns={'k':'http://www.opengis.net/kml/2.2'}
features=[]
for place in root.findall('.//k:Placemark',ns):
    props={x.attrib['name']:x.text for x in place.findall('.//k:SimpleData',ns)}
    polygons=[]
    for polygon in place.findall('.//k:Polygon',ns):
        rings=[]
        for ring in polygon.findall('k:outerBoundaryIs/k:LinearRing/k:coordinates',ns)+polygon.findall('k:innerBoundaryIs/k:LinearRing/k:coordinates',ns):
            coords=[[round(float(n),6) for n in point.split(',')[:2]] for point in ring.text.split()]
            if len(coords)<4 or coords[0]!=coords[-1] or any(abs(p[0])>180 or abs(p[1])>90 for p in coords): raise ValueError('Invalid WGS84 ring')
            rings.append(coords)
        if rings: polygons.append(rings)
    if polygons: features.append({'type':'Feature','id':props['ZHR'],'properties':{'id':props['ZHR'],'name':f"Fire-regime zone {props['ZHR']}",'source':'Generalitat de Catalunya / Bombers','edition':'ZHR v2014','sourceUrl':URL},'geometry':{'type':'MultiPolygon','coordinates':polygons}})
if len(features)!=77: raise ValueError('Unexpected source inventory; review upstream changes')
path=Path(__file__).resolve().parents[1]/'data/catalonia-fire-regimes.geojson'
path.write_text(json.dumps({'type':'FeatureCollection','features':features},separators=(',',':')))
print(f'Imported {len(features)} official planning zones to {path}')
