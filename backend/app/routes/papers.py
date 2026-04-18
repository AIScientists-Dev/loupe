"""Paper endpoints — upload, status, SSE, findings, review."""
from __future__ import annotations

import asyncio
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse

from app.models import (
    LocalizeStatus,
    Paper,
    PaperStatusResponse,
    PaperSummary,
    PIPELINE_ORDER,
)
from app.services.events import bus, format_sse
from app.services.orchestrator import Orchestrator

router = APIRouter(prefix="/v1/papers", tags=["papers"])


def _orch() -> Orchestrator:
    from app.main import get_orchestrator
    return get_orchestrator()


# -- CRUD ---------------------------------------------------------------------

@router.post("", response_model=Paper)
async def create_paper(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    orch: Orchestrator = Depends(_orch),
):
    if file.content_type not in ("application/pdf", "application/octet-stream", None):
        raise HTTPException(400, detail={"code": "pdf_unreadable", "message": "Only PDF uploads are supported"})
    raw = await file.read()
    if not raw:
        raise HTTPException(400, detail={"code": "pdf_unreadable", "message": "Uploaded PDF is empty"})

    paper = orch.create_paper(file.filename or "paper.pdf", raw)
    background.add_task(orch.run_pipeline_task, paper.paper_id)
    return paper


@router.get("", response_model=List[PaperSummary])
def list_papers(orch: Orchestrator = Depends(_orch)):
    return orch.list_papers()


@router.get("/{paper_id}", response_model=Paper)
def get_paper(paper_id: str, orch: Orchestrator = Depends(_orch)):
    paper = orch.get_paper(paper_id)
    if not paper:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    return paper


@router.delete("/{paper_id}", status_code=204)
def delete_paper(paper_id: str, orch: Orchestrator = Depends(_orch)):
    if not orch.delete_paper(paper_id):
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    return Response(status_code=204)


# -- status -------------------------------------------------------------------

@router.get("/{paper_id}/status", response_model=PaperStatusResponse)
def get_status(paper_id: str, orch: Orchestrator = Depends(_orch)):
    paper = orch.get_paper(paper_id)
    if not paper:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    active = [f for f in paper.findings if not f.soft_deleted]
    localize_pending = sum(1 for f in active if f.localize_status == LocalizeStatus.pending)
    return PaperStatusResponse(
        status=paper.status,
        step=paper.step,
        step_index=paper.step_index,
        total_steps=len(PIPELINE_ORDER),
        error_code=paper.error_code,
        error_message=paper.error_message,
        finding_count=len(active),
        localize_pending=localize_pending,
    )


# -- PDF binary ---------------------------------------------------------------

@router.get("/{paper_id}/pdf")
def serve_pdf(paper_id: str, orch: Orchestrator = Depends(_orch)):
    pdf_bytes = orch.store.load_pdf(paper_id)
    if not pdf_bytes:
        raise HTTPException(404, detail={"code": "not_found", "message": "PDF not found"})
    return Response(content=pdf_bytes, media_type="application/pdf")


# -- SSE events ---------------------------------------------------------------

@router.get("/{paper_id}/events")
async def stream_events(paper_id: str, orch: Orchestrator = Depends(_orch)):
    paper = orch.get_paper(paper_id)
    if not paper:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})

    async def event_generator():
        queue = bus.subscribe(paper_id)
        try:
            yield format_sse("hello", {
                "paper_id": paper_id,
                "status": paper.status.value,
                "step": paper.step.value,
                "step_index": paper.step_index,
            })
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield b": ping\n\n"
                    continue
                yield format_sse(payload["event"], payload["data"])
                if payload["event"] in ("pipeline.done", "step.failed"):
                    # Drain any late events for 1s, then close.
                    try:
                        late = await asyncio.wait_for(queue.get(), timeout=1.0)
                        yield format_sse(late["event"], late["data"])
                    except asyncio.TimeoutError:
                        break
        finally:
            bus.unsubscribe(paper_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
