#!/usr/bin/env python3
"""Prepare privacy-minimized organization JSONL from the supplied Excel workbooks.

The two Isle of Wight inputs may have a .csv suffix but are XLSX zip archives.
Only public business fields are retained. Street address and precise coordinates
are removed for businesses present in the home-based subset. The Exchange
targeting workbook is emitted to a restricted server-only candidate file and
all contact, demographic, military, birth-date, age, and street fields are
intentionally discarded.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
IOW_FIPS = "51093"
IOW_COORDINATE_ENVELOPE = {
    "minimumLatitude": 36.64,
    "maximumLatitude": 37.22,
    "minimumLongitude": -77.02,
    "maximumLongitude": -76.43,
}


def normalize_name(value: str) -> str:
    value = value.lower().replace("&", " and ")
    value = re.sub(r"\b(incorporated|corporation|company|limited|inc|corp|co|llc|ltd|pllc)\b", " ", value)
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value)).strip()


def text(value: object) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def stable_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:28]
    return f"{prefix}_{digest}"


def read_xlsx_rows(path: Path, sheet_name: str | None = None):
    with zipfile.ZipFile(path) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall("m:si", NS):
                shared.append("".join(node.text or "" for node in item.iterfind(".//m:t", NS)))

        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in relationships.findall("r:Relationship", REL_NS)}
        selected = None
        for sheet in workbook.findall("m:sheets/m:sheet", NS):
            if sheet_name is None or sheet.attrib.get("name") == sheet_name:
                selected = rel_map[sheet.attrib[f"{{{DOC_REL}}}id"]]
                break
        if selected is None:
            raise ValueError(f"Sheet {sheet_name!r} not found in {path}")
        target = selected.lstrip("/")
        if not target.startswith("xl/"):
            target = f"xl/{target}"
        sheet_root = ET.fromstring(archive.read(target))
        headers = []
        for row_index, row in enumerate(sheet_root.findall("m:sheetData/m:row", NS)):
            cells = {}
            for cell in row.findall("m:c", NS):
                ref = cell.attrib.get("r", "A1")
                column = 0
                for char in re.match(r"[A-Z]+", ref).group(0):
                    column = column * 26 + ord(char) - 64
                value_node = cell.find("m:v", NS)
                inline = cell.find("m:is/m:t", NS)
                raw = inline.text if inline is not None else (value_node.text if value_node is not None else "")
                if cell.attrib.get("t") == "s" and raw:
                    raw = shared[int(raw)]
                cells[column - 1] = text(raw)
            if row_index == 0:
                width = max(cells.keys(), default=-1) + 1
                headers = [cells.get(index, "") for index in range(width)]
                continue
            if not headers:
                continue
            result = {header: cells.get(index, "") for index, header in enumerate(headers) if header}
            if any(result.values()):
                yield result


def source_id(row: dict[str, str]) -> str:
    duns = re.sub(r"\D", "", row.get("D-U-N-S@ Number", ""))
    if duns:
        return f"duns:{duns}"
    return stable_id("iow", normalize_name(row.get("Company Name", "")), row.get("Physical City", ""), row.get("Physical State", ""))


def bounded_coordinate(value: object, minimum: float, maximum: float) -> float | None:
    raw = text(value)
    if not raw:
        return None
    try:
        coordinate = float(raw)
    except ValueError:
        return None
    return coordinate if minimum <= coordinate <= maximum else None


def coordinate_in_market(latitude: float, longitude: float, territory_fips: str) -> bool:
    if latitude == 0 and longitude == 0:
        return False
    if territory_fips != IOW_FIPS:
        return True
    return (
        IOW_COORDINATE_ENVELOPE["minimumLatitude"] <= latitude <= IOW_COORDINATE_ENVELOPE["maximumLatitude"]
        and IOW_COORDINATE_ENVELOPE["minimumLongitude"] <= longitude <= IOW_COORDINATE_ENVELOPE["maximumLongitude"]
    )


def prepare(args):
    home_rows = list(read_xlsx_rows(args.home, "Company Details"))
    home_ids = {source_id(row) for row in home_rows}
    organizations = {}
    company_rows = list(read_xlsx_rows(args.companies, "Company Details"))
    company_identity_counts = Counter(
        source_id(row) for row in company_rows if text(row.get("Company Name"))
    )
    invalid_coordinate_rows = 0
    out_of_market_coordinate_rows = 0

    for row in company_rows:
        name = text(row.get("Company Name"))
        if not name:
            continue
        identity = source_id(row)
        home_based = identity in home_ids
        duns = re.sub(r"\D", "", row.get("D-U-N-S@ Number", ""))
        website = text(row.get("Web Address (URL)"))
        if website and not re.match(r"^https?://", website, re.IGNORECASE):
            website = f"https://{website}"
        city = text(row.get("Physical City"))
        state = text(row.get("Physical State"))
        county = text(row.get("Physical County"))
        territory_fips = IOW_FIPS if (
            normalize_name(county) == "isle of wight"
            and normalize_name(state) in {"va", "virginia"}
        ) else ""
        latitude = bounded_coordinate(row.get("Latitude"), -90, 90)
        longitude = bounded_coordinate(row.get("Longtitude"), -180, 180)
        has_any_coordinate = bool(text(row.get("Latitude")) or text(row.get("Longtitude")))
        if has_any_coordinate and (latitude is None or longitude is None):
            invalid_coordinate_rows += 1
            latitude = None
            longitude = None
        elif latitude is not None and longitude is not None and not coordinate_in_market(
            latitude, longitude, territory_fips
        ):
            invalid_coordinate_rows += 1
            out_of_market_coordinate_rows += 1
            latitude = None
            longitude = None
        record = {
            "id": stable_id("org", identity),
            "schemaVersion": 2,
            "name": name,
            "normalizedName": normalize_name(name),
            "organizationType": text(row.get("Company Type")),
            "description": text(row.get("Line of Business")),
            "city": city,
            "state": state,
            "county": county,
            "territoryFips": territory_fips,
            "privacySuppressed": home_based,
            "postalCode": "" if home_based else re.sub(r"\.0$", "", text(row.get("Physical Zipcode")))[:5],
            "addressLine1": "" if home_based else text(row.get("Physical Address")),
            "website": website,
            "publicPhone": "" if home_based else text(row.get("Phone No")),
            "latitude": None if home_based else latitude,
            "longitude": None if home_based else longitude,
            "coordinateConfidence": "approximate" if (
                not home_based and latitude is not None and longitude is not None
            ) else "",
            "naicsCodes": [text(row.get("Primary NAICS Code"))] if text(row.get("Primary NAICS Code")) else [],
            "sourceIds": {"duns": duns} if duns else {"iow": identity},
            "sources": ["iow_companies"] + (["iow_home_businesses"] if home_based else []),
            "claimStatus": "unclaimed",
            "verificationStatus": "unverified",
            "homeBased": home_based,
            "searchTokens": sorted(set(normalize_name(name).split()))[:20],
        }
        organizations[identity] = {key: value for key, value in record.items() if value not in (None, "", [])}

    targeting_rows = list(read_xlsx_rows(args.targeting))
    targeting_identity_counts: Counter[str] = Counter()
    restricted_by_identity: dict[str, dict[str, object]] = {}
    for row in targeting_rows:
        name = text(row.get("Account Name"))
        if not name:
            continue
        city = text(row.get("Mailing City"))
        state = text(row.get("Mailing State/Province"))
        identity_key = "|".join((normalize_name(name), normalize_name(city), normalize_name(state)))
        targeting_identity_counts[identity_key] += 1
        if identity_key in restricted_by_identity:
            continue
        restricted_by_identity[identity_key] = {
            "id": stable_id("target", identity_key),
            "name": name,
            "normalizedName": normalize_name(name),
            "city": city,
            "state": state,
            "sources": ["exchange_targeting"],
            "searchTokens": sorted(set(normalize_name(name).split()))[:20],
            "restrictedMatchOnly": True,
            "privacySuppressed": True,
            "schemaVersion": 2,
        }
    restricted = list(restricted_by_identity.values())

    args.output_dir.mkdir(parents=True, exist_ok=True)
    with (args.output_dir / "isle-of-wight-organizations.jsonl").open("w", encoding="utf-8") as handle:
        for record in organizations.values():
            handle.write(json.dumps(record, sort_keys=True) + "\n")
    with (args.output_dir / "exchange-targeting-restricted.jsonl").open("w", encoding="utf-8") as handle:
        for record in restricted:
            handle.write(json.dumps(record, sort_keys=True) + "\n")
    prepared_coordinate_count = sum(
        1 for row in organizations.values()
        if row.get("latitude") is not None and row.get("longitude") is not None
    )
    report = {
        "source": {
            "companyRows": len(company_rows),
            "companyRowsWithoutName": sum(1 for row in company_rows if not text(row.get("Company Name"))),
            "homeBusinessRows": len(home_rows),
            "homeBusinessIdentitiesMatched": len(home_ids.intersection(organizations)),
            "homeBusinessIdentitiesUnmatched": len(home_ids.difference(organizations)),
            "targetingRows": len(targeting_rows),
            "targetingRowsWithoutName": sum(1 for row in targeting_rows if not text(row.get("Account Name"))),
        },
        "organizations": len(organizations),
        "homeBased": sum(1 for row in organizations.values() if row.get("homeBased")),
        "coordinateMarkersEligible": prepared_coordinate_count,
        "listOnlyOrganizations": len(organizations) - prepared_coordinate_count,
        "invalidCoordinateRows": invalid_coordinate_rows,
        "outOfMarketCoordinateRowsSuppressed": out_of_market_coordinate_rows,
        "duplicateOrganizationIdentityGroups": sum(
            1 for count in company_identity_counts.values() if count > 1
        ),
        "restrictedTargetingCandidates": len(restricted),
        "duplicateTargetingIdentityGroups": sum(
            1 for count in targeting_identity_counts.values() if count > 1
        ),
        "duplicateTargetingIdentityRows": sum(
            count for count in targeting_identity_counts.values() if count > 1
        ),
        "duplicateTargetingRowsSuppressed": sum(
            count - 1 for count in targeting_identity_counts.values() if count > 1
        ),
        "privacy": {
            "homeAddressesSuppressed": True,
            "homeCoordinatesSuppressed": True,
            "targetingCandidatesRestrictedMatchOnly": True,
            "targetingContactDemographicAndBirthFieldsExcluded": True,
            "fabricatedCoordinates": False,
            "outOfMarketCoordinatesSuppressed": True,
        },
        "outputDirectory": str(args.output_dir),
    }
    (args.output_dir / "seed-preparation-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--companies", type=Path, required=True)
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--targeting", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    prepare(parser.parse_args())
