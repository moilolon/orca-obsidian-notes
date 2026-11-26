# Dibuja la portada del README (assets/cover.png, 1600x1000), el icono (assets/icon.png, 256x256,
# el que Orca enseña como icono del proyecto) y la vista previa de GitHub
# (assets/social-preview.png, 1280x640, que se sube a mano en Settings si el repo es público),
# oscuros y a partir de formas.
# Desde la raíz del repo: powershell -NoProfile -File assets/draw-images.ps1
Add-Type -AssemblyName System.Drawing

$assets = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-Color([string]$hex, [int]$alpha = 255) {
  $c = [System.Drawing.ColorTranslator]::FromHtml($hex)
  return [System.Drawing.Color]::FromArgb($alpha, $c.R, $c.G, $c.B)
}

$ground = Get-Color '#1E222A'
$frame = Get-Color '#181B22'
$sheet = Get-Color '#2C313C'
$line = Get-Color '#565E6E'

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

function Fill-Gradient($g, $from, $to, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.PointF $x, $y), (New-Object System.Drawing.PointF ($x + $w), ($y + $h)), $from, $to)
  $path = New-RoundedPath $x $y $w $h $r
  $g.FillPath($brush, $path)
  $brush.Dispose(); $path.Dispose()
}

function Write-Text($g, [string]$text, [string]$font, [float]$size, $color, [float]$x, [float]$y) {
  $f = New-Object System.Drawing.Font($font, $size)
  $b = New-Object System.Drawing.SolidBrush $color
  $g.DrawString($text, $f, $b, $x, $y)
  $f.Dispose(); $b.Dispose()
}

function Draw-Lines($g, [float]$x, [float]$y, [float]$w, [float[]]$fractions, [float]$gap) {
  foreach ($fraction in $fractions) {
    Fill-Rounded $g $line $x $y ($w * $fraction) 8 4
    $y += $gap
  }
}

function New-Canvas([int]$w, [int]$h) {
  $bitmap = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  return @($bitmap, $g)
}

# The icon: the accent's gradient square with the repo's symbol, drawn where the cover puts it
# (120,250, 120 px). $glyph draws the symbol in those coordinates.
function Draw-Icon($g, $cover, [scriptblock]$glyph) {
  Fill-Gradient $g (Get-Color $cover.Accent) (Get-Color $cover.AccentDark) 120 250 120 120 26
  & $glyph $g
}

# The cover, 1600 px wide plus $extra on each side: the ground and the glow fill it all, the
# content stays in the middle 1600x1000.
function Draw-Cover($g, $cover, [int]$extra) {
  $width = 1600 + 2 * $extra
  $g.Clear($ground)
  $glow = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $width, 1000), (Get-Color $cover.Accent 70), (Get-Color $cover.Accent 0))
  $g.FillRectangle($glow, 0, 0, $width, 1000)
  $glow.Dispose()
  $g.TranslateTransform($extra, 0)
  Draw-Icon $g $cover $cover.Glyph
  Write-Text $g $cover.Title 'Segoe UI Semibold' 60 (Get-Color '#ECEFF4') 112 400
  for ($i = 0; $i -lt $cover.Text.Count; $i++) {
    Write-Text $g $cover.Text[$i] 'Segoe UI' 28 (Get-Color '#A0A8B6') 120 (520 + $i * 46)
  }
  Fill-Rounded $g $frame 900 90 580 820 28
  for ($i = 0; $i -lt 3; $i++) { Fill-Rounded $g $line (936 + $i * 40) 122 22 22 11 }
  & $cover.Picture $g
  $g.ResetTransform()
}

function Save-Images($cover) {
  $canvas = New-Canvas 1600 1000
  Draw-Cover $canvas[1] $cover 0
  $canvas[1].Dispose()
  $canvas[0].Save((Join-Path $assets 'cover.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas[0].Dispose()

  # GitHub's preview is 2:1: the cover widened to 2000x1000, then scaled to 1280x640.
  $wide = New-Canvas 2000 1000
  Draw-Cover $wide[1] $cover 200
  $wide[1].Dispose()
  $social = New-Canvas 1280 640
  $social[1].DrawImage($wide[0], 0, 0, 1280, 640)
  $social[1].Dispose(); $wide[0].Dispose()
  $social[0].Save((Join-Path $assets 'social-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $social[0].Dispose()

  # The icon, the cover's 120 px square drawn at 240 px on a transparent 256x256.
  $icon = New-Canvas 256 256
  $icon[1].Clear([System.Drawing.Color]::Transparent)
  $icon[1].Transform = New-Object System.Drawing.Drawing2D.Matrix(2, 0, 0, 2, -232, -492)
  Draw-Icon $icon[1] $cover $cover.Glyph
  $icon[1].Dispose()
  $icon[0].Save((Join-Path $assets 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $icon[0].Dispose()

  Write-Output 'cover.png, icon.png and social-preview.png written'
}

# The section colors the panel uses, in order (accent, success, warning, danger).
$bands = @((Get-Color '#7AA2F7'), (Get-Color '#78C88C'), (Get-Color '#E6B95A'), (Get-Color '#EB6E6E'))

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

# The cover is also the plugin's in Orca's catalog, which is in English: its text stays in English.
$cover = @{
  Accent = '#7C5CDC'
  AccentDark = '#483496'
  Title = 'Obsidian Notes'
  Text = @("Your Obsidian vault in Orca's sidebar:", 'images, backlinks, callouts and links,', 'with the open note filling the panel.')
}

$cover.Glyph = {
  param($g)
  # El símbolo: una nota con sus bandas de sección.
  Draw-Note $g 145 266 70 88 0.55
}

$cover.Picture = {
  param($g)
  # El panel lateral con la nota como la enseña: etiquetas, secciones, una imagen y quién la enlaza.
  Draw-CoverNote $g 960 176
}

Save-Images $cover
