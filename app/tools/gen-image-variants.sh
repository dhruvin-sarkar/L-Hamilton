#!/usr/bin/env bash
# Narrower renditions of the content photographs, for the srcset on every
# <img> that shows them.
#
# Each original stays where it is and stays the widest candidate. Beside it go
# resized copies named <stem>-<width>.webp, at the widths listed below. The
# widths come from what each picture actually renders at, measured at 390, 1440
# and 1920 and checked against Chrome's candidate pick. So change a list here
# and the srcset that names those files has to change with it.
#
# What each sizes attribute states, and why: see the comment over the Home
# gallery in index.html.
#
# sharp-cli is fetched by npx for the run, so it is not a dependency. Lanczos3
# downscale, WebP q82. The alpha plane is lossless, so a cut-out's edge is the
# original's edge.
#
# No file leaves here with EXIF or XMP in it. sharp writes none unless asked
# to, so the renditions are clean as made; the originals are whatever was
# exported into this folder, and a design tool's export names its author and
# account. The last line strips every .webp under public and tools/sources, so
# an original dropped in beside its renditions is cleaned by the same run that
# cuts them.
#
# Run:  bash tools/gen-image-variants.sh      (from app/)
# Out:  public/assets/**/<stem>-<width>.webp, and public/assets/footer/portrait-<width>.webp
set -euo pipefail
tools="$(cd "$(dirname "$0")" && pwd)"
cd "$tools/../public/assets"

# variants <width...> -- <file...>
variants() {
  local widths=()
  while [ "$1" != "--" ]; do widths+=("$1"); shift; done
  shift
  for w in "${widths[@]}"; do
    for f in "$@"; do
      npx -y sharp-cli@5 -i "$f" -o "$(dirname "$f")/{name}-$w.webp" \
        -q 82 --effort 6 --alphaQuality 100 resize "$w" >/dev/null
    done
  done
}

variants 480 768             -- gallery/gallery-{01,02,03,04,05,06,07,08,09,10,11}.webp
variants 768 1024            -- otot/on-track.webp
variants 640 800             -- otot/off-track.webp
variants 800 1200 1440 1920  -- otot/hall-of-fame.webp
# Two digits and nothing after: the 26 originals. `helmet-*[0-9].webp` also
# matched the renditions this line writes (helmet-01-320.webp ends in a digit
# too), so a second run resized each of those again into helmet-01-320-640.webp
# and 233 more files that nothing names and the build would copy into dist.
variants 320 480 640         -- helmets-hof/helmet-[0-9][0-9].webp
# Only the wearing shots wide enough for a 480 to save anything: 03, 16, 23 and
# 27 are 387-562px and are served as they are.
variants 480                 -- helmets-hof/reveal-{01,02,04,05,06,07,08,09,10,11,12,13,14,15,17,18,19,20,21,24,25,26}.webp
variants 768                 -- store/store-hero.webp
variants 480                 -- store/store-side.webp
variants 480 576             -- socials/social-0{1,2,3,4,5,6,7}.webp
variants 480 640 864         -- menu/{home,on-track,off-track,calendar}.webp

# The footer portrait is the hero photograph at its full 3780px. No page loads
# that file itself (the WebGL scene has its own lewis-hero-gl.webp), so it is
# kept in tools/sources rather than in public, where everything is copied into
# dist and served: 316 KB nobody asks for. The footer gets these copies.
for w in 640 1024 1440 1920 2560; do
  npx -y sharp-cli@5 -i "$tools/sources/lewis-hero.webp" -o "footer/portrait-$w.webp" \
    -q 82 --effort 6 --alphaQuality 100 resize "$w" >/dev/null
done

python "$tools/strip-webp-metadata.py"
