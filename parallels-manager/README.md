# Parallels Manager

A native macOS SwiftUI app to manage Parallels Desktop virtual machines — with full VoiceOver accessibility.

## What It Does

Parallels Manager lists all your Parallels Desktop VMs and lets you:

- **Start** a stopped or suspended VM
- **Stop** a running VM (soft shutdown)
- **Pause** a running VM
- **Resume** a paused or suspended VM
- **Clone** a VM (prompts for a new name)
- **Delete** a VM (with confirmation)

The VM list auto-refreshes every 10 seconds. A busy indicator appears on the row while an operation is in progress.

## Requirements

| Requirement | Notes |
|---|---|
| macOS 13 Ventura or later | Apple Silicon or Intel |
| Parallels Desktop | `/usr/local/bin/prlctl` must be present |
| Xcode Command Line Tools | For building from source (`xcode-select --install`) |
| Developer ID certificate | Only needed for the signed build and DMG |

## Using the App

### With a Mouse or Trackpad

Right-click any VM row to get a context menu with all available actions. The menu only shows actions that are valid for the VM's current state (e.g. Start is greyed out if the VM is already running).

You can also use the **VM Actions** menu in the menu bar. The selected VM (highlighted row) determines which VM the menu commands act on.

### Keyboard Shortcuts (VM Actions menu)

| Action | Shortcut |
|---|---|
| Start | ⌘ Return |
| Stop | ⌘ . |
| Pause | ⌘ ⌥ P |
| Resume | ⌘ ⇧ P |
| Clone… | ⌘ ⇧ D |
| Delete… | ⌘ ⇧ ⌫ |

Click a row first so the app knows which VM to act on, then press the shortcut.

### With VoiceOver

Three access paths are available:

1. **VM Actions menu bar menu** — always reachable regardless of where VoiceOver focus is. Select a VM in the list, then open VM Actions from the menu bar.

2. **Context menu (VO + Shift + M)** — move VoiceOver focus to any VM row and press VO + Shift + M to open the context menu for that VM.

3. **Accessibility actions (VO + Z)** — move VoiceOver focus to any VM row and press VO + Z to cycle through quick actions: Start, Stop, Pause, Resume, Clone, Delete.

Each VM row reads aloud as: **"[Name], [status]"** with a hint pointing to the context menu and action rotor.

## Building from Source

The easiest way is to double-click one of the Finder launchers in this folder.

### Finder Launchers

| File | What it does |
|---|---|
| `Build App.command` | Compiles the app and places it at `build/Parallels Manager.app`. Signs with your Developer ID. |
| `Package DMG.command` | Builds the app and creates a distributable DMG at `build/Parallels Manager 1.0.dmg`. |

Both launchers open in Terminal automatically when double-clicked. The first time you run them macOS may ask you to confirm — click Open.

### Terminal

```bash
cd parallels-manager

# Build the app (signed)
./build.sh

# Build without signing (for local testing)
./build.sh --skip-sign

# Build the full distributable DMG
./package-dmg.sh

# DMG without signing
./package-dmg.sh --skip-sign
```

Build output goes to `parallels-manager/build/`:

```
build/
  Parallels Manager.app      ← drag this to /Applications to use locally
  Parallels Manager 1.0.dmg  ← share this for distribution
```

## Project Structure

```
parallels-manager/
  Package.swift                   Swift Package Manager manifest
  Info.plist                      App bundle metadata (bundle ID, no sandbox)
  build.sh                        Build + sign script
  package-dmg.sh                  DMG packaging script
  Build App.command               Finder double-click launcher for build.sh
  Package DMG.command             Finder double-click launcher for package-dmg.sh
  Sources/ParallelsManager/
    ParallelsManagerApp.swift     App entry point, VM Actions CommandMenu
    VMModel.swift                 VM data model, VMStore, all state + actions
    PrlctlController.swift        prlctl subprocess wrapper + output parser
    ContentView.swift             Main window: List with selection, sheets, dialogs
    VMRow.swift                   Single VM row (VoiceOver-friendly single element)
    CloneSheet.swift              Sheet for entering a clone name
```

## Technical Notes

- **No App Sandbox.** The app shells out to `/usr/local/bin/prlctl` which requires subprocess execution that the sandbox disallows. This means it cannot be distributed through the Mac App Store — distribute via DMG from your own website.
- **prlctl path.** Parallels installs `prlctl` at `/usr/local/bin/prlctl`. If yours is elsewhere, update the path in `PrlctlController.swift`.
- **Signing.** `build.sh` signs with `Developer ID Application: Kelly Ford (P887QF74N8)`. Update `SIGN_ID` in `build.sh` if you are building under a different certificate.
- **Swift Package Manager.** No Xcode project file — build entirely via `swift build`. macOS 13+ target.
- **Auto-refresh.** `VMStore` fires a `Timer` every 10 seconds and re-runs `prlctl list --all`.

## Distribution

The `Package DMG.command` / `package-dmg.sh` produces a standard drag-to-Applications DMG suitable for posting on a website. Because the app is signed with a Developer ID certificate (not notarized), Gatekeeper will warn users when they first open it. They can right-click → Open to bypass the warning, or you can notarize the DMG with `xcrun notarytool` if you want a frictionless download experience.
