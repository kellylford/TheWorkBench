<#
.SYNOPSIS
    Signs files with Kelly Ford's Azure Artifact Signing certificate, on this PC.

.DESCRIPTION
    The same signing as the release workflow, for builds made here: signtool with Microsoft's
    Artifact Signing add-on, the kellyford-public certificate profile, SHA-256, and a timestamp
    so the signature stays valid after the short-lived certificate expires. Each file is checked
    afterwards and the script fails unless every one is validly signed and timestamped.

    Needs, once:
      winget install Microsoft.Azure.TrustedSigningClientTools
      az login   (as an account with the Artifact Signing Certificate Profile Signer role)

    See The-Idea-Place-Projects/signing/windows.md.

.EXAMPLE
    .\Sign Files.ps1 build\x64\HyperVManage.exe build\arm64\HyperVManage.exe
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory, ValueFromRemainingArguments)]
    [string[]]$Path
)

$ErrorActionPreference = 'Stop'

# @() keeps one file a list: without it a single path is a string, and @files below would
# splat it into one argument per character.
$files = @(foreach ($p in $Path) { (Resolve-Path -LiteralPath $p).Path })

# The add-on is x64, and signtool has to match it, so the x64 signtool is used on Arm PCs too.
$dlib = Join-Path $env:LOCALAPPDATA 'Microsoft\MicrosoftTrustedSigningClientTools\Azure.CodeSigning.Dlib.dll'
if (-not (Test-Path -LiteralPath $dlib)) {
    throw "The Artifact Signing add-on isn't installed. Run: winget install Microsoft.Azure.TrustedSigningClientTools"
}
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin", "$env:LOCALAPPDATA\Microsoft\MicrosoftTrustedSigningClientTools" `
        -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\' } |
    Sort-Object { $_.Directory.Parent.Name } -Descending |
    Select-Object -First 1
if (-not $signtool) {
    throw "signtool.exe (x64) wasn't found. Installing Microsoft.Azure.TrustedSigningClientTools with winget adds it."
}

# UTF-8 without a byte order mark: the add-on can't read the file with one.
$metadata = Join-Path ([IO.Path]::GetTempPath()) "signing-metadata-$([guid]::NewGuid().ToString('N')).json"
$json = [ordered]@{
    Endpoint               = 'https://eus.codesigning.azure.net/'
    CodeSigningAccountName = 'kellylford'
    CertificateProfileName = 'kellyford-public'
} | ConvertTo-Json
[IO.File]::WriteAllText($metadata, $json, (New-Object Text.UTF8Encoding $false))

try {
    Write-Host "Signing $($files.Count) file(s) with $($signtool.FullName)."
    # signtool writes progress to stderr; with ErrorActionPreference Stop that would end the script
    # before its exit code could be read.
    $ErrorActionPreference = 'Continue'
    & $signtool.FullName sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $dlib /dmdf $metadata @files
    $signExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($signExit -ne 0) { throw "signtool failed (exit code $signExit). If it mentions credentials, run az login." }
} finally {
    Remove-Item -LiteralPath $metadata -Force -ErrorAction SilentlyContinue
}

$bad = 0
foreach ($f in $files) {
    $sig = Get-AuthenticodeSignature -LiteralPath $f
    Write-Host "$f"
    Write-Host "  status: $($sig.Status); signer: $($sig.SignerCertificate.Subject); timestamped: $([bool]$sig.TimeStamperCertificate)"
    if ($sig.Status -ne 'Valid' -or -not $sig.TimeStamperCertificate) { $bad++ }
}
if ($bad) { throw "$bad file(s) aren't validly signed and timestamped." }
Write-Host 'Every file is signed and timestamped.'
