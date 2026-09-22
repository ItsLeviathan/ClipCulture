@echo off
rem Launches Clip Culture. Builds the app first if it has not been built yet.
cd /d "%~dp0"
if not exist "out\main\index.js" (
  echo First run: building Clip Culture...
  call npm run build
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
