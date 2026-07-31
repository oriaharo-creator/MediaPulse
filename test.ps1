$payload = Get-Content payload.json -Raw
$res = Invoke-RestMethod -Uri 'https://co.eepy.moe/api/json' -Method Post -Body $payload -ContentType 'application/json'
Write-Host "Cobalt Status:" $res.status
Write-Host "Cobalt URL:" $res.url
