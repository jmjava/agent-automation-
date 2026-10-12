#!/usr/bin/env python3
"""Seed an Obsidian vault with the agent-automation task lists.

Merge-safe by design:
- ``AI Memory/Agent Queue.md``: created if missing; otherwise only queue lines
  whose canonical text is not already present (checked or unchecked) are
  appended under a dated heading.
- ``AI Memory/Projects/agent-automation/Project State.md``: copied only when
  missing. An existing note is left alone; use the MCP ``update_project_state``
  tool or pass ``--force-project-state``.
- ``TODO/*.md``: copied when missing; existing notes are never overwritten.

Standard library only. Never touches files outside ``--vault``.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import shutil
import sys
from pathlib import Path

REPO_VAULT = Path(__file__).resolve().parent.parent / "vault"
PROJECT_SLUG = "agent-automation"

_CHECKBOX_RE = re.compile(r"^[-*+][ \t]+\[([ xX])\][ \t]+(.*\S)[ \t]*$")
_TRAILING_META_RE = re.compile(r"(?:\s+#\S+|\s+\[repo::[^\]]+\])$")


def canonical(text: str) -> str:
    text = " ".join(text.split()).casefold()
    while True:
        stripped = _TRAILING_META_RE.sub("", text)
        if stripped == text:
            return text
        text = stripped


def queue_items(markdown: str, *, open_only: bool) -> list[str]:
    items: list[str] = []
    for line in markdown.splitlines():
        match = _CHECKBOX_RE.match(line)
        if match is None:
            continue
        if open_only and match.group(1) != " ":
            continue
        items.append(match.group(2).strip())
    return items


def seed_queue(src: Path, dest: Path, *, dry_run: bool) -> str:
    if not dest.exists():
        if not dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dest)
        return f"created {dest}"
    existing = {canonical(item) for item in queue_items(dest.read_text("utf-8"), open_only=False)}
    missing = [
        item
        for item in queue_items(src.read_text("utf-8"), open_only=True)
        if canonical(item) not in existing
    ]
    if not missing:
        return f"unchanged {dest} (all queue lines already present)"
    if not dry_run:
        today = dt.date.today().isoformat()
        block = ["", f"## agent-automation (seeded {today})", ""]
        block += [f"- [ ] {item}" for item in missing]
        text = dest.read_text("utf-8")
        separator = "" if text.endswith("\n") or not text else "\n"
        with dest.open("a", encoding="utf-8") as handle:
            handle.write(separator + "\n".join(block) + "\n")
    return f"appended {len(missing)} queue lines to {dest}"


def seed_file(src: Path, dest: Path, *, dry_run: bool, force: bool = False) -> str:
    existed = dest.exists()
    if existed and not force:
        return f"skipped {dest} (exists)"
    if not dry_run:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
    return f"{'replaced' if existed else 'created'} {dest}"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--vault", default=os.environ.get("OBSIDIAN_VAULT_PATH"), help="vault root (default: $OBSIDIAN_VAULT_PATH)")
    parser.add_argument("--memory-root", default=os.environ.get("OBSIDIAN_MEMORY_ROOT", "AI Memory"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force-project-state", action="store_true", help="overwrite an existing Project State.md")
    args = parser.parse_args(argv)

    if not args.vault:
        parser.error("--vault or OBSIDIAN_VAULT_PATH is required")
    vault = Path(args.vault).expanduser().resolve()
    if not vault.is_dir():
        print(f"error: vault directory does not exist: {vault}", file=sys.stderr)
        return 2

    src_memory = REPO_VAULT / "AI Memory"
    dest_memory = vault / args.memory_root
    results = [
        seed_queue(src_memory / "Agent Queue.md", dest_memory / "Agent Queue.md", dry_run=args.dry_run),
        seed_file(
            src_memory / "Projects" / PROJECT_SLUG / "Project State.md",
            dest_memory / "Projects" / PROJECT_SLUG / "Project State.md",
            dry_run=args.dry_run,
            force=args.force_project_state,
        ),
    ]
    for note in sorted((REPO_VAULT / "TODO").glob("*.md")):
        results.append(seed_file(note, vault / "TODO" / note.name, dry_run=args.dry_run))

    prefix = "[dry-run] " if args.dry_run else ""
    for line in results:
        print(prefix + line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
