-- ============================================
-- SUPABASE SCHEMA - Sistem Absensi & Pelanggaran
-- Jalankan di Supabase SQL Editor
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLE: classes
-- ============================================
CREATE TABLE IF NOT EXISTS classes (
    id SERIAL PRIMARY KEY,
    local_id INTEGER UNIQUE,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE: teachers (guru)
-- ============================================
CREATE TABLE IF NOT EXISTS teachers (
    id SERIAL PRIMARY KEY,
    local_id INTEGER UNIQUE,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    subject TEXT,
    supabase_uid UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE: students
-- ============================================
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    local_id INTEGER UNIQUE,
    nisn TEXT UNIQUE,
    name TEXT NOT NULL,
    class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
    class_local_id INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE: teacher_class_subjects (relasi guru-kelas-mapel)
-- ============================================
CREATE TABLE IF NOT EXISTS teacher_class_subjects (
    id SERIAL PRIMARY KEY,
    local_id INTEGER UNIQUE,
    teacher_id INTEGER REFERENCES teachers(id) ON DELETE CASCADE,
    class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    teacher_local_id INTEGER,
    class_local_id INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE: attendance
-- ============================================
CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    local_id INTEGER UNIQUE,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
    student_local_id INTEGER,
    teacher_local_id INTEGER,
    date DATE NOT NULL,
    lesson INTEGER NOT NULL,
    subject TEXT,
    status TEXT NOT NULL CHECK (status IN ('H', 'I', 'S', 'A')),
    notes TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE: violation_categories (kategori pelanggaran)
-- ============================================
CREATE TABLE IF NOT EXISTS violation_categories (
    id SERIAL PRIMARY KEY,
    local_id INTEGER UNIQUE,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    default_points INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE: violations (pelanggaran)
-- ============================================
CREATE TABLE IF NOT EXISTS violations (
    id SERIAL PRIMARY KEY,
    local_id INTEGER UNIQUE,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
    category_id INTEGER REFERENCES violation_categories(id) ON DELETE SET NULL,
    student_local_id INTEGER,
    teacher_local_id INTEGER,
    category_local_id INTEGER,
    date DATE NOT NULL,
    description TEXT,
    points INTEGER DEFAULT 1,
    followup TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_violations_student ON violations(student_id);
CREATE INDEX IF NOT EXISTS idx_violations_date ON violations(date);

-- ============================================
-- VIEWS for easy reporting
-- ============================================

-- View: attendance detail
CREATE OR REPLACE VIEW v_attendance_detail AS
SELECT 
    a.id,
    a.local_id,
    a.date,
    a.lesson,
    a.subject,
    a.status,
    a.notes,
    s.name AS student_name,
    s.nisn,
    c.name AS class_name,
    t.name AS teacher_name,
    a.synced_at
FROM attendance a
JOIN students s ON a.student_local_id = s.local_id
JOIN classes c ON s.class_local_id = c.local_id
LEFT JOIN teachers t ON a.teacher_local_id = t.local_id;

-- View: violations detail
CREATE OR REPLACE VIEW v_violations_detail AS
SELECT 
    v.id,
    v.local_id,
    v.date,
    v.description,
    v.points,
    v.followup,
    s.name AS student_name,
    s.nisn,
    c.name AS class_name,
    t.name AS teacher_name,
    vc.name AS category_name,
    v.synced_at
FROM violations v
JOIN students s ON v.student_local_id = s.local_id
LEFT JOIN classes c ON s.class_local_id = c.local_id
LEFT JOIN teachers t ON v.teacher_local_id = t.local_id
LEFT JOIN violation_categories vc ON v.category_local_id = vc.local_id;

-- View: student violation summary (akumulasi poin)
CREATE OR REPLACE VIEW v_student_violation_summary AS
SELECT 
    s.local_id AS student_local_id,
    s.name AS student_name,
    s.nisn,
    c.name AS class_name,
    COUNT(v.id) AS total_violations,
    COALESCE(SUM(v.points), 0) AS total_points
FROM students s
LEFT JOIN classes c ON s.class_local_id = c.local_id
LEFT JOIN violations v ON v.student_local_id = s.local_id
GROUP BY s.local_id, s.name, s.nisn, c.name;

-- ============================================
-- RLS (Row Level Security) - Optional
-- Aktifkan jika ingin per-user access control
-- ============================================
-- ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE violations ENABLE ROW LEVEL SECURITY;

SELECT 'Schema berhasil dibuat! ✅' AS status;
