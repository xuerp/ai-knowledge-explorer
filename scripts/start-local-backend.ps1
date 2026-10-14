param([int]$Port = 8001, [int]$FrontendPort = 8082)

$ErrorActionPreference = 'Stop'
$backendPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'backend'
$envFilePath = Join-Path $backendPath '.env'
if (-not (Test-Path -LiteralPath $envFilePath)) {
    throw '缺少 backend/.env。请按 backend/.env.example 配置认证后启动。'
}
$pythonPath = Join-Path $backendPath '.venv-codex/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    $pythonPath = Join-Path $backendPath '.venv/Scripts/python.exe'
}
if (-not (Test-Path -LiteralPath $pythonPath)) { throw '未找到后端 Python 虚拟环境。' }

# Keep the existing user database and load its authentication configuration.
$previousDatabase = $env:AI_RADAR_DATABASE_URL
$previousCors = $env:AI_RADAR_CORS_ORIGINS
try {
    $env:AI_RADAR_DATABASE_URL = 'sqlite:///' + ((Join-Path $backendPath 'data/ai_radar.db') -replace '\\', '/')
    $env:AI_RADAR_CORS_ORIGINS = "http://127.0.0.1:$FrontendPort,http://localhost:$FrontendPort"
    Push-Location $backendPath
    try {
        & $pythonPath -m uvicorn app.main:app --host 127.0.0.1 --port $Port --env-file $envFilePath
    } finally { Pop-Location }
} finally {
    $env:AI_RADAR_DATABASE_URL = $previousDatabase
    $env:AI_RADAR_CORS_ORIGINS = $previousCors
}
