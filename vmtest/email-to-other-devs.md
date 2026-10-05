Subject: Letting Claude test Windows apps in a VM, so it stops taking over your PC

Hi all,

Here's a tip from my own work with Claude Code, plus a tool you can use.

## The problem

When Claude tests a Windows desktop app, it runs the app on the same PC you're using. Windows pop
up, focus jumps out from under you, keystrokes meant for the app land wherever you happen to be,
and your screen reader starts reading test windows in the middle of what you're doing. With JAWS or
NVDA running, that turns into chaos quickly. I was either stopping work while Claude tested, or
telling it not to test the UI at all. Neither is good.

## What we built

It's called vmtest, and it lets Claude do all its app testing inside a Hyper-V virtual machine
instead of on your PC.

- Nothing opens on your desktop, focus never moves, and no keys reach your apps. Your screen reader
  stays quiet.
- Claude talks to the VM through a Hyper-V feature called PowerShell Direct, which needs no network
  and opens no window.
- A small helper inside the VM does the work. It launches the app, reads its accessibility tree,
  presses buttons, sends keys, types, takes screenshots and runs installers. After every step, it
  reports back where keyboard focus landed.
- Each piece of work (a repo and branch) gets its own checkpoint, so Claude can stop and come back
  later with the app still open. When the work is merged, the VM goes back to a clean state.
- Claude reads the same accessibility information our screen readers do. For classic Windows
  dialogs it also checks the older MSAA role, because that's often what JAWS goes by. A message box
  button that the newer API wrongly calls a "pane" is reported as a push button, the way your
  screen reader would announce it.

Everything is here: https://github.com/kellylford/TheWorkBench/tree/main/vmtest

## A real test it has already done

I had another Claude session working on my QuickMail email app. I asked this session to teach that
one how to use vmtest, and the two of them sent messages back and forth while I got on with other
things. The QuickMail session installed the app in the VM and checked where focus landed on first
run. It then uninstalled the app and confirmed that a new uninstall prompt appeared at the right
time, with focus on the safe button. That's something our automated build checks couldn't answer.
Along the way it reported problems with vmtest itself, and the first session fixed them.

## What you need

- Windows 11 Pro, Enterprise or Education, with Hyper-V turned on. Home doesn't have Hyper-V.
- Enough memory to run a VM next to your own work. The test VM uses about 2 to 8 GB while it runs,
  and none when it's saved.
- Claude Code.
- It works on both Arm64 (I use a Snapdragon Surface) and x64 PCs.

## Setting it up

1. Add yourself to the Hyper-V Administrators group, once, from an administrator PowerShell, then
   sign out and back in. After that, nothing here needs elevation:

   Add-LocalGroupMember -Group "Hyper-V Administrators" -Member "$env:USERDOMAIN\$env:USERNAME"

2. Make a Windows 11 VM named ClaudeTesting. There are two ways to do it, both in the same repo:
   - Hyper-V Manage, a screen-reader-first Hyper-V app I built. It's in the hyperv-manage folder.
   - The hyperv-rdp-vm script. It builds a VM from a Windows ISO with no clicking through setup.

   Put the VM on a virtual switch that has internet.

3. Run vmtest prepare once. It sets the VM to sign in by itself, installs the helper, and saves the
   "Clean" checkpoint every test starts from.

4. Teach Claude to use it, which is the important part. The vmtest folder has a skill file
   (skill\SKILL.md). Copy it to your own .claude\skills\vmtest folder, and change the path in it to
   wherever you put vmtest. Claude then reaches for vmtest by itself whenever a task means opening,
   driving or installing a Windows app. I also added one line to my global CLAUDE.md, so it isn't
   optional:

   "Test Windows desktop apps (anything that opens a window, sends keys, or installs) in the test
   VM with the vmtest skill, never on this PC."

   Finally, add a permission rule so vmtest runs without asking you every time. The README shows the
   exact rule.

A note on the password: the test VM's account uses a throwaway default password. That's fine for a
VM that exists only for testing, but don't reuse a real password there.

## What it can't tell you

This matters for us, so I want to be straight about it:

- It sees roles, names, states, help text and focus. It doesn't hear speech.
  - If an app moves focus without telling assistive technology, or announces something through a
    notification, vmtest can report focus in the right place while a screen reader says nothing.
  - Capturing what NVDA actually says inside the VM is on the to-do list.
- Pressing a button through the accessibility API doesn't prove the button can be reached from the
  keyboard. Ask Claude to use Tab and arrow keys and to report where focus goes.
- So listening with JAWS or NVDA is still our job. What vmtest changes is that Claude does all the
  setup, clicking and checking first, and only hands you the listening part.

## Smaller tips that came out of this

- **An independent review.** Have a separate reviewer go over Claude's code. I use a "code-reviewer"
  subagent that didn't write the code, and it found real bugs in vmtest that the author missed,
  including ones that could have lost saved test state.
- **Sessions can talk to each other.** In Claude Code on the desktop, sessions on the same PC can
  send each other messages. One session can brief another on a tool, or hand over a test, without
  you copying anything between them.
- **When a VM loses its network.** Check which virtual switch it's on. Mine was tied to a USB
  Ethernet adapter that wasn't plugged in, and moving it to the Wi-Fi switch fixed it.

If you try it, I'd love to hear how it goes, and what breaks.

Kelly
