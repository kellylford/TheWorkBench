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
    [DllImport("nvdaControllerClient64.dll", CharSet = CharSet.Unicode)]
    public static extern int nvdaController_testIfRunning();
    [DllImport("nvdaControllerClient64.dll", CharSet = CharSet.Unicode)]
    public static extern int nvdaController_speakText(string text);
    [DllImport("nvdaControllerClient64.dll", CharSet = CharSet.Unicode)]
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
binding is lazy — so a missing DLL surfaces only at the first call, as a
`MethodInvocationException`. Catch it and fall back rather than letting it surface as a crash.

Use `nvdaControllerClient32.dll` instead if you are on 32-bit PowerShell.

**Honest status**: the JAWS path above is verified working. The NVDA path is written to NV
Access's documented interface and compiles, but has not been run against a live NVDA. Treat it
as unverified until you have tried it.

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
