param (
    [string]$GitHubToken = "",
    [string]$FtpUsername = "anonymous",
    [string]$FtpPassword = "anonymous@"
)

if (-not $GitHubToken) {
    $GitHubToken = Read-Host -AsSecureString "Please enter your GitHub Personal Access Token (PAT)"
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($GitHubToken)
    $GitHubToken = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}

$repo = "oriaharo-creator/MediaPulse"
$headers = @{
    "Authorization" = "token $GitHubToken"
    "Accept" = "application/vnd.github.v3+json"
}

Write-Host "Fetching latest artifacts for $repo..."
try {
    $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/actions/artifacts" -Headers $headers
} catch {
    Write-Host "Error fetching artifacts. Please ensure your token is valid and has 'repo' scope." -ForegroundColor Red
    exit
}

if ($response.artifacts.Count -eq 0) {
    Write-Host "No artifacts found!" -ForegroundColor Red
    exit
}

$latestArtifact = $response.artifacts | Where-Object { $_.name -eq "MediaPulse-IPA" } | Select-Object -First 1
if (-not $latestArtifact) {
    Write-Host "No MediaPulse-IPA artifact found!" -ForegroundColor Red
    exit
}

$downloadUrl = $latestArtifact.archive_download_url
$zipFile = "MediaPulse-IPA.zip"

Write-Host "Downloading $($latestArtifact.name) ($($latestArtifact.size_in_bytes) bytes)..."
try {
    Invoke-RestMethod -Uri $downloadUrl -Headers $headers -OutFile $zipFile
} catch {
    Write-Host "Failed to download artifact." -ForegroundColor Red
    exit
}

Write-Host "Extracting..."
if (Test-Path "extracted_ipa") { Remove-Item "extracted_ipa" -Recurse -Force }
Expand-Archive -Path $zipFile -DestinationPath "extracted_ipa" -Force

$ipaFile = Get-ChildItem "extracted_ipa\*.ipa" -Recurse | Select-Object -First 1

if (-not $ipaFile) {
    Write-Host "Could not find .ipa file in the extracted archive." -ForegroundColor Red
    exit
}

$ftpUrl = "ftp://192.168.1.253:2121/" + $ipaFile.Name
Write-Host "Uploading $($ipaFile.Name) to $ftpUrl ..."

try {
    $webClient = New-Object System.Net.WebClient
    $webClient.Credentials = New-Object System.Net.NetworkCredential($FtpUsername, $FtpPassword)
    $webClient.UploadFile($ftpUrl, $ipaFile.FullName)
    Write-Host "Upload Complete! The IPA is now on your device." -ForegroundColor Green
} catch {
    Write-Host "FTP Upload Failed. Ensure your phone's FTP server is active on port 2121." -ForegroundColor Red
    Write-Host $_.Exception.Message
}

# Cleanup
Remove-Item $zipFile -Force
Remove-Item "extracted_ipa" -Recurse -Force
