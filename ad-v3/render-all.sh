#!/bin/bash
# Render the three aspects (silent) with modest parallelism, then mux the licensed track.
# Usage: ./render-all.sh [169 sq vt]   (needs Node >= 22 and ffmpeg; music in ../ad-audio/)
set -u
cd "$(dirname "$0")"
MUSIC=../ad-audio/atlasaudio-techno-606278.mp3
OUT=${OUT:-renders}
mkdir -p "$OUT"
for ar in "${@:-169 sq vt}"; do
  for a in $ar; do
    node build.mjs "$a" || exit 1
    nice -n 10 npx --yes hyperframes@0.8.143 render --workers 2 --quality high --fps 30 -o "$OUT/silent-$a.mp4" || exit 1
    # video t=0 = track 0.495 s (beat 1); drop on beat 32; music hard-stops on the end card (beat 144 = 66.46 s)
    ffmpeg -y -loglevel error -i "$OUT/silent-$a.mp4" -ss 0.495 -i "$MUSIC" \
      -filter_complex "[1:a]atrim=0:66.46,afade=t=in:st=0:d=0.03,afade=t=out:st=66.41:d=0.05,apad,alimiter=limit=0.97[a]" \
      -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "$OUT/predge-intro-v3-$a.mp4" || exit 1
    echo "done $a"
  done
done
node build.mjs 169 >/dev/null
