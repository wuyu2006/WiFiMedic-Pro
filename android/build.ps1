$ErrorActionPreference = 'Stop'

$Android = $PSScriptRoot
$Root = Split-Path -Parent $Android
$Jdk = (Get-ChildItem (Join-Path $Root '.toolchain\jdk') -Directory | Select-Object -First 1).FullName
$BuildTools = Join-Path $Root '.toolchain\sdk\android-14'
$Platform = Join-Path $Root '.toolchain\sdk\android-34-ext12'
$Build = Join-Path $Android 'build'
$Classes = Join-Path $Build 'classes'
$Dex = Join-Path $Build 'dex'
$ResZip = Join-Path $Build 'resources.zip'
$BaseApk = Join-Path $Build 'base.apk'
$BaseDexApk = Join-Path $Build 'base-with-dex.apk'
$AlignedApk = Join-Path $Build 'aligned.apk'
$OutputApk = Join-Path $Build 'WiFiMedic-Android-1.0.0.apk'
$Keystore = if ($env:WIFIMEDIC_KEYSTORE) { $env:WIFIMEDIC_KEYSTORE } else { Join-Path $Android 'keystore\wifimedic-release.jks' }
$StorePass = $env:WIFIMEDIC_STORE_PASS
$KeyPass = if ($env:WIFIMEDIC_KEY_PASS) { $env:WIFIMEDIC_KEY_PASS } else { $StorePass }
$Alias = if ($env:WIFIMEDIC_KEY_ALIAS) { $env:WIFIMEDIC_KEY_ALIAS } else { 'wifimedic' }

if (-not (Test-Path (Join-Path $Jdk 'bin\javac.exe'))) { throw 'JDK not found under .toolchain\jdk' }
if (-not (Test-Path (Join-Path $BuildTools 'aapt2.exe'))) { throw 'Android build-tools not found under .toolchain\sdk\android-14' }
if (-not (Test-Path (Join-Path $Platform 'android.jar'))) { throw 'Android platform not found under .toolchain\sdk\android-34-ext12' }
if (-not $StorePass) { throw 'Android signing password is not set. Set WIFIMEDIC_STORE_PASS (and optionally WIFIMEDIC_KEY_PASS, WIFIMEDIC_KEYSTORE, WIFIMEDIC_KEY_ALIAS) before running build.ps1.' }

Remove-Item -Recurse -Force $Build -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $Classes, $Dex | Out-Null

$env:JAVA_HOME = $Jdk.FullName
$env:PATH = (Join-Path $Jdk 'bin') + ';' + $BuildTools + ';' + $env:PATH

Write-Host '[1/7] Compiling Java sources...'
$sources = @(Get-ChildItem (Join-Path $Android 'src') -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName)
& (Join-Path $Jdk 'bin\javac.exe') -encoding UTF-8 -source 8 -target 8 -classpath (Join-Path $Platform 'android.jar') -d $Classes @sources
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

Write-Host '[2/7] Packaging classes and dexing...'
& (Join-Path $Jdk 'bin\jar.exe') cf (Join-Path $Build 'classes.jar') -C $Classes .
if ($LASTEXITCODE -ne 0) { throw 'jar failed' }
& (Join-Path $BuildTools 'd8.bat') --lib (Join-Path $Platform 'android.jar') --min-api 23 --output $Dex (Join-Path $Build 'classes.jar')
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

Write-Host '[3/7] Compiling Android resources...'
& (Join-Path $BuildTools 'aapt2.exe') compile --dir (Join-Path $Android 'res') -o $ResZip
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }

Write-Host '[4/7] Linking base APK...'
& (Join-Path $BuildTools 'aapt2.exe') link -o $BaseApk -I (Join-Path $Platform 'android.jar') --manifest (Join-Path $Android 'AndroidManifest.xml') -R $ResZip -A (Join-Path $Android 'assets') --auto-add-overlay --min-sdk-version 23 --target-sdk-version 34
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

Write-Host '[5/7] Adding classes.dex...'
Copy-Item $BaseApk $BaseDexApk -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($BaseDexApk, 'Update')
try {
  $entry = $zip.CreateEntry('classes.dex', [System.IO.Compression.CompressionLevel]::NoCompression)
  $stream = $entry.Open()
  try {
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $Dex 'classes.dex'))
    $stream.Write($bytes, 0, $bytes.Length)
  } finally {
    $stream.Dispose()
  }
} finally {
  $zip.Dispose()
}

Write-Host '[6/7] Aligning and signing...'
& (Join-Path $BuildTools 'zipalign.exe') -f 4 $BaseDexApk $AlignedApk
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

if (-not (Test-Path $Keystore)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $Keystore) | Out-Null
  & (Join-Path $Jdk 'bin\keytool.exe') -genkeypair -v -keystore $Keystore -storepass $StorePass -keypass $KeyPass -alias $Alias -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=WiFiMedic Android, OU=Local Tools, O=WiFiMedic, L=Local, ST=Local, C=CN'
  if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
}

& (Join-Path $BuildTools 'apksigner.bat') sign --ks $Keystore --ks-key-alias $Alias --ks-pass "pass:$StorePass" --key-pass "pass:$KeyPass" --out $OutputApk $AlignedApk
if ($LASTEXITCODE -ne 0) { throw 'apksigner sign failed' }

Write-Host '[7/7] Verifying APK...'
& (Join-Path $BuildTools 'apksigner.bat') verify --verbose --print-certs $OutputApk
if ($LASTEXITCODE -ne 0) { throw 'apksigner verify failed' }

$release = Join-Path $Root 'release'
New-Item -ItemType Directory -Force -Path $release | Out-Null
Copy-Item $OutputApk (Join-Path $release 'WiFiMedic-Android-1.0.0.apk') -Force
$item = Get-Item $OutputApk
Write-Host ''
Write-Host ('APK ready: ' + $item.FullName)
Write-Host ('Size: ' + [Math]::Round($item.Length / 1MB, 2) + ' MB')
Write-Host ('Copy: ' + (Join-Path $release 'WiFiMedic-Android-1.0.0.apk'))
