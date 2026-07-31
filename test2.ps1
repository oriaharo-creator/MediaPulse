$payload = Get-Content payload.json -Raw
$res = Invoke-RestMethod -Uri 'https://cobalt.q0.pm/api/json' -Method Post -Body $payload -ContentType 'application/json'
Write-Host "Status:" $res.status
Write-Host "URL:" $res.url
