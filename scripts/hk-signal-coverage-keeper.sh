#!/usr/bin/env bash
set -euo pipefail

INTERVAL_SECONDS="${COVERAGE_KEEPER_INTERVAL_SECONDS:-300}"
SESSION_SECONDS="${COVERAGE_KEEPER_SESSION_SECONDS:-18000}"
EVALUATOR_DELAY_SECONDS="${COVERAGE_KEEPER_EVALUATOR_DELAY_SECONDS:-90}"
DRY_RUN="${COVERAGE_KEEPER_DRY_RUN:-false}"
ONCE="${COVERAGE_KEEPER_ONCE:-false}"
REPO="${GITHUB_REPOSITORY:-MaxYu725/Storm-Track}"
REF="${COVERAGE_KEEPER_REF:-main}"
API_URL="${GITHUB_API_URL:-https://api.github.com}"

if ! [[ "$INTERVAL_SECONDS" =~ ^[0-9]+$ ]] || (( INTERVAL_SECONDS < 60 )); then
  echo "invalid COVERAGE_KEEPER_INTERVAL_SECONDS=$INTERVAL_SECONDS" >&2
  exit 2
fi
if ! [[ "$SESSION_SECONDS" =~ ^[0-9]+$ ]] || (( SESSION_SECONDS < INTERVAL_SECONDS )); then
  echo "invalid COVERAGE_KEEPER_SESSION_SECONDS=$SESSION_SECONDS" >&2
  exit 2
fi
if ! [[ "$EVALUATOR_DELAY_SECONDS" =~ ^[0-9]+$ ]] || (( EVALUATOR_DELAY_SECONDS >= INTERVAL_SECONDS )); then
  echo "invalid COVERAGE_KEEPER_EVALUATOR_DELAY_SECONDS=$EVALUATOR_DELAY_SECONDS" >&2
  exit 2
fi

if [[ "$DRY_RUN" != "true" && -z "${GH_TOKEN:-}" ]]; then
  echo "GH_TOKEN is required unless COVERAGE_KEEPER_DRY_RUN=true" >&2
  exit 2
fi

started_epoch="$(date -u +%s)"
iteration=0

workflow_dispatch() {
  local workflow="$1"
  local label="$2"
  local now
  now="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[$now] DRY_RUN dispatch $label ($workflow) ref=$REF"
    return 0
  fi

  local url="${API_URL}/repos/${REPO}/actions/workflows/${workflow}/dispatches"
  local payload
  payload="$(jq -cn --arg ref "$REF" '{ref:$ref}')"
  local attempt http_code

  for attempt in 1 2 3; do
    http_code="$(curl --silent --show-error --location \
      --output /tmp/coverage-keeper-response.txt \
      --write-out '%{http_code}' \
      --request POST \
      --header 'Accept: application/vnd.github+json' \
      --header "Authorization: Bearer ${GH_TOKEN}" \
      --header 'X-GitHub-Api-Version: 2022-11-28' \
      --data "$payload" \
      "$url" || true)"

    if [[ "$http_code" == "204" ]]; then
      echo "[$now] dispatched $label ($workflow) ref=$REF attempt=$attempt"
      return 0
    fi

    echo "[$now] dispatch attempt $attempt failed: $label HTTP ${http_code:-curl-error}" >&2
    cat /tmp/coverage-keeper-response.txt >&2 2>/dev/null || true
    if (( attempt < 3 )); then sleep 5; fi
  done

  return 1
}

safe_dispatch() {
  local workflow="$1"
  local label="$2"
  if ! workflow_dispatch "$workflow" "$label"; then
    echo "WARNING: coverage keeper could not dispatch $label this tick; continuing session" >&2
    return 0
  fi
}

while true; do
  tick_started_epoch="$(date -u +%s)"
  elapsed=$((tick_started_epoch - started_epoch))
  if (( elapsed > SESSION_SECONDS )); then
    echo "coverage keeper session complete after ${elapsed}s"
    break
  fi

  # HKO truth is the high-frequency truth source. Dispatch every keeper tick.
  safe_dispatch 'hko-warning-truth-recorder.yml' 'HKO truth recorder'

  # Beta prospective is intentionally lower-frequency: every third 5-minute tick.
  if (( iteration % 3 == 0 )); then
    safe_dispatch 'beta-prospective-recorder.yml' 'Beta prospective recorder'
  fi

  # Workflows started by this keeper use GITHUB_TOKEN. GitHub recursion protection
  # prevents their workflow_run events from starting another workflow, so dispatch
  # the evaluator explicitly after allowing the recorder writes to settle.
  if [[ "$DRY_RUN" != "true" && "$EVALUATOR_DELAY_SECONDS" != "0" ]]; then
    sleep "$EVALUATOR_DELAY_SECONDS"
  fi
  safe_dispatch 'hk-signal-evaluator.yml' 'HK signal evaluator'

  if [[ "$ONCE" == "true" ]]; then
    echo "coverage keeper one-shot complete"
    break
  fi

  iteration=$((iteration + 1))
  now_epoch="$(date -u +%s)"
  elapsed=$((now_epoch - started_epoch))
  if (( elapsed >= SESSION_SECONDS )); then
    echo "coverage keeper session complete after ${elapsed}s"
    break
  fi

  tick_elapsed=$((now_epoch - tick_started_epoch))
  sleep_seconds=$((INTERVAL_SECONDS - tick_elapsed))
  if (( sleep_seconds <= 0 )); then
    echo "coverage keeper tick overran interval by $((-sleep_seconds))s; continuing immediately" >&2
    continue
  fi
  if (( elapsed + sleep_seconds > SESSION_SECONDS )); then
    sleep_seconds=$((SESSION_SECONDS - elapsed))
  fi
  if (( sleep_seconds > 0 )); then sleep "$sleep_seconds"; fi
done
