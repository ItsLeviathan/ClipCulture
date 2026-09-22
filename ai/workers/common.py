"""Shared helpers for Clip Culture Python workers (JSON-lines protocol on stdout)."""
import glob
import json
import os
import site
import sys
import traceback


def emit(**msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def add_cuda_dlls():
    """Make Windows find CUDA DLLs shipped as pip wheels (cuBLAS, cuDNN, CUDA runtime) and llama.cpp's own DLLs."""
    import ctypes

    for root in site.getsitepackages():
        for bin_dir in glob.glob(os.path.join(root, "nvidia", "*", "bin")):
            os.add_dll_directory(bin_dir)
            os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
        lib = os.path.join(root, "llama_cpp", "lib")
        if os.path.isdir(lib):
            os.add_dll_directory(lib)
    for name in ("cudart64_12.dll", "cublas64_12.dll"):
        try:
            ctypes.CDLL(name)
        except OSError:
            pass


def run_main(fn):
    try:
        fn()
    except Exception as e:  # noqa: BLE001
        emit(type="error", message=str(e), details=traceback.format_exc())
        sys.exit(1)
