@echo off
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish
if %errorlevel% neq 0 exit /b %errorlevel%
echo.
echo Build complete: publish\UiaNotifyDemo.exe
