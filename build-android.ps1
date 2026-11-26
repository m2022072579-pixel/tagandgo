param(
    [string] $SdkRoot = $env:ANDROID_HOME,
    [string] $JdkRoot = $env:JAVA_HOME
)

$ErrorActionPreference = 'Stop'
$tagGoDev = Join-Path $env:LOCALAPPDATA 'TagAndGoDev'
if (-not $SdkRoot) { $SdkRoot = Join-Path $tagGoDev 'sdk' }
if (-not $JdkRoot) {
    $JdkRoot = (Get-ChildItem -LiteralPath $tagGoDev -Directory -Filter 'jdk-17*' | Select-Object -First 1).FullName
}
$env:JAVA_HOME = $JdkRoot
$env:Path = "$JdkRoot\bin;$env:Path"
$sdkTools = Join-Path $SdkRoot 'build-tools\35.0.0'
$androidJar = Join-Path $SdkRoot 'platforms\android-35\android.jar'
$scratch = Join-Path $tagGoDev ('build-' + [Guid]::NewGuid().ToString('N'))
$apkOut = Join-Path $PSScriptRoot 'dist'

function Invoke-BuildStep([string] $Program, [string[]] $Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Build step failed ($LASTEXITCODE): $Program" }
}

New-Item -ItemType Directory -Force -Path "$scratch\classes","$scratch\dex","$scratch\generated",$apkOut | Out-Null
Copy-Item -LiteralPath "$PSScriptRoot\android" -Destination "$scratch\android" -Recurse
New-Item -ItemType Directory -Force -Path "$scratch\android\res\raw" | Out-Null

$webSource = Join-Path $PSScriptRoot 'www'
$html = [IO.File]::ReadAllText((Join-Path $webSource 'index.html'))
$css = [IO.File]::ReadAllText((Join-Path $webSource 'style.css'))
$hero = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $webSource 'coffee-daylight.webp')))
$css = $css.Replace('./coffee-daylight.webp', 'data:image/webp;base64,' + $hero)
$font = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $webSource 'fonts/PretendardVariable.woff2')))
$css = $css.Replace('./fonts/PretendardVariable.woff2', 'data:font/woff2;base64,' + $font)
$fontLicense = [IO.File]::ReadAllText((Join-Path $webSource 'fonts/Pretendard-LICENSE.txt'))
$css = "/*`n$fontLicense`n*/`n$css"
$core = [IO.File]::ReadAllText((Join-Path $webSource 'core.mjs'))
$campaigns = [IO.File]::ReadAllText((Join-Path $webSource 'campaigns.mjs'))
$retention = [IO.File]::ReadAllText((Join-Path $webSource 'retention.mjs'))
$checkout = [IO.File]::ReadAllText((Join-Path $webSource 'checkout.mjs'))
$customer = [IO.File]::ReadAllText((Join-Path $webSource 'customer.mjs'))
$views = [IO.File]::ReadAllText((Join-Path $webSource 'views.mjs'))
$app = [IO.File]::ReadAllText((Join-Path $webSource 'app.mjs'))
$qr = [IO.File]::ReadAllText((Join-Path $webSource 'qrcode.js'))
$license = [IO.File]::ReadAllText((Join-Path $webSource 'qrcode-LICENSE.txt'))
$styleLink = '<link rel="stylesheet" href="./style.css">'
$qrLink = '<script src="./qrcode.js"></script>'
$scriptLink = '<script type="module" src="./app.mjs"></script>'
$localImport = '(?m)^import \{[^\r\n]+\} from "\./(?:core|views|campaigns|customer|checkout|retention)\.mjs";\r?\n'
if (-not ($html.Contains($styleLink) -and $html.Contains($qrLink) -and $html.Contains($scriptLink)) -or $app -notmatch $localImport) {
    throw 'The Android page could not be assembled from the web entry point.'
}
$retention = $retention -creplace '(?m)^export (?=(?:const|function)\s)', ''
$campaigns = ($campaigns -creplace $localImport, '') -creplace '(?m)^export (?=(?:const|function)\s)', ''
$checkout = ($checkout -creplace $localImport, '') -creplace '(?m)^export (?=(?:const|function)\s)', ''
$customer = $customer -creplace '(?m)^export (?=(?:const|function)\s)', ''
$core = ($core -creplace $localImport, '') -creplace '(?m)^export (?=(?:const|function)\s)', ''
$views = ($views -creplace $localImport, '') -creplace '(?m)^export (?=(?:const|function)\s)', ''
$app = $app -creplace $localImport, ''
$policy = '<meta http-equiv="Content-Security-Policy" content="default-src ''none''; script-src ''unsafe-inline''; style-src ''unsafe-inline''; img-src data:; font-src data:; base-uri ''none''; form-action ''none''">'
$page = $html.Replace($styleLink, "$policy`n<style>`n$css`n</style>")
$page = $page.Replace($qrLink, "<script>`n/*`n$license`n*/`n$qr`n</script>")
$page = $page.Replace($scriptLink, "<script type=`"module`">`n$retention`n$campaigns`n$checkout`n$core`n$customer`n$views`n$app`n</script>")
[IO.File]::WriteAllText("$scratch\android\res\raw\taggo_page.html", $page)

$keystore = Join-Path $tagGoDev 'taggo-debug.jks'
if (-not (Test-Path -LiteralPath $keystore)) {
    Invoke-BuildStep "$JdkRoot\bin\keytool.exe" @('-genkeypair','-keystore',$keystore,'-storepass','android',
        '-alias','taggo-debug','-keypass','android','-keyalg','RSA','-keysize','2048','-validity','3650',
        '-dname','CN=TagAndGo Pilot','-storetype','JKS')
}

Push-Location -LiteralPath $scratch
try {
    Invoke-BuildStep "$sdkTools\aapt2.exe" @('compile','--dir','android\res','-o','res.zip')
    Invoke-BuildStep "$sdkTools\aapt2.exe" @('link','-o','base.apk','-I',$androidJar,
        '--manifest','android\AndroidManifest.xml','--java','generated','res.zip')
    Invoke-BuildStep "$JdkRoot\bin\javac.exe" @('-encoding','UTF-8','--release','8','-classpath',$androidJar,
        '-d','classes','generated\com\tagandgo\pilot\R.java','android\src\com\tagandgo\pilot\MainActivity.java')
    Invoke-BuildStep "$JdkRoot\bin\jar.exe" @('cf','classes.jar','-C','classes','.')
    Invoke-BuildStep "$sdkTools\d8.bat" @('--min-api','26','--lib',$androidJar,'--output','dex','classes.jar')
    Invoke-BuildStep "$JdkRoot\bin\jar.exe" @('uf','base.apk','-C','dex','classes.dex')
    Invoke-BuildStep "$sdkTools\zipalign.exe" @('-f','4','base.apk','aligned.apk')
    Invoke-BuildStep "$sdkTools\apksigner.bat" @('sign','--ks',$keystore,'--ks-pass','pass:android',
        '--key-pass','pass:android','--ks-key-alias','taggo-debug','--v4-signing-enabled','false','--out','signed.apk','aligned.apk')
    Invoke-BuildStep "$sdkTools\apksigner.bat" @('verify','--verbose','signed.apk')
    Copy-Item -LiteralPath 'signed.apk' -Destination "$apkOut\Coffee-Pass-Android.apk" -Force
    Copy-Item -LiteralPath 'signed.apk' -Destination "$apkOut\MOA-Android.apk" -Force
    Get-Item -LiteralPath "$apkOut\Coffee-Pass-Android.apk" | Select-Object FullName,Length
} finally {
    Pop-Location
}
