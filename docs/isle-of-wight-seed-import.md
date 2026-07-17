# Isle of Wight organization seed import

## Sources and privacy

The supplied `IOW_Companies.csv` and `IOW_Home-based_Businesses.csv` files are XLSX workbooks despite their `.csv` suffixes. The preparer reads their `Company Details` sheets. The home list is merged into the main list by D-U-N-S identifier (fallback: normalized name/location) and adds `homeBased: true`; it does not create a second organization.

The Exchange Targeting workbook contains personal contact details, demographic attributes, military status, birth dates, ages, and possible residential addresses. None are retained. Only name and coarse city/state are prepared into `organizationSourceCandidates`, a server-only matching collection denied to clients by Firestore rules. Descriptions, contact fields, streets, demographics, and dates of birth are discarded.

For home-based records, street address, precise coordinates, postal code, and phone are removed. Other Isle of Wight records retain public business location fields for later map use. Provenance and source identifiers remain attached.

## Prepare

```bash
python3 apps/functions/scripts/prepare-organization-seeds.py \
  --companies "/path/IOW_Companies.csv" \
  --home "/path/IOW_Home-based_Businesses.csv" \
  --targeting "/path/Exchange Targeting List.xlsx" \
  --output-dir data/seed/prepared
```

Current prepared output contains 5,128 Isle of Wight organization records, including 1,591 home-based classifications, plus 3,564 restricted targeting candidates. Prepared JSONL is deterministic and can be reviewed before import.

## Import

Authenticate the Firebase Admin SDK, then run:

```bash
npm run seed:import --workspace functions -- \
  --organizations ../../data/seed/prepared/isle-of-wight-organizations.jsonl \
  --targeting ../../data/seed/prepared/exchange-targeting-restricted.jsonl \
  --batch-id iow-2026-07-17
```

Add `--dry-run` to validate without writing. Results report created, updated, skipped, duplicate, and invalid counts. Stable document IDs and merge writes make reruns idempotent. The fixture is `apps/functions/test-fixtures/organization-seed.jsonl`; a human-editable template is `docs/templates/isle-of-wight-organization-import.csv`.

## Search and correction

Seed rows store normalized names and search tokens. Authenticated searches query local organizations and restricted candidates, call USAspending from the server, score likely matches, and merge duplicate display results. Unclaimed profiles are labeled as such. Administrative corrections should update the organization document while preserving `sources`, `sourceIds`, `importBatchId`, and timestamps.

USAspending is queried server-side through `POST /api/v2/autocomplete/recipient/`; the browser never calls the external API directly.
