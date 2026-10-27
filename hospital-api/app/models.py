"""SQLAlchemy models — a 1:1 mirror of data/schema_mysql.sql.

    departments(id, name)                      ← one row per department name
    hospitals(id, name, display_name,          ← one row per hospital
              latitude, longitude, address)
    hospital_departments(hospital_id,          ← the many-to-many link table
                          department_id)

Why a link table? A department exists in many hospitals AND a hospital has
many departments — a plain foreign key on either side cannot express that,
so the relationship lives in its own table with a two-column primary key.

Column names/types match the SQL file, so running either this file (via
`python -m app.seed`, which calls Base.metadata.create_all) or schema_mysql.sql
in MySQL produces the same structure.
"""
from __future__ import annotations

from typing import List

from sqlalchemy import Column, Double, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# The link table. Composite primary key (hospital_id, department_id) means the
# same pair can never appear twice — no duplicate "Cardiology @ Square" rows.
hospital_departments = Table(
    "hospital_departments",
    Base.metadata,
    Column("hospital_id", ForeignKey("hospitals.id", ondelete="CASCADE"), primary_key=True),
    Column("department_id", ForeignKey("departments.id", ondelete="CASCADE"), primary_key=True),
)


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)

    hospitals: Mapped[List["Hospital"]] = relationship(
        secondary=hospital_departments, back_populates="departments"
    )


class Hospital(Base):
    __tablename__ = "hospitals"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # `name` is the key used in the original dictionary, e.g. "BIRDEMGeneralHospital"
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    # `display_name` is the readable name shown to users, e.g. "BIRDEM General Hospital"
    display_name: Mapped[str] = mapped_column(String(150), nullable=False)
    latitude: Mapped[float] = mapped_column(Double, nullable=False)
    longitude: Mapped[float] = mapped_column(Double, nullable=False)
    # NULL when no address is known yet (same as the SQL schema)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)

    departments: Mapped[List[Department]] = relationship(
        secondary=hospital_departments, back_populates="hospitals"
    )
