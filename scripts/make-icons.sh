#!/bin/sh
# Rasterises the app icons in public/ from public/favicon.svg and scripts/icon-maskable.svg.
# Needs rsvg-convert (brew install librsvg). Run from the repository root.
set -e
rsvg-convert -w 192 -h 192 public/favicon.svg -o public/icon-192.png
rsvg-convert -w 512 -h 512 public/favicon.svg -o public/icon-512.png
rsvg-convert -w 512 -h 512 scripts/icon-maskable.svg -o public/icon-maskable-512.png
rsvg-convert -w 180 -h 180 scripts/icon-maskable.svg -o public/apple-touch-icon.png
