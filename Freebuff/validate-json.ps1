$ErrorActionPreference = 'Stop'
try {
    $raw = Get-Content 'C:\Users\lz\Desktop\DamenFAQ\Github_Repository\Frontend\api.json' -Raw -Encoding UTF8
    $data = $raw | ConvertFrom-Json
    Write-Host "Valid JSON - $($data.Count) questions found"
    foreach ($item in $data) {
        Write-Host "  #$($item.id) $($item.question.pl)"
    }
} catch {
    Write-Host "INVALID JSON: $_"
}
