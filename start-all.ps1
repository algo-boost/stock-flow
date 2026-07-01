$envFile = "C:\stock-flow\stock-flow\backend\.env"
$tunnelLog = "$env:USERPROFILE\tunnel-err.txt"

# 1. Backend (conda python)
Write-Host "[1/3] Backend :8000" -ForegroundColor Cyan
$b = Start-Process -FilePath "python" `
  -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8000" `
  -WorkingDirectory "C:\stock-flow\stock-flow\backend" -PassThru

# 2. Frontend
Write-Host "[2/3] Frontend :5173" -ForegroundColor Cyan
$f = Start-Process -FilePath "npx.cmd" `
  -ArgumentList "vite","--host","127.0.0.1" `
  -WorkingDirectory "C:\stock-flow\stock-flow\frontend" -PassThru

# 3. Tunnel - capture URL from stderr
Write-Host "[3/3] Tunnel" -ForegroundColor Cyan
$t = Start-Process -FilePath "cloudflared" `
  -ArgumentList "tunnel","--protocol","http2","--url","http://127.0.0.1:5173" `
  -NoNewWindow -RedirectStandardError $tunnelLog -PassThru

# Wait for URL (grep whole file, cloudflared lines wrap)
$url = $null
for ($i=0; $i -lt 15; $i++) {
    Start-Sleep 1
    $lines = Get-Content $tunnelLog -ErrorAction SilentlyContinue
    foreach ($line in $lines) {
        if ($line -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
            $url = $Matches[0]
            break
        }
    }
    if ($url) { break }
}

if ($url) {
    Write-Host "URL: $url" -ForegroundColor Green
    ($envFile | ForEach-Object { (Get-Content $_ -Raw) -replace 'FEISHU_REDIRECT_URI=.*', "FEISHU_REDIRECT_URI=$url" -replace 'CORS_ORIGINS=.*', "CORS_ORIGINS=$url" }) | Set-Content $envFile -NoNewline
    Write-Host ".env updated" -ForegroundColor Green
} else {
    Write-Host "URL not found!" -ForegroundColor Red
}

Write-Host "Backend  : http://127.0.0.1:8000" -ForegroundColor White
Write-Host "Frontend : http://127.0.0.1:5173" -ForegroundColor White
Write-Host "Public   : $url" -ForegroundColor White
Write-Host "Ctrl+C to stop" -ForegroundColor Yellow

while ($true) {
    if ($b.HasExited) { Write-Host "Backend died!" -ForegroundColor Red; break }
    if ($f.HasExited) { Write-Host "Frontend died!" -ForegroundColor Red; break }
    if ($t.HasExited) { Write-Host "Tunnel died!" -ForegroundColor Red; break }
    Start-Sleep 10
}
