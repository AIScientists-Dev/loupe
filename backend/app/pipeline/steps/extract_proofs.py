"""Step 2 — extract theorem/lemma/proposition/proof blocks from paper markdown.

Stub until M2. For M1 this is a no-op so the pipeline can complete.
"""
from __future__ import annotations

from app.models import Paper


async def run_extract_proofs(paper: Paper, llm, bus=None) -> None:
    # M2 will fill this in. For now, no-op — pipeline still completes.
    paper.proof_blocks = []
