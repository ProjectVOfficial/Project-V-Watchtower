[CmdletBinding()]
param(
    [Parameter()]
    [string]$ProjectRoot = (Get-Location).Path,

    [Parameter()]
    [string]$Version = "1.0.0",

    [Parameter()]
    [string]$OutputFolderName = "github-release-output"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-File {
    param([string]$Path, [string]$Description)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Description was not found: $Path"
    }
}

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$KitRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$OutputRoot = Join-Path $ProjectRoot $OutputFolderName
$RepositoryRoot = Join-Path $OutputRoot "repository"
$AssetsRoot = Join-Path $OutputRoot "release-assets"
$TempRoot = Join-Path $env:TEMP ("project-v-source-" + [Guid]::NewGuid().ToString("N"))

$PackageJsonPath = Join-Path $ProjectRoot "package.json"
Require-File $PackageJsonPath "Project package.json"

$PackageJson = Get-Content -LiteralPath $PackageJsonPath -Raw | ConvertFrom-Json
if ($PackageJson.name -ne "project-v-watchtower") {
    throw "The selected folder does not appear to be Project V Watchtower. Found package name: $($PackageJson.name)"
}

$NsisSource = Join-Path $ProjectRoot "src-tauri\target\release\bundle\nsis\Project V Watchtower_${Version}_x64-setup.exe"
$MsiSource = Join-Path $ProjectRoot "src-tauri\target\release\bundle\msi\Project V Watchtower_${Version}_x64_en-US.msi"

Require-File $NsisSource "NSIS installer"
Require-File $MsiSource "MSI installer"

$LicenseCandidates = @(
    (Join-Path $ProjectRoot "LICENSE"),
    (Join-Path $ProjectRoot "LICENSE.md"),
    (Join-Path $ProjectRoot "LICENSE.txt"),
    (Join-Path $ProjectRoot "COPYING"),
    (Join-Path $ProjectRoot "COPYING.txt")
)

$LicenseSource = $LicenseCandidates | Where-Object {
    Test-Path -LiteralPath $_ -PathType Leaf
} | Select-Object -First 1

if (-not $LicenseSource) {
    throw "No project LICENSE or COPYING file was found. Public AGPL binary distribution should include the full license text. Add the correct project license before continuing."
}

