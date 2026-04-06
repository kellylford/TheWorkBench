@echo off
setlocal

set CONFIG=Debug
if /i "%1"=="release" set CONFIG=Release
if /i "%1"=="publish" goto publish
if /i "%1"=="run"     goto run
if /i "%1"=="clean"   goto clean

:build
echo Building QuickMail (%CONFIG%)...
dotnet build QuickMail\QuickMail.csproj -c %CONFIG%
goto end

:run
echo Running QuickMail (%CONFIG%)...
dotnet run --project QuickMail\QuickMail.csproj -c %CONFIG%
goto end

:publish
echo Publishing QuickMail self-contained (Release)...
dotnet publish QuickMail\QuickMail.csproj -c Release -r win-x64 --self-contained -o publish\
goto end

:clean
echo Cleaning...
dotnet clean QuickMail\QuickMail.csproj
goto end

:end
endlocal
