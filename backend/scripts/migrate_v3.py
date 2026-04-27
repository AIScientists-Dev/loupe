"""Backfill v3 fields on existing data + seed folders.

Idempotent. Safe to run after migrate_v2 has already touched the same files.

Backfill rules:
  - paper.flag      → null (if missing)
  - paper.folder    → null where it equals "Inbox" (Inbox is gone in v3)
  - data/folders.json → ensured present (FolderStore self-seeds on first
    init, but we touch it here so the migration is observable)

Usage:
    python -m scripts.migrate_v3 --dry-run
    python -m scripts.migrate_v3
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Tuple


DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def _backfill(paper: Dict[str, Any]) -> List[str]:
    notes: List[str] = []

    if "flag" not in paper:
        paper["flag"] = None
        notes.append("paper.flag → null (added)")
    elif paper.get("flag") not in (None, "promising", "rejected"):
        # Defensive: clear unrecognized values rather than fail-fast on read.
        old = paper["flag"]
        paper["flag"] = None
        notes.append(f"paper.flag → null (was {old!r}, invalid)")

    folder = paper.get("folder")
    if folder == "Inbox":
        paper["folder"] = None
        notes.append("paper.folder Inbox → null")

    return notes


def _atomic_write(path: Path, data: Dict[str, Any]) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-migrate3-", suffix=".json")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def migrate_papers(papers_dir: Path, *, dry_run: bool) -> Tuple[int, int]:
    files = sorted(papers_dir.glob("*.json"))
    touched = 0
    for path in files:
        try:
            paper = json.loads(path.read_text())
        except Exception as e:
            print(f"  ERROR  {path.name}: {e}", file=sys.stderr)
            continue

        notes = _backfill(paper)
        if not notes:
            print(f"  ok      {path.name}  (already up to date)")
            continue

        touched += 1
        verb = "would update" if dry_run else "updated"
        print(f"  {verb:<13} {path.name}")
        for n in notes:
            print(f"      - {n}")
        if not dry_run:
            _atomic_write(path, paper)

    return touched, len(files)


def ensure_folders_seed(data_dir: Path, *, dry_run: bool) -> None:
    folders_path = data_dir / "folders.json"
    if folders_path.exists():
        print(f"  folders.json present at {folders_path}")
        return
    if dry_run:
        print(f"  would seed {folders_path}")
        return
    # Importing FolderStore self-seeds on first construction.
    from app.services.folder_store import FolderStore  # type: ignore
    FolderStore(data_dir)
    print(f"  seeded {folders_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="v3 paper-state backfill + folder seed")
    parser.add_argument("--dry-run", action="store_true", help="Print planned changes without writing.")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR, help=f"data root (default: {DEFAULT_DATA_DIR})")
    args = parser.parse_args()

    if not args.data_dir.exists():
        print(f"data dir not found: {args.data_dir}", file=sys.stderr)
        return 1

    papers_dir = args.data_dir / "papers"
    print(f"Scanning {papers_dir}...")
    touched, scanned = migrate_papers(papers_dir, dry_run=args.dry_run)
    verb = "would touch" if args.dry_run else "touched"
    print(f"\n{verb} {touched}/{scanned} paper file(s)")

    print(f"\nFolder seed:")
    ensure_folders_seed(args.data_dir, dry_run=args.dry_run)

    return 0


if __name__ == "__main__":
    sys.exit(main())
