# Wind field feasibility study

## Decision

For the first Storm Track wind-map beta, use a **frontend-only ECMWF IFS 10 m model wind field via Open-Meteo**, rendered by a local Canvas particle layer on top of the existing Leaflet map.

The wind field is a contextual numerical-model layer. It must remain separate from HKO/CMA/JMA/CWA official tropical-cyclone tracks and from the saved official wind-radii layer.

## Why this option

### Open-Meteo / ECMWF IFS

- Open-Meteo's ECMWF endpoint exposes IFS wind speed and direction at 10 m and supports multiple coordinates in one request.
- Current documentation describes IFS HRES at about 9 km, with updates every 6 hours.
- API data are CC BY 4.0 and require attribution.
- The free endpoint is non-commercial and currently rate-limited to 10,000 calls/day, 5,000/hour and 600/minute, with no uptime guarantee.
- Storm Track can therefore make one bounded multi-coordinate request only when the user explicitly enables the layer, cache it for the session, and avoid any production Worker change.

References:
- https://open-meteo.com/en/docs/ecmwf-api
- https://open-meteo.com/en/license
- https://open-meteo.com/en/terms
- https://open-meteo.com/en/pricing

### NOAA GFS / NOMADS

Technically viable, but not the best browser-first beta path.

- NOMADS supports 0.25 degree GFS and UGRD/VGRD subsetting.
- The Grib Filter returns GRIB2 binary data.
- NCEP's own help asks automated loops to leave about 10 seconds between fetches.
- A robust implementation would therefore benefit from a separate ingestion/conversion service, caching and model-run management rather than direct mobile-browser processing.

References:
- https://nomads.ncep.noaa.gov/
- https://nomads.ncep.noaa.gov/info.php?page=gribfilter
- https://nomads.ncep.noaa.gov/info.php?page=opendap_grib_migration

### Windy Map Forecast API

Not selected for production integration.

- It provides a mature Leaflet-based wind particle layer.
- The free Testing tier is explicitly development-only.
- The Professional tier is listed at EUR 990/year, with ECMWF optional licensing costs.
- The current Windy library documentation is based on Leaflet 1.4.x, while Storm Track uses Leaflet 1.9.4, so adopting it would also increase map-lifecycle coupling.

References:
- https://api.windy.com/map-forecast/pricing
- https://api.windy.com/map-forecast/docs

## Beta architecture

```text
Existing Storm Track Leaflet map
        |
        +-- official HKO/CMA/JMA/CWA paths (unchanged)
        +-- saved official wind radii (unchanged)
        +-- optional model wind field beta
                |
                +-- Open-Meteo ECMWF endpoint
                +-- bounded viewport coordinate grid
                +-- wind speed/direction -> U/V
                +-- bilinear interpolation
                +-- Canvas particles
```

## Guardrails

1. The layer is **off by default**.
2. No production Storm Worker endpoint, secret, D1 table or R2 object is changed.
3. One multi-coordinate request is used per required grid refresh; panning inside the existing grid does not trigger another fetch.
4. Session cache TTL is 20 minutes.
5. UI always identifies the layer as `ECMWF IFS · 10 m · 模式風場` and includes Open-Meteo attribution.
6. It must never be described as an HKO official wind field, warning signal forecast or official tropical-cyclone wind radius.
7. `prefers-reduced-motion` users get static vector arrows instead of particle animation.
8. If the source is unavailable, official storm-track functionality remains unaffected.

## Future upgrade path

If wind-field usage becomes core rather than optional beta functionality, move data acquisition to an independently versioned wind-data service. That service can later ingest raw ECMWF/GFS GRIB2, persist run metadata, expose compact vector tiles/grids, and remove browser dependence on third-party API quotas without touching the authoritative production Storm Worker.
