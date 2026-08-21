# AI-20 — Historical Forecast Archive Source Research

Status: **alternative archives identified, but none may substitute for missing official agency forecast provenance**

This note records source research performed while JMA 2615 remains preliminary. No external archive data was imported and no production or analysis database was modified.

## Current production gap

The read-only finalized-corpus inventory established that the production Storm archive begins too late to contain forecast provenance for JMA-finalized 2601–2604. The current analysis corpus therefore cannot reach the distinct-storm thresholds for adaptive weighting or signal calibration from production history alone.

## JMA public historical material

JMA's public historical typhoon pages provide long-term typhoon track charts, position tables, finalized Best Track data and annual-report material. These are suitable authoritative truth/finality sources, but they do not expose the missing multi-agency historical forecast bulletin corpus needed to recreate the current four-agency walk-forward snapshots.

JMA's information catalogue also describes WTJP typhoon products distributed through operational delivery channels such as SafetyCast/GTS. This confirms that operational forecast products exist, but it does not by itself establish a public, stable historical bulletin archive that can be ingested under the current project provenance rules.

Relevant official sources reviewed:

- `https://www.data.jma.go.jp/typhoon/`
- `https://www.jma.go.jp/jma/jma-eng/jma-center/rsmc-hp-pub-eg/Besttracks/bst2026.txt`
- `https://ds.data.jma.go.jp/suishin/cgi-bin/catalogue/make_product_page.cgi?id=Taifu`

## TIGGE / UCAR tropical-cyclone track archive

The WMO/WWRP TIGGE ecosystem is a real and useful historical forecast archive. ECMWF documentation describes a TIGGE Tropical Cyclone Track archive using Cyclone XML (CXML), and UCAR GDEX exposes historical files from participating numerical prediction centres.

Examples observed during research include:

- JMA-origin (`RJTD`) CXML tropical-cyclone track files, including 2026 May, June, July and August inventories;
- CMA-origin (`BABJ`) historical tropical-cyclone track files;
- filenames explicitly marked as NWP/model products such as `..._GSM_glob_prod_tctr_nwp.xml` and ensemble track products.

Relevant sources reviewed:

- `https://confluence.ecmwf.int/spaces/TIGGE/pages/40109935/Description`
- `https://confluence.ecmwf.int/spaces/TIGGE/pages/40109881/Tools`
- `https://gdex.ucar.edu/datasets/d330003/`

## Why TIGGE cannot fill the current agency-skill gap

The current Storm Track agency semantics refer to independently published agency forecast tracks from HKO, CMA/NMC, JMA and CWA. TIGGE TC tracks are model/NWP guidance products contributed by numerical prediction centres. They are not automatically equivalent to an agency's public operational tropical-cyclone forecast bulletin.

Therefore:

- `RJTD` TIGGE model tracks must not be silently labelled as the existing official `JMA` forecast source;
- `BABJ` TIGGE model tracks must not be silently labelled as the existing official `CMA`/NMC forecast source;
- TIGGE does not solve HKO or CWA historical bulletin provenance;
- mixing NWP model guidance with official agency tracks under one agency identifier would invalidate skill comparisons and violate the project's agency-independence rule.

## Safe future use

TIGGE remains potentially valuable as a **separate model-guidance research dataset**. A future checkpoint could define independent source identifiers such as model/centre/product tuples, preserve CXML issuance time and archive provenance, and evaluate model guidance separately from official agency bulletins.

Such a dataset must not:

- count toward official four-agency forecast coverage;
- alter official agency skill weights;
- substitute for missing HKO/CWA forecasts;
- be merged into the current `JMA`, `CMA`, `HKO` or `CWA` identities without an explicit semantic redesign.

## Current decision

Do not backfill the AI learning corpus from TIGGE merely to reach minimum storm counts. Continue accumulating the production four-agency archive and wait for official post-analysis truth for those storms. Historical model-guidance research, if pursued, should be isolated as a separate later dataset/checkpoint.
