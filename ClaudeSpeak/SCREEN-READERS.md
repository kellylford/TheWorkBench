# Routing Claude's speech through JAWS or NVDA

Companion to [SETUP.md](SETUP.md), which sets up read-aloud
using a Windows system voice. This one replaces the speaking step so the text goes to your
screen reader instead.

That base setup is unchanged and still works on its own. Everything here is additive.

## Why you might want this

Routing through the screen reader means Claude's replies use **your** voice, **your** rate,
and **your** punctuation level — the settings you already tuned — and your normal silence key
interrupts them like any other speech.

Routing through a separate system voice keeps working when the screen reader is off, and lets
Claude sound distinct from everything else.

Neither is correct in general. The setup below supports both and lets you switch.

---

## JAWS

JAWS exposes a COM automation interface, `FreedomSci.JawsApi`, registered by the JAWS
installer. The whole integration is three lines:

```powershell
$jaws = New-Object -ComObject FreedomSci.JawsApi
$jaws.SayString("Text to speak", $true)   # $true = interrupt whatever is speaking
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($jaws) | Out-Null
```

`SayString` returns `$true` on success. Check JAWS is actually running first — the COM object
registers whether or not it is:

```powershell
if (Get-Process jfw -ErrorAction SilentlyContinue) { <# JAWS is running #> }
```

Confirm the interface is present:

```powershell
Get-ChildItem 'HKLM:\SOFTWARE\Classes' | Where-Object { $_.PSChildName -like 'FreedomSci.JawsApi*' }
```

**Do not try to set a rate.** There is no rate parameter, and that is correct — the rate is a
setting the user already made.

## NVDA

NVDA is a C API in `nvdaControllerClient64.dll`, called via P/Invoke.

**The DLL does not ship with NVDA.** It comes from NV Access's *controller client* package —
download it separately and put it somewhere your script can find, e.g.
`%USERPROFILE%\.claude\`. This is the step people get stuck on.

```powershell
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NvdaClient {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool SetDllDirectory(string path);
    [DllImport("nvdaControllerClient.dll", CharSet = CharSet.Unicode)]
    public static extern int nvdaController_testIfRunning();
    [DllImport("nvdaControllerClient.dll", CharSet = CharSet.Unicode)]
    public static extern int nvdaController_speakText(string text);
    [DllImport("nvdaControllerClient.dll", CharSet = CharSet.Unicode)]
    public static extern int nvdaController_cancelSpeech();
}
'@

# The DllImport name is unqualified, so the containing directory has to be on the search
# path before the first call binds it.
[NvdaClient]::SetDllDirectory("$env:USERPROFILE\.claude") | Out-Null

