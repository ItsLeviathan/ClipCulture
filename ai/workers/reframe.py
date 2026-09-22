"""Clip Culture vertical reframing worker.

For each requested source time range, detects faces (OpenCV YuNet), decides who is the active
speaker (mouth motion + size, with hysteresis so the camera does not ping-pong), and produces a
smooth, sparse camera path as keyframes {t, cx} where cx is the horizontal centre of the 9:16
window as a fraction of frame width.
"""
import argparse
import json
import os

import cv2
import numpy as np

from common import emit, run_main

SAMPLE_FPS = 6.0
DET_WIDTH = 640


def rdp(points, eps):
    """Ramer-Douglas-Peucker on (t, cx) with cx scaled so eps means 'fraction of frame width'."""
    if len(points) < 3:
        return points
    (t0, c0), (t1, c1) = points[0], points[-1]
    dmax, idx = 0.0, 0
    for i in range(1, len(points) - 1):
        t, c = points[i]
        k = (t - t0) / (t1 - t0) if t1 != t0 else 0
        d = abs(c - (c0 + (c1 - c0) * k))
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return rdp(points[: idx + 1], eps)[:-1] + rdp(points[idx:], eps)
    return [points[0], points[-1]]


class Track:
    def __init__(self, tid, cx, cy, w, patch):
        self.id, self.cx, self.cy, self.w, self.patch = tid, cx, cy, w, patch
        self.speak = 0.0
        self.seen = 0


def mouth_patch(gray, det, scale):
    # YuNet landmarks: 10,11 = right mouth corner; 12,13 = left mouth corner
    mx0, my0, mx1, my1 = det[10], det[11], det[12], det[13]
    cx, cy = (mx0 + mx1) / 2, (my0 + my1) / 2
    hw = max(abs(mx1 - mx0) * 0.9, 6)
    x0, x1 = int(max(cx - hw, 0)), int(min(cx + hw, gray.shape[1] - 1))
    y0, y1 = int(max(cy - hw * 0.7, 0)), int(min(cy + hw * 0.7, gray.shape[0] - 1))
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None
    return cv2.resize(gray[y0:y1, x0:x1], (24, 12)).astype(np.float32)


def analyze_range(cap, detector, rng, fps_src, frame_w, frame_h):
    scale = DET_WIDTH / frame_w
    dw, dh = DET_WIDTH, int(frame_h * scale)
    detector.setInputSize((dw, dh))
    step = max(1, int(round(fps_src / SAMPLE_FPS)))
    dt = step / fps_src
    cap.set(cv2.CAP_PROP_POS_MSEC, rng["start"] * 1000.0)

    tracks, next_id, current = [], 0, None
    switch_votes = 0
    cam, path, face_samples, total = 0.5, [], 0, 0
    last_face_t = None
    t = rng["start"]
    while t <= rng["end"]:
        ok = cap.grab()
        if not ok:
            break
        ok, frame = cap.retrieve()
        for _ in range(step - 1):
            cap.grab()
        if not ok:
            break
        total += 1
        small = cv2.resize(frame, (dw, dh))
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        _, faces = detector.detect(small)
        faces = [] if faces is None else [f for f in faces if f[14] > 0.6]

        # associate detections with tracks
        used = set()
        for f in sorted(faces, key=lambda f: -f[2] * f[3]):
            fcx, fcy, fw = (f[0] + f[2] / 2) / dw, (f[1] + f[3] / 2) / dh, f[2] / dw
            best, bd = None, 0.18
            for tr in tracks:
                if tr.id in used:
                    continue
                d = abs(tr.cx - fcx) + abs(tr.cy - fcy) * 0.5
                if d < bd:
                    best, bd = tr, d
            patch = mouth_patch(gray, f, scale)
            if best is None:
                best = Track(next_id, fcx, fcy, fw, patch)
                next_id += 1
                tracks.append(best)
            else:
                motion = 0.0
                if patch is not None and best.patch is not None:
                    motion = float(np.abs(patch - best.patch).mean()) / 255.0
                best.speak = 0.65 * best.speak + 0.35 * motion * 10.0 + 0.0
                best.cx, best.cy, best.w, best.patch = fcx, fcy, fw, patch
            best.seen += 1
            used.add(best.id)
        for tr in tracks:
            if tr.id not in used:
                tr.speak *= 0.8

        visible = [tr for tr in tracks if tr.id in used]
        if visible:
            face_samples += 1
            last_face_t = t
            score = lambda tr: tr.speak + 0.6 * tr.w  # noqa: E731 - speaking dominates, size breaks ties
            best = max(visible, key=score)
            if current is None or current not in visible:
                current, switch_votes = best, 0
            elif best is not current and score(best) > score(current) * 1.5 + 0.05:
                switch_votes += 1
                if switch_votes * dt >= 1.0:  # sustained for ~1 s before cutting to the other person
                    current, switch_votes = best, 0
            else:
                switch_votes = 0
            target = current.cx
        else:
            target = cam
            if last_face_t is not None and t - last_face_t > 3.0:
                target = 0.5  # nobody for a while: drift back to centre

        # deadband + easing: small movement is ignored, larger movement is eased
        err = target - cam
        if abs(err) > 0.035:
            cam += err * (0.32 if abs(err) > 0.2 else 0.18)
        path.append((t - rng["start"], cam))
        t += dt

    mode = "track" if total and face_samples / total >= 0.15 else "center"
    if mode == "center":
        keys = [{"t": round(rng["start"], 3), "cx": 0.5}, {"t": round(rng["end"], 3), "cx": 0.5}]
    else:
        pts = rdp([(p[0], p[1]) for p in path], 0.012)
        keys = [{"t": round(rng["start"] + p[0], 3), "cx": round(float(min(max(p[1], 0.0), 1.0)), 4)} for p in pts]
    return {"id": rng["id"], "mode": mode, "keys": keys, "faceRatio": round(face_samples / max(total, 1), 2)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--ranges", required=True, help="JSON file: [{id,start,end}]")
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", required=True)
    args = ap.parse_args()

    with open(args.ranges, encoding="utf-8") as f:
        ranges = json.load(f)
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise RuntimeError("Could not open the preview video for face tracking")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    fw, fh = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    detector = cv2.FaceDetectorYN.create(args.model, "", (DET_WIDTH, int(fh * DET_WIDTH / fw)), 0.6, 0.3, 5000)

    results = []
    for i, r in enumerate(ranges):
        emit(type="status", message=f"Tracking people in clip {i + 1} of {len(ranges)}")
        emit(type="progress", done=i, total=len(ranges))
        results.append(analyze_range(cap, detector, r, fps, fw, fh))
    emit(type="progress", done=len(ranges), total=len(ranges))

    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"results": results}, f)
    os.replace(tmp, args.out)
    emit(type="done", output=args.out)


if __name__ == "__main__":
    run_main(main)
