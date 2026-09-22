"""Clip Culture highlight detection worker (local LLM via llama.cpp).

Reads the timestamped transcript, asks a local LLM to pick self-contained, engaging moments
(referencing transcript units by id so timestamps are exact and no words are invented), scores them
with audio-energy features, chooses how many clips the content deserves, and refines boundaries
deterministically from word timestamps (trim filler, snap to sentence ends, cut dead air).

Modes:
  detect      whole video -> ranked highlights
  regenerate  one alternative for a given time range and an instruction
"""
import argparse
import json
import math
import os
import re
import sys
import wave

from common import add_cuda_dlls, emit, run_main

MIN_CLIP = 30.0  # every clip is at least this long (seconds)
MAX_CLIP = 150.0
TARGET_COUNT = 10  # aim for at least this many highlights whenever the video has enough material
FILLERS = {"um", "uh", "er", "ah", "hmm", "umm", "uhh", "erm"}
SENT_END = re.compile(r"[.!?…]['\")\]]*$")

HIGHLIGHT_SCHEMA = {
    "type": "object",
    "properties": {
        "highlights": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start_id": {"type": "integer"},
                    "end_id": {"type": "integer"},
                    "hook": {"type": "integer"},
                    "emotion": {"type": "integer"},
                    "information": {"type": "integer"},
                    "story": {"type": "integer"},
                    "standalone": {"type": "integer"},
                    "ending": {"type": "integer"},
                    "engagement": {"type": "integer"},
                    "reason": {"type": "string"},
                    "title": {"type": "string"},
                    "hook_line": {"type": "string"},
                    "caption": {"type": "string"},
                    "hashtags": {"type": "array", "items": {"type": "string"}},
                },
                "required": [
                    "start_id", "end_id", "hook", "emotion", "information", "story", "standalone",
                    "ending", "engagement", "reason", "title", "hook_line", "caption", "hashtags",
                ],
            },
        }
    },
    "required": ["highlights"],
}

SYSTEM = """You are an expert short-form video editor who finds the best moments in long videos for Instagram Reels, TikTok and YouTube Shorts.

You receive a transcript split into numbered units with timestamps. Choose moments that work as STANDALONE short videos.

A great moment:
- opens with a strong hook (surprising statement, question, bold claim, curiosity gap, direct advice)
- delivers useful information, a story with setup and payoff, humour, or real emotion
- can be understood without the rest of the video (no unexplained references like "as I said earlier")
- ends on a complete thought or a strong closing line, never mid-sentence
- is 30-90 seconds long. NEVER shorter than 30 seconds (check the timestamps); up to 120 seconds only if a story needs it

Rules:
- Refer to moments ONLY by start_id and end_id of the given units. Never invent ids.
- Do not pick greetings, sponsor reads, housekeeping, or filler chatter.
- Score each dimension 0-10 honestly; most moments are average. Only truly great moments deserve 8+.
- title: short, catchy, accurately describes the moment (max 8 words). hook_line: an attention-grabbing opening line for the video overlay, faithful to what is said. caption: 1-2 sentence social media description. hashtags: 4-6 relevant lowercase words without spaces or # derived from the actual topic.
- Never fabricate quotes or change the speaker's meaning.
- If nothing in the excerpt is worth clipping, return an empty list."""

REGEN_HINTS = {
    "stronger-hook": "Choose a start where the FIRST sentence is the most attention-grabbing possible (a bold claim, question or surprising fact), even if that means starting later than before.",
    "shorter": "Make it a much tighter, punchier version - roughly 60% of the original length - keeping only the essential payoff.",
    "more-context": "Include enough setup to fully understand the point. It may be longer (up to 120 seconds).",
    "more-emotional": "Focus on the most emotional, funny, or intense part of this area.",
    "information": "Focus on the most information-dense, useful explanation in this area.",
    "auto": "Pick a different but equally strong version of this moment.",
}


# ---------------------------------------------------------------- transcript units

