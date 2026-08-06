# speak-engine.ps1
# Speaks a text file through whichever route speak-config.json selects.
#
# Drop-in replacement for speak-onecore.ps1 — same -Path signature — so switching is a
# one-word edit in speak-response.ps1. Configure it with the `voice-setup` skill rather than
# by hand.
#
# Routes:
#   jaws     FreedomSci.JawsApi COM. Uses the user's own voice, rate and punctuation
#            settings, and their normal silence key interrupts it. Rate here is ignored,
#            deliberately: overriding a screen-reader user's configured rate would be a
#            defect, not a feature.
#   nvda     nvdaControllerClient64.dll. Same reasoning. The DLL is NOT installed with NVDA;
#            it comes from NV Access's controller-client package.
#   onecore  Windows WinRT voices. Cleaner than the SAPI set. Rate 0.5-6.0.
#   sapi     Older SAPI 5 "Desktop" voices. Rate -10..10.
#   auto     A running screen reader if there is one, else onecore.
#
# Never throws: a speech failure must not disrupt the session.

param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$ConfigPath = (Join-Path $env:USERPROFILE '.claude\speak-config.json')
)

$ErrorActionPreference = 'SilentlyContinue'

$text = [System.IO.File]::ReadAllText($Path)
if ([string]::IsNullOrWhiteSpace($text)) { exit 0 }

$cfg = $null
if (Test-Path -LiteralPath $ConfigPath) {
    try { $cfg = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
}
if (-not $cfg) { $cfg = [pscustomobject]@{ engine = 'auto' } }

function Get-Setting($name, $default) {
    if ($cfg.PSObject.Properties.Name -contains $name -and $null -ne $cfg.$name) { return $cfg.$name }
    return $default
}

$engine    = [string](Get-Setting 'engine' 'auto')
$voice     = [string](Get-Setting 'voice' '')
$rate      = Get-Setting 'rate' $null
$nvdaDll   = [string](Get-Setting 'nvdaClientDll' '')
$interrupt = [bool](Get-Setting 'interrupt' $true)

# ---------------------------------------------------------------------------- routes

function Try-Jaws($text, $interrupt) {
    if (-not (Get-Process jfw -ErrorAction SilentlyContinue)) { return $false }
    try {
        $j = New-Object -ComObject FreedomSci.JawsApi -ErrorAction Stop
        $ok = $j.SayString($text, $interrupt)
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($j) | Out-Null
        return [bool]$ok
    } catch { return $false }
}

function Try-Nvda($text, $interrupt, $dllPath) {
    if (-not (Get-Process nvda -ErrorAction SilentlyContinue)) { return $false }

    if (-not $dllPath) {
        foreach ($root in @("$env:USERPROFILE\.claude", "${env:ProgramFiles(x86)}\NVDA", "$env:ProgramFiles\NVDA")) {
            if (-not (Test-Path $root)) { continue }
            $hit = Get-ChildItem $root -Recurse -Filter 'nvdaControllerClient64.dll' -ErrorAction SilentlyContinue |
                   Select-Object -First 1
            if ($hit) { $dllPath = $hit.FullName; break }
        }
    }
    if (-not $dllPath -or -not (Test-Path -LiteralPath $dllPath)) { return $false }

    try {
        if (-not ('NvdaClient' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NvdaClient {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetDllDirectory(string path);
    [DllImport("nvdaControllerClient64.dll", CharSet = CharSet.Unicode)]
    public static extern int nvdaController_testIfRunning();
    [DllImport("nvdaControllerClient64.dll", CharSet = CharSet.Unicode)]
    public static extern int nvdaController_speakText(string text);
    [DllImport("nvdaControllerClient64.dll", CharSet = CharSet.Unicode)]
    public static extern int nvdaController_cancelSpeech();
}
'@
        }
        # The DllImport name is unqualified, so the directory must be on the search path
        # before the first call binds it.
        [NvdaClient]::SetDllDirectory((Split-Path -Parent $dllPath)) | Out-Null
        if ([NvdaClient]::nvdaController_testIfRunning() -ne 0) { return $false }
        if ($interrupt) { [NvdaClient]::nvdaController_cancelSpeech() | Out-Null }
        return ([NvdaClient]::nvdaController_speakText($text) -eq 0)
    } catch { return $false }
}

# PowerShell 5.1 has no await, so unwrap IAsyncOperation<T> by hand via AsTask. Hoisted to
# script scope rather than nested inside Try-OneCore, so it does not depend on a caller's
# locals being visible.
$script:AsTaskGeneric = $null
function Await($operation, $resultType) {
    if (-not $script:AsTaskGeneric) {
        $script:AsTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and
            $_.GetParameters().Count -eq 1 -and
            $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
        })[0]
    }
    $task = $script:AsTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.Wait(-1) | Out-Null
    $task.Result
}

