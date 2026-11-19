#!/usr/bin/env bash
set -euo pipefail

SCENARIO="maximum"
K6_OVERRIDE="${K6_BIN:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario) SCENARIO="$2"; shift 2 ;;
    --k6) K6_OVERRIDE="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: ./run.sh --scenario maximum|stress|reliability|batch [--k6 /path/to/k6]"
      exit 0
      ;;
    *) echo "Unknown argument: $1"; exit 2 ;;
  esac
done

if [[ -f "config/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "config/.env"
  set +a
fi

case "$SCENARIO" in
  maximum) SCRIPT="scenarios/maximum.js" ;;
  stress) SCRIPT="scenarios/stress.js" ;;
  reliability) SCRIPT="scenarios/reliability.js" ;;
  batch) SCRIPT="batch_100k.js" ;;
  *) echo "Invalid scenario: $SCENARIO"; exit 2 ;;
esac

if [[ -n "$K6_OVERRIDE" ]]; then
  K6="$K6_OVERRIDE"
elif [[ -x "./k6" ]]; then
  K6="./k6"
elif [[ -x "./k6-windows-amd64.exe" ]]; then
  K6="./k6-windows-amd64.exe"
elif [[ -x "./k6.exe" ]]; then
  K6="./k6.exe"
elif command -v k6 >/dev/null 2>&1; then
  K6="$(command -v k6)"
else
  echo "k6 binary not found. Set K6_BIN or use --k6 /path/to/k6."
  exit 3
fi

echo "Scenario=$SCENARIO"
echo "Script=$SCRIPT"
echo "K6=$K6"
"$K6" run --include-system-env-vars "$SCRIPT"
