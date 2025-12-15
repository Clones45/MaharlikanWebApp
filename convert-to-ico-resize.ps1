
Add-Type -AssemblyName System.Drawing
$source = "$PSScriptRoot\assets\logo.png"
$dest = "$PSScriptRoot\assets\icon.ico"

try {
    Write-Host "Reading $source..."
    $srcImage = [System.Drawing.Bitmap]::FromFile($source)
    
    Write-Host "Resizing to 256x256..."
    $newBitmap = New-Object System.Drawing.Bitmap 256, 256
    $graph = [System.Drawing.Graphics]::FromImage($newBitmap)
    $graph.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graph.Clear([System.Drawing.Color]::Transparent)
    $graph.DrawImage($srcImage, 0, 0, 256, 256)
    
    Write-Host "Converting to Icon..."
    $iconHandle = $newBitmap.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($iconHandle)
    
    Write-Host "Saving to $dest..."
    $stream = [System.IO.File]::Create($dest)
    $icon.Save($stream)
    $stream.Close()
    
    Write-Host "Success! Created 256x256 icon at $dest"
}
catch {
    Write-Error "Failed: $_"
    exit 1
}
finally {
    if ($srcImage) { $srcImage.Dispose() }
    if ($newBitmap) { $newBitmap.Dispose() }
    if ($icon) { $icon.Dispose() }
    if ($graph) { $graph.Dispose() }
    if ($iconHandle) { [System.Drawing.Graphics]::ReleaseHdc($iconHandle) } # Not strictly needed for managed wrapper but good practice
}
