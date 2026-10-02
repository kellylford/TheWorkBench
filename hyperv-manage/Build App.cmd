@echo off
rem Builds Hyper-V Manage as one self-contained exe in build\<arch>\HyperVManage.exe.
rem With no argument it builds for this PC's processor. Pass x64 or arm64 to choose, and
rem sign to sign it with Azure Artifact Signing afterwards (see "Sign Files.ps1"):
rem   "Build App.cmd" arm64
rem   "Build App.cmd" x64 sign
setlocal
set ARCH=%~1
set SIGN=%~2
if /i "%ARCH%"=="sign" (set ARCH=& set SIGN=sign)
if "%ARCH%"=="" (
    if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" (set ARCH=arm64) else (set ARCH=x64)
)
echo Building Hyper-V Manage for %ARCH%.
dotnet publish "%~dp0src\HyperVManage\HyperVManage.csproj" -c Release -r win-%ARCH% --self-contained true -o "%~dp0build\%ARCH%" -nologo -v quiet
if errorlevel 1 (
    echo The build failed. The messages above say why.
    exit /b 1
)
if not exist "%~dp0build\%ARCH%\HyperVManage.exe" (
    echo The build reported success but HyperVManage.exe is missing.
    exit /b 1
)
if /i "%SIGN%"=="sign" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Sign Files.ps1" "%~dp0build\%ARCH%\HyperVManage.exe"
    if errorlevel 1 (
        echo Signing failed. The messages above say why.
        exit /b 1
    )
)
echo Done: %~dp0build\%ARCH%\HyperVManage.exe
endlocal
