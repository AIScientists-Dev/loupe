"""Paper endpoints — upload, status, SSE, findings, review."""
from __future__ import annotations

import asyncio
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse

from app.models import (
    DecideRequest,
    Finding,
    InvestigateRequest,
    LocalizeStatus,
    Paper,
    PaperStatusResponse,
    PaperSummary,
    PIPELINE_ORDER,
    ReviewDraft,
    ReviewPatchRequest,
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


# -- localize -----------------------------------------------------------------

@router.post("/{paper_id}/findings/{finding_id}/localize", response_model=Finding)
async def localize_finding_route(
    paper_id: str,
    finding_id: str,
    orch: Orchestrator = Depends(_orch),
):
    result = await orch.localize_one(paper_id, finding_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper or finding not found"})
    return result


# -- decide / investigate -----------------------------------------------------

@router.post("/{paper_id}/findings/{finding_id}/decide", response_model=Finding)
async def decide_finding_route(
    paper_id: str,
    finding_id: str,
    req: DecideRequest,
    orch: Orchestrator = Depends(_orch),
):
    result = await orch.decide_finding(paper_id, finding_id, req.decision, req.note)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper or finding not found"})
    return result


@router.post("/{paper_id}/findings/{finding_id}/investigate", response_model=Finding)
async def investigate_finding_route(
    paper_id: str,
    finding_id: str,
    req: InvestigateRequest,
    orch: Orchestrator = Depends(_orch),
):
    if not (req.message or "").strip():
        raise HTTPException(400, detail={"code": "validation_error", "message": "message is required"})
    result = await orch.investigate_finding(paper_id, finding_id, req.message)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper or finding not found"})
    return result


# -- review draft -------------------------------------------------------------

@router.post("/{paper_id}/review/generate", response_model=ReviewDraft)
async def generate_review_route(
    paper_id: str,
    orch: Orchestrator = Depends(_orch),
):
    result = await orch.generate_review(paper_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    return result


@router.get("/{paper_id}/review/{draft_id}", response_model=ReviewDraft)
def get_review_route(
    paper_id: str,
    draft_id: str,
    orch: Orchestrator = Depends(_orch),
):
    result = orch.get_review(paper_id, draft_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Draft not found"})
    return result


@router.patch("/{paper_id}/review/{draft_id}", response_model=ReviewDraft)
async def patch_review_route(
    paper_id: str,
    draft_id: str,
    req: ReviewPatchRequest,
    orch: Orchestrator = Depends(_orch),
):
    result = await orch.patch_review(paper_id, draft_id, req.markdown)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Draft not found"})
    return result


@router.get("/{paper_id}/review/{draft_id}/export")
def export_review_route(
    paper_id: str,
    draft_id: str,
    format: str = "md",
    orch: Orchestrator = Depends(_orch),
):
    draft = orch.get_review(paper_id, draft_id)
    if draft is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Draft not found"})

    if format == "md":
        return Response(
            content=draft.markdown,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="review-{draft_id[:8]}.md"'},
        )
    if format == "pdf":
        pdf_bytes = _render_markdown_pdf(draft.markdown)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="review-{draft_id[:8]}.pdf"'},
        )
    raise HTTPException(400, detail={"code": "validation_error", "message": "format must be 'md' or 'pdf'"})


def _render_markdown_pdf(md: str) -> bytes:
    """Render markdown → HTML → PDF using PyMuPDF Story + DocumentWriter.

    Stays inside the existing PyMuPDF dep so the backend installs cleanly via
    pip alone (no brew/apt-get for pango/cairo/weasyprint).
    """
    import io
    import fitz  # PyMuPDF
    import markdown as md_lib

    html_body = md_lib.markdown(md, extensions=["fenced_code", "tables"])
    html = "<body>" + html_body + "</body>"
    css = (
        "body { font-family: serif; font-size: 11pt; line-height: 1.45; color: #111; }"
        "h1,h2,h3 { font-family: sans-serif; margin: 1.2em 0 0.4em; color: #000; }"
        "h1 { font-size: 18pt; } h2 { font-size: 14pt; } h3 { font-size: 12pt; }"
        "p { margin: 0.35em 0; }"
        "code { font-family: monospace; background: #f0f0f0; padding: 1px 3px; }"
        "pre { font-family: monospace; background: #f6f6f6; padding: 8px; }"
        "blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 10pt; color: #555; }"
        "ul, ol { margin: 0.35em 0 0.35em 1.5em; }"
    )

    page_rect = fitz.paper_rect("letter")
    content_rect = page_rect + (54, 54, -54, -54)  # 0.75" margins

    buf = io.BytesIO()
    writer = fitz.DocumentWriter(buf)

    def where(_req_rect, _filled):
        return content_rect

    # PyMuPDF Story: render HTML across paginated output.
    story = fitz.Story(html=html, user_css=css)
    more = 1
    while more:
        dev = writer.begin_page(page_rect)
        more, _ = story.place(content_rect)
        story.draw(dev)
        writer.end_page()
    writer.close()
    return buf.getvalue()
