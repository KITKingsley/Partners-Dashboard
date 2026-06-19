$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = if ($args.Count -gt 0) { [int]$args[0] } else { 4173 }

function Get-ContentType {
    param([string]$Path)

    switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8' }
        '.css' { 'text/css; charset=utf-8' }
        '.js' { 'application/javascript; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.csv' { 'text/csv; charset=utf-8' }
        default { 'application/octet-stream' }
    }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()

Write-Host "CP Revenue Dashboard: http://127.0.0.1:$port/"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        try {
            $requestPath = [Uri]::UnescapeDataString(($request.Url.AbsolutePath.TrimStart('/')))
            if ([string]::IsNullOrWhiteSpace($requestPath)) {
                $requestPath = 'index.html'
            }

            $fullPath = Join-Path $workspace $requestPath
            $resolvedWorkspace = [IO.Path]::GetFullPath($workspace)
            $resolvedPath = [IO.Path]::GetFullPath($fullPath)

            if (-not $resolvedPath.StartsWith($resolvedWorkspace, [StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($resolvedPath)) {
                $response.StatusCode = 404
                $body = [Text.Encoding]::UTF8.GetBytes('Not found')
            } else {
                $bytes = [IO.File]::ReadAllBytes($resolvedPath)
                $response.StatusCode = 200
                $response.ContentType = Get-ContentType $resolvedPath
                $response.ContentLength64 = $bytes.Length
                $body = $bytes
            }

            $response.OutputStream.Write($body, 0, $body.Length)
        } catch {
            Write-Host "Request error: $($_.Exception.Message)"
            try {
                if ($response.StatusCode -eq 200) {
                    $response.StatusCode = 500
                }
                $body = [Text.Encoding]::UTF8.GetBytes('Internal server error')
                $response.ContentLength64 = $body.Length
                $response.OutputStream.Write($body, 0, $body.Length)
            } catch {
                # Client disconnected.
            }
        } finally {
            try {
                $response.OutputStream.Close()
            } catch {
                # Client disconnected.
            }
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
