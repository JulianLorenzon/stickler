#!/bin/sh
# Runs inside an ImageMagick container. /logo.png = source, /res = Android res dir
set -e
apk add --no-cache imagemagick >/dev/null
L=/logo.png
magick $L -format "bg=%[hex:p{8,8}]\n" info:
for d in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  n=${d%%:*}; rest=${d#*:}; s=${rest%%:*}; fg=${rest#*:}
  # adaptive foreground: full-bleed logo, the mark sits inside the 66dp safe zone
  magick $L -resize ${fg}x${fg} /res/mipmap-$n/ic_launcher_foreground.png
  # legacy square icon with rounded corners
  r=$((s * 18 / 100))
  magick $L -resize ${s}x${s} \( -size ${s}x${s} xc:none -fill white -draw "roundrectangle 0,0,$((s-1)),$((s-1)),$r,$r" \) -alpha set -compose DstIn -composite /res/mipmap-$n/ic_launcher.png
  # legacy round icon
  magick $L -resize ${s}x${s} \( -size ${s}x${s} xc:none -fill white -draw "circle $((s/2)),$((s/2)) $((s/2)),0" \) -alpha set -compose DstIn -composite /res/mipmap-$n/ic_launcher_round.png
done
# pre-Android-12 splash: dark background, logo centred
for f in /res/drawable*/splash.png; do
  w=$(magick identify -format %w $f); h=$(magick identify -format %h $f)
  m=$w; [ $h -lt $m ] && m=$h
  s=$((m * 28 / 100)); r=$((s * 22 / 100))
  magick $L -resize ${s}x${s} \( -size ${s}x${s} xc:none -fill white -draw "roundrectangle 0,0,$((s-1)),$((s-1)),$r,$r" \) -alpha set -compose DstIn -composite /tmp/logo_s.png
  magick -size ${w}x${h} xc:'#161819' /tmp/logo_s.png -gravity center -compose Over -composite $f
done
echo done
