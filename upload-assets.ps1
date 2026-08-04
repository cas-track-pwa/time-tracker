param (
    [Parameter(Mandatory=$true)]
    [string]$AssetDir,

    [Parameter(Mandatory=$true)]
    [string]$NamespaceId
)

# Note: With the [assets] binding in wrangler.toml, `wrangler deploy` automatically
# uploads static assets. This script is optional for manual KV uploads.

# Verify directory path
if (-not (Test-Path -Path $AssetDir)) {
    Write-Error "Directory '$AssetDir' does not exist."
    exit 1
}

Write-Host "Scanning files in $AssetDir (skipping node_modules)..."

# Define allowed file extensions
$allowedExtensions = @('.js', '.css', '.html', '.svg', '.png')
$kvPairs = @()

# Use .NET Enumeration to safely stream files and allow instant Ctrl+C
try {
    $dirInfo = New-Object System.IO.DirectoryInfo($AssetDir)

    # Enumerate files efficiently without choking on memory
    $files = [System.IO.Directory]::EnumerateFiles($dirInfo.FullName, "*", [System.IO.SearchOption]::AllDirectories)

    foreach ($filePath in $files) {
        # Check for Ctrl+C interrupt
        if ([System.Console]::KeyAvailable) {
            # Allows standard console breaking if needed
        }

        # FAST EXCLUSION: Skip the file entirely if its path contains node_modules
        if ($filePath -like "*\node_modules\*") {
            continue
        }

        $extension = [System.IO.Path]::GetExtension($filePath).ToLower()

        # Check if the file extension is allowed
        if ($allowedExtensions -notcontains $extension) {
            continue
        }

        # Format relative path key using forward slashes
        $relativePath = $filePath.Substring($dirInfo.FullName.Length).TrimStart('\')
        $key = $relativePath -replace '\\', '/'

        # Read file content safely based on type
        if ($extension -match '\.(png|svg)') {
            # Binary files must be base64 encoded for KV API transmission
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $content = [Convert]::ToBase64String($bytes)

            $kvPairs += [PSCustomObject]@{
                key      = $key
                value    = $content
                base64   = $true  # Tells Wrangler to decode the base64 string
            }
        } else {
            # Text files are read directly
            $content = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8)

            $kvPairs += [PSCustomObject]@{
                key   = $key
                value = $content
            }
        }
    }
}
catch {
    Write-Error "Error scanning directories: $_"
    exit 1
}

if ($kvPairs.Count -eq 0) {
    Write-Host "No matching assets found to upload."
    exit 0
}

# Create temporary JSON payload
$tempJsonPath = Join-Path ([System.IO.Path]::GetTempPath()) "$([System.IO.Path]::GetRandomFileName()).json"
$kvPairs | ConvertTo-Json -Depth 10 -Compress | Set-Content -Path $tempJsonPath -Encoding UTF8

Write-Host "Uploading $($kvPairs.Count) matching assets to Cloudflare KV..."
npx wrangler kv:bulk put $tempJsonPath --namespace-id=$NamespaceId

# Clean up
Remove-Item -Path $tempJsonPath -Force
Write-Host "Upload complete!"