def load_units(transcript):
    """Split transcript segments into sentence-like units using word timings."""
    units = []
    for seg in transcript["segments"]:
        words = seg.get("words") or []
        if not words:
            if seg["text"].strip():
                units.append({"start": seg["start"], "end": seg["end"], "text": seg["text"].strip(), "words": []})
            continue
        cur = []
        for i, w in enumerate(words):
            cur.append(w)
            nxt = words[i + 1] if i + 1 < len(words) else None
            gap = (nxt["start"] - w["end"]) if nxt else 0
            if nxt is None or SENT_END.search(w["word"].strip()) or gap > 0.9 or (len(cur) >= 45):
                units.append({
                    "start": cur[0]["start"],
                    "end": cur[-1]["end"],
                    "text": "".join(x["word"] for x in cur).strip(),
                    "words": cur,
                })
                cur = []
    for i, u in enumerate(units):
        u["id"] = i
    return units


def fmt(t):
    t = int(t)
    return f"{t // 60:02d}:{t % 60:02d}"


# ---------------------------------------------------------------- audio features

def audio_energy(path, step=0.5):
    """RMS level in dB per `step` seconds from a 16 kHz mono wav. Returns (levels, z-scores)."""
    import numpy as np

    with wave.open(path, "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        chunk = int(sr * step)
        levels = []
        while True:
            raw = wf.readframes(chunk * 2000)
            if not raw:
                break
            a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            usable = (len(a) // chunk) * chunk
            if usable == 0:
                break
            frames = a[:usable].reshape(-1, chunk)
            rms = np.sqrt((frames**2).mean(axis=1) + 1e-10)
            levels.extend((20 * np.log10(rms + 1e-6)).tolist())
    lv = np.array(levels) if levels else np.zeros(1)
    voiced = lv[lv > -55]
    mu = float(voiced.mean()) if voiced.size else -30.0
    sd = float(voiced.std()) if voiced.size > 1 else 6.0
    z = ((lv - mu) / max(sd, 1.0)).tolist()
    return lv.tolist(), z, step


def audio_score(z, step, start, end):
    """0-100: lively delivery (above-average energy with dynamics) scores higher."""
    a, b = int(start / step), max(int(end / step), int(start / step) + 1)
    seg = z[a:b] or [0.0]
    mean = sum(seg) / len(seg)
    var = sum((x - mean) ** 2 for x in seg) / len(seg)
    return max(0.0, min(100.0, 50 + 22 * mean + 12 * math.sqrt(var)))


# ---------------------------------------------------------------- LLM

def load_llm(path):
    add_cuda_dlls()
    from llama_cpp import Llama

    emit(type="status", message="Loading language model")
    return Llama(model_path=path, n_ctx=8192, n_gpu_layers=-1, flash_attn=True, verbose=False)


def ask(llm, user, max_tokens=1800):
    out = llm.create_chat_completion(
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
        response_format={"type": "json_object", "schema": HIGHLIGHT_SCHEMA},
        temperature=0.3,
        max_tokens=max_tokens,
    )
    text = out["choices"][0]["message"]["content"]
    try:
        return json.loads(text).get("highlights", [])
    except json.JSONDecodeError:
        return []


def window_prompt(units, extra=""):
    lines = [f"[{u['id']}] ({fmt(u['start'])}-{fmt(u['end'])}) {u['text']}" for u in units]
    return "Transcript excerpt:\n" + "\n".join(lines) + f"\n\n{extra}\nReturn the JSON."


def windows(units, span=420.0, overlap=60.0):
    if not units:
        return []
    out, t0 = [], units[0]["start"]
    end_all = units[-1]["end"]
    while t0 < end_all:
        chunk = [u for u in units if u["start"] >= t0 and u["start"] < t0 + span]
        if chunk:
            out.append(chunk)
        if t0 + span >= end_all:
            break
        t0 += span - overlap
    return out


def llm_score(h):
    w = {"hook": 1.3, "emotion": 0.8, "information": 1.0, "story": 0.9, "standalone": 1.2, "ending": 1.0, "engagement": 1.2}
    tot = sum(w.values())
    return sum(max(0, min(10, int(h.get(k, 0)))) * v for k, v in w.items()) / tot * 10


# ---------------------------------------------------------------- boundary refinement

def refine(units, a, b, all_words, max_extend=6.0):
    """Return (start, end, segments) for units a..b using word timing."""
    a, b = max(0, min(a, len(units) - 1)), max(0, min(b, len(units) - 1))
    if b < a:
        a, b = b, a
    words = [w for u in units[a : b + 1] for w in u["words"]]
    if not words:
        u0, u1 = units[a], units[b]
        return u0["start"], u1["end"], [[u0["start"], u1["end"]]]

    # leading filler
    while len(words) > 3 and re.sub(r"\W", "", words[0]["word"].lower()) in FILLERS:
        words.pop(0)

    # extend to a complete sentence if the last unit doesn't end one
    last = words[-1]
    if not SENT_END.search(last["word"].strip()):
        j = b + 1
        while j < len(units) and units[j]["start"] - last["end"] <= max_extend:
            words.extend(units[j]["words"])
            last = words[-1]
            if SENT_END.search(last["word"].strip()):
                break
            j += 1

    # pad, but never into neighbouring speech
    idx_first = next((i for i, w in enumerate(all_words) if w["start"] >= words[0]["start"] - 1e-6), 0)
    prev_end = all_words[idx_first - 1]["end"] if idx_first > 0 else 0.0
    start = max(words[0]["start"] - 0.15, prev_end + 0.03, 0.0)
    idx_last = next((i for i, w in enumerate(all_words) if w["end"] >= words[-1]["end"] - 1e-6), len(all_words) - 1)
    next_start = all_words[idx_last + 1]["start"] if idx_last + 1 < len(all_words) else words[-1]["end"] + 1.0
    end = min(words[-1]["end"] + 0.35, next_start - 0.03)
    end = max(end, words[-1]["end"])

    # dead space: cut long pauses inside the clip, keeping natural breathing room
    segs, seg_start = [], start
    for prev, nxt in zip(words, words[1:]):
        gap = nxt["start"] - prev["end"]
        if gap > 1.1:
            segs.append([seg_start, prev["end"] + 0.35])
            seg_start = nxt["start"] - 0.2
    segs.append([seg_start, end])
    segs = [[round(s, 3), round(e, 3)] for s, e in segs if e - s > 0.3]
    return round(start, 3), round(end, 3), segs


def extend_units(units, a, b, min_dur):
    """Grow unit range a..b (forward first, then backward at the end of the video) until it spans min_dur seconds."""
    a, b = max(0, min(a, len(units) - 1)), max(0, min(b, len(units) - 1))
    if b < a:
        a, b = b, a
    while units[b]["end"] - units[a]["start"] < min_dur:
        if b + 1 < len(units):
            b += 1
        elif a > 0:
            a -= 1
        else:
            break
    return a, b


def text_of(units, start, end):
    return " ".join(u["text"] for u in units if u["end"] > start and u["start"] < end).strip()


def fallback_meta(units, s, e):
    """Title + description straight from the spoken words, used only if the LLM returned nothing."""
    text = text_of(units, s, e)
    words = re.sub(r"\s+", " ", text).split(" ")
    title = " ".join(words[:8]).strip(" ,.;:-")
    sentences = re.split(r"(?<=[.!?])\s+", text)
    caption = " ".join(sentences[:2]).strip()
    if len(caption) > 220:
        caption = caption[:217].rsplit(" ", 1)[0] + "..."
    return (title[:1].upper() + title[1:]) if title else "Highlight", caption or title


def build_highlight(h, units, all_words, z, step):
    """Refine an LLM-picked range into a clip of at least MIN_CLIP seconds (returns None if impossible)."""
    a, b = extend_units(units, h["start_id"], h["end_id"], MIN_CLIP + 2)
    for _ in range(40):
        s, e, segs = refine(units, a, b, all_words)
        dur = sum(x[1] - x[0] for x in segs)  # after dead-air cuts
        if dur >= MIN_CLIP:
            break
        if b + 1 < len(units):
            b += 1
        elif a > 0:
            a -= 1
        else:
            break
    if dur < MIN_CLIP:
        return None
    a_score = audio_score(z, step, s, e)
    l_score = llm_score(h)
    title = h.get("title", "").strip().rstrip(".")
    caption = re.sub(r"\s*#\w+", "", h.get("caption", "")).strip()  # hashtags are stored separately
    if not title or not caption:  # every clip must have a title and a description
        ft, fc = fallback_meta(units, s, e)
        title, caption = title or ft, caption or fc
    return {
        "start": s,
        "end": e,
        "duration": round(dur, 2),
        "segments": segs,
        "score": round(0.85 * l_score + 0.15 * a_score, 1),
        "llmScore": round(l_score, 1),
        "audioScore": round(a_score, 1),
        "scores": {k: int(h.get(k, 0)) for k in ("hook", "emotion", "information", "story", "standalone", "ending", "engagement")},
        "reason": h.get("reason", "").strip(),
        "title": title,
        "hook": h.get("hook_line", "").strip() or title,
        "caption": caption,
        "hashtags": [re.sub(r"[^\w]", "", t.lower()) for t in h.get("hashtags", []) if re.sub(r"[^\w]", "", t)][:8],
    }


def overlap_frac(a, b):
    inter = max(0.0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
    shorter = max(1e-6, min(a["end"] - a["start"], b["end"] - b["start"]))
    return inter / shorter


def choose(cands, total_duration):
    """Rank, de-duplicate, and pick the best clips: at least TARGET_COUNT when the video has enough material."""
    cands = [c for c in cands if c and MIN_CLIP <= c["duration"] <= MAX_CLIP]
    cands.sort(key=lambda c: -c["score"])
    picked = []
    for c in cands:
        if all(overlap_frac(c, p) < 0.15 and abs(c["start"] - p["start"]) > 20 for p in picked):
            picked.append(c)
    limit = max(TARGET_COUNT, min(20, round(total_duration / 60.0 / 6.0)))  # 10 minimum; ~1 per 6 min for long videos
    keep = picked[:limit]
    keep.sort(key=lambda c: c["start"])
    return keep


# ---------------------------------------------------------------- modes

def valid_range(h, w):
    return (
        isinstance(h.get("start_id"), int)
        and isinstance(h.get("end_id"), int)
        and w[0]["id"] <= h["start_id"] <= w[-1]["id"]
        and w[0]["id"] <= h["end_id"] <= w[-1]["id"]  # ids outside the excerpt are hallucinations
    )


def describe(llm, units, a, b, all_words, z, step):
    """Ask the LLM for title/description/scores for an exact unit range (used for gap-filling)."""
    w = units[max(0, a - 3) : min(len(units), b + 4)]
    extra = f"Write the metadata for exactly ONE moment: use start_id={a} and end_id={b}. Be honest in the scores."
    h = next(iter(ask(llm, window_prompt(w, extra), max_tokens=600)), None) or {}
    h = {**h, "start_id": a, "end_id": b}
    return build_highlight(h, units, all_words, z, step)


def fill_spans(units, taken, z, step, need):
    """Sentence-aligned spans of >= MIN_CLIP+5 s in regions no clip covers yet, best audio energy first."""
    spans, i = [], 0
    while i < len(units):
        a = b = i
        while b < len(units) - 1 and (
            units[b]["end"] - units[a]["start"] < MIN_CLIP + 5 or not SENT_END.search(units[b]["text"].strip())
        ):
            b += 1
            if units[b]["end"] - units[a]["start"] > 90:
                break
        s, e = units[a]["start"], units[b]["end"]
        if e - s >= MIN_CLIP and all(e <= t0 or s >= t1 for t0, t1 in taken):
            spans.append((audio_score(z, step, s, e), a, b))
        i = b + 1
    spans.sort(reverse=True)
    return spans[: need * 2]


def detect(args, transcript, units, all_words, z, step):
    llm = load_llm(args.model)
    wins = windows(units)
    cands = []
    total = transcript["duration"]
    want = max(TARGET_COUNT, min(20, round(total / 60.0 / 6.0)))

    def scan(label, extra):
        for i, w in enumerate(wins):
            emit(type="status", message=f"{label} ({i + 1} of {len(wins)})")
            emit(type="progress", done=i, total=len(wins))
            for h in ask(llm, window_prompt(w, extra), max_tokens=2600):
                if valid_range(h, w):
                    c = build_highlight(h, units, all_words, z, step)
                    if c:
                        cands.append(c)
        emit(type="progress", done=len(wins), total=len(wins))

    # pass 1: the best moments in each excerpt
    scan(
        "Finding highlights",
        "Find up to 6 standalone moments in this excerpt, each at least 30 seconds long (check the timestamps). "
        "Prefer spreading them across different parts of the excerpt. Include good moments even if not perfect.",
    )
    picks = choose(cands, total)

    # pass 2: not enough yet -> ask again for additional, different moments
    if len(picks) < want:
        scan(
            "Looking for more highlights",
            "Find up to 8 MORE standalone moments in this excerpt, each at least 30 seconds long. "
            "Choose different parts of the excerpt than the most obvious ones; interesting explanations, stories, "
            "opinions, examples and advice all count.",
        )
        picks = choose(cands, total)

    # pass 3: still short -> take untouched regions and let the LLM write their titles and descriptions
    if len(picks) < want:
        taken = [(p["start"], p["end"]) for p in picks]
        spans = fill_spans(units, taken, z, step, want - len(picks))
        for k, (_, a, b) in enumerate(spans):
            emit(type="status", message=f"Filling remaining highlights ({k + 1} of {len(spans)})")
            emit(type="progress", done=k, total=len(spans))
            c = describe(llm, units, a, b, all_words, z, step)
            if c:
                cands.append(c)
        picks = choose(cands, total)

    return {"highlights": picks, "candidates": len(cands), "wanted": want}


def regenerate(args, transcript, units, all_words, z, step):
    llm = load_llm(args.model)
    lo, hi = args.range_start - 90, args.range_end + 90
    w = [u for u in units if u["end"] >= lo and u["start"] <= hi]
    if not w:
        return {"highlights": []}
    emit(type="status", message="Creating a new version")
    hint = REGEN_HINTS.get(args.instruction, REGEN_HINTS["auto"])
    orig_len = max(1.0, args.range_end - args.range_start)
    if args.instruction == "shorter":
        hint += f" The new moment should be about {max(int(MIN_CLIP), int(orig_len * 0.65))} seconds long (the original is {int(orig_len)} seconds) and never shorter than 30 seconds."
    elif args.instruction == "more-context":
        hint += f" The new moment should be longer than the original {int(orig_len)} seconds, at most 120 seconds."
    ids = [u["id"] for u in units if u["start"] >= args.range_start - 1 and u["end"] <= args.range_end + 1]
    extra = (
        f"The existing clip covers units {ids[0] if ids else w[0]['id']} to {ids[-1] if ids else w[-1]['id']}. "
        f"Create exactly ONE alternative highlight from this excerpt. {hint}"
    )
    best = None
    for temp_try in range(2):
        for h in ask(llm, window_prompt(w, extra), max_tokens=700)[:1]:
            if isinstance(h.get("start_id"), int) and isinstance(h.get("end_id"), int) and w[0]["id"] <= h["start_id"] <= h["end_id"] <= w[-1]["id"]:
                best = build_highlight(h, units, all_words, z, step) or best
        if best:
            break
    return {"highlights": [best] if best else []}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="detect", choices=["detect", "regenerate"])
    ap.add_argument("--transcript", required=True)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--instruction", default="auto")
    ap.add_argument("--range-start", type=float, default=0)
    ap.add_argument("--range-end", type=float, default=0)
    args = ap.parse_args()

    with open(args.transcript, encoding="utf-8") as f:
        transcript = json.load(f)
    units = load_units(transcript)
    if not units:
        emit(type="status", message="No speech found")
        result = {"highlights": [], "candidates": 0}
    else:
        all_words = [w for u in units for w in u["words"]]
        emit(type="status", message="Analyzing audio energy")
        try:
            _, z, step = audio_energy(args.audio)
        except Exception:  # noqa: BLE001 - audio features are a bonus signal, never fatal
            z, step = [0.0], 0.5
        result = (detect if args.mode == "detect" else regenerate)(args, transcript, units, all_words, z, step)

    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    os.replace(tmp, args.out)
    emit(type="done", output=args.out)


if __name__ == "__main__":
    run_main(main)
