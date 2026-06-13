"""fetch_mathdial.py — download the MathDial train CSV for EV-8a (gitignored)."""
from __future__ import annotations
import argparse, os, sys

SOURCE_URL = "https://raw.githubusercontent.com/eth-nlped/mathdial/main/data/train.csv"


def main(argv=None) -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(here, "data")
    p = argparse.ArgumentParser(description="fetch MathDial train CSV for EV-8a")
    p.add_argument("--out", default=os.path.join(data_dir, "mathdial_train.csv"))
    a = p.parse_args(argv)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    import urllib.request
    print(f"Downloading {SOURCE_URL} ...", flush=True)
    urllib.request.urlretrieve(SOURCE_URL, a.out)  # noqa: S310 - fixed trusted URL
    print(f"  -> {a.out} ({os.path.getsize(a.out)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
