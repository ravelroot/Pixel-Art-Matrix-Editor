@echo off
setlocal
set "ROOT=%~dp0"
set "OUT=%ROOT%out"
where javac >nul 2>nul || (echo Instale o JDK 21 ou mais novo: https://adoptium.net/ & exit /b 1)
if not exist "%OUT%" (
  mkdir "%OUT%"
  dir /s /b "%ROOT%src\*.java" > "%TEMP%\crivo-sources.txt"
  javac -encoding UTF-8 -d "%OUT%" @"%TEMP%\crivo-sources.txt" || exit /b 1
)
java -cp "%OUT%" io.github.ravelroot.crivo.Crivo %*
