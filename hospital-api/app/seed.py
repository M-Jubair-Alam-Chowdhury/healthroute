"""One-time (and re-runnable) seed script.

    python -m app.seed

What it does
------------
1. Creates the three tables from the SQLAlchemy models (same structure as
   data/schema_mysql.sql — if you already ran that file in MySQL, the tables
   simply get emptied and refilled).
2. Loads hospitals from data/hospital_coords.csv  (name, display_name,
   lat, lng, matched_address).
3. Loads the hospital→department mapping from data/hospital_departments.csv
   and fills the link table.
"""
from __future__ import annotations

import csv
from pathlib import Path

from .database import Base, SessionLocal, engine
from .models import Department, Hospital, hospital_departments

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
HOSPITALS_CSV = DATA_DIR / "hospital_coords.csv"
DEPARTMENTS_CSV = DATA_DIR / "hospital_departments.csv"


def run() -> None:
    # Child tables are dropped automatically via metadata sort order.
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    with SessionLocal() as session:
        # ------------------------------------------------------ hospitals
        hospitals: dict[str, Hospital] = {}
        with HOSPITALS_CSV.open(encoding="utf-8-sig", newline="") as f:  # utf-8-sig strips the BOM
            for row in csv.DictReader(f):
                hospitals[row["name"]] = Hospital(
                    name=row["name"],
                    display_name=row["display_name"],
                    latitude=float(row["lat"]),
                    longitude=float(row["lng"]),
                    address=row["matched_address"] or None,
                )
        session.add_all(hospitals.values())

        # ---------------------------------------- departments + link table
        departments: dict[str, Department] = {}

        def dept(name: str) -> Department:
            name = name.strip()
            if name not in departments:
                departments[name] = Department(name=name)
            return departments[name]

        pairs = 0
        # `filter` drops the `#` comment lines so the CSV can document itself.
        with DEPARTMENTS_CSV.open(encoding="utf-8-sig", newline="") as f:
            rows = (line for line in f if not line.lstrip().startswith("#"))
            for row in csv.DictReader(rows):
                hospital = hospitals.get(row["hospital"].strip())
                if hospital is None:
                    raise KeyError(
                        f"{row['hospital']!r} is not a hospital name from "
                        f"{HOSPITALS_CSV.name} — check the key spelling"
                    )
                # append() fills hospital_departments via the relationship
                hospital.departments.append(dept(row["department"]))
                pairs += 1

        session.commit()

    print(f"Seeded {len(hospitals)} hospitals, {len(departments)} departments, {pairs} links.")


if __name__ == "__main__":
    run()
