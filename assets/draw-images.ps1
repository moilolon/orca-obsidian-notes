# Draws the plugin's icon (256x256), the README cover (1600x1000) and the GitHub social preview
# (1280x640) into assets/, as PNG.
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

function Fill-Bar($g, $color, [float]$x, [float]$y, [float]$w, [float]$h) {
  Fill-Rounded $g $color $x $y $w $h ($h / 2)
}

# The note as the panel shows it: the head (folders, title, tags), a section, an image, another
# section and the notes that link to it. Drawn in the cover's panel, 460x690 from ($x, $y).
function Draw-CoverNote($g, [float]$x, [float]$y) {
  $w = 460; $pad = 30; $inner = $w - 2 * $pad; $left = $x + $pad
  Fill-Rounded $g $sheet $x $y $w 690 30
  $light = [System.Drawing.Color]::FromArgb(255, 205, 211, 222)
  $dim = [System.Drawing.Color]::FromArgb(255, 120, 128, 144)
  $rule = [System.Drawing.Color]::FromArgb(255, 64, 70, 84)

  # Head: the folders as links, the title, two tags, a rule.
  $cx = $left
  foreach ($crumb in @(78, 58, 64)) {
    if ($cx -gt $left) { Fill-Rounded $g $dim ($cx) ($y + 32) 6 6 3; $cx += 16 }
    Fill-Bar $g $bands[0] $cx ($y + 30) $crumb 10
    $cx += $crumb + 10
  }
  Fill-Bar $g $light $left ($y + 60) 190 22
  $tag = [System.Drawing.Color]::FromArgb(110, 122, 162, 247)
  Fill-Bar $g $tag $left ($y + 98) 74 24
  Fill-Bar $g $tag ($left + 86) ($y + 98) 92 24
  $g.FillRectangle((New-Object System.Drawing.SolidBrush $rule), $left, $y + 140, $inner, 2)

  # A section: its band and two lines.
  Fill-Rounded $g $bands[0] $left ($y + 160) $inner 34 10
  Fill-Bar $g $line $left ($y + 210) ($inner * 0.85) 12
  Fill-Bar $g $line $left ($y + 234) ($inner * 0.6) 12

  # An image of the vault, drawn in the note: sky, sun and two hills.
  $imgY = $y + 266; $imgH = 170
  $sky = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.PointF $left, $imgY), (New-Object System.Drawing.PointF $left, ($imgY + $imgH)), [System.Drawing.Color]::FromArgb(255, 70, 96, 160), [System.Drawing.Color]::FromArgb(255, 40, 52, 86))
  $frame = New-RoundedPath $left $imgY $inner $imgH 14
  $g.FillPath($sky, $frame)
  $g.SetClip($frame)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush $bands[2]), $left + $inner - 120, $imgY + 28, 54, 54)
  $far = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF $left, ($imgY + $imgH)),
    (New-Object System.Drawing.PointF ($left + 120), ($imgY + 70)),
    (New-Object System.Drawing.PointF ($left + 250), ($imgY + $imgH))
  )
  $near = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF ($left + 140), ($imgY + $imgH)),
    (New-Object System.Drawing.PointF ($left + 290), ($imgY + 96)),
    (New-Object System.Drawing.PointF ($left + $inner + 40), ($imgY + $imgH))
  )
  $g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 84, 150, 110))), $far)
  $g.FillPolygon((New-Object System.Drawing.SolidBrush $bands[1]), $near)
  $g.ResetClip()
  $sky.Dispose(); $frame.Dispose()

  # Another section, cut short.
  Fill-Rounded $g $bands[1] $left ($y + 458) $inner 34 10
  Fill-Bar $g $line $left ($y + 508) ($inner * 0.75) 12

  # Linked from: a rule, a small label and the notes as outlined buttons with a link mark.
  $g.FillRectangle((New-Object System.Drawing.SolidBrush $rule), $left, $y + 548, $inner, 2)
  Fill-Bar $g $dim $left ($y + 570) 96 10
  $pen = New-Object System.Drawing.Pen $dim, 2
  $bx = $left
  foreach ($button in @(118, 96, 128)) {
    if ($bx + $button -gt $left + $inner) { break }
    $outline = New-RoundedPath $bx ($y + 594) $button 38 10
    $g.DrawPath($pen, $outline)
    $outline.Dispose()
    $g.DrawEllipse($pen, $bx + 12, $y + 607, 10, 10)
    $g.DrawEllipse($pen, $bx + 19, $y + 607, 10, 10)
    Fill-Bar $g $light ($bx + 38) ($y + 608) ($button - 52) 10
    $bx += $button + 12
  }
  $pen.Dispose()
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

# Cover: the name and what it does on the left, a panel with a note on the right. 1600 px wide
# plus $extra on each side: the ground and the glow fill it all, the content stays in the middle.
function Draw-Cover($g, [int]$extra) {
  $width = 1600 + 2 * $extra
  $g.Clear($ground)
  $glow = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $width, 1000), [System.Drawing.Color]::FromArgb(70, 124, 92, 220), [System.Drawing.Color]::FromArgb(0, 124, 92, 220))
  $g.FillRectangle($glow, 0, 0, $width, 1000)
  $g.TranslateTransform($extra, 0)

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
  $g.DrawString('images, backlinks, callouts and links,', $textFont, $muted, 120, 566)
  $g.DrawString('with the open note filling the panel.', $textFont, $muted, 120, 612)

  Fill-Rounded $g ([System.Drawing.Color]::FromArgb(255, 24, 27, 34)) 960 90 520 820 28
  for ($i = 0; $i -lt 5; $i++) {
    Fill-Rounded $g $line (996 + $i * 52) 122 28 28 7
  }
  Draw-CoverNote $g 990 182

  $g.ResetTransform()
  $glow.Dispose(); $iconBrush.Dispose(); $iconPath.Dispose(); $white.Dispose(); $muted.Dispose(); $titleFont.Dispose(); $textFont.Dispose()
}

$canvas = New-Canvas 1600 1000
Draw-Cover $canvas[1] 0
$canvas[1].Dispose()
$canvas[0].Save((Join-Path $assets 'cover.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$canvas[0].Dispose()

# GitHub's social preview (uploaded by hand in Settings) is 2:1: the cover widened to 2000x1000,
# then scaled to 1280x640.
$wide = New-Canvas 2000 1000
Draw-Cover $wide[1] 200
$wide[1].Dispose()
$social = New-Canvas 1280 640
$social[1].InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$social[1].DrawImage($wide[0], 0, 0, 1280, 640)
$social[1].Dispose(); $wide[0].Dispose()
$social[0].Save((Join-Path $assets 'social-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$social[0].Dispose()
Write-Output 'icon.png, cover.png and social-preview.png written'
