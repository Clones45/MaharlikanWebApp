
Add-Type -AssemblyName System.Drawing
$source = "$PSScriptRoot\assets\logo.png"
$dest = "$PSScriptRoot\assets\icon.ico"

try {
    Write-Host "Loading image..."
    $srcImage = [System.Drawing.Bitmap]::FromFile($source)
    
    Write-Host "Resizing..."
    # Resize logic using Bitmap constructor
    $resized = New-Object System.Drawing.Bitmap $srcImage, 256, 256
    
    Write-Host "Getting HIcon..."
    $handle = $resized.GetHicon()
    
    Write-Host "Creating Icon object..."
    $icon = [System.Drawing.Icon]::FromHandle($handle)
    
    Write-Host "Saving..."
    $fs = [System.IO.File]::Create($dest)
    $icon.Save($fs)
    $fs.Close()
    
    Write-Host "Success"
}
catch {
    Write-Host "Error: $_"
    exit 1
}
finally {
    if ($srcImage) { $srcImage.Dispose() }
    if ($resized) { $resized.Dispose() }
    if ($icon) { $icon.Dispose() }
}
