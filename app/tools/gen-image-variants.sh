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
# Where the sizes attributes come from, and why they carry a 1.25 factor from
# 1.1dppx up: see the comment over the Home gallery in index.html.
#
# sharp-cli is fetched by npx for the run, so it is not a dependency. Lanczos3
# downscale, WebP q82. The alpha plane is lossless, so a cut-out's edge is the
# original's edge.
#
# Run:  bash tools/gen-image-variants.sh      (from app/)
# Out:  public/assets/**/<stem>-<width>.webp, and public/assets/footer/portrait-<width>.webp
set -euo pipefail
cd "$(dirname "$0")/../public/assets"

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
variants 320 480 640         -- helmets-hof/helmet-*[0-9].webp
# Only the wearing shots wide enough for a 480 to save anything: 03, 16, 23 and
# 27 are 387-562px and are served as they are.
variants 480                 -- helmets-hof/reveal-{01,02,04,05,06,07,08,09,10,11,12,13,14,15,17,18,19,20,21,24,25,26}.webp
variants 768                 -- store/store-hero.webp
variants 480                 -- store/store-side.webp
variants 480 576             -- socials/social-0{1,2,3,4,5,6,7}.webp
variants 480 640 864         -- menu/{home,on-track,off-track,calendar}.webp

# The footer portrait is the hero photograph, which is 3780px wide and belongs
# to the WebGL scene. The footer gets its own copies rather than the texture.
for w in 640 1024 1440 1920 2560; do
  npx -y sharp-cli@5 -i hero/lewis-hero.webp -o "footer/portrait-$w.webp" \
    -q 82 --effort 6 --alphaQuality 100 resize "$w" >/dev/null
done
