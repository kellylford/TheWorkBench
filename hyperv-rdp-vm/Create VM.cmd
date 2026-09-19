@echo off
rem Runs New-HyperVRdpVM.ps1 without changing the PowerShell execution policy.
rem Any options you add after the file name are passed through, for example:
rem   "Create VM.cmd" -VMName Test2 -MemoryGB 8
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0New-HyperVRdpVM.ps1" %*
