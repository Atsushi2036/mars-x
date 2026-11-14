"""CLI: ``uv run python -m marsx.pipeline build --region jezero-v1``."""

from __future__ import annotations

import argparse

from .build import REGIONS, build


def main() -> None:
    ap = argparse.ArgumentParser(prog="marsx.pipeline")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="fetch, reproject, derive and write a region")
    b.add_argument("--region", default="jezero-v1", choices=sorted(REGIONS))
    b.add_argument("--workers", type=int, default=None)
    b.add_argument("--no-bench", action="store_true", help="skip the serial-vs-parallel measurements")
    b.add_argument("--refresh", action="store_true", help="accept changed upstream small files (updates the lock)")
    a = ap.parse_args()
    if a.cmd == "build":
        build(REGIONS[a.region], workers=a.workers, bench=not a.no_bench, refresh=a.refresh)


if __name__ == "__main__":
    main()
