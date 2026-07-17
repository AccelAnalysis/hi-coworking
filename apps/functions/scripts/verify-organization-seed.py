#!/usr/bin/env python3
"""Fail CI when the committed public organization seed violates invariants."""

import argparse
import json
from pathlib import Path


def main(path: Path) -> None:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    ids = [row.get("id") for row in rows]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate organization IDs found")
    if any(not row.get("name") or not row.get("normalizedName") for row in rows):
        raise SystemExit("organization name/normalizedName missing")
    forbidden_home_fields = {"address", "postalCode", "publicPhone", "latitude", "longitude"}
    violations = [row.get("id") for row in rows if row.get("homeBased") and forbidden_home_fields.intersection(row)]
    if violations:
        raise SystemExit(f"home-based privacy violations: {len(violations)}")
    print(json.dumps({
        "organizations": len(rows),
        "homeBased": sum(bool(row.get("homeBased")) for row in rows),
        "duplicateIds": 0,
        "homePrivacyViolations": 0,
    }, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    main(parser.parse_args().path)
