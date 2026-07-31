$run = Get-Content run.json | ConvertFrom-Json
$jobsUrl = $run.workflow_runs[0].jobs_url
curl.exe -s $jobsUrl > jobs.json
$jobs = Get-Content jobs.json | ConvertFrom-Json
$jobId = $jobs.jobs[0].id
$logUrl = "https://api.github.com/repos/oriaharo-creator/MediaPulse/actions/jobs/$jobId/logs"
Write-Host "Log URL:" $logUrl
