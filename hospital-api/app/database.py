"""Database connection — works with SQLite (zero setup) OR MySQL (production).

Defaults to SQLite so the project runs with `python -m app.seed && uvicorn app.main:app`
and nothing else installed. When your MySQL database is ready, set
HOSPITALS_DB_URL (a dedicated name so it never collides with other projects):

    export HOSPITALS_DB_URL="mysql+pymysql://USER:PASSWORD@localhost:3306/hospitals"

and the exact same code talks to MySQL instead. The table structure matches
data/schema_mysql.sql one-to-one, so you can also create the tables by running
that file in MySQL — SQLAlchemy will simply find them there.
"""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# sqlite:///./hospitals.db  → file next to where you run the command
# mysql+pymysql://user:pass@host:3306/hospitals → your real database
DATABASE_URL = os.environ.get("HOSPITALS_DB_URL", "sqlite:///./hospitals.db")

engine = create_engine(DATABASE_URL, echo=False, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""
