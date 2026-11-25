# Draws the plugin's icon (256x256) and cover (1600x1000) into assets/, as PNG.
# Run from the repository root: powershell -NoProfile -File assets/draw-images.ps1
# Everything is drawn here from shapes: no screenshot, so no note content ends up in the images.
Add-Type -AssemblyName System.Drawing

$assets = Split-Path -Parent $MyInvocation.MyCommand.Path

# The section colors the panel uses, in order (accent, success, warning, danger), on a dark ground.
$ground = [System.Drawing.Color]::FromArgb(255, 30, 34, 42)
$sheet = [System.Drawing.Color]::FromArgb(255, 44, 49, 60)
$line = [System.Drawing.Color]::FromArgb(255, 86, 94, 110)
$bands = @(
  [System.Drawing.Color]::FromArgb(255, 122, 162, 247),
  [System.Drawing.Color]::FromArgb(255, 120, 200, 140),
  [System.Drawing.Color]::FromArgb(255, 230, 185, 90),
  [System.Drawing.Color]::FromArgb(255, 235, 110, 110)
)
$purple = [System.Drawing.Color]::FromArgb(255, 124, 92, 220)
$violet = [System.Drawing.Color]::FromArgb(255, 72, 52, 150)

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Fill-Rounded($g, $color, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $brush = New-Object System.Drawing.SolidBrush $color
  $path = New-RoundedPath $x $y $w $h $r
  $g.FillPath($brush, $path)
  $brush.Dispose(); $path.Dispose()
}

function New-Canvas([int]$w, [int]$h) {
  $bitmap = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  return @($bitmap, $g)
}

# A note sheet: colored section bands, each followed by gray text lines.
function Draw-Note($g, [float]$x, [float]$y, [float]$w, [float]$h, [float]$scale) {
  Fill-Rounded $g $sheet $x $y $w $h (14 * $scale)
  $pad = 16 * $scale
  $cursor = $y + $pad
  $bandH = 16 * $scale
  $lineH = 6 * $scale
  for ($i = 0; $i -lt $bands.Count; $i++) {
    if ($cursor + $bandH -gt $y + $h - $pad) { break }
    Fill-Rounded $g $bands[$i] ($x + $pad) $cursor ($w - 2 * $pad) $bandH (5 * $scale)
    $cursor += $bandH + 9 * $scale
    foreach ($fraction in @(0.85, 0.62)) {
      if ($cursor + $lineH -gt $y + $h - $pad) { break }
      Fill-Rounded $g $line ($x + $pad) $cursor (($w - 2 * $pad) * $fraction) $lineH (3 * $scale)
      $cursor += $lineH + 7 * $scale
    }
    $cursor += 6 * $scale
  }
}

# Icon: a purple rounded square with a note sheet in front.
$canvas = New-Canvas 256 256
$bitmap = $canvas[0]; $g = $canvas[1]
$g.Clear([System.Drawing.Color]::Transparent)
$gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point 256, 256), $purple, $violet)
$square = New-RoundedPath 8 8 240 240 52
$g.FillPath($gradient, $square)
Draw-Note $g 52 40 152 176 1.15
$bitmap.Save((Join-Path $assets 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bitmap.Dispose(); $gradient.Dispose(); $square.Dispose()

# Cover: the name and what it does on the left, a panel with a note on the right.
$canvas = New-Canvas 1600 1000
$bitmap = $canvas[0]; $g = $canvas[1]
$g.Clear($ground)
$glow = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point 1600, 1000), [System.Drawing.Color]::FromArgb(70, 124, 92, 220), [System.Drawing.Color]::FromArgb(0, 124, 92, 220))
$g.FillRectangle($glow, 0, 0, 1600, 1000)

$iconBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Point 120, 250), (New-Object System.Drawing.Point 240, 370), $purple, $violet)
$iconPath = New-RoundedPath 120 250 120 120 26
$g.FillPath($iconBrush, $iconPath)
Draw-Note $g 145 266 70 88 0.55

$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 236, 239, 244))
$muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 160, 168, 182))
$titleFont = New-Object System.Drawing.Font('Segoe UI Semibold', 64)
$textFont = New-Object System.Drawing.Font('Segoe UI', 28)
$g.DrawString('Obsidian Notes', $titleFont, $white, 112, 400)
$g.DrawString("Your Obsidian vault in Orca's sidebar:", $textFont, $muted, 120, 520)
$g.DrawString('folder tree, search, callouts and links,', $textFont, $muted, 120, 566)
$g.DrawString('with the open note filling the panel.', $textFont, $muted, 120, 612)

Fill-Rounded $g ([System.Drawing.Color]::FromArgb(255, 24, 27, 34)) 960 90 520 820 28
for ($i = 0; $i -lt 5; $i++) {
  Fill-Rounded $g $line (996 + $i * 52) 122 28 28 7
}
Draw-Note $g 990 182 460 690 2.1

$g.Dispose(); $glow.Dispose(); $iconBrush.Dispose(); $iconPath.Dispose(); $white.Dispose(); $muted.Dispose(); $titleFont.Dispose(); $textFont.Dispose()
$bitmap.Save((Join-Path $assets 'cover.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
Write-Output 'icon.png and cover.png written'
