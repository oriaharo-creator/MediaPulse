$data = Get-Content npm.json -Raw | ConvertFrom-Json
$data.readme | Out-File readme.md
