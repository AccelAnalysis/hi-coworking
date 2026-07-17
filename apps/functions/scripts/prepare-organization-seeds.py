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
import hashlib
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
DOC_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


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


def prepare(args):
    home_rows = list(read_xlsx_rows(args.home, "Company Details"))
    home_ids = {source_id(row) for row in home_rows}
    organizations = {}

    for row in read_xlsx_rows(args.companies, "Company Details"):
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
        record = {
            "id": stable_id("org", identity),
            "name": name,
            "normalizedName": normalize_name(name),
            "organizationType": text(row.get("Company Type")),
            "description": text(row.get("Line of Business")),
            "city": city,
            "state": state,
            "county": text(row.get("Physical County")),
            "postalCode": "" if home_based else re.sub(r"\.0$", "", text(row.get("Physical Zipcode")))[:5],
            "address": "" if home_based else text(row.get("Physical Address")),
            "website": website,
            "publicPhone": "" if home_based else text(row.get("Phone No")),
            "latitude": None if home_based else float(row["Latitude"]) if text(row.get("Latitude")) else None,
            "longitude": None if home_based else float(row["Longtitude"]) if text(row.get("Longtitude")) else None,
            "naicsCodes": [text(row.get("Primary NAICS Code"))] if text(row.get("Primary NAICS Code")) else [],
            "sourceIds": {"duns": duns} if duns else {"iow": identity},
            "sources": ["iow_companies"] + (["iow_home_businesses"] if home_based else []),
            "claimStatus": "unclaimed",
            "verificationStatus": "unverified",
            "homeBased": home_based,
            "searchTokens": sorted(set(normalize_name(name).split()))[:20],
        }
        organizations[identity] = {key: value for key, value in record.items() if value not in (None, "", [])}

    restricted = []
    for index, row in enumerate(read_xlsx_rows(args.targeting)):
        name = text(row.get("Account Name"))
        if not name:
            continue
        city = text(row.get("Mailing City"))
        state = text(row.get("Mailing State/Province"))
        restricted.append({
            "id": stable_id("target", name, city, state, str(index)),
            "name": name,
            "normalizedName": normalize_name(name),
            "city": city,
            "state": state,
            "sources": ["exchange_targeting"],
            "searchTokens": sorted(set(normalize_name(name).split()))[:20],
            "restrictedMatchOnly": True,
        })

    args.output_dir.mkdir(parents=True, exist_ok=True)
    with (args.output_dir / "isle-of-wight-organizations.jsonl").open("w", encoding="utf-8") as handle:
        for record in organizations.values():
            handle.write(json.dumps(record, sort_keys=True) + "\n")
    with (args.output_dir / "exchange-targeting-restricted.jsonl").open("w", encoding="utf-8") as handle:
        for record in restricted:
            handle.write(json.dumps(record, sort_keys=True) + "\n")
    print(json.dumps({
        "organizations": len(organizations),
        "homeBased": sum(1 for row in organizations.values() if row.get("homeBased")),
        "restrictedTargetingCandidates": len(restricted),
        "outputDirectory": str(args.output_dir),
    }, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--companies", type=Path, required=True)
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--targeting", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    prepare(parser.parse_args())
