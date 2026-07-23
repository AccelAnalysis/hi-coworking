from pathlib import Path


def extract_workflow_script(path: str) -> str:
    source = Path(path).read_text()
    raw = source.split("python3 - <<'PY'\n", 1)[1].split("\n          PY", 1)[0]
    return "\n".join(
        line[10:] if line.startswith("          ") else line
        for line in raw.splitlines()
    )


def apply_publication_diagnostic() -> None:
    script = extract_workflow_script(
        ".github/workflows/pr23-publication-diagnostic-patch.yml"
    )
    strict = '''def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: guarded replacement expected once, found {count}: {old[:100]!r}")
    path.write_text(text.replace(old, new, 1))'''
    idempotent = '''def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if path.name == "index.ts" and "exchange_getOrganizationPublicationDiagnostic" in new:
        if count == 2:
            path.write_text(text.replace(old, new))
            return
        if count == 0 and text.count(new) == 2:
            return
    if count != 1:
        raise SystemExit(f"{path}: guarded replacement expected once, found {count}: {old[:100]!r}")
    path.write_text(text.replace(old, new, 1))'''
    if strict not in script:
        raise SystemExit("Could not locate publication replacement helper")
    exec(compile(script.replace(strict, idempotent, 1), "publication-patch", "exec"))


def apply_server_contract() -> None:
    script = extract_workflow_script(
        ".github/workflows/pr23-server-contract-corrected.yml"
    )
    needle = '''        actorOrganizationId: input.actorOrganizationId,
        subjectOrganizationId: input.organizationId,
        mode: input.mode,'''
    replacement = '''        contractVersion: CONTRACT_VERSION,
        actorOrganizationId: input.actorOrganizationId,
        subjectOrganizationId: input.organizationId,
        mode: input.mode,'''
    if script.count(needle) != 2:
        raise SystemExit(
            f"Expected two directory perspective call patterns, found {script.count(needle)}"
        )
    exec(compile(script.replace(needle, replacement), "server-patch", "exec"))


if __name__ == "__main__":
    apply_publication_diagnostic()
    apply_server_contract()
