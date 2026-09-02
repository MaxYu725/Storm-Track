# AI Situation Analysis Shadow — Evidence Catalog v1

## Problem

The first real Workers AI runs showed that free-form JSON-path citations are a poor interface for model output. Even when the situation interpretation was useful, the model could invent a plausible-looking path, omit the `$.evidence` root, or use unsupported JSONPath filters. Fail-closed validation correctly rejected those outputs, but repeated prompt wording alone would not remove the structural problem.

## Design

Every immutable situation evidence packet now contains a deterministic catalog:

```json
{
  "schemaVersion": "hk-situation-analysis-evidence-catalog/v1",
  "referenceMode": "catalog-id-only",
  "entries": [
    {
      "id": "E_V1_T3",
      "path": "$.evidence.deterministicForecasts.v1.signals.T3",
      "kind": "signal",
      "description": "Frozen V1 T3 likelihood, risk, confidence and timing guidance."
    }
  ]
}
```

The catalog is built by deterministic repository code, not by the AI provider. IDs are storm-agnostic: the same evidence kind receives the same ID across SAUDEL, KROVANH and future cases.

## Output contract

Prompt version `hk-situation-analysis-prompt/v0.3` uses output schema `hk-situation-analysis-shadow-output/v0.2`.

The model must cite only catalog IDs. Examples:

```json
{
  "evidenceIds": ["E_REAPPROACH", "E_HKO_SIGNAL_STATEMENT"]
}
```

or:

```json
{
  "id": "E_LOCAL_WIND_SUMMARY",
  "finding": "Local sustained strong-wind coverage is limited."
}
```

The model must not emit JSON paths.

## Double enforcement

1. Before the request, the provider adapter builds a packet-specific JSON Schema whose evidence-ID fields use an `enum` containing only IDs present in that packet.
2. After the response, repository-local validation independently rejects any ID not present in the supplied immutable catalog.

Cloudflare/OpenAI structured-output behavior is therefore not treated as the only safety boundary.

## Core catalog groups

The initial catalog exposes compact object-level anchors for:

- V1 and V2 impact plus T1/T3/T8 outputs;
- geometry and uncertainty;
- direct approach / departure / re-approach / quasi-stationary lifecycle evidence;
- forecast edge, agency disagreement and interpolation reliability;
- tropical-cyclone wind-field evidence;
- rapid evolution;
- per-agency patterns and threat timeline;
- signal feature/coverage/disagreement evidence;
- contemporaneous HKO operational context when safely available;
- local-wind summary and station observations when available.

It intentionally does not assign IDs to every individual leaf value. The AI should cite the smallest stable evidence object needed for an auditable interpretation rather than reconstruct arbitrary paths.

## Anti-overfitting

The catalog contains no storm-name branch and no SAUDEL-specific ID. It does not alter deterministic risk, coefficients, evaluator state or closeout logic.

```text
affectsForecast = false
affectsEvaluator = false
caseSpecificRulesForbidden = true
referenceMode = catalog-id-only
```

The purpose is evidence-addressing reliability, not model calibration.