function Try-OneCore($text, $voiceMatch, $rate) {
    try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime
        [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media, ContentType = WindowsRuntime] | Out-Null
        [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

        $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
        if ($voiceMatch) {
            $v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
                 Where-Object { $_.Id -like "*$voiceMatch*" -or $_.DisplayName -eq $voiceMatch } |
                 Select-Object -First 1
            if ($v) { $synth.Voice = $v }
        }
        if ($null -ne $rate) { $synth.Options.SpeakingRate = [double]$rate }

        $stream = Await $synth.SynthesizeTextToStreamAsync($text) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
        $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
        Await $reader.LoadAsync([uint32]$stream.Size) ([uint32]) | Out-Null
        $bytes = New-Object byte[] $stream.Size
        $reader.ReadBytes($bytes)

        $wav = [System.IO.Path]::Combine($env:TEMP, "claude-speak-$PID.wav")
        [System.IO.File]::WriteAllBytes($wav, $bytes)
        $player = New-Object System.Media.SoundPlayer $wav
        $player.PlaySync()
        $player.Dispose()
        $synth.Dispose()
        Remove-Item -LiteralPath $wav -Force -ErrorAction SilentlyContinue
        return $true
    } catch { return $false }
}

function Try-Sapi($text, $voiceMatch, $rate) {
    try {
        Add-Type -AssemblyName System.Speech
        $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
        if ($voiceMatch) {
            $v = $synth.GetInstalledVoices() |
                 Where-Object { $_.Enabled -and ($_.VoiceInfo.Name -like "*$voiceMatch*") } |
                 Select-Object -First 1
            if ($v) { $synth.SelectVoice($v.VoiceInfo.Name) }
        }
        if ($null -ne $rate) { $synth.Rate = [int][Math]::Max(-10, [Math]::Min(10, $rate)) }
        $synth.Speak($text)
        $synth.Dispose()
        return $true
    } catch { return $false }
}

# ---------------------------------------------------------------------------- dispatch

# Configured engine first, then every other route. A machine that loses its screen reader,
# or a config naming a voice that has been uninstalled, should still speak.
$order = switch ($engine) {
    'jaws'    { @('jaws', 'nvda', 'onecore', 'sapi') }
    'nvda'    { @('nvda', 'jaws', 'onecore', 'sapi') }
    'onecore' { @('onecore', 'sapi') }
    'sapi'    { @('sapi', 'onecore') }
    default   { @('jaws', 'nvda', 'onecore', 'sapi') }   # auto
}

# Rates are per-engine scales, so resolve defaults separately rather than inline (PowerShell
# 5.1 has no `if` expression).
$oneCoreRate = 6.0
$sapiRate    = 5
if ($null -ne $rate) {
    $oneCoreRate = [double]$rate
    $sapiRate    = [int]$rate
}

foreach ($route in $order) {
    $spoke = $false
    switch ($route) {
        'jaws'    { $spoke = Try-Jaws    $text $interrupt }
        'nvda'    { $spoke = Try-Nvda    $text $interrupt $nvdaDll }
        'onecore' { $spoke = Try-OneCore $text $voice $oneCoreRate }
        'sapi'    { $spoke = Try-Sapi    $text $voice $sapiRate }
    }
    if ($spoke) { exit 0 }
}

exit 0
