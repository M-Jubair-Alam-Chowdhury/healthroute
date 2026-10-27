"""Contract tests — these pin down the API shape Person B builds against.

Run:  pytest -v

They check the DAY-ONE CONTRACT exactly as agreed:
    GET /hospitals?department=X
    → [{"id", "name", "display_name", "lat", "lng", "address?"}, ...]
plus the Task 3 ranking rules on /hospitals/nearby.
"""
# Set the test database BEFORE importing the app (app.database reads it at import).
import os

os.environ.setdefault("HOSPITALS_DB_URL", "sqlite:///./test_hospitals.db")

from fastapi.testclient import TestClient  # noqa: E402

from app import seed  # noqa: E402
from app.main import app  # noqa: E402

seed.run()  # fresh tables + data for the test run
client = TestClient(app)

# BIRDEM's own coordinates, from data/hospital_coords.csv
BIRDEM_LAT, BIRDEM_LNG = 23.7391345, 90.3964427


def test_root_lists_endpoints() -> None:
    r = client.get("/")
    assert r.status_code == 200
    body = r.json()
    assert body["service"].startswith("HealthAI Navigator")
    assert "hospitals" in body["endpoints"]


def test_all_hospitals_have_contract_keys() -> None:
    r = client.get("/hospitals")
    assert r.status_code == 200
    hospitals = r.json()
    assert len(hospitals) == 20
    for h in hospitals:
        # The exact keys from the agreed contract (address is a bonus)
        assert {"id", "name", "display_name", "lat", "lng"} <= set(h)
        assert isinstance(h["lat"], float) and isinstance(h["lng"], float)


def test_department_filter_returns_only_matches() -> None:
    r = client.get("/hospitals", params={"department": "Cardiology"})
    assert r.status_code == 200
    hospitals = r.json()
    assert hospitals, "Cardiology should match several hospitals"
    for h in hospitals:
        assert {"id", "name", "display_name", "lat", "lng"} <= set(h)


def test_department_filter_is_case_insensitive() -> None:
    lower = client.get("/hospitals", params={"department": "cardiology"}).json()
    upper = client.get("/hospitals", params={"department": "Cardiology"}).json()
    assert lower == upper


def test_unknown_department_returns_empty_list() -> None:
    r = client.get("/hospitals", params={"department": "Cryptozoology"})
    assert r.status_code == 200
    assert r.json() == []


def test_departments_endpoint_lists_all() -> None:
    r = client.get("/departments")
    assert r.status_code == 200
    names = [d["name"] for d in r.json()]
    assert "Cardiology" in names
    assert "Eye" in names  # the department names now match the model's labels
    assert len(names) == len(set(names)), "department names must be unique"


def test_nearby_is_sorted_and_marks_single_default() -> None:
    r = client.get(
        "/hospitals/nearby",
        params={"lat": 23.738, "lng": 90.395, "department": "Cardiology", "limit": 5},
    )
    assert r.status_code == 200
    hospitals = r.json()

    distances = [h["distance_km"] for h in hospitals]
    assert distances == sorted(distances), "results must be sorted nearest-first"

    defaults = [h for h in hospitals if h["is_default"]]
    assert len(defaults) == 1, "exactly one hospital is the default"
    assert defaults[0] is hospitals[0], "the nearest one is the default"

    for h in hospitals:
        assert {"id", "name", "display_name", "lat", "lng", "distance_km", "is_default"} <= set(h)


def test_nearby_from_birdem_itself_is_zero_km() -> None:
    r = client.get(
        "/hospitals/nearby",
        params={"lat": BIRDEM_LAT, "lng": BIRDEM_LNG, "limit": 3},
    )
    hospitals = r.json()
    assert hospitals[0]["display_name"] == "BIRDEM General Hospital"
    assert hospitals[0]["distance_km"] == 0.0
    assert hospitals[0]["is_default"] is True


def test_get_hospital_by_id() -> None:
    r = client.get("/hospitals/3")
    assert r.status_code == 200
    assert r.json()["display_name"] == "BIRDEM General Hospital"


def test_get_hospital_404_for_unknown_id() -> None:
    assert client.get("/hospitals/999").status_code == 404


def test_nearby_validates_lat_lng_ranges() -> None:
    r = client.get("/hospitals/nearby", params={"lat": 999, "lng": 90})
    assert r.status_code == 422  # FastAPI's automatic validation


# ---- several departments at once (the model's top 3) -------------------------------------------
TOP3 = ["Cardiology", "ENT", "Respiratory"]


def _ids(rows):
    return {h["id"] for h in rows}


def test_multi_department_all_is_the_intersection() -> None:
    each = [_ids(client.get("/hospitals", params={"department": d}).json()) for d in TOP3]
    both = client.get("/hospitals", params={"department": TOP3, "match": "all"}).json()
    assert _ids(both) == set.intersection(*each)
    assert all(h["matched"] == 3 for h in both)


def test_multi_department_any_is_the_union() -> None:
    each = [_ids(client.get("/hospitals", params={"department": d}).json()) for d in TOP3]
    rows = client.get("/hospitals", params={"department": TOP3, "match": "any"}).json()
    assert _ids(rows) == set.union(*each)


def test_multi_department_most_falls_back_to_the_best_available() -> None:
    rows = client.get("/hospitals", params={"department": TOP3 + ["Cryptozoology"], "match": "most"}).json()
    assert rows and len({h["matched"] for h in rows}) == 1  # all offer the same (maximum) number
    assert rows[0]["matched"] == 3  # Cardiology + ENT + Respiratory, the made-up one can never match
    assert client.get("/hospitals", params={"department": ["Cryptozoology"], "match": "most"}).json() == []


def test_single_department_still_works_and_reports_matched() -> None:
    rows = client.get("/hospitals", params={"department": "cardiology"}).json()
    assert rows and all(h["matched"] == 1 for h in rows)
    assert all(h["matched"] is None for h in client.get("/hospitals").json())


def test_nearby_accepts_several_departments() -> None:
    rows = client.get(
        "/hospitals/nearby",
        params={"lat": 23.738, "lng": 90.395, "department": TOP3, "match": "any", "limit": 50},
    ).json()
    assert rows and [h["distance_km"] for h in rows] == sorted(h["distance_km"] for h in rows)
