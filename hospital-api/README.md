# Hospital API — the database half (Person A)

FastAPI + SQLAlchemy backend for the hospital finder. Implements **Task 2**
(the many-to-many database + department lookup) and the **ranking half of
Task 3** (Haversine nearest-first) as a reference Person B can test against.

Data: **20 Dhaka hospitals** from `data/hospital_coords.csv` (geocoded once —
never per request, exactly as the plan says). Columns: `name, display_name,
lat, lng, matched_address` (the geocode OK/NOT_FOUND status column was
removed from the file).

## Project structure

```
hospital-api/
├── app/
│   ├── main.py          ← FastAPI routes (THE API contract lives here)
│   ├── models.py        ← SQLAlchemy models — 1:1 mirror of data/schema_mysql.sql
│   ├── database.py      ← engine/session; SQLite by default, MySQL via env var
│   ├── geo.py           ← Haversine formula (with a doctest)
│   └── seed.py          ← one-time loader for the two CSVs
├── data/
│   ├── hospital_coords.csv       ← YOUR file: 20 hospitals + coordinates + geocode status
│   ├── schema_mysql.sql          ← YOUR file: the three-table MySQL schema
│   └── hospital_departments.csv  ← SAMPLE mapping — replace with the assignment dictionary!
├── tests/test_api.py    ← 11 contract tests (Person B's test cases, runnable)
└── requirements.txt
```

## Run it (3 commands)

```bash
cd hospital-api
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python -m app.seed          # create tables + load both CSVs
uvicorn app.main:app --reload
```

Open **http://127.0.0.1:8000/docs** — FastAPI generates interactive docs
where you can click through every endpoint. That page is also the easiest
way to demo the API to your teammate or teacher.

Run the tests any time:

```bash
pytest -v
```

## The API contract (agreed day one)

```
GET /hospitals?department=Cardiology
→ [
    {"id": 3, "name": "BIRDEMGeneralHospital",
     "display_name": "BIRDEM General Hospital",
     "lat": 23.7391345, "lng": 90.3964427,
     "address": "BIRDEM General Hospital, Kazi Nazrul Islam Avenue, …"}
  ]
```

| Endpoint | What it does |
|---|---|
| `GET /departments` | All department names (fill a dropdown with this) |
| `GET /hospitals?department=X` | The contract above; omit `department` for all 20 |
| `GET /hospitals?department=A&department=B&department=C&match=all\|any\|most` | Several departments (the model's top 3). `all` (default) = hospitals offering every one, `any` = at least one, `most` = the best available when none has all. Rows then carry `matched` (how many of the requested departments they offer) |
| `GET /hospitals/nearby?lat=&lng=&department=&limit=10` | Ranked by Haversine distance, nearest first, with `distance_km` and `is_default: true` on the nearest — Task 3's "default hospital" rule |
| `GET /hospitals/{id}` | One hospital, ready for a map pin |

The `department` filter is **case-insensitive** (`cardiology` works too) and
unknown departments return `[]`, not an error — nicer for autocomplete UIs.

## Connect the frontend (Person B)

A working reference lives in the Next.js project at **`/fastapi`**
(`src/app/fastapi/page.tsx`): the map module pointed at
`http://localhost:8000/hospitals/nearby` with a department dropdown.
Start both servers (`uvicorn` on 8000, `next dev` on 3000) and open
http://localhost:3000/fastapi. CORS for localhost and the Vercel site is
already configured in `app/main.py`.

## Put in the REAL department dictionary

`data/hospital_departments.csv` is **sample data we made up** — plausible
departments for these hospitals, but NOT the assignment's dictionary.
Replace the rows (same two columns: `hospital,department`, `hospital` must
match the `name` key in `hospital_coords.csv`) and re-run:

```bash
python -m app.seed
```

The seed is safe to re-run: it drops and rebuilds the three tables each time.

## Switch to MySQL (when your database is ready)

1. Create the `hospitals` database and run `data/schema_mysql.sql` in it
   (or let SQLAlchemy create the identical tables — either works).
2. Point the app at it:

```bash
export HOSPITALS_DB_URL="mysql+pymysql://USER:PASSWORD@localhost:3306/hospitals"
python -m app.seed && uvicorn app.main:app --reload
```

Same code, same API — only the storage changed. That's the whole point of
keeping the schema in models and the routes thin.

## ⚠ Coordinates to hand-check

The old `status` column flagged five rows as geocoded to a *similar* place,
not the exact hospital. The column is gone from the CSV now, but it's still
worth eyeballing these pins on a map before trusting them:

- Addin Medical College Hospital
- Dr Sirajul Islam Medical College And Hospital
- Health And Hope Hospital
- Ibn Sina Specialized Hospital
- Ibrahim Cardiac Hospital And Research Institute

(The list is kept here in the README only — it no longer lives in the data.)

## Who owns what (matches the split)

| Piece | Owner |
|---|---|
| Schema, seed, `/hospitals?department=` | **A** — done here, review the code to learn it |
| Test cases & sample queries | **B** — start from `tests/test_api.py`, extend with your own |
| Geocoding + storing coordinates | **A** — already in the CSV; spot-check pins on a map |
| Haversine + ranking | **B** — reference implementation in `app/geo.py` + `/hospitals/nearby`; rebuild it your own way to learn, the tests will tell you if yours matches |
| Map UI + hospital picker | **B** — the `/fastapi` reference page + the map module |

## What to learn here, file by file

- **SQL & many-to-many** → `app/models.py` (the link table) + run JOINs by hand:
  `sqlite3 hospitals.db "SELECT h.display_name FROM hospitals h JOIN hospital_departments hd ON h.id=hd.hospital_id JOIN departments d ON d.id=hd.department_id WHERE d.name='Cardiology';"`
- **FastAPI** → `app/main.py` (routes, query parameters, response models)
- **Testing** → `tests/test_api.py` (TestClient + plain asserts)
- **Haversine** → `app/geo.py` (10 lines of math, with a doctest)

## Git workflow reminder

One repo, `main` always works, `feature/person-a-*` and `feature/person-b-*`
branches, merge via pull requests so you review each other's code. Keep this
README's contract section in sync with any change — it's the agreement that
lets both halves move without waiting for each other.
