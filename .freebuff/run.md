# Run doc — Damen FAQ preview

## Reproduce uncommitted artifacts
No build step needed — this is a pure static HTML/CSS/JS project.

## How to run the server
A PowerShell TcpListener-based static file server (no Node.js/Python required).

**Launch detached:**
```
cmd.exe //C "C:\Users\lz\Desktop\DamenFAQ\Freebuff\launch.cmd"
```
This starts `tcp-server.ps1` on **port 3002**, serving `Github_Repository/Frontend/`.

**Kill:** `netstat -ano | findstr :3002` → `taskkill /PID <pid> /F`
