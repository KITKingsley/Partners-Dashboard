$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = if ($args.Count -gt 0) { [int]$args[0] } else { 4173 }

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'), $port)
$listener.Start()

function Get-ContentType {
    param([string]$Path)

    switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8' }
        '.css' { 'text/css; charset=utf-8' }
        '.js' { 'application/javascript; charset=utf-8' }
        '.csv' { 'text/csv; charset=utf-8' }
        default { 'application/octet-stream' }
    }
}

function Send-Response {
    param(
        [Net.Sockets.NetworkStream]$Stream,
        [int]$StatusCode,
        [string]$StatusText,
        [string]$ContentType,
        [byte[]]$Body
    )

    $header = "HTTP/1.1 $StatusCode $StatusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`n`r`n"
    $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    $Stream.Write($Body, 0, $Body.Length)
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $buffer = New-Object byte[] 4096
            $read = $stream.Read($buffer, 0, $buffer.Length)
            $request = [Text.Encoding]::ASCII.GetString($buffer, 0, $read)
            $requestLine = ($request -split "`r?`n")[0]
            $parts = $requestLine -split ' '
            $requestPath = if ($parts.Count -gt 1) { [Uri]::UnescapeDataString(($parts[1] -split '\?')[0].TrimStart('/')) } else { 'index.html' }
            if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = 'index.html' }

            $fullPath = Join-Path $workspace $requestPath
            $resolvedWorkspace = [IO.Path]::GetFullPath($workspace)
            $resolvedPath = [IO.Path]::GetFullPath($fullPath)

            if (-not $resolvedPath.StartsWith($resolvedWorkspace, [StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($resolvedPath)) {
                $body = [Text.Encoding]::UTF8.GetBytes('Not found')
                Send-Response -Stream $stream -StatusCode 404 -StatusText 'Not Found' -ContentType 'text/plain; charset=utf-8' -Body $body
            } else {
                $body = [IO.File]::ReadAllBytes($resolvedPath)
                Send-Response -Stream $stream -StatusCode 200 -StatusText 'OK' -ContentType (Get-ContentType $resolvedPath) -Body $body
            }
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
