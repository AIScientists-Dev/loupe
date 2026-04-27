"""Onboarding endpoints — v3.

Single profile per backend (single-user MVP). When auth lands, key by user.
Frontend gates first-visit on GET returning 200 vs 404 — once a profile
exists, the modal is suppressed; settings dialog re-POSTs to update.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.models import OnboardingProfile, OnboardingRequest
from app.services.orchestrator import Orchestrator

router = APIRouter(prefix="/v1/onboarding", tags=["onboarding"])


def _orch() -> Orchestrator:
    from app.main import get_orchestrator
    return get_orchestrator()


@router.get("", response_model=OnboardingProfile)
def get_onboarding(orch: Orchestrator = Depends(_orch)) -> OnboardingProfile:
    profile = orch.get_onboarding()
    if profile is None:
        raise HTTPException(404, detail={
            "code": "onboarding_pending",
            "message": "Onboarding has not been completed yet",
        })
    return profile


@router.post("", response_model=OnboardingProfile)
def post_onboarding(
    req: OnboardingRequest,
    orch: Orchestrator = Depends(_orch),
) -> OnboardingProfile:
    """Idempotent on `name`. First-time submission seeds one folder per
    default_venue; subsequent calls only update the profile (folders the
    user may have renamed/deleted aren't recreated)."""
    return orch.submit_onboarding(req)
