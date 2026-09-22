"""Clip Culture transcription worker (faster-whisper).

Protocol: one JSON object per stdout line.
  {"type":"status","message":str}
  {"type":"progress","done":float,"total":float}     seconds of audio processed
  {"type":"done","output":path}
  {"type":"error","message":str,"details":str}
The transcript itself is written to --out (never streamed over stdout).
"""
import argparse
import glob
import json
import os
import sys
import time
import traceback


def emit(**msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def add_cuda_dlls():
    """cuBLAS/cuDNN come from pip wheels (nvidia-*-cu12); make Windows find their DLLs."""
    import site

    roots = site.getsitepackages() + [site.getusersitepackages()]
    for root in roots:
        for bin_dir in glob.glob(os.path.join(root, "nvidia", "*", "bin")):
            os.add_dll_directory(bin_dir)
            os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")


def ensure_model(args, model_name):
    """Download into a plain folder (no symlinks: Windows blocks them without admin/Developer Mode)."""
    from faster_whisper.utils import _MODELS
    from huggingface_hub import snapshot_download

    repo = _MODELS.get(model_name, model_name)
    local = os.path.join(args.models_dir, repo.replace("/", "--"))
    if not os.path.exists(os.path.join(local, "model.bin")):
        emit(type="status", message=f"Downloading speech model {model_name} (one-time)")
        snapshot_download(repo, local_dir=local)
    return local


def run(args, model_name, device, compute_type, model_path):
    from faster_whisper import WhisperModel

    emit(type="status", message=f"Loading speech model ({model_name}, {device})")
    model = WhisperModel(model_path, device=device, compute_type=compute_type)
    emit(type="status", message="Transcribing speech")
    segments, info = model.transcribe(
        args.audio,
        language=args.language or None,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,  # avoids repetition loops on long audio
        beam_size=5,
    )
    total = float(info.duration)
    out_segments = []
    last_emit = 0.0
    for seg in segments:
        out_segments.append(
            {
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text.strip(),
                "words": [
                    {
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "word": w.word,
                        "prob": round(w.probability, 3),
                    }
                    for w in (seg.words or [])
                ],
            }
        )
        now = time.time()
        if now - last_emit > 0.25:
            emit(type="progress", done=float(seg.end), total=total)
            last_emit = now
    emit(type="progress", done=total, total=total)
    return {
        "language": info.language,
        "languageProbability": round(info.language_probability, 3),
        "duration": total,
        "model": model_name,
        "device": device,
        "segments": out_segments,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="large-v3-turbo")
    ap.add_argument("--cpu-model", default="small")
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    ap.add_argument("--language", default="")
    ap.add_argument("--models-dir", required=True)
    args = ap.parse_args()

    os.environ["HF_HOME"] = os.path.join(args.models_dir, "hf")
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    add_cuda_dlls()

    result = None
    if args.device in ("auto", "cuda"):
        gpu_path = ensure_model(args, args.model)  # download errors are real errors, not a reason to use CPU
        try:
            result = run(args, args.model, "cuda", "float16", gpu_path)
        except Exception as e:  # missing CUDA libs, out of VRAM, no GPU...
            if args.device == "cuda":
                raise
            emit(type="status", message="GPU unavailable, falling back to CPU (slower)")
            emit(type="log", message=f"CUDA failed: {e}")
    if result is None:
        result = run(args, args.cpu_model, "cpu", "int8", ensure_model(args, args.cpu_model))

    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    os.replace(tmp, args.out)
    emit(type="done", output=args.out)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        emit(type="error", message=str(e), details=traceback.format_exc())
        sys.exit(1)