if ([NvdaClient]::nvdaController_testIfRunning() -eq 0) {   # 0 means NVDA is running
    [NvdaClient]::nvdaController_cancelSpeech()
    [NvdaClient]::nvdaController_speakText("Text to speak")
}
```

All three return `0` for success. `Add-Type` compiles without the DLL present — P/Invoke
binding is lazy — so a missing DLL surfaces only at the first call. Catch it and fall back
rather than letting it surface as a crash.

**Both paths are verified working.** The NVDA one took a detour worth documenting.

### The architecture trap

The controller client DLL must match the architecture of **the process calling it** — not of
NVDA, and not of Windows. Get it wrong and the first call throws `BadImageFormatException`
("An attempt was made to load a program with an incorrect format").

This bites hardest on Windows on ARM:

| Your PowerShell | DLL you need |
|---|---|
| `System32\WindowsPowerShell` on ARM64 Windows | **arm64** |
| `SysWOW64\WindowsPowerShell` on ARM64 Windows | x86 |
| `System32\WindowsPowerShell` on x64 Windows | x64 |

On ARM64 Windows the inbox PowerShell in System32 is **ARM64 native** and SysWOW64 is **x86**.
There is no x64 PowerShell unless you installed one — so the x64 build, which is the one you
are most likely to already have lying around, cannot be loaded by either.

**The DLL does not ship with NVDA.** Confirmed on NVDA 2026.1.1: nothing matching
`nvdaControllerClient*` exists anywhere under its install directory. Get it from NV Access:

```
https://download.nvaccess.org/releases/<version>/nvda_<version>_controllerClient.zip
```

4.5 MB for 2026.1.1. Inside are `x86/`, `x64/`, `arm64/` and `arm64ec/` folders, each holding
`nvdaControllerClient.dll`. Take the one matching your PowerShell.

### Do not trust the filename

- NV Access shipped the ARM64 library as **`nvdaControllerClient32.dll`** for a while
  ([nvaccess/nvda#15717](https://github.com/nvaccess/nvda/issues/15717)). Current packages drop
  the suffix — it is just `nvdaControllerClient.dll` inside an architecture folder.
- The `arm64ec` build reports **x64** in its PE header, because that is what ARM64EC is.

Read the header instead. Machine type sits at the offset stored in `e_lfanew` (0x3C), plus 4:

```powershell
function Get-PeArch([string]$p) {
    $fs = [IO.File]::OpenRead($p); $br = New-Object IO.BinaryReader($fs)
    $fs.Position = 0x3C; $o = $br.ReadInt32(); $fs.Position = $o + 4; $m = $br.ReadUInt16()
    $br.Close(); $fs.Close()
    switch ($m) { 0x8664 {'x64'} 0x014c {'x86'} 0xAA64 {'ARM64'} default {'unknown'} }
}
```

`speak-voices.ps1` does exactly this, so a wrong-architecture DLL is reported as unusable
rather than as found.

### Diagnosing without starting NVDA

`nvdaController_testIfRunning()` returning **1722** (`RPC_S_SERVER_UNAVAILABLE`) is good news:
the DLL loaded, and is correctly reporting that NVDA is not running. That separates "wrong
architecture" from "NVDA is off" without starting anything.

---

## Making it switchable

Rather than hard-coding a route, read one from a config file. Two scripts do this:

- **`speak-voices.ps1`** — reports every route and voice available on the machine, as JSON:
  which screen readers are installed and running, and every OneCore and SAPI voice with the
  string you match it by. Read-only.
- **`speak-engine.ps1`** — a drop-in replacement for the base setup's `speak-onecore.ps1`
  (same `-Path` parameter). Reads `speak-config.json` and dispatches to `jaws`, `nvda`,
  `onecore`, or `sapi`.

`~/.claude/speak-config.json`:

```json
{
  "engine": "jaws",
  "voice": "",
  "rate": null,
  "interrupt": true,
  "nvdaClientDll": ""
}
```

| Field | Meaning |
|---|---|
| `engine` | `jaws`, `nvda`, `onecore`, `sapi`, or `auto` (a running screen reader, else onecore) |
| `voice` | Substring matching the voice id. Ignored for screen readers. |
| `rate` | `onecore` 0.5–6.0, `sapi` -10..10. **Ignored for screen readers, deliberately.** |
| `interrupt` | Whether a new reply cuts off the previous one |
| `nvdaClientDll` | Full path to the DLL, if it is not somewhere findable |

To switch the base setup over, change the one line in `speak-response.ps1` that names the
speaker:

```powershell
$speaker = Join-Path $env:USERPROFILE '.claude\speak-engine.ps1'
```

### Always fall through

The engine tries the configured route, then every other one. A machine that loses its screen
reader, or a config naming an uninstalled voice, still speaks — it just does not sound like
what was asked for.

The consequence worth knowing: **a successful exit only means *something* spoke**, not that
your chosen route was used. When verifying a config change, listen, or re-run the probe.

---

## Letting Claude configure it for you

`~/.claude/skills/voice-setup/SKILL.md` is a Claude Code skill that runs the probe, offers
only routes that actually exist, previews candidates so you can pick by ear, writes the
config, and checks the hook is pointing at the engine.

Ask for it by name (`/voice-setup`) or just say "change the voice Claude reads with".

Rules it is told to follow, which are worth keeping if you adapt it:

- Never claim what a voice sounds like. Offer a preview; the user judges.
- Never set a rate for a screen-reader route.
- Never assume what is installed — run the probe.

---

## Which is right for you

Worth actually trying rather than reasoning about:

1. Set `"engine": "jaws"` (or `"nvda"`), use it for a session.
2. Set `"engine": "onecore"` with a voice unlike your screen reader's, use it for a session.

The trade-off is real in both directions — one channel that you already control, versus two
channels where Claude is unmistakable but can talk over things. Nobody can tell you which
lands better for how you work.
