[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$WebRtcSource
)

$ErrorActionPreference = 'Stop'

$gsutilRoot = Join-Path $WebRtcSource `
    'third_party\depot_tools\external_bin\gsutil\gsutil_4.68\gsutil'
$replacements = @(
    @{
        Path = Join-Path $gsutilRoot 'gsutil.py'
        Old = 'GSUTIL_DIR = os.path.dirname(os.path.abspath(os.path.realpath(__file__)))'
        New = 'GSUTIL_DIR = os.path.dirname(os.path.abspath(__file__))'
    },
    @{
        Path = Join-Path $gsutilRoot 'gslib\__init__.py'
        Old = 'GSLIB_DIR = os.path.dirname(os.path.realpath(__file__))'
        New = 'GSLIB_DIR = os.path.dirname(os.path.abspath(__file__))'
    },
    @{
        Path = Join-Path $gsutilRoot 'gslib\__init__.py'
        Old = 'GSUTIL_PATH = os.path.realpath(sys.argv[0])'
        New = 'GSUTIL_PATH = os.path.abspath(sys.argv[0])'
    }
)

foreach ($replacement in $replacements) {
    if (-not (Test-Path -LiteralPath $replacement.Path)) {
        throw "Pinned gsutil file was not found: $($replacement.Path)"
    }
    $content = [System.IO.File]::ReadAllText($replacement.Path)
    if ($content.Contains($replacement.New)) {
        continue
    }
    if (-not $content.Contains($replacement.Old)) {
        throw "Pinned gsutil layout changed unexpectedly: $($replacement.Path)"
    }
    $content = $content.Replace($replacement.Old, $replacement.New)
    [System.IO.File]::WriteAllText(
        $replacement.Path,
        $content,
        [System.Text.UTF8Encoding]::new($false))
}

Write-Host 'Patched pinned gsutil to preserve the short P: checkout path.'
