"""Dummy emergency-flag service on port 8002 (replaces mock-risk). NOT an AI model: a rule check.

Run (inside this folder):
    pip install fastapi uvicorn
    python -m uvicorn main:app --port 8002

POST /risk  {"text": "chest tightness or pressure;", "sex": "female",
             "severity": 9, "duration": "Just now", "urgent": true,
             "symptoms": ["Bleeding"], "inside": ["chest-tight"]}
  ->  {"emergency": true | false, "reasons": ["..."]}

Only "text" is required, so the old contract {"text","sex"} -> {"emergency"} still works.
The web app shows "The symptoms might be an emergency." only when emergency is true.

The rules mirror what body-selector.js (Care Anatomy SDK) can produce:
  - "Inside the body" chips flagged urgent there: chest tightness or pressure, short of breath,
    blood in stool, confused or foggy, weak or numb on one side
  - the "Bleeding" symptom chip on any body part (text looks like "head bleeding;")
  - strength (severity) 8, 9 or 10 out of 10
  - the component's own `urgentFlag`
The component writes chips as lowercase phrases ending in ";" and does NOT put strength or
"started" into the text, so those two must be sent as the separate fields below.
Clinicians should review every rule here before real use.
"""
import os
import re

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

SEVERITY_EMERGENCY = 8  # same threshold as `urgent` in body-selector.js

# (reason shown to the app/devs, pattern). Patterns run on lower-cased text.
TEXT_RULES = [
    # --- exact phrases the selector's urgent chips produce ---
    ("chest tightness or pressure", r"chest tightness|chest pressure|tightness or pressure"),
    ("short of breath", r"short(ness)? of breath|difficulty breathing|trouble breathing"),
    ("blood in stool", r"blood in (my )?stool|bloody stool|black (tarry )?stool"),
    ("confusion", r"confused or foggy|confused|disoriented"),
    ("one-sided weakness or numbness", r"weak or numb on one side|one[- ]sided (weakness|numbness)"),
    # "Bleeding" chip on any body part, but not the women's-health chip "unusual discharge or bleeding"
    ("bleeding", r"(?<!discharge or )\bbleeding\b|\bblood loss\b|bleeding heavily|severe bleeding"),
    # --- typed free text ---
    ("chest pain", r"chest pain|crushing|pain in (my )?chest"),
    ("cannot breathe", r"can'?t breathe|cannot breathe|gasping|choking"),
    ("fainting", r"faint|unconscious|passed out|blacked out|unresponsive"),
    ("seizure", r"seizure|convuls"),
    ("stroke signs", r"stroke|paraly|face droop|slurred speech|can'?t speak|sudden (vision loss|numbness)"),
    ("worst pain", r"worst (headache|pain)|thunderclap"),
    ("coughing/vomiting blood", r"(cough(ing)?|vomit(ing)?|throwing up) (up )?blood|blood in (my )?vomit"),
    ("self-harm / overdose / poisoning", r"suicid|kill myself|overdose|poison|swallowed (bleach|pills)"),
    ("severe allergic reaction", r"anaphyla|throat (is )?closing|swelling of (the )?(face|tongue|throat)"),
    # fallback if a client still puts strength into the text
    ("severe strength in text", r"strength: (8|9|10) out of 10|\b(8|9|10) ?/ ?10\b"),
]
COMPILED = [(reason, re.compile(p)) for reason, p in TEXT_RULES]

# Selector "inside the body" ids that are urgent on their own (same ones body-selector.js flags).
URGENT_INSIDE_IDS = {"chest-tight", "breath", "blood-stool", "foggy", "one-side"}

app = FastAPI(title="Emergency flag (dummy)")
# Extra websites allowed to call this API (custom domain): ALLOWED_ORIGINS=https://your-site.com,https://www.your-site.com
_extra = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", *_extra],
    allow_origin_regex=r"https://[a-z0-9-]+\.vercel\.app",  # Vercel production + preview addresses
    allow_methods=["*"],
    allow_headers=["*"],
)


class Req(BaseModel):
    text: str
    sex: str | None = None
    # Optional structured fields from the body selector's report (getReport()):
    severity: int | None = None            # 1-10 "How strong is it?"
    duration: str | None = None            # e.g. "Just now", "Today", "1–3 days"
    urgent: bool | None = None             # the selector's own urgentFlag
    symptoms: list[str] | None = None      # reportedSymptoms, e.g. ["Pain", "Bleeding"]
    inside: list[str] | None = None        # internalConcerns ids, e.g. ["chest-tight"]


def assess(req: Req) -> list[str]:
    text = req.text.lower()
    reasons: list[str] = []

    for reason, rx in COMPILED:
        if rx.search(text):
            reasons.append(reason)

    if req.severity is not None and req.severity >= SEVERITY_EMERGENCY:
        reasons.append(f"severity {req.severity}/10")

    if req.symptoms and any(s.lower() == "bleeding" for s in req.symptoms):
        reasons.append("bleeding")

    if req.inside:
        for i in req.inside:
            if i in URGENT_INSIDE_IDS:
                reasons.append(f"urgent item: {i}")

    # Combinations that are not urgent alone
    new = (req.duration or "").lower() in ("just now", "today")
    if "testicle pain or swelling" in text and new:
        reasons.append("sudden testicle pain (possible torsion)")
    if (
        "pregnancy concern" in text
        and ("discharge or bleeding" in text or "bleeding" in text)
    ):
        reasons.append("pregnancy with bleeding")
    if "fall or injury" in text and req.severity is not None and req.severity >= 7:
        reasons.append("serious injury")

    # Keep the selector's own flag as a last resort so the two never disagree silently.
    if req.urgent and not reasons:
        reasons.append("flagged urgent by the body selector")

    return list(dict.fromkeys(reasons))  # de-duplicate, keep order


@app.get("/")
def root():
    return {
        "service": "Emergency flag (dummy)",
        "contract": 'POST /risk {"text", "sex"?, "severity"?, "duration"?, "urgent"?, "symptoms"?, "inside"?} '
                    '-> {"emergency": bool, "reasons": [str]}',
    }


@app.post("/risk")
def risk(req: Req):
    reasons = assess(req)
    return {"emergency": bool(reasons), "reasons": reasons}