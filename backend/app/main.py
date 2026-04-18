from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.papers import router as papers_router
from app.routes.users import router as users_router
from app.services.llm_client import LLMClient
from app.services.mineru_client import MinerUClient
from app.services.orchestrator import PaperOrchestrator
from app.services.profile_learner import ProfileLearner
from app.services.review_generator import ReviewGenerator
from app.services.storage import FileStore

app = FastAPI(title="ProofAgent API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(papers_router)
app.include_router(users_router)

# -- singletons ---------------------------------------------------------------

_store = FileStore()
_llm = LLMClient()
_mineru = MinerUClient()
_learner = ProfileLearner(_llm)
_review_gen = ReviewGenerator(_llm)
_orchestrator = PaperOrchestrator(_store, _llm, _mineru, _learner, _review_gen)


def get_orchestrator() -> PaperOrchestrator:
    return _orchestrator


def get_store() -> FileStore:
    return _store


@app.get("/health")
def health() -> dict:
    return {"ok": True, "version": "1.0.0"}
