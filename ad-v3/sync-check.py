# Cut-to-beat sync of a rendered file.
#  audio: tempo by comb search on the onset envelope, phase from kick attacks (low-passed energy,
#         first rise to 50% of the local peak) in a +-100 ms window around each grid beat;
#  video: ffmpeg scene detection; detections 1-2 frames after a cut (in-shot snaps, flash-off) are merged.
# Usage: python3 sync2.py video.mp4 [scene_threshold]
import subprocess, re, sys, numpy as np
from scipy.signal import butter, sosfilt
f = sys.argv[1]; th = sys.argv[2] if len(sys.argv) > 2 else "0.08"; sr = 44100; FR = 1 / 30
x = np.frombuffer(subprocess.run(["ffmpeg", "-loglevel", "error", "-i", f, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"], capture_output=True).stdout, dtype=np.float32)
dur = len(x) / sr
# tempo: spectral-flux comb search
hop, n = 256, 1024
fr = np.lib.stride_tricks.sliding_window_view(x[::2], n)[::hop] * np.hanning(n); fps = sr / 2 / hop
S = np.log1p(10 * np.abs(np.fft.rfft(fr, axis=1)))
flux = np.concatenate([[0], np.maximum(0, np.diff(S, axis=0)).sum(1)]); env = np.maximum(flux - np.convolve(flux, np.ones(32) / 32, "same"), 0)
best = (0, 0)
for bpm in np.arange(120, 130, 0.01):
    per = 60 / bpm * fps; ph = np.arange(0, per, 0.25)
    idx = (np.arange(0, len(env) / per - 1)[:, None] * per + ph[None, :]).astype(int); v = env[idx].sum(0).max()
    if v > best[0]: best = (v, bpm)
bpm = best[1]; beat = 60 / bpm
# phase: full-band spectral-flux peak (3 ms hop) within +-80 ms of each beat; tempo/phase by least squares
h2, n2 = 128, 1024
fr2 = np.lib.stride_tricks.sliding_window_view(x, n2)[::h2] * np.hanning(n2); f2 = sr / h2
S2 = np.log1p(10 * np.abs(np.fft.rfft(fr2, axis=1)))
fl = np.concatenate([[0], np.maximum(0, np.diff(S2, axis=0)).sum(1)])
ts, ks = [], []
for k in range(int(dur / beat)):
    g = k * beat; a, b = int((g - 0.08) * f2), int((g + 0.08) * f2)
    if a < 0 or b >= len(fl): continue
    seg = fl[a:b]
    if seg.max() < np.percentile(fl, 97): continue
    ts.append((a + seg.argmax() + n2 / 2 / h2) / f2); ks.append(k)
A = np.vstack([np.ones(len(ks)), ks]).T; ph, beat = np.linalg.lstsq(A, np.array(ts), rcond=None)[0]; bpm = 60 / beat
offs = np.array(ts) - (ph + beat * np.array(ks))
out = subprocess.run(["ffmpeg", "-hide_banner", "-i", f, "-vf", f"select='gt(scene,{th})',showinfo", "-an", "-f", "null", "-"], capture_output=True, text=True).stderr
raw = [float(m) for m in re.findall(r"pts_time:([0-9.]+)", out)]
cuts = []
for t in raw:
    if t < 0.05: continue
    if cuts and t - cuts[-1] <= 2.5 * FR: continue
    cuts.append(t)
cuts = np.array(cuts)
def off(t, step): return t - (ph + np.round((t - ph) / step) * step)
dh = off(cuts, beat / 2); db = off(cuts, beat)
print(f"audio: {bpm:.3f} BPM, kick phase {ph*1000:+.1f} ms from {len(offs)} onset peaks (residual median {np.median(np.abs(offs))*1000:.1f} ms)")
print(f"video: {len(cuts)} cuts detected (scene>{th}, raw {len(raw)}) in {dur:.2f} s -> average shot {dur/(len(cuts)+1):.2f} s")
print(f"cut vs nearest half-beat: median {np.median(np.abs(dh))*1000:.1f} ms, p90 {np.percentile(np.abs(dh),90)*1000:.1f} ms, max {np.abs(dh).max()*1000:.1f} ms; within 1 frame: {(np.abs(dh) <= FR + 1e-6).sum()}/{len(cuts)}")
print(f"cuts on a full beat (within 1 frame): {(np.abs(db) <= FR + 1e-6).sum()}/{len(cuts)}")
