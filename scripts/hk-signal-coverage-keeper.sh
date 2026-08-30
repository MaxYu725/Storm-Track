#!/usr/bin/env bash
set -euo pipefail

INTERVAL_SECONDS="${COVERAGE_KEEPER_INTERVAL_SECONDS:-300}"
SESSION_SECONDS="${COVERAGE_KEEPER_SESSION_SECONDS:-18000}"
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
  local http_code
  http_code="$(curl --silent --show-error --location \
    --output /tmp/coverage-keeper-response.txt \
    --write-out '%{http_code}' \
    --request POST \
    --header 'Accept: application/vnd.github+json' \
    --header "Authorization: Bearer ${GH_TOKEN}" \
    --header 'X-GitHub-Api-Version: 2022-11-28' \
    --data "$payload" \
    "$url")"

  if [[ "$http_code" != "204" ]]; then
    echo "[$now] dispatch failed: $label HTTP $http_code" >&2
    cat /tmp/coverage-keeper-response.txt >&2 || true
    return 1
  fi
  echo "[$now] dispatched $label ($workflow) ref=$REF"
}

while true; do
  now_epoch="$(date -u +%s)"
  elapsed=$((now_epoch - started_epoch))
  if (( elapsed > SESSION_SECONDS )); then
    echo "coverage keeper session complete after ${elapsed}s"
    break
  fi

  # HKO truth is the high-frequency truth source. Dispatch every keeper tick.
  workflow_dispatch 'hko-warning-truth-recorder.yml' 'HKO truth recorder'

  # Beta prospective is intentionally lower-frequency: every third 5-minute tick.
  if (( iteration % 3 == 0 )); then
    workflow_dispatch 'beta-prospective-recorder.yml' 'Beta prospective recorder'
  fi

  if [[ "$ONCE" == "true" ]]; then
    echo "coverage keeper one-shot complete"
    break
  fi

  iteration=$((iteration + 1))
  now_epoch="$(date -u +%s)"
  elapsed=$((now_epoch - started_epoch))
  if (( elapsed + INTERVAL_SECONDS > SESSION_SECONDS )); then
    echo "coverage keeper session complete after ${elapsed}s"
    break
  fi
  sleep "$INTERVAL_SECONDS"
done
