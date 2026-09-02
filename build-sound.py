"""Makes the interface click.

The game keeps its own click inside an FMOD bank (FADPCM), which nothing here
can decode, so this synthesises one with the same character: a short, dry,
wooden tick with a fast decay.
"""
import math, os, random, struct, wave

RATE = 22050

def click(path, freq=1000.0, ms=42, seed=7):
    random.seed(seed)
    n = int(RATE * ms / 1000)
    frames = bytearray()
    for i in range(n):
        t = i / RATE
        env = math.exp(-t * 95.0)                  # sharp wooden decay
        body = math.sin(2 * math.pi * freq * t)
        second = 0.35 * math.sin(2 * math.pi * freq * 2.03 * t)
        noise = 0.30 * (random.random() * 2 - 1) * math.exp(-t * 420.0)
        v = (body + second + noise) * env * 0.42
        frames += struct.pack("<h", max(-32767, min(32767, int(v * 32767))))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(frames))
    print(f"  {os.path.basename(path):<12} {os.path.getsize(path):>6} bytes")

os.makedirs("build-tmp", exist_ok=True)
click(os.path.join("build-tmp", "click.wav"), 1000.0)
click(os.path.join("build-tmp", "back.wav"), 620.0, seed=11)
