param(
    [ValidateSet("maximum", "stress", "reliability", "batch")]
    [string]$Scenario = "maximum",
    [string]$K6Bin = ""
)

$ErrorActionPreference = "Stop"

$envFile = Join-Path $PSScriptRoot "config/.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $name = $parts[0].Trim()
            $value = $parts[1].Trim()
            if (($value.StartsWith("'") -and $value.EndsWith("'")) -or
                ($value.StartsWith('"') -and $value.EndsWith('"'))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            $existing = [Environment]::GetEnvironmentVariable($name, "Process")
            if ([string]::IsNullOrEmpty($existing)) {
                [Environment]::SetEnvironmentVariable($name, $value, "Process")
            }
        }
    }
}

$script = switch ($Scenario) {
    "maximum" { "scenarios/maximum.js" }
    "stress" { "scenarios/stress.js" }
    "reliability" { "scenarios/reliability.js" }
    "batch" { "batch_100k.js" }
}

if (-not $K6Bin) {
    if ($env:K6_BIN) { $K6Bin = $env:K6_BIN }
    elseif (Test-Path (Join-Path $PSScriptRoot "k6.exe")) { $K6Bin = Join-Path $PSScriptRoot "k6.exe" }
    elseif (Test-Path (Join-Path $PSScriptRoot "k6-windows-amd64.exe")) { $K6Bin = Join-Path $PSScriptRoot "k6-windows-amd64.exe" }
    else {
        $cmd = Get-Command k6 -ErrorAction SilentlyContinue
        if ($cmd) { $K6Bin = $cmd.Source }
    }
}

if (-not $K6Bin) {
    throw "k6 binary not found. Use -K6Bin or set K6_BIN."
}

Write-Host "Scenario=$Scenario"
Write-Host "Script=$script"
Write-Host "K6=$K6Bin"
& $K6Bin run --include-system-env-vars (Join-Path $PSScriptRoot $script)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
