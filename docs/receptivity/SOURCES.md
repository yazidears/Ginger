# Data and equation references

- [Meteocat open data and XEMA cadence](https://www.meteo.cat/wpweb/serveis/dades-obertes/)
- [XEMA API specification: units and UTC timestamps](https://apidocs.meteocat.gencat.cat/documentacio/dades-de-la-xema/)
- [Station metadata, public JSON](https://analisi.transparenciacatalunya.cat/resource/yqwd-vj5e.json)
- [Variable metadata, public JSON](https://analisi.transparenciacatalunya.cat/resource/4fb2-n3yi.json)
- [Observations, public JSON](https://analisi.transparenciacatalunya.cat/resource/nzvn-apee.json)
- [Hourly FFMC scientific references and reference implementation](https://github.com/cffdrs/cffdrs_r/blob/main/R/hourly_fine_fuel_moisture_code.r): Van Wagner 1977 PS-X-69; Van Wagner & Pickett 1985 FTR-33. Equations are reimplemented in TypeScript; no claim of Catalan calibration.
- [Standard Initial Spread Index](https://github.com/cffdrs/cffdrs_r/blob/main/R/initial_spread_index.r)
- [Canada FWI system component meanings](https://natural-resources.canada.ca/forests-forestry/wildland-fires/canada-fire-weather-index-system)
- [Open-Meteo variables, units, temporal definitions and usage terms](https://open-meteo.com/en/docs). Public service is subject to non-commercial limits; commercial deployment needs the appropriate plan/endpoint or another permitted provider.
- [MET Norway accumulation periods](https://api.met.no/doc/ForecastJSON); [terms](https://api.met.no/doc/TermsOfService). Source attribution is retained; identify deployments with a useful User-Agent.
- [ESA WorldCover](https://esa-worldcover.org/en), 2021 v200, CC BY 4.0. [Actual public COG used](https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N39E000_Map.tif). Epoch is shown explicitly; it cannot detect subsequent land-use changes.
- [ICGC land-cover API](https://api.icgc.cat/territorial/collections/cobertes-sol): investigated and live-tested; bounded vector queries only below 2,000 ha. It was not substituted with invented municipality-wide polygons. [ICGC 2024 WMS](https://www.icgc.cat/en/Geoinformation-and-Maps/Online-services-Geoservices/WMS-Land-cover) is a future official high-resolution alternative. CORINE is coarser and not used to pretend to resolve 200 m fuels.
- [Sentinel-2 Earth Search STAC](https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a), Copernicus surface reflectance, per-asset scale/offset and SCL. NDVI=(B08-B04)/(B08+B04); NDMI=(B08-B11)/(B08+B11).
- [Terrarium source attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Native terrain source accuracy differs by region; 200 m gradient output is not 200 m source accuracy.
- [Generalitat official Pla Alfa](https://interior.gencat.cat/ca/serveis/informacio-geografica/visors-i-aplicacions/pla-alfa/). [Public municipal service](https://services7.arcgis.com/ZCqVt1fRXwwK6GF4/arcgis/rest/services/Pla_Alfa_Municipal_Avui_FL_2_view/FeatureServer/0). Current comparison requires a fresh metadata timestamp; never relabel stale levels as today's danger.
- [Generalitat daily fire-danger reference](https://agricultura.gencat.cat/ca/ambits/medi-natural/incendis-forestals/mapes/mapa-perill-incendi/).
- Basemap: Esri World Dark Gray Base / Reference public raster services, attributed in the map. CARTO was rejected after visual testing revealed an API-key watermark despite HTTP 200.
