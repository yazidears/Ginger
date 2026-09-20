'use client';
import {useEffect,useRef} from 'react';
import * as THREE from 'three';
import * as maplibre from 'maplibre-gl';
import type {ForestTrees} from '@/lib/forest/types';
import type {RunResult} from '@/lib/sage/types';
import {crownArrivalLookup,crownExposureState} from '@/lib/sage/crown-exposure';
import {forestTileUrl} from '@/lib/forest/layers';

export type ForestSceneStatus = {state: 'loading' | 'ready' | 'partial' | 'unavailable' | 'zoom-in'; count: number; detail: string};
const EMPTY: GeoJSON.FeatureCollection = {type: 'FeatureCollection', features: []};

/** Measured crown dimensions, instanced in the same terrain scene as the forecast.
 * Colour indicates surface-fire arrival at each crown position, not individual combustion. */
export function useForestScene(map: maplibre.Map | null, ready: boolean, enabled: boolean, threeD: boolean, onStatus?: (status: ForestSceneStatus) => void, simulation?:RunResult|null, minute=0) {
  const exposure=useRef({simulation,minute});exposure.current={simulation,minute};
  const recolour=useRef<(()=>void)|null>(null);
  useEffect(()=>{recolour.current?.();},[simulation,minute]);
  useEffect(() => {
    if (!map || !ready || !enabled) return;
    const scene = new THREE.Scene(), camera = new THREE.Camera(), group = new THREE.Group();
    scene.add(group, new THREE.AmbientLight(0xffffff, 2));
    const sun = new THREE.DirectionalLight(0xfff3d5, 2); sun.position.set(-80, -60, 200); scene.add(sun);
    let anchor: maplibre.MercatorCoordinate | null = null;
    let renderer: THREE.WebGLRenderer | undefined;
    let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const clearTrees = () => {
      recolour.current=null;
      for (const child of [...group.children]) {
        group.remove(child);
        if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); }
      }
    };
    map.addSource('sage-forest-raster', {type: 'raster', tiles: [forestTileUrl('cover')], tileSize: 256, attribution: 'ICGC canopy cover · 2016–2017'});
    map.addLayer({id: 'sage-forest-raster', type: 'raster', source: 'sage-forest-raster', paint: {'raster-opacity': .18}}, 'fire-cells-fill');
    map.addSource('sage-tree-pick', {type: 'geojson', data: EMPTY});
    map.addLayer({id: 'sage-tree-pick', type: 'circle', source: 'sage-tree-pick', minzoom: 13.8, paint: {'circle-radius': 7, 'circle-opacity': threeD ? 0 : .6, 'circle-color': '#8ab9a1'}});
    map.addLayer({id: 'sage-crowns', type: 'custom', renderingMode: '3d',
      onAdd(_map, gl) { renderer = new THREE.WebGLRenderer({canvas: map.getCanvas(), context: gl as WebGL2RenderingContext}); renderer.autoClear = false; },
      render(_gl, options) {
        if (!anchor || !group.children.length || !threeD || !renderer) return;
        const scale = anchor.meterInMercatorCoordinateUnits();
        camera.projectionMatrix = new THREE.Matrix4().fromArray(options.defaultProjectionData.mainMatrix).multiply(new THREE.Matrix4().makeTranslation(anchor.x, anchor.y, anchor.z).scale(new THREE.Vector3(scale, -scale, scale)));
        renderer.resetState(); renderer.render(scene, camera);
      },
      onRemove() { clearTrees(); renderer?.dispose(); },
    });
    const load = async () => {
      controller?.abort(); controller = new AbortController(); const request = controller;
      if (map.getZoom() < 13.8) {
        clearTrees(); (map.getSource('sage-tree-pick') as maplibre.GeoJSONSource).setData(EMPTY);
        onStatus?.({state: 'zoom-in', count: 0, detail: 'Zoom in for LiDAR crowns. Regional canopy layer: ICGC 2016–2017.'}); return;
      }
      const bounds = map.getBounds(), center = map.getCenter();
      // A pitched viewport reaches far beyond the inspection scene; keep LiDAR work local.
      const box = [Math.max(bounds.getWest(), center.lng-.02), Math.max(bounds.getSouth(), center.lat-.0175), Math.min(bounds.getEast(), center.lng+.02), Math.min(bounds.getNorth(), center.lat+.0175)];
      const bounded = box[0] !== bounds.getWest() || box[1] !== bounds.getSouth() || box[2] !== bounds.getEast() || box[3] !== bounds.getNorth();
      onStatus?.({state: 'loading', count: 0, detail: 'Reading prepared LiDAR coverage…'});
      try {
        const response = await fetch(`/api/forest/trees?bbox=${box.join(',')}`, {signal: request.signal});
        const data = await response.json() as ForestTrees & {error?: string; detail?: string};
        if (!response.ok) throw Error(data.error || data.detail || 'LiDAR service unavailable');
        if (disposed || request.signal.aborted) return;
        // Bound geometry and CPU preparation. The API's full inventory is not a render budget.
        const limit = map.getZoom() >= 16 ? 5000 : 1800;
        const stride = Math.max(1, Math.ceil(data.trees.length / limit));
        const trees = data.trees.filter((_tree, index) => index % stride === 0).slice(0, limit);
        clearTrees();
        (map.getSource('sage-tree-pick') as maplibre.GeoJSONSource).setData({type: 'FeatureCollection', features: trees.map(tree => ({type: 'Feature', properties: tree, geometry: {type: 'Point', coordinates: [tree.lon, tree.lat]}}))});
        if (trees.length) {
          anchor = maplibre.MercatorCoordinate.fromLngLat([trees[0].lon, trees[0].lat]);
          const scale = anchor.meterInMercatorCoordinateUnits();
          const crowns = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshStandardMaterial({roughness: 1, flatShading: true}), trees.length);
          const dummy = new THREE.Object3D();
          let indexed:RunResult|null|undefined,arrivals:(number|null)[]=[];
          const updateColours=()=>{const current=exposure.current;if(indexed!==current.simulation||arrivals.length!==trees.length){indexed=current.simulation;const lookup=crownArrivalLookup(indexed?.cells);arrivals=trees.map(tree=>lookup(tree.lon,tree.lat));}trees.forEach((tree,index)=>{const state=crownExposureState(arrivals[index],current.minute);crowns.setColorAt(index,state==='front'?new THREE.Color('#ff893e'):state==='reached'?new THREE.Color('#62443c'):new THREE.Color().setHSL(.32,.24,.27+Math.min(tree.heightM,30)/180));});if(crowns.instanceColor)crowns.instanceColor.needsUpdate=true;map.triggerRepaint();};
          recolour.current=updateColours;
          trees.forEach((tree, index) => {
            const p = maplibre.MercatorCoordinate.fromLngLat([tree.lon, tree.lat]);
            const ground = map.queryTerrainElevation([tree.lon, tree.lat]) ?? tree.groundM;
            dummy.position.set((p.x-anchor!.x)/scale, -(p.y-anchor!.y)/scale, ground + tree.heightM*.66);
            dummy.scale.set(tree.crownRadiusM, tree.crownRadiusM, tree.heightM*.34); dummy.updateMatrix(); crowns.setMatrixAt(index, dummy.matrix);
            crowns.setColorAt(index, new THREE.Color().setHSL(.32, .24, .27 + Math.min(tree.heightM,30)/180));
          });
          crowns.instanceMatrix.needsUpdate = true; if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true; group.add(crowns);updateColours();
        }
        const partial = bounded || data.truncated || data.trees.length > limit || data.tiles.some(tile => tile.state !== 'completed');
        onStatus?.({state: trees.length && !partial ? 'ready' : 'partial', count: trees.length, detail: `${trees.length.toLocaleString()} displayed crowns · ${data.acquired || '2021–2023'} LiDAR. ${partial ? 'Partial coverage / display limit. ' : ''}${!trees.length ? 'No prepared crowns here. ' : ''}Orange: central fire arrival; brown: already reached. Illustrative exposure, not measured burning or per-tree physics.`});
        map.triggerRepaint();
      } catch (error) {
        if (disposed || request.signal.aborted) return;
        clearTrees(); (map.getSource('sage-tree-pick') as maplibre.GeoJSONSource).setData(EMPTY);
        onStatus?.({state: 'unavailable', count: 0, detail: `${error instanceof Error ? error.message : 'LiDAR unavailable'}. Regional canopy: 2016–2017; blank does not mean no trees.`});
      }
    };
    const moved = () => { controller?.abort(); clearTimeout(timer); timer = setTimeout(() => void load(), 250); };
    void load(); map.on('moveend', moved);window.addEventListener('ginger-forest-refresh',moved);
    return () => {
      disposed = true; controller?.abort(); clearTimeout(timer); map.off('moveend', moved);window.removeEventListener('ginger-forest-refresh',moved);
      for (const id of ['sage-crowns','sage-tree-pick','sage-forest-raster']) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of ['sage-tree-pick','sage-forest-raster']) if (map.getSource(id)) map.removeSource(id);
    };
  }, [map, ready, enabled, threeD, onStatus]);
}
