# Simple static file server for Damen FAQ
param(
    [int]$Port = 3000,
    [string]$Root = "C:\Users\lz\Desktop\DamenFAQ\Github_Repository\Frontend"
)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:${Port}/")
$listener.Start()

Write-Host "Server running at http://localhost:${Port}/"
Write-Host "Serving files from: $Root"
Write-Host "Press Ctrl+C to stop"

$mimeTypes = @{
    ".html" = "text/html"
    ".css" = "text/css"
    ".js" = "application/javascript"
    ".json" = "application/json"
    ".svg" = "image/svg+xml"
    ".png" = "image/png"
    ".jpg" = "image/jpeg"
    ".gif" = "image/gif"
    ".ico" = "image/x-icon"
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $path = $request.Url.LocalPath
        if ($path -eq "/") { $path = "/index.html" }
        
        $filePath = Join-Path $Root ($path.TrimStart("/").Replace("/", "\"))
        
        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = $mimeTypes[$ext]
            if (-not $contentType) { $contentType = "application/octet-stream" }
            
            $content = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $content.Length
            $response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $response.StatusCode = 404
            $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        
        $response.Close()
    } catch {
        # Continue on error
    }
}
