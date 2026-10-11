"""
Remove EXIF and XMP from every WebP under app/public, leaving the pictures
exactly as they are.

Everything in app/public is copied into dist and served, and it is tracked in
git. An export from a design tool carries an XMP packet naming its author, the
account it came from and that account's workspace, plus an EXIF block; 38 of
the originals here shipped that to every visitor. None of it is read by a
browser to draw the picture.

WebP is a RIFF container: a 12-byte header, then chunks of
<fourcc><uint32 size><payload><pad byte if size is odd>. The metadata sits in
its own "EXIF" and "XMP " chunks, beside the ones that hold the pixels ("VP8 ",
"VP8L", "ALPH"). So this drops those two chunks, clears the two bits in the
"VP8X" header that say they are present, and rewrites the RIFF length. The
picture chunks are copied byte for byte: nothing is decoded or re-encoded, so
there is no quality loss and nothing to compare by eye.

"ICCP" is kept. It is the colour profile the browser converts through, and the
ones in these files are real (sRGB, Display P3); dropping one changes how the
picture is drawn.

  python tools/strip-webp-metadata.py

Rewrites in place only the files that carry either chunk, so a second run
changes nothing. gen-image-variants.sh ends by running it.
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"

DROPPED = (b"EXIF", b"XMP ")
# Bits of the VP8X chunk's first byte: "an EXIF chunk follows", "an XMP chunk
# follows". A decoder that trusts them would look for chunks no longer there.
EXIF_FLAG = 0x08
XMP_FLAG = 0x04


def strip(data: bytes, name: str) -> bytes:
    """The same file without its EXIF and XMP chunks. `data` itself if it has neither."""
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError(f"{name}: not a RIFF/WEBP file")

    kept: list[bytes] = []
    dropped = False
    pos = 12
    while pos < len(data):
        if pos + 8 > len(data):
            raise ValueError(f"{name}: a chunk header runs past the end of the file")
        fourcc = data[pos : pos + 4]
        (size,) = struct.unpack("<I", data[pos + 4 : pos + 8])
        end = pos + 8 + size + (size & 1)
        if end > len(data):
            raise ValueError(f"{name}: chunk {fourcc!r} runs past the end of the file")

        if fourcc in DROPPED:
            dropped = True
        elif fourcc == b"VP8X":
            flags = data[pos + 8] & ~(EXIF_FLAG | XMP_FLAG)
            kept.append(data[pos : pos + 8] + bytes([flags]) + data[pos + 9 : end])
        else:
            kept.append(data[pos:end])
        pos = end

    if not dropped:
        return data
    body = b"WEBP" + b"".join(kept)
    return b"RIFF" + struct.pack("<I", len(body)) + body


def main() -> int:
    files = sorted(PUBLIC.rglob("*.webp"))
    if not files:
        raise SystemExit(f"no .webp under {PUBLIC}")

    changed = 0
    saved = 0
    for file in files:
        before = file.read_bytes()
        after = strip(before, str(file.relative_to(PUBLIC)))
        if after is before:
            continue
        file.write_bytes(after)
        changed += 1
        saved += len(before) - len(after)

    print(f"{changed} of {len(files)} WebP files stripped of EXIF/XMP, {saved} bytes removed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
