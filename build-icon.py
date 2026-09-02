"""Builds the exe icon.

Only large sizes go in. The logo carries a lot of detail, and a hand-made 16px
copy of it turns to mush; Windows downsamples from 256 far more cleanly.
"""
import os
from PIL import Image

SRC = r"C:\Users\BUNNY\Downloads\ChatGPT Image Sep 2, 2026, 09_50_00 AM.png"
SIZES = [(64, 64), (128, 128), (256, 256)]

im = Image.open(SRC).convert("RGBA")
side = max(im.size)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
square.save("icon.ico", format="ICO", sizes=SIZES)
print("icon.ico", os.path.getsize("icon.ico"), "bytes; sizes:",
      ", ".join(str(w) for w, _ in SIZES))
