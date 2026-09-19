'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapInstance } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { RunResult } from '@/lib/sage/types';
import { Check, Layers3, LocateFixed, Minus, Mountain, Plus, X } from 'lucide-react';
import {EvidenceBadge} from './evidence';
import {compass, smokeIllustration} from '@/lib/sage/smoke';

export interface TerrainMapProps {
  center: [number, number];
  hotspotKind?: 'observed' | 'simulated';
  hotspots: FeatureCollection;
  buildings: FeatureCollection;
  landcover: FeatureCollection;
  assets: FeatureCollection;
  onSelectPoint: (longitude: number, latitude: number) => void;
  focusKey?: number;
  simulation?: RunResult | null;
  investigationOverlay?: FeatureCollection;
  minute?: number;
  selectedBuilding?: string | null;
  onSelectBuilding?: (id: string) => void;
  initialZoom?: number;
  watchAreas?: Array<{ id: string; name: string; lat: number; lon: number; radiusM: number }>;
  onSelectArea?: (id: string) => void;
  selectedRadiusM?: number;
}
function boundary(lon: number, lat: number, radiusM: number, properties: Record<string, unknown>) {
  const angular = radiusM / 6371008.8, latitude = lat * Math.PI / 180, longitude = lon * Math.PI / 180;
  const coordinates = Array.from({ length: 73 }, (_, i) => { const bearing = i / 72 * Math.PI * 2; const nextLat = Math.asin(Math.sin(latitude) * Math.cos(angular) + Math.cos(latitude) * Math.sin(angular) * Math.cos(bearing)); const nextLon = longitude + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(latitude), Math.cos(angular) - Math.sin(latitude) * Math.sin(nextLat)); return [nextLon * 180 / Math.PI, nextLat * 180 / Math.PI]; });
  return { type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [coordinates] }, properties };
}
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const GROUPS = { buildings: 'Building footprints', landcover: 'Land cover', hotspots: 'Scenario ignition', assets: 'Infrastructure' };
maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

/** Real GIS terrain, not a photogrammetric mesh. Terrarium source documented at
 * https://github.com/tilezen/joerd/blob/master/docs/use-service.md */
