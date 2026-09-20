'use client';
import {useEffect, useRef, useState} from 'react';
import type {Map as MapInstance, Marker} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
export default function HomeWatchMap({lat, lon, onMove}: {lat: number; lon: number; onMove: (lat: number, lon: number) => void}) {
  const container = useRef<HTMLDivElement>(null), map = useRef<MapInstance | null>(null), marker = useRef<Marker | null>(null), move = useRef(onMove);
  const [failed, setFailed] = useState(false);
  move.current = onMove;
  useEffect(() => {
    let cancelled = false;
    void import('maplibre-gl').then(lib => {
      if (cancelled || !container.current) return;
      const m = new lib.Map({container: container.current, center: [lon, lat], zoom: 16, renderWorldCopies: false, style: {version: 8, sources: {osm: {type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxzoom: 19}}, layers: [{id: 'streets', type: 'raster', source: 'osm'}]}});
      map.current = m;
      const pin = new lib.Marker({color: '#ce6345', draggable: true}).setLngLat([lon, lat]).addTo(m);
      marker.current = pin;
      pin.on('dragend', () => {const p = pin.getLngLat(); move.current(p.lat, p.lng);});
      m.on('click', e => {pin.setLngLat(e.lngLat); move.current(e.lngLat.lat, e.lngLat.lng);});
      m.on('error', () => setFailed(true));
      m.addControl(new lib.NavigationControl({showCompass: false}), 'top-right');
    }).catch(() => setFailed(true));
    return () => {cancelled = true; map.current?.remove(); map.current = null; marker.current = null;};
    // A mounted map tracks coordinate changes in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {map.current?.jumpTo({center: [lon, lat]}); marker.current?.setLngLat([lon, lat]);}, [lat, lon]);
  return <><div ref={container} className="home-pin-map" aria-label="Home location map. Click or drag the marker; coordinates can also be edited below."/>{failed && <p role="status">Map tiles are unavailable. Confirm the coordinates below instead.</p>}</>;
}
