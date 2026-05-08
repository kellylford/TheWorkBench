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
echo Publishing QuickMail — single-file self-contained win-x64...
if exist publish\ rmdir /s /q publish\
dotnet publish QuickMail\QuickMail.csproj -c Release -o publish\
echo.
echo Output: publish\QuickMail.exe
goto end

:clean
echo Cleaning...
dotnet clean QuickMail\QuickMail.csproj
if exist publish\ rmdir /s /q publish\
goto end

:end
endlocal
