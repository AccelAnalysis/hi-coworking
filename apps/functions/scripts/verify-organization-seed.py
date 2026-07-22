#!/usr/bin/env python3
"""Fail CI when the committed public organization seed violates invariants."""

import argparse
import json
from pathlib import Path


IOW_FIPS = "51093"
IOW_COORDINATE_ENVELOPE = {
    "minimumLatitude": 36.64,
    "maximumLatitude": 37.22,
    "minimumLongitude": -77.02,
    "maximumLongitude": -76.43,
}


def load_rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def main(path: Path, targeting_path: Path | None = None) -> None:
    rows = load_rows(path)
    ids = [row.get("id") for row in rows]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate organization IDs found")
    if any(not row.get("name") or not row.get("normalizedName") for row in rows):
        raise SystemExit("organization name/normalizedName missing")
    forbidden_home_fields = {"address", "addressLine1", "postalCode", "publicPhone", "latitude", "longitude", "geohash"}
    violations = [row.get("id") for row in rows if (row.get("homeBased") or row.get("privacySuppressed")) and forbidden_home_fields.intersection(row)]
    if violations:
        raise SystemExit(f"home-based privacy violations: {len(violations)}")
    forbidden_targeting_fields = {"email", "phone", "contactName", "birthDate", "age", "militaryStatus"}
    targeting_violations = [row.get("id") for row in rows if forbidden_targeting_fields.intersection(row)]
    if targeting_violations:
        raise SystemExit(f"forbidden targeting fields: {len(targeting_violations)}")

    coordinate_violations = []
    for row in rows:
        latitude = row.get("latitude")
        longitude = row.get("longitude")
        if (latitude is None) != (longitude is None):
            coordinate_violations.append(row.get("id"))
            continue
        if latitude is None:
            continue
        if not isinstance(latitude, (int, float)) or not -90 <= latitude <= 90:
            coordinate_violations.append(row.get("id"))
            continue
        if not isinstance(longitude, (int, float)) or not -180 <= longitude <= 180:
            coordinate_violations.append(row.get("id"))
            continue
        if latitude == 0 and longitude == 0:
            coordinate_violations.append(row.get("id"))
            continue
        if row.get("territoryFips") == IOW_FIPS and not (
            IOW_COORDINATE_ENVELOPE["minimumLatitude"] <= latitude <= IOW_COORDINATE_ENVELOPE["maximumLatitude"]
            and IOW_COORDINATE_ENVELOPE["minimumLongitude"] <= longitude <= IOW_COORDINATE_ENVELOPE["maximumLongitude"]
        ):
            coordinate_violations.append(row.get("id"))
            continue
        if row.get("coordinateConfidence") not in {"authoritative", "verified", "approximate"}:
            coordinate_violations.append(row.get("id"))
    if coordinate_violations:
        raise SystemExit(f"coordinate or confidence violations: {len(coordinate_violations)}")

    targeting_rows = load_rows(targeting_path) if targeting_path else []
    targeting_ids = [row.get("id") for row in targeting_rows]
    if len(targeting_ids) != len(set(targeting_ids)):
        raise SystemExit("duplicate targeting IDs found")
    forbidden_restricted_fields = {
        "email", "phone", "publicPhone", "address", "addressLine1", "street", "postalCode",
        "birthDate", "age", "militaryStatus", "contactName", "race", "gender",
        "otherRace", "otherGender", "latitude", "longitude", "geohash",
    }
    restricted_violations = [
        row.get("id") for row in targeting_rows
        if row.get("restrictedMatchOnly") is not True
        or row.get("privacySuppressed") is not True
        or forbidden_restricted_fields.intersection(row)
    ]
    if restricted_violations:
        raise SystemExit(f"restricted targeting privacy violations: {len(restricted_violations)}")
    print(json.dumps({
        "organizations": len(rows),
        "homeBased": sum(bool(row.get("homeBased")) for row in rows),
        "coordinateEligible": sum(
            row.get("latitude") is not None and row.get("longitude") is not None for row in rows
        ),
        "listOnly": sum(
            row.get("latitude") is None or row.get("longitude") is None for row in rows
        ),
        "restrictedTargetingCandidates": len(targeting_rows),
        "duplicateIds": 0,
        "homePrivacyViolations": 0,
        "coordinateViolations": 0,
        "restrictedTargetingPrivacyViolations": 0,
    }, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--targeting", type=Path)
    arguments = parser.parse_args()
    main(arguments.path, arguments.targeting)
