@echo off
setlocal
cd /d "%~dp0"
set "LOG=%~dp0build_log.txt"

set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY where python3 >nul 2>&1 && set "PY=python3"
if not defined PY (
  echo NO PYTHON FOUND ON PATH> "%LOG%"
  exit /b 1
)

(
  echo === interpreter: %PY%
  %PY% --version
  echo.
  echo === build_all.py
  cd /d "%~dp0"
  %PY% build_all.py
  echo.
  echo === mkindex.py
  %PY% mkindex.py
  echo.
  echo === amfamfield
  cd /d "%~dp0..\amfamfield\build"
  %PY% build.py
  %PY% build_layout.py
  %PY% build_page.py
  echo.
  echo === DONE
) > "%LOG%" 2>&1

exit /b 0
