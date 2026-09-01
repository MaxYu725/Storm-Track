# HKO Local Wind Observation Shadow

Status: **OBSERVATION-ONLY SHADOW**

This channel records the Hong Kong Observatory public dataset for the latest 10-minute mean wind direction, 10-minute mean wind speed, and 10-minute maximum gust. It exists to preserve local observed wind evidence during live tropical-cyclone validation without changing the frozen HK Signal V1 baseline or V2 Shadow 0.1 forecast calculation.

## Source

- Data: `https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv`
- HKO file-layout documentation: `https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/HKO_open_data_10min_wind_Documentation.pdf`
- Official update cadence: every 10 minutes.
- HKO describes the values as provisional observations.

## Semantics

The channel is deliberately separate from the existing tropical-cyclone `windField` analyzer.

- Existing `windField`: forecast/analysis wind-radius geometry from tropical-cyclone agencies.
- `HKO local wind shadow`: actual Hong Kong automatic-weather-station observations.

The recorder does **not** turn a single gust into T3/T8 evidence and does **not** alter any signal likelihood. Sustained 10-minute mean wind and 10-minute gust are preserved separately.

For descriptive shadow summaries only, the recorder flags stations at:

- strong-wind threshold: 41 km/h;
- gale threshold: 63 km/h.

These threshold counts are observational descriptors, not automatic HKO signal rules.

## Stored evidence

Production evidence is written to the dedicated branch:

`data/hko-local-wind-shadow`

with:

- `latest.json`
- `index.ndjson`
- immutable timestamped snapshots under `observations/YYYY/MM/DD/`

Each snapshot includes:

- source timestamp and retrieval timestamp;
- source SHA-256 and capture fingerprint;
- all available station rows;
- maximum 10-minute mean wind and gust;
- strong/gale threshold station lists;
- top mean-wind and gust stations;
- `affectsForecast: false` as an explicit isolation contract.

## Capture cadence

The workflow has its own 10-minute GitHub schedule and can be manually dispatched. The HK signal coverage keeper also dispatches it every second 5-minute tick, providing the same continuity handoff used during active validation while keeping this evidence outside evaluator/closeout semantics.

## SAUDEL use

SAUDEL is the first high-value live case for this channel because HKO has described terrain shielding and offshore/high-ground strong winds while the cyclone follows an unusual approach / pass-south / later-eastward or re-approach structure.

During the active storm, use this channel only to compare:

1. observed local winds;
2. V1 tropical-cyclone wind-field coverage;
3. V1/V2 T1/T3/T8 state and timing;
4. HKO official signal decisions.

Do not tune V1 or V2 coefficients from individual SAUDEL observations. Model integration is deferred to post-case review.
