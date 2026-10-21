@echo off
setlocal
set "PASTA=%~dp0"
set "SAIDA=%PASTA%out"
where javac >nul 2>nul || (echo Instale o JDK 21 ou mais novo: https://adoptium.net/ & exit /b 1)
if not exist "%SAIDA%" (
  mkdir "%SAIDA%"
  dir /s /b "%PASTA%src\*.java" > "%TEMP%\crivo-fontes.txt"
  javac -encoding UTF-8 -d "%SAIDA%" @"%TEMP%\crivo-fontes.txt" || exit /b 1
)
java -cp "%SAIDA%" io.github.ravelroot.crivo.Crivo %*
