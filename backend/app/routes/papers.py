"""Paper endpoints — upload, status, SSE, findings, review."""
from __future__ import annotations

import asyncio
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse

from app.models import (
    CostReport,
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


@router.get("/{paper_id}/pdf-annotated")
def serve_pdf_annotated(paper_id: str, orch: Orchestrator = Depends(_orch)):
    """Original PDF + PDF annotations (red rectangles + popup notes) for every
    KEPT finding. Uses native PDF annotation objects so the paper's own
    existing annotations (if any) are preserved, and the new ones are
    toggleable/interactive in any reader."""
    pdf_bytes = orch.store.load_pdf(paper_id)
    paper = orch.get_paper(paper_id)
    if not pdf_bytes or not paper:
        raise HTTPException(404, detail={"code": "not_found", "message": "PDF not found"})

    import io
    import fitz  # PyMuPDF

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        added = 0
        for f in paper.findings:
            if f.soft_deleted:
                continue
            bbox = f.bbox
            if bbox is None:
                continue
            page_idx = bbox.page - 1
            if page_idx < 0 or page_idx >= doc.page_count:
                continue
            page = doc.load_page(page_idx)
            rect = fitz.Rect(
                bbox.x, bbox.y,
                bbox.x + bbox.width, bbox.y + bbox.height,
            )
            annot = page.add_rect_annot(rect)
            # red stroke, no fill, thicker border
            annot.set_colors(stroke=(0.86, 0.15, 0.15))
            annot.set_border(width=1.6)
            annot.set_opacity(0.9)
            # popup/title shows in-reader on hover/click
            annot.set_info(
                title=f"Loupe — {f.issue_type} ({f.severity})",
                content=f"{f.description}\n\nEvidence: {f.evidence_quote[:400]}",
            )
            annot.update()
            added += 1

        buf = io.BytesIO()
        # incremental=False so we get a fresh PDF with the annotation tree included
        doc.save(buf, garbage=4, deflate=True)
        return Response(
            content=buf.getvalue(),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{paper.filename or "paper"}_annotated.pdf"',
                "X-Loupe-Annotations-Added": str(added),
            },
        )
    finally:
        doc.close()


# -- page thumbnail (for the top thumbnail strip) ----------------------------

@router.get("/{paper_id}/pages/{page_number}/thumb.png")
def page_thumbnail(
    paper_id: str,
    page_number: int,
    orch: Orchestrator = Depends(_orch),
):
    png_bytes = _render_thumb(orch.store, paper_id, page_number)
    if png_bytes is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Thumbnail not available"})
    return Response(content=png_bytes, media_type="image/png", headers={
        "Cache-Control": "public, max-age=3600",
    })


_THUMB_DPI = 72  # low-DPI is plenty for a sidebar thumb


def _render_thumb(store, paper_id: str, page_number: int) -> bytes | None:
    """Lazy-render + cache a per-page thumbnail. Fallback if cache missing."""
    from pathlib import Path
    import fitz
    cache_dir = Path(store.base) / "thumbs" / paper_id
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{page_number:04d}.png"
    if cache_path.exists():
        return cache_path.read_bytes()
    pdf_bytes = store.load_pdf(paper_id)
    if not pdf_bytes:
        return None
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            if page_number < 1 or page_number > doc.page_count:
                return None
            page = doc.load_page(page_number - 1)
            pix = page.get_pixmap(matrix=fitz.Matrix(_THUMB_DPI / 72.0, _THUMB_DPI / 72.0), alpha=False)
            png = pix.tobytes("png")
        cache_path.write_bytes(png)
        return png
    except Exception:
        return None


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


# -- stop / resume / skip / cost --------------------------------------------

@router.post("/{paper_id}/stop", response_model=Paper)
def stop_run(paper_id: str, orch: Orchestrator = Depends(_orch)):
    result = orch.stop(paper_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    return result


@router.post("/{paper_id}/resume", response_model=Paper)
def resume_run(
    paper_id: str,
    background: BackgroundTasks,
    orch: Orchestrator = Depends(_orch),
):
    result = orch.resume(paper_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    # Kick the scheduler off the ASGI event loop.
    background.add_task(orch.run_pipeline_task, paper_id)
    return result


@router.post("/{paper_id}/segments/{segment_id}/skip", response_model=Paper)
def skip_segment(paper_id: str, segment_id: str, orch: Orchestrator = Depends(_orch)):
    result = orch.skip_segment(paper_id, segment_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper or segment not found"})
    return result


@router.post("/{paper_id}/segments/{segment_id}/include", response_model=Paper)
def include_segment(paper_id: str, segment_id: str, orch: Orchestrator = Depends(_orch)):
    result = orch.include_segment(paper_id, segment_id)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper or segment not found"})
    return result


@router.get("/{paper_id}/cost", response_model=CostReport)
def get_cost(paper_id: str, orch: Orchestrator = Depends(_orch)):
    report = orch.build_cost_report(paper_id)
    if report is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "Paper not found"})
    return report


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
