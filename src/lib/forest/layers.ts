import type {ForestMetric} from './types';
export const FOREST_WMS='https://geoserveis.icgc.cat/servei/catalunya/variables-biofisiques-arbrat/wms';
export const FOREST_LAYERS:Record<ForestMetric,{label:string;layer:string;unit:string;description:string}>={
 density:{label:'Tree density',layer:'densitat_peus_hectarea_color_2016_2017',unit:'stems / ha',description:'ICGC modelled stem density. Reference period 2016–2017; not a current tree census.'},
 height:{label:'Canopy height',layer:'alcada_mitjana_color_2016_2017',unit:'m',description:'ICGC modelled mean tree height. Reference period 2016–2017.'},
 cover:{label:'Canopy cover',layer:'recobriment_arbori_color_2016_2017',unit:'%',description:'ICGC modelled canopy cover. Reference period 2016–2017.'},
 biomass:{label:'Aboveground biomass',layer:'biomassa_aeria_total_color_2016_2017',unit:'t / ha',description:'Modelled aboveground biomass includes material that is not available wildfire fuel.'},
 foliage:{label:'Foliage biomass',layer:'biomassa_foliar_color_2016_2017',unit:'t / ha',description:'Modelled foliage biomass; not measured fuel moisture.'},
 diameter:{label:'Mean stem diameter',layer:'diametre_normal_mitja_color_2016_2017',unit:'cm',description:'Stand-level mean diameter, not an individual trunk measurement.'},
};
export function forestTileUrl(metric:ForestMetric){return `${FOREST_WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${FOREST_LAYERS[metric].layer}&STYLES=&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}`;}
export function forestLegendUrl(metric:ForestMetric){return `${FOREST_WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetLegendGraphic&LAYER=${FOREST_LAYERS[metric].layer}&FORMAT=image/png`;}
