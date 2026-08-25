param(
    [int]$Port = 5500,
    [string]$Root = "C:\Users\lz\Desktop\DamenFAQ\Github_Repository\Frontend"
)

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".svg"  = "image/svg+xml"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".gif"  = "image/gif"
    ".ico"  = "image/x-icon"
    ".txt"  = "text/plain; charset=utf-8"
    ".woff" = "font/woff"
    ".woff2"= "font/woff2"
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "Server running at http://localhost:${Port}/"
Write-Host "Serving files from: $Root"

$buffer = New-Object byte[] 8192

while ($true) {
    if (-not $listener.Pending()) {
        Start-Sleep -Milliseconds 50
        continue
    }
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $writer = New-Object System.IO.StreamWriter($stream)
    
    try {
        $requestLine = $reader.ReadLine()
        if (-not $requestLine) { $client.Close(); continue }
        
        $parts = $requestLine -split ' '
        $method = $parts[0]
        $urlPath = if ($parts.Length -gt 1) { $parts[1] } else { '/' }
        
        # Read headers (discard)
        while (($line = $reader.ReadLine()) -and $line -ne '') { }
        
        if ($urlPath -eq '/') { $urlPath = '/index.html' }
        
        $filePath = Join-Path $Root ($urlPath.TrimStart('/').Replace('/', '\'))
        $filePath = [System.IO.Path]::GetFullPath($filePath)
        
        # Security: ensure path stays within Root
        if (-not $filePath.StartsWith($Root)) {
            $body = [System.Text.Encoding]::UTF8.GetBytes("403 Forbidden")
            $header = "HTTP/1.1 403 Forbidden`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
            $bytes = [System.Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Write($body, 0, $body.Length)
            $client.Close()
            continue
        }
        
        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $ct = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
            $header = "HTTP/1.1 200 OK`r`nContent-Type: $ct`r`nContent-Length: $($fileBytes.Length)`r`nConnection: close`r`nAccess-Control-Allow-Origin: *`r`n`r`n"
            $hBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($hBytes, 0, $hBytes.Length)
            $stream.Write($fileBytes, 0, $fileBytes.Length)
        } else {
            $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
            $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
            $bytes = [System.Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Write($body, 0, $body.Length)
        }
    } catch {
        Write-Host "Error: $_"
    } finally {
        try { $client.Close() } catch {}
    }
}
