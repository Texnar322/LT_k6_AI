#!/usr/bin/env bash
set -euo pipefail
K6_VERSION="v1.8.2"
XK6_VERSION="v1.4.14"
KAFKA_VERSION="v0.1.0"
go install "go.k6.io/xk6/cmd/xk6@${XK6_VERSION}"
"$(go env GOPATH)/bin/xk6" build "$K6_VERSION" \
  --with "github.com/grafana/xk6-kafka@${KAFKA_VERSION}" \
  --output ./k6
echo "Built ./k6"
