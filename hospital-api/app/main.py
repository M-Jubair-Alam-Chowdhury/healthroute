"""HealthAI Navigator — hospital lookup API (Person A's half of the project).

THE CONTRACT (agreed day one, see README.md)
--------------------------------------------
    GET /hospitals?department=Cardiology
    → [{"id": 3, "name": "BIRDEMGeneralHospital",
         "display_name": "BIRDEM General Hospital",
         "lat": 23.7391345, "lng": 90.3964427, "address": "..."}]

Several departments at once (the model's top 3):
    GET /hospitals?department=Cardiology&department=ENT&department=Respiratory&match=all
      match=all  (default) hospitals that offer EVERY listed department
      match=any            hospitals that offer at least one
      match=most           hospitals that offer the most of them (the best available when none has all)
    Every row then also carries "matched": how many of the listed departments it offers.

Extra keys (address) never break Person B — JSON consumers ignore what they
don't read. B builds the map against this shape while the real database is
still being filled.

Run it
------
    python -m app.seed          # load the CSVs into the database
    uvicorn app.main:app --reload
    → http://127.0.0.1:8000/docs   (interactive docs FastAPI writes for you)
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .database import SessionLocal
from .geo import haversine_km
from .models import Department, Hospital

app = FastAPI(
    title="HealthAI Navigator — Hospital API",
    description=(
        "Department lookup + nearest-hospital ranking for the hospital finder. "
        "Data: 20 Dhaka hospitals with coordinates."
    ),
    version="1.0.0",
)

# ------------------------------------------------------------------- CORS
# Let the frontend (Person B's map, on Vercel or localhost) call this API
# straight from the browser. Add your own origins as the project grows.
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "https://care-anatomy-sdk-5.vercel.app",
    ],
    # Vercel preview deployments (care-anatomy-sdk-5-abc123.vercel.app)
    allow_origin_regex=r"https://[a-z0-9-]+\.vercel\.app",
    allow_methods=["GET"],
    allow_headers=["*"],
)


def get_db() -> Session:
    """FastAPI dependency: one session per request, always closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ------------------------------------------------------- response schemas
class HospitalOut(BaseModel):
    """Exactly the agreed contract, plus `address` as a bonus field.

    The database columns are `latitude`/`longitude` (schema_mysql.sql) while
    the contract keys are `lat`/`lng` — AliasChoices bridges that, reading
    either name from the ORM row and always serializing as `lat`/`lng`.
    """

    id: int
    name: str
    display_name: str
    lat: float = Field(validation_alias=AliasChoices("lat", "latitude"))
    lng: float = Field(validation_alias=AliasChoices("lng", "longitude"))
    address: Optional[str] = None
    # Only set when ?department= was given: how many of the requested departments this hospital offers.
    matched: Optional[int] = None

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class NearbyHospitalOut(HospitalOut):
    """Contract + the fields Person B's map needs for ranking."""

    distance_km: float
    is_default: bool  # True only on the single nearest result


class DepartmentOut(BaseModel):
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)


class ApiInfo(BaseModel):
    service: str
    version: str
    endpoints: dict[str, str]


# ---------------------------------------------------------------- routes
@app.get("/", response_model=ApiInfo, tags=["meta"])
def root() -> ApiInfo:
    return ApiInfo(
        service="HealthAI Navigator — Hospital API",
        version=app.version,
        endpoints={
            "departments": "/departments",
            "hospitals": "/hospitals?department={name}[&department={name}...&match=all|any|most]",
            "nearby": "/hospitals/nearby?lat={lat}&lng={lng}&department={name}",
            "docs": "/docs",
        },
    )


@app.get("/departments", response_model=list[DepartmentOut], tags=["departments"])
def list_departments(db: Session = Depends(get_db)) -> list[Department]:
    """All department names — perfect for filling a dropdown on the frontend."""
    return list(db.scalars(select(Department).order_by(Department.name)))


Match = Literal["all", "any", "most"]
MATCH_HELP = (
    "With several departments: 'all' = hospitals offering every one (default), 'any' = at least one, "
    "'most' = the hospitals offering the most of them."
)


