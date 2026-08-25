# Kill old server on port 8080 and start a new one
$ErrorActionPreference = 'SilentlyContinue'
$conns = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue
if ($conns) {
    foreach ($c in $conns) {
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

# Start new server
Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','C:\Users\lz\Desktop\DamenFAQ\Freebuff\server.ps1','-Port','8080' -RedirectStandardOutput 'C:\Users\lz\Desktop\DamenFAQ\.freebuff\preview-80c9a260-c293-4c9c-86ce-05eab69787e4.log' -RedirectStandardError 'C:\Users\lz\Desktop\DamenFAQ\.freebuff\preview-80c9a260-c293-4c9c-86ce-05eab69787e4.log.err' -WindowStyle Hidden -PassThru | Select-Object -ExpandProperty Id
