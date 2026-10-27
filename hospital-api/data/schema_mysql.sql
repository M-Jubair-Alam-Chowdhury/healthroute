-- Hospital finder schema (MySQL)
-- Run this inside the `hospitals` database you already created.
-- A department exists in many hospitals; a hospital has many departments.
-- That many-to-many relationship needs a link table.

-- Safe to re-run: drop in child-to-parent order.
DROP TABLE IF EXISTS hospital_departments;
DROP TABLE IF EXISTS hospitals;
DROP TABLE IF EXISTS departments;

CREATE TABLE departments (
    id   INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE hospitals (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(100) NOT NULL UNIQUE,  -- key used in the original dictionary
    display_name VARCHAR(150) NOT NULL,         -- readable name shown to users
    latitude     DOUBLE NOT NULL,
    longitude    DOUBLE NOT NULL,
    address      VARCHAR(255) NULL              -- NULL when no address is known yet
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE hospital_departments (
    hospital_id   INT NOT NULL,
    department_id INT NOT NULL,
    PRIMARY KEY (hospital_id, department_id),
    -- MySQL automatically indexes department_id because of this foreign key,
    -- so "which hospitals have department X" is already fast.
    FOREIGN KEY (hospital_id)   REFERENCES hospitals(id)   ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
