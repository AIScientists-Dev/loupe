"""Step 1: PARSE — Send PDF to MinerU, get structured blocks with bounding boxes."""
from __future__ import annotations

import logging

from app.models import Paper, PaperStatus, PipelineStep, UserProfile
from app.services.mineru_client import MinerUClient
from app.services.storage import FileStore

logger = logging.getLogger(__name__)


async def run_parse(paper: Paper, profile: UserProfile, mineru: MinerUClient, store: FileStore) -> Paper:
    pdf_bytes = store.load_pdf(paper.paper_id)
    if not pdf_bytes:
        raise RuntimeError(f"PDF not found for paper {paper.paper_id}")

    try:
        blocks = await mineru.parse_pdf(pdf_bytes, paper.filename)
    except Exception as exc:
        logger.warning("MinerU parse failed (%s), falling back to mock parser", exc)
        blocks = mineru._mock_parse(pdf_bytes)

    paper.parsed_blocks = blocks

    # Extract title from first heading block
    for b in blocks:
        if b.block_type == "heading":
            paper.title = b.content[:200]
            break

    paper.status = PaperStatus.parsing
    return paper
