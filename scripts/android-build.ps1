param(
    [ValidateSet('Debug', 'Preview', 'Release')][string]$Variant = 'Debug',
    [switch]$UseMirror
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
# Keep build caches inside the workspace.
$env:GRADLE_USER_HOME = Join-Path $projectRoot '.cache/gradle'
$env:ANDROID_USER_HOME = Join-Path $projectRoot '.cache/android'
$javaCommand = Get-Command java -ErrorAction Stop
$javaProbe = New-Object System.Diagnostics.Process
$javaProbe.StartInfo.FileName = $javaCommand.Source
$javaProbe.StartInfo.Arguments = '-version'
$javaProbe.StartInfo.UseShellExecute = $false
$javaProbe.StartInfo.CreateNoWindow = $true
$javaProbe.StartInfo.RedirectStandardError = $true
[void]$javaProbe.Start()
$javaVersion = $javaProbe.StandardError.ReadToEnd()
$javaProbe.WaitForExit()
$javaProbe.Dispose()
if ($javaVersion -notmatch 'version "17\.') {
    throw 'This Android toolchain requires JDK 17 on PATH.'
}
$env:JAVA_HOME = Split-Path (Split-Path $javaCommand.Source -Parent) -Parent
Push-Location (Join-Path $projectRoot 'android')
try {
    $buildArguments = @("--gradle-user-home=$env:GRADLE_USER_HOME", "assemble$Variant", '--console=plain')
    if ($UseMirror) {
        $buildArguments += @('--init-script', (Join-Path $PSScriptRoot 'android-mirrors.init.gradle'))
    }
    & ./gradlew.bat @buildArguments
    if ($LASTEXITCODE -ne 0) { throw "Android $Variant build failed: $LASTEXITCODE" }
} finally { Pop-Location }
