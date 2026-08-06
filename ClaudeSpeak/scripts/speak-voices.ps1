# speak-voices.ps1
# Reports every speech route available on this machine, as JSON.
#
# Used by the `voice-setup` skill so Claude can offer real choices instead of guessing at
# what is installed. Safe to run at any time; changes nothing.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File speak-voices.ps1

$ErrorActionPreference = 'SilentlyContinue'

$result = [ordered]@{
    screenReaders = @()
    systemVoices  = @()
    notes         = @()
}

# --- JAWS -------------------------------------------------------------------------------
# Speaking through JAWS means the user's own voice, rate, and punctuation settings apply,
# and their normal silence key interrupts it. Nothing here can or should override that.
$jawsRunning = [bool](Get-Process jfw -ErrorAction SilentlyContinue)
$jawsCom = $false
try {
    $j = New-Object -ComObject FreedomSci.JawsApi -ErrorAction Stop
    $jawsCom = $true
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($j) | Out-Null
} catch { }

if ($jawsCom) {
    $result.screenReaders += [ordered]@{
        engine    = 'jaws'
        name      = 'JAWS'
        available = $true
        running   = $jawsRunning
        rateControlledByApp = $false
        detail    = if ($jawsRunning) { 'FreedomSci.JawsApi registered, JAWS running' }
                    else { 'FreedomSci.JawsApi registered, but JAWS is not running right now' }
    }
}

# --- NVDA -------------------------------------------------------------------------------
# NVDA speech goes through nvdaControllerClient64.dll, which is NOT installed with NVDA by
# default — it ships in NV Access's "controller client" package. Report the path if found.
$nvdaRunning = [bool](Get-Process nvda -ErrorAction SilentlyContinue)
$nvdaDll = $null
$searchRoots = @(
    "${env:ProgramFiles(x86)}\NVDA",
    "$env:ProgramFiles\NVDA",
    "$env:LOCALAPPDATA\Programs\NVDA",
    "$env:USERPROFILE\.claude"
)
foreach ($root in $searchRoots) {
    if (-not (Test-Path $root)) { continue }
    $hit = Get-ChildItem $root -Recurse -Filter 'nvdaControllerClient64.dll' -ErrorAction SilentlyContinue |
           Select-Object -First 1
    if ($hit) { $nvdaDll = $hit.FullName; break }
}

if ($nvdaRunning -or $nvdaDll) {
    $result.screenReaders += [ordered]@{
        engine    = 'nvda'
        name      = 'NVDA'
        available = [bool]$nvdaDll
        running   = $nvdaRunning
        rateControlledByApp = $false
        dllPath   = $nvdaDll
        detail    = if ($nvdaDll) { "controller client found at $nvdaDll" }
                    else { 'NVDA is running but nvdaControllerClient64.dll was not found - download the controller client from nvaccess.org and put it in %USERPROFILE%\.claude' }
    }
}

# --- OneCore voices (WinRT) -------------------------------------------------------------
try {
    [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media, ContentType = WindowsRuntime] | Out-Null
    foreach ($v in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices) {
        $result.systemVoices += [ordered]@{
            engine      = 'onecore'
            id          = $v.Id
            displayName = $v.DisplayName
            language    = $v.Language
            gender      = [string]$v.Gender
            # The substring speak-engine.ps1 matches on.
            match       = ($v.Id -split '\\')[-1]
            rateRange   = '0.5 to 6.0 (6 = fastest)'
        }
    }
} catch {
    $result.notes += "OneCore voices unavailable: $($_.Exception.Message)"
}

# --- SAPI 5 "Desktop" voices ------------------------------------------------------------
try {
    Add-Type -AssemblyName System.Speech
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    foreach ($v in $s.GetInstalledVoices()) {
        if (-not $v.Enabled) { continue }
        $result.systemVoices += [ordered]@{
            engine      = 'sapi'
            id          = $v.VoiceInfo.Id
            displayName = $v.VoiceInfo.Name
            language    = [string]$v.VoiceInfo.Culture
            gender      = [string]$v.VoiceInfo.Gender
            match       = $v.VoiceInfo.Name
            rateRange   = '-10 to 10 (10 = fastest)'
        }
    }
    $s.Dispose()
} catch {
    $result.notes += "SAPI voices unavailable: $($_.Exception.Message)"
}

if (-not $result.screenReaders) {
    $result.notes += 'No screen reader speech API detected. System voices only.'
}
$result.notes += 'OneCore and SAPI are separate sets. A name appearing in both (e.g. Zira) is two different voices; OneCore generally sounds cleaner.'

$result | ConvertTo-Json -Depth 6
