"""Paper endpoints — upload, analysis, findings, investigations, draft reviews."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse

from app.models import (
    DraftReviewRequest,
    DraftReviewResponse,
    Exchange,
    ExchangeDecisionRequest,
    Finding,
    FindingDecisionRequest,
    InvestigateRequest,
    LLMModel,
    PaperDetailResponse,
    PaperSummaryResponse,
    PipelineState,
    RerunRequest,
)
from app.services.orchestrator import PaperOrchestrator

router = APIRouter(prefix="/v1/papers", tags=["papers"])


def _orch() -> PaperOrchestrator:
    from app.main import get_orchestrator
    return get_orchestrator()


def _user(x_user_id: str = Header(default="default")) -> str:
    return x_user_id


# -- CRUD ---------------------------------------------------------------------

@router.post("", response_model=PaperSummaryResponse)
async def create_paper(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    model: str = Form(default="claude-opus-4-6"),
    user_id: str = Depends(_user),
    orch: PaperOrchestrator = Depends(_orch),
):
    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(400, "Only PDF uploads are supported")
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Uploaded PDF is empty")

    try:
        llm_model = LLMModel(model)
    except ValueError:
        llm_model = LLMModel.claude_opus

    paper = orch.create_paper(user_id, file.filename or "paper.pdf", raw, llm_model)
    background.add_task(orch.run_analysis, paper.paper_id, user_id)

    findings = paper.findings
    reviewed = sum(1 for f in findings if f.decision is not None)
    return PaperSummaryResponse(
        paper_id=paper.paper_id,
        filename=paper.filename,
        title=paper.title,
        status=paper.status,
        finding_count=len(findings),
        reviewed_count=reviewed,
        created_at=paper.created_at,
    )


@router.get("", response_model=List[PaperSummaryResponse])
def list_papers(user_id: str = Depends(_user), orch: PaperOrchestrator = Depends(_orch)):
    return orch.list_papers(user_id)


@router.get("/{paper_id}", response_model=PaperDetailResponse)
def get_paper(paper_id: str, orch: PaperOrchestrator = Depends(_orch)):
    detail = orch.get_paper_detail(paper_id)
    if not detail:
        raise HTTPException(404, "Paper not found")
    return detail


@router.delete("/{paper_id}")
def delete_paper(paper_id: str, orch: PaperOrchestrator = Depends(_orch)):
    if not orch.delete_paper(paper_id):
        raise HTTPException(404, "Paper not found")
    return {"ok": True}


@router.get("/{paper_id}/pdf")
def serve_pdf(paper_id: str, orch: PaperOrchestrator = Depends(_orch)):
    pdf_bytes = orch.store.load_pdf(paper_id)
    if not pdf_bytes:
        raise HTTPException(404, "PDF not found")
    return Response(content=pdf_bytes, media_type="application/pdf")


@router.get("/{paper_id}/status", response_model=PipelineState)
def get_status(paper_id: str, orch: PaperOrchestrator = Depends(_orch)):
    paper = orch.get_paper(paper_id)
    if not paper:
        raise HTTPException(404, "Paper not found")
    return paper.pipeline_state


# -- rerun ---------------------------------------------------------------------

@router.post("/{paper_id}/rerun", response_model=PaperDetailResponse)
async def rerun_paper(
    paper_id: str,
    req: RerunRequest,
    user_id: str = Depends(_user),
    orch: PaperOrchestrator = Depends(_orch),
):
    result = await orch.rerun_analysis(paper_id, user_id, req.focus_areas)
    if not result:
        raise HTTPException(404, "Paper not found")
    return result


# -- finding verdicts ----------------------------------------------------------

@router.post("/{paper_id}/findings/{finding_id}/decide", response_model=Finding)
async def decide_finding(
    paper_id: str,
    finding_id: str,
    req: FindingDecisionRequest,
    user_id: str = Depends(_user),
    orch: PaperOrchestrator = Depends(_orch),
):
    result = await orch.decide_finding(paper_id, finding_id, req, user_id)
    if not result:
        raise HTTPException(404, "Finding not found")
    return result


@router.post("/{paper_id}/findings/{finding_id}/investigate", response_model=Exchange)
async def investigate_finding(
    paper_id: str,
    finding_id: str,
    req: InvestigateRequest,
    user_id: str = Depends(_user),
    orch: PaperOrchestrator = Depends(_orch),
):
    result = await orch.investigate_finding(paper_id, finding_id, req, user_id)
    if not result:
        raise HTTPException(404, "Finding not found")
    return result


# -- exchange verdicts ---------------------------------------------------------

@router.post("/{paper_id}/exchanges/{exchange_id}/decide", response_model=Exchange)
async def decide_exchange(
    paper_id: str,
    exchange_id: str,
    req: ExchangeDecisionRequest,
    user_id: str = Depends(_user),
    orch: PaperOrchestrator = Depends(_orch),
):
    result = await orch.decide_exchange(paper_id, exchange_id, req, user_id)
    if not result:
        raise HTTPException(404, "Exchange not found")
    return result


@router.post("/{paper_id}/exchanges/{exchange_id}/investigate", response_model=Exchange)
async def investigate_exchange(
    paper_id: str,
    exchange_id: str,
    req: InvestigateRequest,
    user_id: str = Depends(_user),
    orch: PaperOrchestrator = Depends(_orch),
):
    result = await orch.investigate_exchange(paper_id, exchange_id, req, user_id)
    if not result:
        raise HTTPException(404, "Exchange not found")
    return result


# -- draft review --------------------------------------------------------------

@router.post("/{paper_id}/draft-review", response_model=DraftReviewResponse)
async def generate_draft_review(
    paper_id: str,
    req: DraftReviewRequest,
    user_id: str = Depends(_user),
    orch: PaperOrchestrator = Depends(_orch),
):
    result = await orch.generate_draft_review(paper_id, req, user_id)
    if not result:
        raise HTTPException(404, "Paper not found")
    return result


@router.post("/{paper_id}/draft-review/pdf")
async def download_draft_review_pdf(
    paper_id: str,
    req: DraftReviewRequest,
    user_id: str = Depends(_user),
    orch: PaperOrchestrator = Depends(_orch),
):
    result = await orch.generate_draft_review(paper_id, req, user_id)
    if not result:
        raise HTTPException(404, "Paper not found")
    pdf_bytes = orch.render_review_pdf(result.review_markdown)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=review.pdf"},
    )
