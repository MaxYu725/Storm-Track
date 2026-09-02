# HK Signal AI Situation Analysis Shadow — Cloudflare Workers AI

Status: **MANUAL INFERENCE PROVIDER / SHADOW ONLY**

This provider attaches Cloudflare Workers AI to the existing immutable AI Situation Analysis Shadow packet corpus. It does not change frozen V1, V2 Shadow, evaluator, closeout, HKO truth attribution, or any deterministic coefficient/threshold.

## Provider choice

Initial model: `@cf/openai/gpt-oss-120b`.

The adapter uses the Cloudflare Workers AI OpenAI-compatible Chat Completions endpoint:

```text
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions
```

It requests JSON Schema output and then applies the repository's own strict local validator. Provider schema-following is therefore not trusted as the only correctness layer.

## Why this provider fits the experiment

- Cloudflare-hosted reasoning model;
- no new application server is required;
- the exact same immutable evidence packets and prompt contract are reused;
- output remains provider-neutral at the semantic level;
- OpenAI direct API support remains available separately as an optional benchmark;
- inference can remain manual while the research contract is still being validated.

## Closed-book contract

The model receives exactly:

1. `hk-situation-analysis-prompt/v0.1` system instructions;
2. one saved `hk-situation-analysis-shadow-input/v0.1` evidence packet.

It does **not** receive:

- HKO truth corpus;
- evaluator output;
- later observations;
- web search;
- tool calls;
- source-ID based hidden context;
- storm-specific prompt branches.

The storm name/case ID/date/station names are provenance only and cannot select a special rule.

## Output contract

The response must conform to `hk-situation-analysis-shadow-output/v0.1` and include lifecycle interpretation, current/future phases, decision-window interpretation, T1/T3/T8 operational interpretation, evidence conflicts, semantic concerns and uncertainties.

The adapter rejects:

- missing choices/content;
- non-normal completion;
- non-JSON output;
- locally invalid schema output;
- evidence references outside `$.evidence...`.

No replacement risk/probability is generated.

## Runtime settings

Current pilot defaults:

```text
model       @cf/openai/gpt-oss-120b
max_tokens  6000
temperature 0.2
seed        725
stream      false
```

`reasoningControl` is recorded as `provider-default` because the Chat Completions contract used here does not depend on a provider-specific reasoning-effort switch. The model itself is reasoning-capable.

## Credentials

The GitHub Actions workflow accepts either naming convention already used across projects:

```text
CLOUDFLARE_ACCOUNT_ID   preferred
CLOUDFLARE_API_TOKEN    preferred

CF_ACCOUNT_ID           fallback
CF_API_TOKEN             fallback
```

The API token must be allowed to invoke Workers AI for the account. If an existing Cloudflare deployment token does not include Workers AI permission, use a separate Workers AI token rather than broadening unrelated production credentials unnecessarily.

Secrets are never written to repository files or inference records. The stored endpoint is normalized with `{account_id}` rather than persisting the account ID.

## Workflow

`.github/workflows/hk-situation-analysis-cloudflare-shadow.yml` is `workflow_dispatch` only.

Required input:

```text
case_id = exact stable case ID present in the latest immutable packet batch
```

Default model:

```text
@cf/openai/gpt-oss-120b
```

`force=false` prevents a duplicate call when the same provider already has an inference for the same packet + prompt + model + fixed provider settings.

## Persistence

Successful outputs are written to the existing provider-neutral data branch:

```text
data/hk-situation-analysis-shadow-inferences
```

Immutable Cloudflare history is stored under:

```text
inferences/<case-id>/cloudflare-workers-ai/YYYY/MM/DD/...
```

Convenience pointers are provider-specific:

```text
cases/<case-id>/providers/cloudflare-workers-ai/latest.json
providers/cloudflare-workers-ai/latest.json
```

This prevents a Cloudflare run from overwriting the OpenAI provider's convenience pointer while still allowing a shared cross-provider index.

## First pilot design

Do not judge the provider using SAUDEL alone.

The first controlled comparison should use at least:

- `STC-2026-JMA-TC2621` — SAUDEL stress case;
- `STC-2026-JMA-TC2628` — KROVANH control case from the same packet batch.

The same prompt, schema, model settings and no-truth contract must be used for both. SAUDEL must not receive any special instruction.

## Promotion gate

Cloudflare Workers AI remains shadow-only until independent prospective evidence shows that it can improve situation interpretation without degrading ordinary-path cases.

A provider is not promoted merely because it produces a convincing narrative for SAUDEL. Required evidence includes lifecycle-phase correctness, evidence-reference discipline, timing interpretation, contradiction detection, uncertainty calibration and explicit ordinary-case regression checks.
