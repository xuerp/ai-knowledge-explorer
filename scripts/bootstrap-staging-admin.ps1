param(
  [string]$ApiBaseUrl = "https://ai-radar-api-staging.onrender.com"
)

$ErrorActionPreference = "Stop"
$apiRoot = $ApiBaseUrl.TrimEnd("/")

Write-Host "AI Radar staging admin bootstrap"
Write-Host "API: $apiRoot"
Write-Host "The token and password will not be echoed or stored in shell history."

$email = Read-Host "Admin email"
$securePassword = Read-Host "Admin password (at least 12 characters)" -AsSecureString
$secureAdminToken = Read-Host "AI_RADAR_ADMIN_TOKEN from Render" -AsSecureString

$password = $null
$adminToken = $null

try {
  $password = [System.Net.NetworkCredential]::new("", $securePassword).Password
  $adminToken = [System.Net.NetworkCredential]::new("", $secureAdminToken).Password

  if ([string]::IsNullOrWhiteSpace($email)) {
    throw "Admin email cannot be empty."
  }
  if ($password.Length -lt 12) {
    throw "Admin password must contain at least 12 characters."
  }
  if ([string]::IsNullOrWhiteSpace($adminToken)) {
    throw "AI_RADAR_ADMIN_TOKEN cannot be empty."
  }

  $body = @{
    email = $email.Trim()
    password = $password
  } | ConvertTo-Json

  Invoke-RestMethod "$apiRoot/api/v2/auth/bootstrap" `
    -Method Post `
    -Headers @{ "X-Admin-Token" = $adminToken } `
    -ContentType "application/json" `
    -Body $body | Out-Null

  $login = Invoke-RestMethod "$apiRoot/api/v2/auth/login" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body

  if (-not $login.accessToken) {
    throw "The admin was created, but login verification returned no access token."
  }

  Write-Host "Admin creation and login verification succeeded." -ForegroundColor Green
  Write-Host "Next: remove AI_RADAR_ADMIN_TOKEN from Render and redeploy the API."
}
finally {
  $password = $null
  $adminToken = $null
  $body = $null
  $login = $null
  Remove-Variable securePassword, secureAdminToken -ErrorAction SilentlyContinue
}
