"""ProofAgent API entrypoint."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.routes.papers import router as papers_router
from app.services.llm_client import LLMClient
from app.services.mineru_client import MinerUClient
from app.services.orchestrator import Orchestrator
from app.services.storage import FileStore
from app.services.vision_client import VisionClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="ProofAgent API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# -- singletons ---------------------------------------------------------------

_store = FileStore()
_llm = LLMClient()
_mineru = MinerUClient()
_vision = VisionClient()
_orchestrator = Orchestrator(_store, _llm, _mineru, _vision)


def get_orchestrator() -> Orchestrator:
    return _orchestrator


# -- error envelope -----------------------------------------------------------

def _envelope(code: str, message: str, detail=None) -> dict:
    body = {"code": code, "message": message}
    if detail is not None:
        body["detail"] = detail
    return {"error": body}


@app.exception_handler(StarletteHTTPException)
async def http_exc_handler(_req: Request, exc: StarletteHTTPException):
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail and "message" in detail:
        code = detail["code"]
        message = detail["message"]
        extra = detail.get("detail")
    else:
        code = {400: "bad_request", 404: "not_found", 405: "method_not_allowed"}.get(
            exc.status_code, "http_error"
        )
        message = str(detail) if detail else code
        extra = None
    return JSONResponse(status_code=exc.status_code, content=_envelope(code, message, extra))


@app.exception_handler(RequestValidationError)
async def validation_exc_handler(_req: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content=_envelope("validation_error", "Request validation failed", exc.errors()),
    )


@app.exception_handler(Exception)
async def generic_exc_handler(_req: Request, exc: Exception):
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(
        status_code=500,
        content=_envelope("internal", "Internal server error"),
    )


# -- routes -------------------------------------------------------------------

app.include_router(papers_router)


@app.get("/source/pricing.py")
def source_pricing() -> Response:
    """Serve the pricing formula raw so users can audit every number."""
    from pathlib import Path
    p = Path(__file__).parent / "services" / "pricing.py"
    return Response(content=p.read_text(encoding="utf-8"), media_type="text/x-python; charset=utf-8")


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "version": "2.0.0",
        "mineru_configured": bool(settings.mineru_api_url),
        "anthropic_configured": bool(settings.anthropic_api_key),
    }
