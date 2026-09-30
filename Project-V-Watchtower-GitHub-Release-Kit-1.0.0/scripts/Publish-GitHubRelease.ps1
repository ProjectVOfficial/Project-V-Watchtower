[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")]
    [string]$Repository,

    [Parameter()]
    [string]$ProjectRoot = (Get-Location).Path,

    [Parameter()]
    [string]$Version = "1.0.0",

    [Parameter()]
    [string]$OutputFolderName = "github-release-output",

    [Parameter()]
    [ValidateSet("public", "private")]
    [string]$Visibility = "public",

    [Parameter()]
    [switch]$Publish
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found."
    }
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter()]
        [string[]]$Arguments = @()
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Command $($Arguments -join ' ')"
    }
}

Require-Command "git"
Require-Command "gh"

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$OutputRoot = Join-Path $ProjectRoot $OutputFolderName
$RepositoryRoot = Join-Path $OutputRoot "repository"
$AssetsRoot = Join-Path $OutputRoot "release-assets"
$Tag = "v$Version"

if (-not (Test-Path -LiteralPath $RepositoryRoot -PathType Container)) {
    throw "Prepared repository folder not found: $RepositoryRoot. Run Prepare-ReleaseAssets.ps1 first."
}
if (-not (Test-Path -LiteralPath $AssetsRoot -PathType Container)) {
    throw "Prepared release-assets folder not found: $AssetsRoot. Run Prepare-ReleaseAssets.ps1 first."
}

$RequiredAssets = @(
    (Join-Path $AssetsRoot "Project-V-Watchtower-${Version}-Windows-x64-Setup.exe"),
    (Join-Path $AssetsRoot "Project-V-Watchtower-${Version}-Windows-x64.msi"),
    (Join-Path $AssetsRoot "Project-V-Watchtower-${Version}-Source.zip"),
    (Join-Path $AssetsRoot "SHA256SUMS.txt")
)

foreach ($Asset in $RequiredAssets) {
    if (-not (Test-Path -LiteralPath $Asset -PathType Leaf)) {
        throw "Required release asset is missing: $Asset"
    }
}

Invoke-Checked "gh" @("auth", "status")

& cmd.exe /d /c "gh repo view `"$Repository`" --json nameWithOwner >nul 2>nul"
if ($LASTEXITCODE -eq 0) {
    throw "The GitHub repository '$Repository' already exists. This safety-focused script will not overwrite an existing repository."
}

$GitName = (& git config --global user.name)
$GitEmail = (& git config --global user.email)
if ([string]::IsNullOrWhiteSpace($GitName) -or [string]::IsNullOrWhiteSpace($GitEmail)) {
    throw @"
Git author identity is not configured.

Run:
  git config --global user.name "Your Name"
  git config --global user.email "your-github-email@example.com"

Then run this script again.
"@
}

Push-Location $RepositoryRoot
try {
    if (Test-Path -LiteralPath (Join-Path $RepositoryRoot ".git")) {
        throw "The prepared repository folder already contains .git. Remove github-release-output and prepare it again before publishing."
    }

    Invoke-Checked "git" @("init", "-b", "main")
    Invoke-Checked "git" @("add", ".")
    Invoke-Checked "git" @("commit", "-m", "Project V Watchtower $Version release documentation")

    $RepoDescription = "Experimental local-first Windows situational-awareness, research, mapping, and optional local-AI workstation."
    $CreateArguments = @(
        "repo", "create", $Repository,
        "--$Visibility",
        "--source", ".",
        "--remote", "origin",
        "--push",
        "--description", $RepoDescription
    )
    Invoke-Checked "gh" $CreateArguments
}
finally {
    Pop-Location
}

$ReleaseArguments = @(
    "release", "create", $Tag
)
$ReleaseArguments += $RequiredAssets
$ReleaseArguments += @(
    (Join-Path $AssetsRoot "RELEASE_NOTES.md"),
    (Join-Path $AssetsRoot "LICENSE"),
    (Join-Path $AssetsRoot "release-assets.json"),
    "--repo", $Repository,
    "--title", "Project V Watchtower $Version",
    "--notes-file", (Join-Path $RepositoryRoot "RELEASE_BODY.md")
)

if (-not $Publish) {
    $ReleaseArguments += "--draft"
}

Invoke-Checked "gh" $ReleaseArguments

Write-Host ""
if ($Publish) {
    Write-Host "Published Project V Watchtower $Version." -ForegroundColor Green
}
else {
    Write-Host "Created a DRAFT Project V Watchtower $Version release." -ForegroundColor Green
    Write-Host "Review every asset and warning on GitHub before publishing."
}

Invoke-Checked "gh" @("repo", "view", $Repository, "--web")