export default function SageTerrainMap({ center, hotspots, buildings, landcover, assets, onSelectPoint, focusKey = 0, simulation, investigationOverlay = EMPTY, minute = 240, selectedBuilding, onSelectBuilding, initialZoom = 12, watchAreas = [], onSelectArea, selectedRadiusM = 1500 }: TerrainMapProps) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const loaded = useRef<MapInstance | null>(null);
  const pointCallback = useRef(onSelectPoint);
  const buildingCallback = useRef(onSelectBuilding);
  buildingCallback.current = onSelectBuilding;
  const initialZoomRef = useRef(initialZoom);
  const areaCallback = useRef(onSelectArea);
  areaCallback.current = onSelectArea;
  const popup = useRef<maplibregl.Popup | null>(null);
  const currentCenter = useRef(center);
  pointCallback.current = onSelectPoint;
  currentCenter.current = center;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [threeD, setThreeD] = useState(true);
  const [layerMenu, setLayerMenu] = useState(false);
  const [showSmoke, setShowSmoke] = useState(false);
  const smoke = useMemo(() => simulation ? smokeIllustration(simulation, minute, showSmoke) : null, [simulation, minute, showSmoke]);
  const [satellite, setSatellite] = useState(true);
  const [visible, setVisible] = useState({ buildings: true, landcover: true, hotspots: true, assets: true });

  useEffect(() => {
    if (!host.current) return;
    setReady(false);
    let m: MapInstance;
    try {
      m = new maplibregl.Map({
        container: host.current, center: currentCenter.current, zoom: initialZoomRef.current,
        pitch: 45, bearing: -12, maxPitch: 75, minZoom: 4, maxZoom: 19,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            satellite: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
            dark: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors © CARTO' },
            labels: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors © CARTO' },
            elevation: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'Terrain: Mapzen / <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">DEM sources</a>' },
          },
          layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#172120' } },
            { id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-saturation': -.3, 'raster-brightness-max': .76 } },
            { id: 'dark', type: 'raster', source: 'dark', layout: { visibility: 'none' } },
            { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': .85 } },
          ],
        },
      });
      map.current = m;
    } catch {
      setError('3D renderer unavailable. Geographic observations remain accessible in the panels.');
      return;
    }
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 100 }), 'bottom-left');
    m.on('error', () => setError('Map source degraded · some imagery or terrain tiles could not load'));
    m.on('load', () => {
      if (map.current !== m) return;
      Object.keys(GROUPS).forEach(id => m.addSource(id, { type: 'geojson', data: EMPTY }));
      m.addSource('watch-areas', { type: 'geojson', data: EMPTY });
      m.addSource('inspection-area', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'watch-area-fill', type: 'fill', source: 'watch-areas', paint: { 'fill-color': '#8fc8bc', 'fill-opacity': .035 } });
      m.addLayer({ id: 'watch-area-line', type: 'line', source: 'watch-areas', paint: { 'line-color': '#8fc8bc', 'line-width': 1.5, 'line-dasharray': [4, 3] } });
      m.addLayer({ id: 'inspection-area', type: 'line', source: 'inspection-area', paint: { 'line-color': '#f6e7bb', 'line-width': 1, 'line-opacity': .7, 'line-dasharray': [2, 3] } });
      m.addSource('fire-cells', {type:'geojson', data:EMPTY});
      m.addSource('fire-domain', {type:'geojson', data:EMPTY});
      m.addSource('selected-point', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'landcover-fill', type: 'fill', source: 'landcover', paint: { 'fill-color': ['match', ['coalesce', ['get', 'natural'], ['get', 'landuse'], ['get', 'class'], ''], 'wood', '#6b9968', 'forest', '#6b9968', 'scrub', '#b1a061', 'grassland', '#a7b77c', 'farmland', '#bbab70', '#859674'], 'fill-opacity': .18 } });
      m.addLayer({ id: 'landcover-line', type: 'line', source: 'landcover', paint: { 'line-color': '#9eb886', 'line-width': .6, 'line-opacity': .45 } });
      m.addSource('smoke-illustration', {type:'geojson', data:EMPTY});
      m.addLayer({id:'smoke-illustration',type:'fill',source:'smoke-illustration',paint:{'fill-color':'#dfded5','fill-opacity':['get','opacity']}});
      m.addSource('investigation',{type:'geojson',data:EMPTY});
      m.addLayer({id:'investigation-fill',type:'fill',source:'investigation',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['coalesce',['get','color'],'#74d2ca'],'fill-opacity':.32}});
      m.addLayer({id:'investigation-line',type:'line',source:'investigation',filter:['!=',['geometry-type'],'Point'],paint:{'line-color':['coalesce',['get','color'],'#74d2ca'],'line-width':2}});
      m.addLayer({id:'investigation-point',type:'circle',source:'investigation',filter:['==',['geometry-type'],'Point'],paint:{'circle-color':['coalesce',['get','color'],'#74d2ca'],'circle-radius':7,'circle-stroke-color':'#ffffff','circle-stroke-width':1}});
      m.addLayer({id:'fire-domain-line',type:'line',source:'fire-domain',paint:{'line-color':'#e6d6a8','line-width':1.5,'line-dasharray':[4,3]}});
      m.addLayer({id:'fire-cells-fill',type:'fill',source:'fire-cells',paint:{'fill-color':['case',['==',['get','arrivalCentral'],null],'#e6b86b','#f66b43'],'fill-opacity':.38},filter:['<=',['get','arrivalMin'],0]});
      m.addLayer({ id: 'buildings-flat', type: 'fill', source: 'buildings', minzoom: 12, layout: { visibility: 'none' }, paint: { 'fill-color': '#d1d6c9', 'fill-opacity': .65 } });
      m.addLayer({ id: 'buildings-unknown', type: 'fill', source: 'buildings', minzoom: 12, filter: ['==', ['get', 'heightM'], null], paint: { 'fill-color': '#d1d6c9', 'fill-opacity': .5 } });
      m.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', source: 'buildings', minzoom: 12, paint: { 'fill-extrusion-color': ['match', ['get', 'heightSource'], 'height', '#ccd5d0', 'osm-height', '#ccd5d0', '#a6b9b0'], 'fill-extrusion-height': ['max', 0, ['to-number', ['get', 'heightM'], 0]], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': .88 } });
      m.addLayer({id:'buildings-outline',type:'line',source:'buildings',minzoom:12,paint:{'line-color':'#d1d6c9','line-width':.65,'line-opacity':.55}});
      m.addLayer({id:'building-selection',type:'line',source:'buildings',filter:['==',['get','id'],''],paint:{'line-color':'#ffffff','line-width':3}});
      m.addLayer({ id: 'hotspots-halo', type: 'circle', source: 'hotspots', paint: { 'circle-radius': 13, 'circle-color': '#fa683e', 'circle-opacity': .22, 'circle-blur': .4 } });
      m.addLayer({ id: 'hotspots-dot', type: 'circle', source: 'hotspots', paint: { 'circle-radius': 4, 'circle-color': '#ffd09b', 'circle-stroke-color': '#fa683e', 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'assets-dot', type: 'circle', source: 'assets', paint: { 'circle-radius': 5, 'circle-color': '#8fc8bc', 'circle-stroke-color': '#182a29', 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'selected-point', type: 'circle', source: 'selected-point', paint: { 'circle-radius': 9, 'circle-color': '#ffffff', 'circle-opacity': .1, 'circle-stroke-color': '#f6e7bb', 'circle-stroke-width': 2 } });
      m.setTerrain({ source: 'elevation', exaggeration: 1 });
      loaded.current = m;
      setReady(true);
    });
    m.on('click', event => {
      if (loaded.current !== m) return;
      if (buildingCallback.current && loaded.current === m) {
        const feature = m.queryRenderedFeatures(event.point, {layers:['buildings-3d','buildings-flat','buildings-unknown']})[0];
        if (feature?.properties?.id) {buildingCallback.current(String(feature.properties.id)); return;}
      }
      const { lng, lat } = event.lngLat;
      const feature = m.queryRenderedFeatures(event.point, { layers: ['buildings-3d', 'buildings-flat', 'buildings-unknown', 'assets-dot', 'hotspots-dot'] })[0];
      if (feature) {
        const properties = feature.properties || {};
        const content = document.createElement('div'); content.className = 'terrain-feature';
        const title = document.createElement('strong'); title.textContent = String(properties.name || (feature.source === 'hotspots' ? 'Scenario ignition' : 'Mapped building')); content.append(title);
        const rows: Array<[string, unknown]> = feature.source === 'buildings'
          ? [['Height', properties.heightM ? `${properties.heightM} m` : 'Not recorded'], ['Basis', properties.heightBasis || properties.heightSource || 'Unknown'], ['Source', properties.source || 'OpenStreetMap'], ['Occupancy', 'Not established'], ['Exposure', 'No validated fire forecast']]
          : feature.source === 'hotspots' ? [['Basis', 'Simulated · user-selected ignition'], ['Status', 'Hypothetical scenario origin']]
          : [['Source', properties.source || 'OpenStreetMap'], ['Type', properties.kind || properties.amenity || 'Mapped infrastructure'], ['Fire arrival', 'Not established']];
        rows.forEach(([label, value]) => { const row = document.createElement('p'); const caption = document.createElement('span'); caption.textContent = label; const text = document.createElement('b'); text.textContent = String(value); row.append(caption, text); content.append(row); });
        const inspect = document.createElement('button'); inspect.textContent = 'Set fire origin here'; inspect.onclick = () => { popup.current?.remove(); pointCallback.current(lng, lat); }; content.append(inspect);
        popup.current?.remove(); popup.current = new maplibregl.Popup({ maxWidth: '290px', className: 'terrain-popup' }).setLngLat(event.lngLat).setDOMContent(content).addTo(m);
        return;
      }
      const area = m.queryRenderedFeatures(event.point, { layers: ['watch-area-fill'] })[0];
      if (area?.properties?.id && areaCallback.current) { areaCallback.current(String(area.properties.id)); return; }
      popup.current?.remove(); pointCallback.current(lng, lat);
    });
    m.on('mousemove', event => { if (loaded.current !== m) return; m.getCanvas().style.cursor = m.queryRenderedFeatures(event.point, { layers: ['buildings-3d', 'buildings-flat', 'buildings-unknown', 'assets-dot', 'hotspots-dot', 'watch-area-fill'] }).length ? 'pointer' : 'crosshair'; });
    const observer = new ResizeObserver(() => m.resize());
    observer.observe(host.current);
    return () => { observer.disconnect(); loaded.current = null; map.current = null; m.remove(); };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || loaded.current !== m) return;
    for (const [id, data] of Object.entries({ hotspots, buildings, landcover, assets })) (m.getSource(id) as GeoJSONSource)?.setData(data);
  }, [ready, hotspots, buildings, landcover, assets]);
  useEffect(() => { const m=map.current; if(ready&&m&&loaded.current===m)(m.getSource('smoke-illustration') as GeoJSONSource)?.setData(showSmoke&&smoke?smoke.plumes:EMPTY); }, [ready,showSmoke,smoke]);
  useEffect(()=>{const m=map.current;if(ready&&m&&loaded.current===m)(m.getSource('investigation') as GeoJSONSource)?.setData(investigationOverlay);},[ready,investigationOverlay]);
  useEffect(() => {
    const m=map.current;if(!ready||!m||loaded.current!==m)return;
    (m.getSource('fire-cells') as GeoJSONSource)?.setData(simulation?.cells||EMPTY);
    (m.getSource('fire-domain') as GeoJSONSource)?.setData(simulation?.domain||EMPTY);
    m.setFilter('fire-cells-fill',['<=',['get','arrivalMin'],minute]);
    m.setPaintProperty('fire-cells-fill','fill-color',['case',['all',['!=',['get','arrivalCentral'],null],['<=',['get','arrivalCentral'],minute]],'#f66b43','#e6b86b']);
    m.setFilter('building-selection',['==',['get','id'],selectedBuilding||'']);
    const color: maplibregl.ExpressionSpecification = simulation ? ['case',['all',['!=',['get','structuralIgnitionCentral'],null],['<=',['get','structuralIgnitionCentral'],minute]],'#e74432',['all',['!=',['get','arrivalMin'],null],['<=',['get','arrivalMin'],minute]],'#ff8558','#b6c4bf'] : ['match',['get','heightSource'],'osm-height','#ccd5d0','#a6b9b0'];
    m.setPaintProperty('buildings-3d','fill-extrusion-color',color);
    m.setPaintProperty('buildings-flat','fill-color',color);
    m.setPaintProperty('buildings-unknown','fill-color',color);
  },[ready,simulation,minute,selectedBuilding]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || loaded.current !== m) return;
    popup.current?.remove();
    (m.getSource('selected-point') as GeoJSONSource)?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [center[0], center[1]] }, properties: {} }] });
    m.flyTo({ center: [center[0], center[1]], zoom: initialZoomRef.current, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1000, essential: false });
  }, [center[0], center[1], focusKey, ready]);
  useEffect(() => {
    const m = map.current; if (!ready || !m || loaded.current !== m) return;
    (m.getSource('watch-areas') as GeoJSONSource)?.setData({ type: 'FeatureCollection', features: watchAreas.filter(area => Number.isFinite(area.radiusM) && area.radiusM > 0).map(area => boundary(area.lon, area.lat, area.radiusM, { id: area.id, name: area.name })) });
    (m.getSource('inspection-area') as GeoJSONSource)?.setData({ type: 'FeatureCollection', features: Number.isFinite(selectedRadiusM) && selectedRadiusM > 0 ? [boundary(center[0], center[1], selectedRadiusM, {})] : [] });
  }, [ready, watchAreas, center[0], center[1], selectedRadiusM]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || loaded.current !== m) return;
    m.setTerrain(threeD ? { source: 'elevation', exaggeration: 1 } : null);
    m.easeTo({ pitch: threeD ? 45 : 0, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650 });
    for (const layer of m.getStyle().layers) {
      const source = (layer as { source?: keyof typeof visible }).source;
      if (source && source in visible) {
        const dimensional = layer.id === 'buildings-flat' ? !threeD : layer.id === 'buildings-3d' ? threeD : true;
        m.setLayoutProperty(layer.id, 'visibility', visible[source] && dimensional ? 'visible' : 'none');
      }
    }
    m.setLayoutProperty('satellite', 'visibility', satellite ? 'visible' : 'none');
    m.setLayoutProperty('labels', 'visibility', satellite ? 'visible' : 'none');
    m.setLayoutProperty('dark', 'visibility', satellite ? 'none' : 'visible');
  }, [ready, threeD, satellite, visible]);

  return <div className="map-wrapper terrain-map" style={{ position: 'relative', width: '100%', height: '100%', minHeight: 300 }}>
    <div ref={host} className="map-canvas" style={{ position: 'absolute', inset: 0 }} aria-label="Interactive regional terrain and infrastructure map. Click any location to inspect it." />
    {!ready && !error && <div className="map-loading"><span className="spinner" /> Loading geographic context…</div>}
    {error && <div className="map-warning" role="status">{error}</div>}
    {smoke && <aside className="sage-wind-card" aria-label="Wind and smoke illustration">
      <div className="sage-wind-top"><span className="sage-wind-compass" aria-hidden="true"><i>N</i><b style={{transform:`rotate(${smoke.wind?.toDegrees??0}deg)`}}>↑</b></span><div><span className="sage-wind-eyebrow">Wind at +{Math.round(smoke.minute)} min</span><strong>{smoke.wind ? smoke.wind.speedKmh < .1 ? 'Calm wind' : `${compass(smoke.wind.fromDegrees)} → ${compass(smoke.wind.toDegrees)} · ${smoke.wind.speedKmh.toFixed(1)} km/h` : 'Weather unavailable'}</strong><small>{smoke.wind && smoke.wind.speedKmh >= .1 ? `From ${Math.round(smoke.wind.fromDegrees)}° · blowing toward ${Math.round(smoke.wind.toDegrees)}°` : 'No reliable transport direction'}</small></div></div>
      <p className="sage-fire-heading">Recent fire-front shift: <b>{smoke.fireHeadingDegrees === null ? 'no clear direction' : `mainly ${compass(smoke.fireHeadingDegrees)}`}</b></p>
      {simulation?.request.structural && !simulation.cells.features.length && <p className="sage-fire-heading">Building transfer follows distance/delay assumptions; wind affects the smoke illustration.</p>}
      <label className="sage-smoke-toggle"><input type="checkbox" checked={showSmoke} onChange={e=>setShowSmoke(e.target.checked)}/><span>Smoke illustration</span><em>Experimental</em></label>
      {showSmoke && smoke.plumes.features.length === 0 && <p className="sage-fire-heading">No illustrated puffs remain here at this time. Scrub earlier to explore drift; this does not establish clean air.</p>}
      <details className="sage-smoke-details"><summary>What am I seeing?</summary><p>Wind carries smoke; terrain and fuel also steer the fire. The heading compares the centroids of newly reached central-run cells in two successive 5-minute windows. It describes a recent shift, not where fire must go next. Sparse or nearly stationary centroids show no clear direction.</p><p>Smoke follows the central run and the timeline. Sampled vegetation emits for 10 minutes; assumed burning buildings for 30. Puffs spread and drift for up to 30 minutes inside this map domain.</p><p>Uses forecast 10 m wind, including your wind scenario. Pale areas illustrate horizontal drift only: no measured smoke, concentration, plume height or airflow around buildings.</p></details>
    </aside>}
    <div className="map-controls">
      <button aria-label="Zoom in" onClick={() => map.current?.zoomIn()}><Plus size={17} /></button>
      <button aria-label="Zoom out" onClick={() => map.current?.zoomOut()}><Minus size={17} /></button>
      <button aria-label="Recenter map" onClick={() => map.current?.flyTo({ center: currentCenter.current, zoom: 12.5 })}><LocateFixed size={17} /></button>
      <button aria-label={threeD ? 'Switch to 2D map' : 'Switch to 3D terrain'} title={threeD ? 'Switch to 2D map' : 'Switch to 3D terrain'} aria-pressed={threeD} className={threeD ? 'selected' : ''} onClick={() => setThreeD(v => !v)}><Mountain size={17} /><span style={{ fontSize: 9 }}>{threeD ? '3D' : '2D'}</span></button>
      <button aria-label="Map layers" aria-expanded={layerMenu} onClick={() => setLayerMenu(v => !v)}><Layers3 size={17} /></button>
    </div>
    {layerMenu && <div className="layer-menu panel"><div className="panel-heading">Geographic layers<button aria-label="Close map layers" onClick={() => setLayerMenu(false)}><X size={15} /></button></div><div className="segmented"><button className={satellite ? 'active' : ''} onClick={() => setSatellite(true)}>Satellite</button><button className={!satellite ? 'active' : ''} onClick={() => setSatellite(false)}>Dark map</button></div>{(Object.keys(GROUPS) as Array<keyof typeof GROUPS>).map(id => <button className="layer-row" key={id} aria-pressed={visible[id]} onClick={() => setVisible(v => ({ ...v, [id]: !v[id] }))}><span className={'checkbox ' + (visible[id] ? 'checked' : '')}>{visible[id] && <Check size={11} />}</span>{GROUPS[id]}<EvidenceBadge kind={id==='hotspots'?'simulated':'observed'}/></button>)}<p>Real DEM terrain and sourced building footprints. Height provenance is shown in the building inspector.</p></div>}
    <div className="map-legend" style={{ maxWidth: 'calc(100% - 80px)' }}><b>{threeD ? '3D TERRAIN' : '2D MAP'}</b><span><EvidenceBadge kind="simulated"/> · Ignition & spread</span><span><EvidenceBadge kind="observed"/> · Geography</span><span>{simulation?'Dashed square: simulation boundary':'Select a building or vegetation fire origin'}</span><span>{simulation?.request.structural?'Red: assumed building ignition · orange: surface exposure':'Click buildings to inspect height evidence'}</span></div>
  </div>;
}
