#!/usr/bin/env python3
import argparse
from datetime import datetime
import json
import os
import subprocess
import sys


def parse_bbox(pbf_path: str):
    try:
        output = subprocess.check_output(
            ["osmium", "fileinfo", "--get", "header.bounds", pbf_path],
            text=True,
        ).strip()
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"failed to read bbox via osmium: {exc}") from exc

    parts = output.split(",")
    if len(parts) != 4:
        raise ValueError(f"unexpected bbox format: '{output}'")

    try:
        min_lon, min_lat, max_lon, max_lat = map(float, parts)
    except ValueError as exc:
        raise ValueError(f"failed to parse bbox numbers: '{output}'") from exc

    return min_lon, min_lat, max_lon, max_lat


def main():
    parser = argparse.ArgumentParser(description="Generate manifest for a region DB")
    parser.add_argument("--region-id", required=True, help="Region slug (e.g. uk)")
    parser.add_argument("--db", required=True, help="Path to the sqlite db")
    parser.add_argument("--pbf", required=True, help="Path to the source .osm.pbf")
    parser.add_argument(
        "--output", required=True, help="Where to write the manifest JSON file"
    )
    args = parser.parse_args()

    if not os.path.exists(args.db):
        raise FileNotFoundError(f"db not found: {args.db}")
    if not os.path.exists(args.pbf):
        raise FileNotFoundError(f"pbf not found: {args.pbf}")

    min_lon, min_lat, max_lon, max_lat = parse_bbox(args.pbf)
    size_bytes = os.path.getsize(args.db)
    updated_at = datetime.now().isoformat()

    manifest = {
        "id": f"{args.region_id}-latest",
        "region": args.region_id,
        "bbox": {
            "minLon": min_lon,
            "minLat": min_lat,
            "maxLon": max_lon,
            "maxLat": max_lat,
        },
        "db": {
            "object": f"{args.region_id}-latest.db",
            "size_bytes": size_bytes,
        },
        "updated_at": updated_at,
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, sort_keys=False)
        f.write("\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
