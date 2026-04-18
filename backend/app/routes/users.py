"""User profile endpoints — onboarding, focus areas, learned rules, templates."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.models import (
    LearnedRule,
    OnboardingRequest,
    UpdateProfileRequest,
    UserProfile,
)
from app.services.storage import FileStore

router = APIRouter(prefix="/v1/users", tags=["users"])


def _store() -> FileStore:
    from app.main import get_store
    return get_store()


@router.post("", response_model=UserProfile)
def create_user(req: OnboardingRequest, store: FileStore = Depends(_store)):
    profile = UserProfile(
        display_name=req.display_name,
        focus_areas=req.focus_areas,
        onboarding_completed=True,
    )
    store.save_profile(profile)
    return profile


@router.get("/{user_id}", response_model=UserProfile)
def get_user(user_id: str, store: FileStore = Depends(_store)):
    profile = store.load_profile(user_id)
    if not profile:
        raise HTTPException(404, "User not found")
    return profile


@router.patch("/{user_id}", response_model=UserProfile)
def update_user(user_id: str, req: UpdateProfileRequest, store: FileStore = Depends(_store)):
    profile = store.load_profile(user_id)
    if not profile:
        raise HTTPException(404, "User not found")
    if req.display_name is not None:
        profile.display_name = req.display_name
    if req.focus_areas is not None:
        profile.focus_areas = req.focus_areas
    store.save_profile(profile)
    return profile


@router.delete("/{user_id}/learned-rules/{rule_id}")
def delete_rule(user_id: str, rule_id: str, store: FileStore = Depends(_store)):
    profile = store.load_profile(user_id)
    if not profile:
        raise HTTPException(404, "User not found")
    profile.learned_rules = [r for r in profile.learned_rules if r.rule_id != rule_id]
    store.save_profile(profile)
    return {"ok": True}


@router.put("/{user_id}/review-templates/{venue}")
def save_template(user_id: str, venue: str, body: dict, store: FileStore = Depends(_store)):
    profile = store.load_profile(user_id)
    if not profile:
        raise HTTPException(404, "User not found")
    profile.custom_review_templates[venue] = body
    store.save_profile(profile)
    return {"ok": True}


@router.put("/{user_id}/style-prompts/{style}")
def save_style_prompt(user_id: str, style: str, body: dict, store: FileStore = Depends(_store)):
    profile = store.load_profile(user_id)
    if not profile:
        raise HTTPException(404, "User not found")
    profile.custom_style_prompts[style] = body.get("prompt", "")
    store.save_profile(profile)
    return {"ok": True}


@router.put("/{user_id}/tone-prompts/{tone}")
def save_tone_prompt(user_id: str, tone: str, body: dict, store: FileStore = Depends(_store)):
    profile = store.load_profile(user_id)
    if not profile:
        raise HTTPException(404, "User not found")
    profile.custom_tone_prompts[tone] = body.get("prompt", "")
    store.save_profile(profile)
    return {"ok": True}
