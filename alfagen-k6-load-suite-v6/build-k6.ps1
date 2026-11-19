$ErrorActionPreference = "Stop"
$K6Version = "v1.8.2"
$Xk6Version = "v1.4.14"
$KafkaVersion = "v0.1.0"
go install "go.k6.io/xk6/cmd/xk6@$Xk6Version"
$Xk6 = Join-Path (go env GOPATH) "bin/xk6.exe"
& $Xk6 build $K6Version --with "github.com/grafana/xk6-kafka@$KafkaVersion" --output ".\k6.exe"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Built .\k6.exe"
