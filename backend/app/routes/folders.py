"""Folders endpoint — file-backed CRUD (v3).

Replaces the v2 static list. Folders live in `data/folders.json`; the
orchestrator owns the rename/delete cascade onto `paper.folder`.

Frontend contract (matches `/Users/.../V3_BACKEND_SPEC.md` §2):
  GET    /v1/folders          → List[Folder]
  POST   /v1/folders          {name, venue_type?}        → Folder | 409
  PATCH  /v1/folders/{name}   {name?, venue_type?}       → Folder | 404 | 409
  DELETE /v1/folders/{name}                              → 204 | 404 | 409 default
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.models import Folder, FolderCreateRequest, FolderPatchBodyRequest
from app.services.orchestrator import Orchestrator

router = APIRouter(prefix="/v1", tags=["folders"])


def _orch() -> Orchestrator:
    from app.main import get_orchestrator
    return get_orchestrator()


@router.get("/folders", response_model=List[Folder])
def list_folders(orch: Orchestrator = Depends(_orch)) -> List[Folder]:
    return orch.list_folders()


@router.post("/folders", response_model=Folder, status_code=201)
def create_folder(
    req: FolderCreateRequest,
    orch: Orchestrator = Depends(_orch),
) -> Folder:
    name = (req.name or "").strip()
    if not name:
        raise HTTPException(400, detail={"code": "invalid_name", "message": "Folder name cannot be empty"})
    folder = orch.create_folder(name, req.venue_type)
    if folder is None:
        raise HTTPException(409, detail={
            "code": "folder_exists",
            "message": f"A folder named {name!r} already exists",
        })
    return folder


@router.patch("/folders/{name}", response_model=Folder)
def patch_folder_row(
    name: str,
    req: FolderPatchBodyRequest,
    orch: Orchestrator = Depends(_orch),
) -> Folder:
    """Rename a folder, change its venue_type icon hint, or both. Rename
    cascades onto every `paper.folder == old_name`."""
    target_name = (req.name or "").strip() if req.name is not None else None

    # Apply rename first (drives the cascade), then venue_type tweak.
    if target_name and target_name != name:
        result = orch.rename_folder(name, target_name)
        if result is None:
            raise HTTPException(404, detail={"code": "not_found", "message": f"Folder {name!r} not found"})
        if result == "collision":
            raise HTTPException(409, detail={
                "code": "folder_exists",
                "message": f"A folder named {target_name!r} already exists",
            })
        # The folder's name has changed — apply subsequent venue_type by the new key.
        name = target_name

    if req.venue_type is not None:
        out = orch.update_folder_venue_type(name, req.venue_type)
        if out is None:
            raise HTTPException(404, detail={"code": "not_found", "message": f"Folder {name!r} not found"})
        return out

    # No-op patch (or only-rename path): return the current row.
    current = orch.folder_store.get(name)
    if current is None:
        raise HTTPException(404, detail={"code": "not_found", "message": f"Folder {name!r} not found"})
    return current


@router.delete("/folders/{name}", status_code=204)
def delete_folder_row(
    name: str,
    orch: Orchestrator = Depends(_orch),
):
    result = orch.delete_folder(name)
    if result is None:
        raise HTTPException(404, detail={"code": "not_found", "message": f"Folder {name!r} not found"})
    if result == "default":
        raise HTTPException(409, detail={
            "code": "folder_default",
            "message": f"Folder {name!r} is a default folder and cannot be deleted",
        })
    return Response(status_code=204)
