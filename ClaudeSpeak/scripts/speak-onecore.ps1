# speak-onecore.ps1
# Speaks a text file using a OneCore voice, then exits.
#
# System.Speech (SAPI 5) can only see voices registered under
# HKLM\SOFTWARE\Microsoft\Speech\Voices — on this machine just the older "Desktop" David and
# Zira. The OneCore voices live under Speech_OneCore\Voices and are reachable only through
# WinRT (Windows.Media.SpeechSynthesis), so this takes the WinRT route rather than the
# System.Speech one-liner.
#
# WinRT hands back audio as a stream instead of playing it, so this renders to a WAV and
# plays that. Run detached by speak-response.ps1 so a long reply never holds up the session.

param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$VoiceMatch = 'ZiraM',
    [double]$Rate = 6.0        # WinRT SpeakingRate range is 0.5–6.0; 6 is maximum
)

$ErrorActionPreference = 'Stop'

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media, ContentType = WindowsRuntime] | Out-Null
    [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

    # PowerShell 5.1 has no await, so unwrap IAsyncOperation<T> by hand via AsTask.
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and
        $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

    function Await($operation, $resultType) {
        $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
        $task.Wait(-1) | Out-Null
        $task.Result
    }

    $text = [System.IO.File]::ReadAllText($Path)
    if ([string]::IsNullOrWhiteSpace($text)) { exit 0 }

    $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
    $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
             Where-Object { $_.Id -like "*$VoiceMatch*" } | Select-Object -First 1
    if ($voice) { $synth.Voice = $voice }
    $synth.Options.SpeakingRate = $Rate

    $stream = Await $synth.SynthesizeTextToStreamAsync($text) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])

    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    Await $reader.LoadAsync([uint32]$stream.Size) ([uint32]) | Out-Null
    $bytes = New-Object byte[] $stream.Size
    $reader.ReadBytes($bytes)

    # Per-process WAV name: a second reply can start rendering while this one still plays.
    $wav = [System.IO.Path]::Combine($env:TEMP, "claude-speak-$PID.wav")
    [System.IO.File]::WriteAllBytes($wav, $bytes)

    $player = New-Object System.Media.SoundPlayer $wav
    $player.PlaySync()
    $player.Dispose()
    $synth.Dispose()
    Remove-Item -LiteralPath $wav -Force -ErrorAction SilentlyContinue
} catch {
    exit 0
}
