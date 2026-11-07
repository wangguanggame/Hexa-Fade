[CmdletBinding()]
param(
    [ValidateSet('build', 'fbgame')]
    [string]$Command = 'build',
    [string]$CreatorPath = 'F:\software\CocosEditor\Creator\3.8.7\CocosCreator.exe',
    [switch]$DebugBuild,
    [switch]$NoZip,
    [switch]$Upload,
    [switch]$ResetUploadToken,
    [switch]$UploadOnly,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$projectPath = $PSScriptRoot
$configPath = Join-Path $projectPath 'build-templates/buildConfig_web-mobile.json'
$outputPath = Join-Path $projectPath 'build/web-mobile'
$zipPath = Join-Path $projectPath 'game.zip'
$logPath = Join-Path $projectPath 'temp/builder/command-line-build.log'
$tokenPath = Join-Path $projectPath 'upload-token.local.txt'
$appId = '27708600165480897'

try {
    if ($UploadOnly) { $Upload = $true }
    if ($Upload -and $NoZip) { throw '-Upload cannot be combined with -NoZip.' }
    if (!(Test-Path -LiteralPath $CreatorPath -PathType Leaf)) {
        throw "Cocos Creator not found: $CreatorPath. Specify -CreatorPath."
    }
    if (!(Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw "Build config not found: $configPath"
    }
    $null = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $debugValue = $DebugBuild.IsPresent.ToString().ToLowerInvariant()
    $buildOptions = "configPath=$configPath;platform=web-mobile;debug=$debugValue;logDest=$logPath"
    Write-Host "Project: $projectPath"
    Write-Host "Creator: $CreatorPath"
    Write-Host "Build: $buildOptions"
    if ($DryRun) {
        Write-Host "Dry run complete. Output: $outputPath; ZIP: $zipPath"
        if ($Upload) { Write-Host "Upload target: Facebook app $appId (no request sent)." }
        exit 0
    }

    if ($Upload) {
        if ($ResetUploadToken -or !(Test-Path -LiteralPath $tokenPath)) {
            Write-Host "First-time setup: paste an upload access token for Facebook app $appId."
            Write-Host 'You can use App ID|App Secret, as in the existing run.sh.'
            $secureToken = Read-Host 'Access token (input hidden)' -AsSecureString
            if ($secureToken.Length -eq 0) { throw 'Upload access token is required.' }
            $secureToken | ConvertFrom-SecureString | Set-Content -LiteralPath $tokenPath -Encoding ASCII
        } else {
            $secureToken = (Get-Content -LiteralPath $tokenPath -Raw).Trim() | ConvertTo-SecureString
        }
    }

    if (!$UploadOnly) {
    $null = New-Item -ItemType Directory -Path (Split-Path $logPath) -Force
    $process = Start-Process -FilePath $CreatorPath -ArgumentList @(
        '--project', ('"' + $projectPath + '"'),
        '--build', ('"' + $buildOptions + '"')
    ) -WindowStyle Hidden -Wait -PassThru
    # Creator 3.8 reports successful builds with exit code 36.
    if ($process.ExitCode -ne 36) {
        throw "Build failed (exit code $($process.ExitCode)). See $logPath"
    }
    if (!(Test-Path -LiteralPath (Join-Path $outputPath 'index.html'))) {
        throw "Build output is missing index.html: $outputPath"
    }

    if (!$NoZip) {
        Add-Type -AssemblyName System.IO.Compression
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        # Build a temporary archive first, then replace the previous package.
        $temporaryZip = Join-Path $projectPath ('game.' + [guid]::NewGuid().ToString('N') + '.zip')
        try {
            $archive = [System.IO.Compression.ZipFile]::Open($temporaryZip, [System.IO.Compression.ZipArchiveMode]::Create)
            try {
                $outputRoot = [System.IO.Path]::GetFullPath($outputPath).TrimEnd('\', '/') + '\'
                foreach ($file in Get-ChildItem -LiteralPath $outputPath -File -Recurse) {
                    $entryName = $file.FullName.Substring($outputRoot.Length).Replace('\', '/')
                    $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                        $archive, $file.FullName, $entryName,
                        [System.IO.Compression.CompressionLevel]::Optimal
                    )
                }
            } finally {
                $archive.Dispose()
            }
            Move-Item -LiteralPath $temporaryZip -Destination $zipPath -Force
        } finally {
            if (Test-Path -LiteralPath $temporaryZip) {
                Remove-Item -LiteralPath $temporaryZip
            }
        }
        Write-Host "Package: $zipPath"
    }
    Write-Host "Build succeeded: $outputPath"
    } elseif (!(Test-Path -LiteralPath $zipPath -PathType Leaf)) {
        throw "Package not found: $zipPath. Build first."
    }
    if ($Upload) {
        Add-Type -AssemblyName System.IO.Compression
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
        try {
            if (@($archive.Entries | Where-Object { $_.FullName.Contains('\') }).Count) {
                throw 'ZIP contains Windows backslash paths. Rebuild before uploading.'
            }
            foreach ($requiredEntry in @('index.html', 'index.js', 'src/system.bundle.js', 'src/polyfills.bundle.js', 'src/import-map.json')) {
                if (!$archive.GetEntry($requiredEntry)) { throw "ZIP is missing $requiredEntry" }
            }
        } finally {
            $archive.Dispose()
        }
        Add-Type -AssemblyName System.Net.Http
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $client = [System.Net.Http.HttpClient]::new()
        $client.Timeout = [TimeSpan]::FromMinutes(30)
        $form = [System.Net.Http.MultipartFormDataContent]::new()
        $response = $null
        try {
            $credential = [System.Net.NetworkCredential]::new('', $secureToken)
            $form.Add([System.Net.Http.StringContent]::new($credential.Password), 'access_token')
            $form.Add([System.Net.Http.StringContent]::new('BUNDLE'), 'type')
            $form.Add([System.Net.Http.StringContent]::new('Hexa build ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')), 'comment')
            $fileContent = [System.Net.Http.StreamContent]::new([System.IO.File]::OpenRead($zipPath))
            $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new('application/octet-stream')
            $form.Add($fileContent, 'asset', 'game.zip')
            Write-Host "Uploading game.zip to Facebook app $appId..."
            $response = $client.PostAsync("https://graph-video.facebook.com/$appId/assets", $form).GetAwaiter().GetResult()
            $responseText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            $result = $responseText | ConvertFrom-Json
            if (!$response.IsSuccessStatusCode -or $result.error) {
                $errorCode = $result.error.code
                $errorMessage = [string]$result.error.message
                $errorMessage = $errorMessage.Replace($credential.Password, '[REDACTED]')
                $secretPart = ($credential.Password -split '\|', 2)[-1]
                if ($secretPart) { $errorMessage = $errorMessage.Replace($secretPart, '[REDACTED]') }
                throw "Facebook upload failed (HTTP $([int]$response.StatusCode), API code $errorCode): $errorMessage. ZIP preserved: $zipPath"
            }
            if (!$result.id -and $result.success -ne $true) {
                throw "Facebook did not confirm upload success. ZIP preserved: $zipPath"
            }
            Write-Host "Upload accepted. Bundle ID: $($result.id)"
            Write-Host "Check processing status: https://developers.facebook.com/apps/$appId/instant-games/hosting/"
        } finally {
            if ($response) { $response.Dispose() }
            $form.Dispose()
            $client.Dispose()
        }
    }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
