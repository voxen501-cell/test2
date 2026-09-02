<#
  Puts the AI Companion bridge on your own Cloudflare domain.

  The bridge keeps running on this PC; Cloudflare only lends it a public
  address with a real certificate, which is what Bedrock needs before it will
  talk to anything that is not localhost.

  Run once:   .\setup-cloudflare.ps1 -Hostname ai.yourdomain.com
  Run daily:  .\setup-cloudflare.ps1 -Hostname ai.yourdomain.com -RunOnly
#>
param(
  [Parameter(Mandatory = $true)][string]$Hostname,
  [string]$TunnelName = "ai-bridge",
  [int]$Port = 8080,
  [switch]$RunOnly
)

$ErrorActionPreference = "Stop"
$cf = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $cf)) { $cf = (Get-Command cloudflared).Source }

$cfDir = Join-Path $env:USERPROFILE ".cloudflared"
$configPath = Join-Path $cfDir "config.yml"

if (-not $RunOnly) {
  # 1. one browser login, which also picks which of your domains to use
  if (-not (Test-Path (Join-Path $cfDir "cert.pem"))) {
    Write-Host "[1/4] logging in to Cloudflare - pick $Hostname's domain in the browser" -ForegroundColor Cyan
    & $cf tunnel login
  } else {
    Write-Host "[1/4] already logged in to Cloudflare" -ForegroundColor DarkGray
  }

  # 2. a named tunnel keeps the same address every run, unlike a quick tunnel
  $existing = & $cf tunnel list 2>$null | Select-String -SimpleMatch $TunnelName
  if ($existing) {
    Write-Host "[2/4] tunnel '$TunnelName' already exists" -ForegroundColor DarkGray
  } else {
    Write-Host "[2/4] creating tunnel '$TunnelName'" -ForegroundColor Cyan
    & $cf tunnel create $TunnelName
  }

  # 3. point the hostname at it
  Write-Host "[3/4] routing $Hostname to '$TunnelName'" -ForegroundColor Cyan
  & $cf tunnel route dns --overwrite-dns $TunnelName $Hostname

  # 4. write the ingress rule
  $uuid = (& $cf tunnel list --output json | ConvertFrom-Json |
           Where-Object { $_.name -eq $TunnelName }).id
  if (-not $uuid) { throw "could not find the tunnel id for '$TunnelName'" }

  @"
tunnel: $uuid
credentials-file: $cfDir\$uuid.json
# quic times out on flaky wifi, and this link has to stay up for hours
protocol: http2

ingress:
  - hostname: $Hostname
    service: http://localhost:$Port
    originRequest:
      # a player standing still sends nothing; do not hang up on them
      connectTimeout: 30s
      noTLSVerify: true
  - service: http_status:404
"@ | Out-File -FilePath $configPath -Encoding utf8

  Write-Host "[4/4] wrote $configPath" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Start the bridge first (AI-Companion-Bridge.exe), then in Minecraft run:" -ForegroundColor Green
Write-Host "  /connect wss://$Hostname" -ForegroundColor Yellow
Write-Host ""
& $cf tunnel --config $configPath run $TunnelName