Write-Step "Resetting release output"
if (Test-Path -LiteralPath $OutputRoot) {
    Remove-Item -LiteralPath $OutputRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $RepositoryRoot -Force | Out-Null
New-Item -ItemType Directory -Path $AssetsRoot -Force | Out-Null

Write-Step "Copying GitHub documentation"
$RepositoryItems = @(
    "README.md",
    "WHITEPAPER.md",
    "INSTALLATION.md",
    "SECURITY.md",
    "PRIVACY.md",
    "RELEASE_NOTES.md",
    "RELEASE_BODY.md",
    "UPSTREAM_AND_LICENSE.md",
    "SUPPORT.md",
    "CONTRIBUTING.md",
    "ROADMAP.md",
    ".gitignore",
    "docs",
    ".github"
)

foreach ($Item in $RepositoryItems) {
    $Source = Join-Path $KitRoot $Item
    $Destination = Join-Path $RepositoryRoot $Item
    if (Test-Path -LiteralPath $Source -PathType Container) {
        Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
    }
    elseif (Test-Path -LiteralPath $Source -PathType Leaf) {
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
    }
    else {
        throw "Required kit item is missing: $Source"
    }
}

Copy-Item -LiteralPath $LicenseSource -Destination (Join-Path $RepositoryRoot "LICENSE") -Force

$OptionalNoticeCandidates = @(
    (Join-Path $ProjectRoot "NOTICE"),
    (Join-Path $ProjectRoot "NOTICE.md"),
    (Join-Path $ProjectRoot "THIRD_PARTY_NOTICES"),
    (Join-Path $ProjectRoot "THIRD_PARTY_NOTICES.md")
)
foreach ($Notice in $OptionalNoticeCandidates) {
    if (Test-Path -LiteralPath $Notice -PathType Leaf) {
        Copy-Item -LiteralPath $Notice -Destination (Join-Path $RepositoryRoot ([IO.Path]::GetFileName($Notice))) -Force
    }
}

$ProjectReleaseGuide = Join-Path $ProjectRoot "docs\PROJECT_V_RELEASE_GUIDE.md"
if (Test-Path -LiteralPath $ProjectReleaseGuide -PathType Leaf) {
    Copy-Item -LiteralPath $ProjectReleaseGuide -Destination (Join-Path $RepositoryRoot "docs\PROJECT_V_RELEASE_GUIDE.md") -Force
}

Write-Step "Copying and normalizing installer names"
$NsisDestinationName = "Project-V-Watchtower-${Version}-Windows-x64-Setup.exe"
$MsiDestinationName = "Project-V-Watchtower-${Version}-Windows-x64.msi"
$NsisDestination = Join-Path $AssetsRoot $NsisDestinationName
$MsiDestination = Join-Path $AssetsRoot $MsiDestinationName

Copy-Item -LiteralPath $NsisSource -Destination $NsisDestination -Force
Copy-Item -LiteralPath $MsiSource -Destination $MsiDestination -Force

Write-Step "Creating corresponding source archive"
New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
$SourceStage = Join-Path $TempRoot "Project-V-Watchtower-${Version}-Source"
New-Item -ItemType Directory -Path $SourceStage -Force | Out-Null

$RobocopyArguments = @(
    $ProjectRoot,
    $SourceStage,
    "/E",
    "/COPY:DAT",
    "/DCOPY:DAT",
    "/R:1",
    "/W:1",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS",
    "/NP",
    "/XD",
    "node_modules",
    "dist",
    "target",
    "release",
    ".git",
    ".build-fix-backups",
    $OutputFolderName,
    ([IO.Path]::GetFileName($KitRoot)),
    "/XF",
    ".env",
    ".env.*",
    "*.key",
    "*.pem",
    "*.pfx",
    "*.p12",
    "*.jks",
    "*.keystore",
    "*.cer",
    "*.crt",
    "*.log",
    "*.dmp"
)

& robocopy @RobocopyArguments | Out-Null
$RobocopyExitCode = $LASTEXITCODE
if ($RobocopyExitCode -ge 8) {
    throw "robocopy failed while creating the source archive. Exit code: $RobocopyExitCode"
}

$SecretFiles = Get-ChildItem -LiteralPath $SourceStage -Recurse -Force -File |
    Where-Object {
        $_.Name -eq ".env" -or
        $_.Name -like ".env.*" -or
        $_.Extension -in @(".key", ".pem", ".pfx", ".p12", ".jks", ".keystore")
    }

if ($SecretFiles) {
    $Names = ($SecretFiles | ForEach-Object FullName) -join [Environment]::NewLine
    throw "Potential secret files remain in the source staging folder:`n$Names"
}

$StagedLicense = @(
    (Join-Path $SourceStage "LICENSE"),
    (Join-Path $SourceStage "LICENSE.md"),
    (Join-Path $SourceStage "LICENSE.txt"),
    (Join-Path $SourceStage "COPYING"),
    (Join-Path $SourceStage "COPYING.txt")
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1

if (-not $StagedLicense) {
    Copy-Item -LiteralPath $LicenseSource -Destination (Join-Path $SourceStage "LICENSE") -Force
}

$SourceZipName = "Project-V-Watchtower-${Version}-Source.zip"
$SourceZipPath = Join-Path $AssetsRoot $SourceZipName
Compress-Archive -LiteralPath $SourceStage -DestinationPath $SourceZipPath -CompressionLevel Optimal -Force

Write-Step "Generating SHA-256 checksums"
$ChecksumTargets = @(
    $NsisDestination,
    $MsiDestination,
    $SourceZipPath
)

$ChecksumLines = foreach ($Target in $ChecksumTargets) {
    $Hash = Get-FileHash -LiteralPath $Target -Algorithm SHA256
    "{0}  {1}" -f $Hash.Hash.ToLowerInvariant(), ([IO.Path]::GetFileName($Target))
}

$ChecksumPath = Join-Path $AssetsRoot "SHA256SUMS.txt"
$ChecksumLines | Set-Content -LiteralPath $ChecksumPath -Encoding utf8

Copy-Item -LiteralPath (Join-Path $RepositoryRoot "RELEASE_NOTES.md") -Destination (Join-Path $AssetsRoot "RELEASE_NOTES.md") -Force
Copy-Item -LiteralPath (Join-Path $RepositoryRoot "LICENSE") -Destination (Join-Path $AssetsRoot "LICENSE") -Force

$Manifest = [ordered]@{
    product = "Project V Watchtower"
    version = $Version
    createdAtUtc = [DateTime]::UtcNow.ToString("o")
    releaseStatus = "experimental-pre-alpha"
    codeSigned = $false
    automaticUpdaterEnabled = $false
    assets = @(
        [ordered]@{ name = $NsisDestinationName; type = "nsis"; sha256 = (Get-FileHash -LiteralPath $NsisDestination -Algorithm SHA256).Hash.ToLowerInvariant() },
        [ordered]@{ name = $MsiDestinationName; type = "msi"; sha256 = (Get-FileHash -LiteralPath $MsiDestination -Algorithm SHA256).Hash.ToLowerInvariant() },
        [ordered]@{ name = $SourceZipName; type = "corresponding-source"; sha256 = (Get-FileHash -LiteralPath $SourceZipPath -Algorithm SHA256).Hash.ToLowerInvariant() }
    )
}
$Manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $AssetsRoot "release-assets.json") -Encoding utf8

Write-Step "Cleaning temporary source staging"
if (Test-Path -LiteralPath $TempRoot) {
    Remove-Item -LiteralPath $TempRoot -Recurse -Force
}

Write-Host ""
Write-Host "Release preparation completed." -ForegroundColor Green
Write-Host "Repository:     $RepositoryRoot"
Write-Host "Release assets: $AssetsRoot"
Write-Host ""
Write-Host "Review every file before publishing, especially the source ZIP."
