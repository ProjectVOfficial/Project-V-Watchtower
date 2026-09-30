[CmdletBinding()]
param(
    [Parameter()]
    [string]$ProjectRoot = "E:\PROJECTS\worldmonitor-2.5.23",

    [Parameter()]
    [string]$Repository = "ThePeopleRecords/Project-V-Watchtower",

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

function Invoke-Gh {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [Parameter()]
        [switch]$AllowFailure
    )

    $PreviousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $OutputLines = @(
            & gh @Arguments 2>&1 | ForEach-Object { $_.ToString() }
        )
        $ExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $PreviousPreference
    }

    $OutputText = ($OutputLines -join "`n").Trim()

    if ($ExitCode -ne 0 -and -not $AllowFailure) {
        throw "GitHub CLI command failed with exit code ${ExitCode}: gh $($Arguments -join ' ')`n$OutputText"
    }

    [pscustomobject]@{
        ExitCode = $ExitCode
        Output   = $OutputText
    }
}

function Get-EncodedRepositoryPath {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $Segments = ($RelativePath -replace "\\", "/").Split("/")
    return (($Segments | ForEach-Object {
        [Uri]::EscapeDataString($_)
    }) -join "/")
}

function Get-RelativeRepositoryPath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$FullPath
    )

    return $FullPath.Substring($Root.Length).TrimStart("\", "/") -replace "\\", "/"
}

function Publish-RepositoryFile {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryName,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][System.IO.FileInfo]$File
    )

    $RelativePath = Get-RelativeRepositoryPath -Root $RepositoryRoot -FullPath $File.FullName
    $EncodedPath = Get-EncodedRepositoryPath -RelativePath $RelativePath
    $Endpoint = "repos/$RepositoryName/contents/$EncodedPath"

    $Existing = Invoke-Gh -Arguments @(
        "api",
        $Endpoint,
        "--jq",
        ".sha"
    ) -AllowFailure

    $ExistingSha = $null
    if ($Existing.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($Existing.Output)) {
        $ExistingSha = $Existing.Output.Trim()
    }
    elseif (
        $Existing.ExitCode -ne 0 -and
        $Existing.Output -notmatch "404|Not Found|repository is empty|This repository is empty"
    ) {
        throw "Could not check existing GitHub file '$RelativePath'.`n$($Existing.Output)"
    }

    $Bytes = [IO.File]::ReadAllBytes($File.FullName)
    $Base64 = [Convert]::ToBase64String($Bytes)

    $Payload = [ordered]@{
        message = if ($ExistingSha) {
            "Update $RelativePath for Project V Watchtower release"
        }
        else {
            "Add $RelativePath for Project V Watchtower release"
        }
        content = $Base64
        branch  = "main"
    }

    if ($ExistingSha) {
        $Payload["sha"] = $ExistingSha
    }

    $TemporaryJson = Join-Path $env:TEMP ("project-v-github-" + [Guid]::NewGuid().ToString("N") + ".json")
    try {
        $Json = $Payload | ConvertTo-Json -Depth 5 -Compress
        $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [IO.File]::WriteAllText($TemporaryJson, $Json, $Utf8NoBom)

        Invoke-Gh -Arguments @(
            "api",
            "--method",
            "PUT",
            $Endpoint,
            "--input",
            $TemporaryJson,
            "--silent"
        ) | Out-Null
    }
    finally {
        Remove-Item -LiteralPath $TemporaryJson -Force -ErrorAction SilentlyContinue
    }

    if ($ExistingSha) {
        Write-Host "UPDATED   $RelativePath"
    }
    else {
        Write-Host "UPLOADED  $RelativePath"
    }
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) is not installed or is not available in PATH."
}

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$OutputRoot = Join-Path $ProjectRoot $OutputFolderName
$RepositoryRoot = Join-Path $OutputRoot "repository"
$AssetsRoot = Join-Path $OutputRoot "release-assets"
$Tag = "v$Version"

if (-not (Test-Path -LiteralPath $RepositoryRoot -PathType Container)) {
    throw "Prepared repository folder not found: $RepositoryRoot"
}
if (-not (Test-Path -LiteralPath $AssetsRoot -PathType Container)) {
    throw "Prepared release-assets folder not found: $AssetsRoot"
}

