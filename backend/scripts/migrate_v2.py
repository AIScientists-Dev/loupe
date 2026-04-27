"""Backfill v2 review-flow fields on existing data/papers/*.json.

Idempotent: re-runs are no-ops once a paper has all v2 fields. Safe to run
in `--dry-run` first to inspect planned changes; default mode writes
in-place using a tmp-file rename so a crash mid-write can't truncate a
paper file.

Backfill rules:
  - findings[*].dimension       → "proof"     (existing pipeline only emitted proof findings)
  - paper.stage                 → "dived" if status == "ready" else "uploaded"
  - paper.folder                → "Inbox"
  - paper.venue_type            → "journal"
  - paper.dimension_scores      → []
  - paper.final_score           → null

Usage:
    python -m scripts.migrate_v2 --dry-run
    python -m scripts.migrate_v2
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Tuple


DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "papers"


def _backfill(paper: Dict[str, Any]) -> List[str]:
    """Mutate `paper` in place, return a list of human-readable change notes."""
    notes: List[str] = []

    # Findings: set dimension on any that lack it.
    findings = paper.get("findings") or []
    missing = [f for f in findings if "dimension" not in f or f.get("dimension") is None]
    if missing:
        for f in missing:
            f["dimension"] = "proof"
        notes.append(f"findings: backfilled dimension=proof on {len(missing)}/{len(findings)}")

    # Paper-level fields.
    if "venue_type" not in paper or paper.get("venue_type") is None:
        paper["venue_type"] = "journal"
        notes.append("paper.venue_type → journal")
    if "folder" not in paper or paper.get("folder") in (None, ""):
        paper["folder"] = "Inbox"
        notes.append("paper.folder → Inbox")
    if "stage" not in paper or paper.get("stage") is None:
        paper["stage"] = "dived" if paper.get("status") == "ready" else "uploaded"
        notes.append(f"paper.stage → {paper['stage']}")
    if "dimension_scores" not in paper:
        paper["dimension_scores"] = []
        notes.append("paper.dimension_scores → []")
    if "final_score" not in paper:
        paper["final_score"] = None  # explicit null vs missing key
        # not a meaningful change — only note it if it was missing entirely
    if "venue_name" not in paper:
        paper["venue_name"] = None
    if "review_style" not in paper:
        paper["review_style"] = None
    if "triage" not in paper:
        paper["triage"] = None

    return notes


def _atomic_write(path: Path, data: Dict[str, Any]) -> None:
    """Write JSON to a temp file in the same directory then os.replace.

    Same pattern the FileStore uses (see services/storage.py): avoids
    partial writes if the process is killed mid-flush.
    """
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-migrate-", suffix=".json")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def migrate(data_dir: Path, *, dry_run: bool) -> Tuple[int, int]:
    """Walk data_dir and backfill each paper. Returns (touched, scanned)."""
    files = sorted(data_dir.glob("*.json"))
    touched = 0
    for path in files:
        try:
            paper = json.loads(path.read_text())
        except Exception as e:
            print(f"  ERROR  {path.name}: failed to read JSON: {e}", file=sys.stderr)
            continue

        notes = _backfill(paper)
        if not notes:
            print(f"  ok     {path.name}  (already up to date)")
            continue

        touched += 1
        action = "would update" if dry_run else "updated"
        print(f"  {action:<13} {path.name}")
        for n in notes:
            print(f"      - {n}")

        if not dry_run:
            _atomic_write(path, paper)

    return touched, len(files)


def main() -> int:
    parser = argparse.ArgumentParser(description="v2 paper-state backfill")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print planned changes without writing.")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR,
                        help=f"Override the papers directory (default: {DEFAULT_DATA_DIR})")
    args = parser.parse_args()

    if not args.data_dir.exists():
        print(f"data dir not found: {args.data_dir}", file=sys.stderr)
        return 1

    print(f"Scanning {args.data_dir}...")
    touched, scanned = migrate(args.data_dir, dry_run=args.dry_run)
    verb = "would touch" if args.dry_run else "touched"
    print(f"\n{verb} {touched}/{scanned} paper file(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