def _base_query(
    db: Session, departments: Optional[list[str]], match: Match = "all"
) -> list[tuple[Hospital, Optional[int]]]:
    """Hospitals (with how many requested departments each offers), optionally filtered.

    Department names are compared case-insensitively. Without any department every hospital is
    returned (matched=None). The many-to-many link is loaded once (selectinload), then counted in
    Python: with 20 hospitals this is simpler and clearer than a GROUP BY / HAVING query.
    """
    wanted = {d.strip().lower() for d in (departments or []) if d and d.strip()}
    stmt = select(Hospital).options(selectinload(Hospital.departments)).order_by(Hospital.id)
    hospitals = list(db.scalars(stmt))
    if not wanted:
        return [(h, None) for h in hospitals]

    scored = [(h, len(wanted & {d.name.lower() for d in h.departments})) for h in hospitals]
    if match == "any":
        keep = [(h, n) for h, n in scored if n >= 1]
    elif match == "most":
        best = max((n for _, n in scored), default=0)
        keep = [(h, n) for h, n in scored if best > 0 and n == best]
    else:  # "all"
        keep = [(h, n) for h, n in scored if n == len(wanted)]
    return keep


def _out(h: Hospital, matched: Optional[int]) -> HospitalOut:
    return HospitalOut(
        id=h.id, name=h.name, display_name=h.display_name,
        lat=h.latitude, lng=h.longitude, address=h.address, matched=matched,
    )


@app.get("/hospitals", response_model=list[HospitalOut], tags=["hospitals"])
def list_hospitals(
    department: Optional[list[str]] = Query(
        default=None,
        description="Filter by department, e.g. 'Cardiology'. Repeat the parameter for several. Omit for all hospitals.",
        examples=["Cardiology"],
    ),
    match: Match = Query(default="all", description=MATCH_HELP),
    db: Session = Depends(get_db),
) -> list[HospitalOut]:
    """THE contract endpoint: hospitals, optionally with the given department(s)."""
    return [_out(h, n) for h, n in _base_query(db, department, match)]


@app.get(
    "/hospitals/nearby",
    response_model=list[NearbyHospitalOut],
    tags=["hospitals"],
    summary="Hospitals ranked by distance from a point (nearest = default)",
)
def nearby_hospitals(
    lat: float = Query(..., ge=-90, le=90, description="User latitude"),
    lng: float = Query(..., ge=-180, le=180, description="User longitude"),
    department: Optional[list[str]] = Query(
        default=None, description="Also filter by department (repeat for several)", examples=["Cardiology"]
    ),
    match: Match = Query(default="all", description=MATCH_HELP),
    limit: int = Query(default=10, ge=1, le=50, description="How many to return"),
    db: Session = Depends(get_db),
) -> list[NearbyHospitalOut]:
    """Task 3 ranking: Haversine first pass, sorted, nearest flagged.

    The browser sends the user's position (Geolocation API) to this endpoint.
    Person B then fetches real road distance/time for the top few from a
    routing API (OSRM is free) — keeping geocoder/routing calls tiny.
    """
    rows = _base_query(db, department, match)
    if not rows:
        return []

    ranked = sorted(
        rows,
        key=lambda hn: haversine_km(lat, lng, hn[0].latitude, hn[0].longitude),
    )[:limit]

    return [
        NearbyHospitalOut(
            id=h.id,
            name=h.name,
            display_name=h.display_name,
            lat=h.latitude,
            lng=h.longitude,
            address=h.address,
            matched=n,
            distance_km=round(haversine_km(lat, lng, h.latitude, h.longitude), 2),
            is_default=(index == 0),
        )
        for index, (h, n) in enumerate(ranked)
    ]


@app.get("/hospitals/{hospital_id}", response_model=HospitalOut, tags=["hospitals"])
def get_hospital(hospital_id: int, db: Session = Depends(get_db)) -> Hospital:
    """Single hospital by id, with its coordinates ready for a map pin."""
    hospital = db.get(Hospital, hospital_id)
    if hospital is None:
        raise HTTPException(status_code=404, detail="Hospital not found")
    return hospital
