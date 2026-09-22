"""Generates Clip Culture's built-in royalty-free music library.

Every track is an ORIGINAL composition synthesized here (no samples, no third-party audio), so the
whole library is released under CC0 1.0. Loops are 16 bars and wrap seamlessly (reverb tail is folded
back onto the start). Re-run any time:  ai\\venv\\Scripts\\python tools\\make_music.py
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np

SR = 44100
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "music")

MAJOR = [0, 2, 4, 5, 7, 9, 11]
MINOR = [0, 2, 3, 5, 7, 8, 10]

# id, title, category, bpm, root midi, mode, progression (scale degrees, 1 chord/bar x4, repeated),
# drums, bass, arp, pad level, melody, brightness
TRACKS = [
    ("energetic", "Neon Drive", 128, 57, MINOR, [0, 5, 2, 6], "four", "eighth", 16, 0.5, True, 0.9),
    ("chill", "Slow Morning", 82, 60, MAJOR, [0, 4, 5, 3], "soft", "whole", 8, 0.9, True, 0.4),
    ("cinematic", "Skyline", 90, 50, MINOR, [0, 5, 3, 4], "epic", "whole", 8, 1.0, False, 0.5),
    ("emotional", "Quiet Hours", 70, 57, MINOR, [0, 3, 5, 4], "none", "whole", 8, 1.0, True, 0.35),
    ("funny", "Wobble Walk", 112, 60, MAJOR, [0, 3, 4, 3], "bounce", "walk", 8, 0.3, True, 0.8),
    ("dramatic", "Iron Tide", 100, 45, MINOR, [0, 5, 6, 4], "epic", "eighth", 8, 0.8, False, 0.6),
    ("motivational", "Rise Up", 118, 55, MAJOR, [0, 4, 5, 3], "four", "eighth", 16, 0.7, True, 0.85),
    ("gaming", "Pixel Rush", 140, 52, MINOR, [0, 6, 5, 6], "breaks", "eighth", 16, 0.3, True, 1.0),
    ("vlog", "Golden Hour", 100, 62, MAJOR, [0, 5, 3, 4], "soft", "walk", 8, 0.6, True, 0.6),
    ("podcast", "Late Night Talk", 76, 57, MINOR, [0, 2, 3, 4], "soft", "whole", 8, 0.8, False, 0.3),
]


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def env(n, a=0.005, d=0.1, s=0.6, r=0.1):
    """ADSR-ish envelope for n samples."""
    e = np.ones(n)
    ai, di, ri = int(a * SR), int(d * SR), int(r * SR)
    ai = max(1, min(ai, n))
    e[:ai] = np.linspace(0, 1, ai)
    if n > ai + di:
        e[ai : ai + di] = np.linspace(1, s, di)
        e[ai + di :] = s
    ri = min(ri, n)
    e[n - ri :] *= np.linspace(1, 0, ri)
    return e


def tone(freq, dur, harmonics, decay=None, detune=0.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for h, amp in harmonics:
        y += amp * np.sin(2 * np.pi * freq * h * t)
        if detune:
            y += amp * 0.6 * np.sin(2 * np.pi * freq * h * (1 + detune) * t)
    if decay:
        y *= np.exp(-t * decay)
    return y


def scale_note(root, mode, degree, octave=0):
    o, d = divmod(degree, 7)
    return root + mode[d] + 12 * (o + octave)


def add(buf, sig, start):
    i = int(start * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i]


def kick():
    n = int(0.28 * SR)
    t = np.arange(n) / SR
    f = 46 + 110 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11) * 1.1


def snare(rng):
    n = int(0.2 * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    return (noise * np.exp(-t * 22) * 0.55 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 26) * 0.4)


def hat(rng, open_=False):
    n = int((0.16 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    hp = np.diff(noise, prepend=0)
    return hp * np.exp(-t * (18 if open_ else 70)) * 0.22


def reverb(x, rng, secs=1.6, wet=0.22):
    n = int(secs * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((2, n)) * np.exp(-t * 3.2)
    ir[:, :int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    out = np.zeros((2, x.shape[1] + n))
    size = 1 << (x.shape[1] + n - 1).bit_length()
    for c in range(2):
        out[c] = np.fft.irfft(np.fft.rfft(x[c], size) * np.fft.rfft(ir[c], size), size)[: x.shape[1] + n]
    out *= 0.03  # normalise convolution gain
    return out


def render(cat, title, bpm, root, mode, prog, drums, bass_kind, arp_steps, pad_lvl, melody, bright, seed):
    rng = np.random.default_rng(seed)
    beat = 60.0 / bpm
    bar = beat * 4
    bars = 16
    total = bars * bar
    n = int(total * SR)
    L, R = np.zeros(n), np.zeros(n)

    # pad (sustained triad per bar)
    for b in range(bars):
        deg = prog[b % 4]
        t0 = b * bar
        for k in (0, 2, 4):
            f = midi(scale_note(root + 12, mode, deg + k))
            sig = tone(f, bar + 0.4, [(1, 1), (2, 0.35 * bright), (3, 0.15 * bright)], detune=0.004) * env(int((bar + 0.4) * SR), 0.25, 0.3, 0.8, 0.35)
            add(L, sig * pad_lvl * 0.075, t0)
            add(R, np.roll(sig, 40) * pad_lvl * 0.075, t0)

    # bass
    for b in range(bars):
        deg = prog[b % 4]
        f = midi(scale_note(root - 12, mode, deg))
        if bass_kind == "whole":
            hits = [(0, 4)]
        elif bass_kind == "eighth":
            hits = [(i * 0.5, 0.45) for i in range(8)]
        else:  # walk
            hits = [(0, 0.9), (1, 0.9), (2, 0.9), (3, 0.9)]
        for j, (pos, ln) in enumerate(hits):
            steps = [0, 0, 4, 0][j % 4] if bass_kind == "walk" else 0
            ff = f * (2 ** (steps / 12)) if bass_kind == "walk" else f
            sig = tone(ff, ln * beat, [(1, 1), (2, 0.4), (3, 0.12)]) * env(int(ln * beat * SR), 0.005, 0.1, 0.7, 0.05) * 0.36
            add(L, sig, b * bar + pos * beat)
            add(R, sig, b * bar + pos * beat)

    # arpeggio
    if arp_steps:
        step = bar / arp_steps
        for b in range(bars):
            deg = prog[b % 4]
            pat = [0, 2, 4, 2, 0, 2, 4, 7 - 0][:8]
            for s in range(arp_steps):
                d = deg + [0, 2, 4, 7, 4, 2, 4, 2][s % 8]
                f = midi(scale_note(root + 12, mode, d, 1))
                sig = tone(f, step * 1.6, [(1, 1), (2, 0.3 * bright), (3, 0.1)], decay=7) * 0.09
                pan = 0.5 + 0.35 * np.sin(s * 0.9)
                add(L, sig * (1 - pan) * 1.4, b * bar + s * step)
                add(R, sig * pan * 1.4, b * bar + s * step)

    # melody (seeded random walk on the scale, phrase repeats every 4 bars)
    if melody:
        phrase = []
        d = 4
        for i in range(16):
            d = int(np.clip(d + rng.choice([-2, -1, -1, 0, 1, 1, 2]), 0, 9))
            phrase.append((d, rng.choice([1, 1, 2, 0.5, 0.5, 1.5])))
        for rep in range(bars // 4):
            t = rep * 4 * bar
            k = 0
            while t < (rep + 1) * 4 * bar - beat:
                d, ln = phrase[k % 16]
                k += 1
                if rng.random() < 0.18:
                    t += ln * beat
                    continue
                f = midi(scale_note(root + 12, mode, d, 1))
                sig = tone(f, ln * beat * 1.1, [(1, 1), (2, 0.25 * bright), (3, 0.08)]) * env(int(ln * beat * 1.1 * SR), 0.01, 0.15, 0.6, 0.12) * 0.11
                add(L, sig, t)
                add(R, sig * 0.9, t)
                t += ln * beat

    # drums
    def hit(sig, t, g=1.0):
        add(L, sig * g, t)
        add(R, sig * g, t)

    for b in range(bars):
        t0 = b * bar
        if drums == "four":
            for i in range(4):
                hit(kick(), t0 + i * beat, 0.7)
                hit(hat(rng, True), t0 + i * beat + beat / 2, 0.9)
            hit(snare(rng), t0 + beat, 0.6)
            hit(snare(rng), t0 + 3 * beat, 0.6)
        elif drums == "soft":
            hit(kick(), t0, 0.45)
            hit(kick(), t0 + 2.5 * beat, 0.35)
            hit(snare(rng), t0 + beat, 0.28)
            hit(snare(rng), t0 + 3 * beat, 0.28)
            for i in range(8):
                hit(hat(rng), t0 + i * beat / 2, 0.55)
        elif drums == "epic":
            hit(kick(), t0, 0.9)
            hit(kick(), t0 + 2 * beat, 0.8)
            hit(snare(rng), t0 + 3 * beat, 0.7)
            if b % 4 == 3:
                for i in range(8):
                    hit(snare(rng), t0 + 2 * beat + i * beat / 4, 0.18 + i * 0.05)
        elif drums == "bounce":
            for i in (0, 1.5, 2, 3.5):
                hit(kick(), t0 + i * beat, 0.6)
            hit(snare(rng), t0 + beat, 0.4)
            hit(snare(rng), t0 + 3 * beat, 0.4)
            for i in range(4):
                hit(hat(rng), t0 + i * beat + beat / 2, 0.7)
        elif drums == "breaks":
            for i in (0, 0.75, 2, 2.5):
                hit(kick(), t0 + i * beat, 0.65)
            hit(snare(rng), t0 + beat, 0.55)
            hit(snare(rng), t0 + 3 * beat, 0.55)
            for i in range(16):
                hit(hat(rng), t0 + i * beat / 4, 0.4 + 0.2 * (i % 2))

    x = np.stack([L, R])
    wet = reverb(x, rng)
    out = np.zeros((2, n))
    out += x * 0.85 + wet[:, :n] * 0.8
    out[:, : wet.shape[1] - n] += wet[:, n:] * 0.8  # fold reverb tail onto the start -> seamless loop
    out /= max(1e-6, np.abs(out).max()) / 0.85  # peak-normalise leaving headroom
    return out, total


def main():
    os.makedirs(ROOT, exist_ok=True)
    ff = sys.argv[1] if len(sys.argv) > 1 else "ffmpeg"
    lib = []
    for i, (cat, title, bpm, root, mode, prog, drums, bass, arp, pad, mel, bright) in enumerate(TRACKS):
        print(f"[{i + 1}/{len(TRACKS)}] {cat}: {title}", flush=True)
        y, total = render(cat, title, bpm, root, mode, prog, drums, bass, arp, pad, mel, bright, seed=100 + i)
        wav = os.path.join(ROOT, f"{cat}.wav")
        pcm = (np.clip(y.T, -1, 1) * 32767).astype("<i2")
        with wave.open(wav, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        mp3 = f"{cat}.mp3"
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", wav, "-c:a", "libmp3lame", "-b:a", "192k", os.path.join(ROOT, mp3)], check=True)
        os.remove(wav)
        lib.append({
            "id": f"rf-{cat}",
            "title": title,
            "artist": "Clip Culture Originals",
            "category": cat,
            "duration": round(total, 1),
            "bpm": bpm,
            "license": "CC0 1.0: original synthesized composition, free for any use",
            "file": mp3,
        })
    with open(os.path.join(ROOT, "library.json"), "w", encoding="utf-8") as f:
        json.dump(lib, f, indent=2)
    print("done", len(lib), "tracks")


if __name__ == "__main__":
    main()
