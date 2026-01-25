#!/usr/bin/env python3
import argparse
import datetime
import glob
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Combine per-region manifests")
    parser.add_argument(
        "--input-glob",
        default="manifests/**/manifest.json",
        help="Glob for input manifest files",
    )
    parser.add_argument("--output", required=True, help="Path to combined manifest")
    parser.add_argument(
        "--updated-at",
        help="Override updated_at timestamp (defaults to current UTC)",
    )
    args = parser.parse_args()

    files = sorted(Path(p) for p in glob.glob(args.input_glob, recursive=True))
    if not files:
        raise FileNotFoundError(f"no manifests matched glob: {args.input_glob}")

    regions = []
    for path in files:
        with path.open("r", encoding="utf-8") as f:
            regions.append(json.load(f))

    updated_at = (
        args.updated_at
        if args.updated_at
        else datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    )

    combined = {"updated_at": updated_at, "regions": regions}

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(combined, f, indent=2, sort_keys=False)
        f.write("\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