$RequiredAssets = @(
    (Join-Path $AssetsRoot "Project-V-Watchtower-${Version}-Windows-x64-Setup.exe"),
    (Join-Path $AssetsRoot "Project-V-Watchtower-${Version}-Windows-x64.msi"),
    (Join-Path $AssetsRoot "Project-V-Watchtower-${Version}-Source.zip"),
    (Join-Path $AssetsRoot "SHA256SUMS.txt"),
    (Join-Path $AssetsRoot "RELEASE_NOTES.md"),
    (Join-Path $AssetsRoot "LICENSE"),
    (Join-Path $AssetsRoot "release-assets.json")
)

foreach ($Asset in $RequiredAssets) {
    if (-not (Test-Path -LiteralPath $Asset -PathType Leaf)) {
        throw "Required release asset is missing: $Asset"
    }
}

$ReleaseBody = Join-Path $RepositoryRoot "RELEASE_BODY.md"
if (-not (Test-Path -LiteralPath $ReleaseBody -PathType Leaf)) {
    throw "Release notes body is missing: $ReleaseBody"
}

Write-Step "Confirming GitHub CLI authentication"
Invoke-Gh -Arguments @("auth", "status") | Out-Null
Write-Host "Authenticated GitHub CLI session confirmed." -ForegroundColor Green

Write-Step "Confirming the GitHub repository exists"
$RepositoryCheck = Invoke-Gh -Arguments @(
    "repo",
    "view",
    $Repository,
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner"
)
Write-Host "Repository: $($RepositoryCheck.Output)" -ForegroundColor Green

Write-Step "Uploading documentation through the GitHub API"
Write-Host "This bypasses the broken local Git credential helper."
Write-Host "The repository documentation contains no installers; installers are uploaded as release assets."

$GitDirectoryPrefix = (Join-Path $RepositoryRoot ".git") + [IO.Path]::DirectorySeparatorChar

$Files = @(
    Get-ChildItem -LiteralPath $RepositoryRoot -Recurse -Force -File |
        Where-Object {
            -not $_.FullName.StartsWith(
                $GitDirectoryPrefix,
                [StringComparison]::OrdinalIgnoreCase
            )
        }
)

if ($Files.Count -eq 0) {
    throw "No repository documentation files were found."
}

$Files = @(
    $Files | Sort-Object `
        @{ Expression = {
            if (
                $_.Name -eq "README.md" -and
                $_.DirectoryName -eq $RepositoryRoot
            ) { 0 } else { 1 }
        }},
        @{ Expression = { $_.FullName } }
)

foreach ($File in $Files) {
    Publish-RepositoryFile `
        -RepositoryName $Repository `
        -RepositoryRoot $RepositoryRoot `
        -File $File
}

Invoke-Gh -Arguments @(
    "repo",
    "edit",
    $Repository,
    "--default-branch",
    "main"
) | Out-Null

Write-Step "Creating or refreshing the draft GitHub Release"
$ExistingRelease = Invoke-Gh -Arguments @(
    "release",
    "view",
    $Tag,
    "--repo",
    $Repository,
    "--json",
    "tagName"
) -AllowFailure

if ($ExistingRelease.ExitCode -eq 0) {
    Invoke-Gh -Arguments @(
        "release",
        "edit",
        $Tag,
        "--repo",
        $Repository,
        "--title",
        "Project V Watchtower $Version",
        "--notes-file",
        $ReleaseBody,
        "--draft",
        "--target",
        "main"
    ) | Out-Null

    $UploadArguments = @(
        "release",
        "upload",
        $Tag
    ) + $RequiredAssets + @(
        "--repo",
        $Repository,
        "--clobber"
    )

    Invoke-Gh -Arguments $UploadArguments | Out-Null
    Write-Host "Existing draft release updated." -ForegroundColor Green
}
else {
    $CreateArguments = @(
        "release",
        "create",
        $Tag
    ) + $RequiredAssets + @(
        "--repo",
        $Repository,
        "--title",
        "Project V Watchtower $Version",
        "--notes-file",
        $ReleaseBody,
        "--draft",
        "--target",
        "main"
    )

    Invoke-Gh -Arguments $CreateArguments | Out-Null
    Write-Host "Draft release created." -ForegroundColor Green
}

$ReleaseUrl = Invoke-Gh -Arguments @(
    "release",
    "view",
    $Tag,
    "--repo",
    $Repository,
    "--json",
    "url",
    "--jq",
    ".url"
)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "GITHUB UPLOAD COMPLETED" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Repository:"
Write-Host "https://github.com/$Repository"
Write-Host ""
Write-Host "Draft release:"
Write-Host $ReleaseUrl.Output
Write-Host ""
Write-Host "The release is still a DRAFT. Review every document and asset on GitHub,"
Write-Host "then click Publish release only when you are satisfied."
