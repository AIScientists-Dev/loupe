"""Step 3 — verify each proof block; emit Findings for detected issues.

Stub until M3. No-op for M1.
"""
from __future__ import annotations

from app.models import Paper


async def run_verify_proofs(paper: Paper, llm, bus=None) -> None:
    # M3 will fill this in.
    paper.findings = []
