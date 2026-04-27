# Loupe v3 backend spec — folders + flags + onboarding + batch

Frontend is implementing this contract now (against MSW for the new pieces). Backend builds in parallel; once each endpoint lands, frontend cuts over from mock to real with no UI change.

## 1. Data model deltas

### `Paper` — new field

```python
class PaperFlag(str, Enum):
    promising = "promising"
    rejected = "rejected"

class Paper(BaseModel):
    ...
    flag: Optional[PaperFlag] = None
```

Rules:
- A paper has at most one flag at a time. Setting `promising` clears `rejected` and vice versa.
- `flag` is orthogonal to `stage`: a paper can be `flag=promising` while still `stage=triaged`. Status folders OR-filter on both.

### `Folder` — explicit model (replaces hardcoded list)

```python
class Folder(BaseModel):
    name: str               # canonical key; user-visible. Case-sensitive.
    venue_type: Optional[VenueType] = None  # cosmetic icon hint, optional
    created_at: str
    is_default: bool = False  # cannot be deleted (e.g., "All")
```

Folders are stored on disk (e.g. `data/folders.json`). On first boot, seed from onboarding (see §3). The legacy hardcoded list (`["Inbox","Journal","Conference","Grant","Thesis"]`) goes away — all folders come from the store.

Rules:
- Folder rename: updates the folder row AND every `paper.folder` matching the old name.
- Folder delete: removes the folder row and clears `paper.folder` to `None` for matching papers (papers are NOT deleted — folder is an alias).
- "All" is a virtual folder, not stored; just a UI filter.

### `OnboardingProfile` — new

```python
class OnboardingProfile(BaseModel):
    name: str
    role: str                       # free text: "Editor", "Reviewer", "PhD student", etc.
    field: str                      # free text: "Statistics", "ML theory", etc.
    default_venues: List[str]       # e.g. ["JASA","Biometrika","NeurIPS"] — drives folder seeding
    default_review_style: ReviewStyleSnapshot  # used at upload time + at finalize-review
    completed_at: str
```

Single-user MVP: one profile, persisted at `data/profile.json`. When auth lands, key by user_id.

## 2. Endpoints

### Paper flag

```
POST   /v1/papers/{id}/flag
       body: {"flag": "promising" | "rejected" | null}   # null clears
       returns: Paper
```

Setting a flag:
- Clears the opposite flag (idempotent set, not toggle)
- Does NOT change `stage` — flags and stages are independent
- Does NOT delete or hide the paper (frontend filters to display)

### Folder CRUD

```
GET    /v1/folders                                  → List[Folder]
POST   /v1/folders                                  body: {name, venue_type?}
                                                     returns: Folder | 409 on duplicate name
PATCH  /v1/folders/{name}                           body: {name?, venue_type?}
                                                     returns: Folder | 404 | 409 on rename collision
                                                     side effect: paper.folder = newName for matching papers
DELETE /v1/folders/{name}                           returns: 204
                                                     side effect: paper.folder = None for matching papers
                                                     refuses if folder.is_default
```

Default folders:
- After onboarding completes, seed from `default_venues` with `is_default=False` (user can rename/delete).
- No "Inbox" folder gets seeded — status folders (Processing/Screened/etc.) cover the lifecycle states; venue folders cover the user-defined buckets. A paper without a venue folder simply has `paper.folder = None` and shows under the "All" filter.

### Onboarding

```
GET    /v1/onboarding                               → OnboardingProfile | 404 (not yet completed)
POST   /v1/onboarding                               body: OnboardingProfile (without completed_at)
                                                     returns: OnboardingProfile
                                                     side effect: creates one Folder per default_venue
```

Creating the profile is idempotent on `name` — POSTing twice updates it but only seeds folders the first time. (Track with a one-shot flag.)

### Batch paper actions

```
POST   /v1/papers/batch
       body: {
         "ids": [paper_id, ...],
         "action": "dive_deep" | "flag" | "set_folder" | "delete",
         "payload": {...}                       # action-specific
       }
       returns: {
         "results": [{"paper_id": "...", "ok": true} | {"paper_id": "...", "ok": false, "error": "..."}, ...],
         "summary": {"ok": N, "failed": M}
       }
```

Action payloads:
- `dive_deep` — `{}`. Idempotent: papers already diving/dived skip silently with `ok: true, skipped: true`.
- `flag` — `{"flag": "promising"|"rejected"|null}`. Same semantics as POST /flag.
- `set_folder` — `{"folder": "<name>"|null}`. Validates folder exists.
- `delete` — `{}`. Hard-deletes papers + their PDFs + thumbs.

Batch dive-deep is the high-volume case. Background-task each one via the existing `dive_deep` task; emit `dive.batch.started` SSE on the umbrella for UI feedback.

## 3. Migration

Existing data:
- Migrate every `paper.folder == "Inbox"` to `paper.folder = None` (Inbox is gone). UI shows them under "All" + the relevant status folder.
- Set `paper.flag = None` on all papers.
- Drop the hardcoded folder list; populate `data/folders.json` with `Journal/Conference/Grant/Thesis` as initial seed (in case onboarding hasn't run yet).
- Onboarding profile starts unset; frontend gates first-visit on it.

Migration script lives next to `migrate_v2.py`. Idempotent. Run once.

## 4. Status folder semantics (frontend-only — no backend endpoint)

Status folders are pure derived filters over the paper list:

| Status | Filter |
|---|---|
| Processing | `stage in ("uploaded","triaging","diving")` |
| Screened | `stage == "triaged"` |
| Deep Analyzed | `stage == "dived" AND final_score is None` |
| Reviewed | `final_score is not None` |
| Promising | `flag == "promising"` |
| Rejected | `flag == "rejected"` |

Frontend computes counts from the `GET /v1/papers` list. No backend work needed for these.

## 5. Cost model — unchanged

Triage ≤ $0.05, deep-dive ≤ $1.50, finalize-review ≤ $0.10 (text-only).
Batch dive-deep: enforce per-paper cap; surface the running total at the umbrella.

## 6. SSE additions

```
flag.set            {paper_id, flag}
folder.created      {folder}
folder.renamed      {old, new}
folder.deleted      {name}
onboarding.completed {profile}
dive.batch.started  {paper_ids, total}
dive.batch.progress {paper_id, ok, message?}
dive.batch.completed {ok, failed}
```

## 7. Phasing

Recommended order (each independent, all small):

1. **Paper.flag + POST /flag** — unblocks Promising/Rejected UI today.
2. **Folder CRUD** — unblocks rename/delete UI.
3. **Onboarding** — unblocks the first-visit gate. Folder seeding piggybacks on existing CRUD.
4. **Batch endpoint** — biggest, but frontend can fall back to sequential calls until it lands.
5. **Migration** — runs once after #1–#3 are in.

Frontend will use temporary localStorage stores for `flag` + onboarding until #1 and #3 ship, so the UI is testable today.
