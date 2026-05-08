// server.js — Sistem Absensi & Pelanggaran
// Primary: SQLite | Backup: Supabase

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const csv = require('csv-parser');
const sync = require('./supabase-sync');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ============================================
// PATHS
// ============================================
const DB_PATH = path.join(__dirname, 'database', 'absensi.db');
const FRONTEND_PATH = path.join(__dirname, 'frontend');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

[path.dirname(DB_PATH), UPLOADS_DIR, FRONTEND_PATH].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const upload = multer({ dest: UPLOADS_DIR });

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(FRONTEND_PATH));

// ============================================
// DATABASE INIT
// ============================================
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) { console.error('DB Error:', err.message); process.exit(1); }
    console.log('✅ SQLite connected');
    db.run('PRAGMA foreign_keys = ON');
    db.serialize(initSchema);
});

function initSchema() {
    db.run(`CREATE TABLE IF NOT EXISTS classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now','localtime'))
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS teachers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        subject TEXT,
        role TEXT DEFAULT 'guru' CHECK(role IN ('guru','admin')),
        created_at TEXT DEFAULT (datetime('now','localtime'))
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS teacher_class_subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL,
        class_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
        UNIQUE(teacher_id, class_id, subject)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nisn TEXT UNIQUE,
        name TEXT NOT NULL,
        class_id INTEGER,
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        teacher_id INTEGER,
        date TEXT NOT NULL,
        lesson INTEGER NOT NULL,
        subject TEXT,
        status TEXT NOT NULL CHECK(status IN ('H','I','S','A')),
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL,
        UNIQUE(student_id, date, lesson)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS violation_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        default_points INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now','localtime'))
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS violations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        teacher_id INTEGER,
        category_id INTEGER,
        date TEXT NOT NULL,
        description TEXT,
        points INTEGER DEFAULT 1,
        followup TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL,
        FOREIGN KEY (category_id) REFERENCES violation_categories(id) ON DELETE SET NULL
    )`);

    // Seed default violation categories
    db.run(`INSERT OR IGNORE INTO violation_categories (name, description, default_points) VALUES
        ('Terlambat', 'Datang terlambat ke sekolah/kelas', 1),
        ('Seragam', 'Tidak memakai seragam lengkap', 2),
        ('Gadget', 'Menggunakan HP saat pelajaran', 3),
        ('Bolos', 'Tidak hadir tanpa keterangan', 5),
        ('Perkelahian', 'Terlibat perkelahian', 10),
        ('Tidak Sopan', 'Bersikap tidak sopan kepada guru', 5),
        ('Menyontek', 'Menyontek saat ujian/tugas', 8),
        ('Lainnya', 'Pelanggaran lainnya', 1)`);

    // Seed default admin
    const bcryptjs = (() => { try { return require('bcryptjs'); } catch { return null; } })();
    if (bcryptjs) {
        const hash = bcryptjs.hashSync('admin123', 10);
        db.run(`INSERT OR IGNORE INTO teachers (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
            ['Administrator', 'admin@sekolah.sch.id', hash, 'admin']);
    } else {
        db.run(`INSERT OR IGNORE INTO teachers (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
            ['Administrator', 'admin@sekolah.sch.id', 'admin123', 'admin']);
    }

    console.log('✅ Schema ready');
    sync.initSupabase();
}

// ============================================
// HELPERS
// ============================================
const dbAll = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));
const dbGet = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
const dbRun = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));

function apiError(res, err, status = 500) {
    console.error('API Error:', err.message || err);
    res.status(status).json({ success: false, message: err.message || err });
}

// Simple auth middleware (cek header x-teacher-id)
async function authMiddleware(req, res, next) {
    const teacherId = req.headers['x-teacher-id'];
    if (!teacherId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    try {
        const teacher = await dbGet('SELECT id, role FROM teachers WHERE id = ?', [teacherId]);
        if (!teacher) return res.status(401).json({ success: false, message: 'Guru tidak ditemukan' });
        req.teacher = teacher;
        next();
    } catch (err) { apiError(res, err); }
}

function adminOnly(req, res, next) {
    if (req.teacher?.role !== 'admin') return res.status(403).json({ success: false, message: 'Hanya admin yang bisa mengakses ini' });
    next();
}

// ============================================
// AUTH API
// ============================================
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email dan password wajib diisi' });

    try {
        const teacher = await dbGet('SELECT * FROM teachers WHERE email = ?', [email]);
        if (!teacher) return res.status(401).json({ success: false, message: 'Email atau password salah' });

        let valid = false;
        try {
            const bcryptjs = require('bcryptjs');
            valid = await bcryptjs.compare(password, teacher.password_hash);
        } catch {
            valid = (password === teacher.password_hash);
        }

        if (!valid) return res.status(401).json({ success: false, message: 'Email atau password salah' });

        const { password_hash, ...teacherData } = teacher;
        const assignments = await dbAll(`
            SELECT tcs.id, tcs.class_id, tcs.subject, c.name as class_name
            FROM teacher_class_subjects tcs
            JOIN classes c ON tcs.class_id = c.id
            WHERE tcs.teacher_id = ?
        `, [teacher.id]);

        res.json({ success: true, teacher: teacherData, assignments });
    } catch (err) { apiError(res, err); }
});

// ============================================
// CLASSES API
// ============================================
app.get('/api/classes', async (req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM classes ORDER BY name');
        res.json(rows);
    } catch (err) { apiError(res, err); }
});

app.post('/api/classes', authMiddleware, adminOnly, async (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Nama kelas wajib diisi' });
    try {
        const result = await dbRun('INSERT INTO classes (name) VALUES (?)', [name.trim()]);
        const newClass = { id: result.lastID, name: name.trim() };
        sync.syncClass(newClass);
        io.emit('classesUpdated');
        res.status(201).json({ success: true, ...newClass });
    } catch (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ success: false, message: 'Nama kelas sudah ada' });
        apiError(res, err);
    }
});

app.delete('/api/classes/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM classes WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ success: false, message: 'Kelas tidak ditemukan' });
        sync.syncDelete('classes', req.params.id);
        io.emit('classesUpdated');
        res.json({ success: true, message: 'Kelas berhasil dihapus' });
    } catch (err) { apiError(res, err); }
});

// ============================================
// TEACHERS API
// ============================================
app.get('/api/teachers', authMiddleware, adminOnly, async (req, res) => {
    try {
        const teachers = await dbAll('SELECT id, name, email, subject, role, created_at FROM teachers ORDER BY name');
        for (const t of teachers) {
            t.assignments = await dbAll(`
                SELECT tcs.id, tcs.class_id, tcs.subject, c.name as class_name
                FROM teacher_class_subjects tcs
                JOIN classes c ON tcs.class_id = c.id
                WHERE tcs.teacher_id = ?
            `, [t.id]);
        }
        res.json(teachers);
    } catch (err) { apiError(res, err); }
});

app.post('/api/teachers', authMiddleware, adminOnly, async (req, res) => {
    const { name, email, password, subject, role, assignments } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Nama, email, password wajib diisi' });

    try {
        let hash = password;
        try { const b = require('bcryptjs'); hash = await b.hash(password, 10); } catch {}

        const result = await dbRun('INSERT INTO teachers (name, email, password_hash, subject, role) VALUES (?,?,?,?,?)',
            [name, email, hash, subject || null, role || 'guru']);
        const teacherId = result.lastID;

        if (assignments?.length) {
            for (const a of assignments) {
                await dbRun('INSERT OR IGNORE INTO teacher_class_subjects (teacher_id, class_id, subject) VALUES (?,?,?)',
                    [teacherId, a.class_id, a.subject]);
            }
        }

        sync.syncTeacher({ id: teacherId, name, email, subject });
        io.emit('teachersUpdated');
        res.status(201).json({ success: true, id: teacherId, message: 'Guru berhasil ditambahkan' });
    } catch (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ success: false, message: 'Email sudah terdaftar' });
        apiError(res, err);
    }
});

app.put('/api/teachers/:id', authMiddleware, adminOnly, async (req, res) => {
    const { name, email, subject, role, password, assignments } = req.body;
    const teacherId = req.params.id;
    try {
        if (password) {
            let hash = password;
            try { const b = require('bcryptjs'); hash = await b.hash(password, 10); } catch {}
            await dbRun('UPDATE teachers SET name=?, email=?, subject=?, role=?, password_hash=? WHERE id=?',
                [name, email, subject, role, hash, teacherId]);
        } else {
            await dbRun('UPDATE teachers SET name=?, email=?, subject=?, role=? WHERE id=?',
                [name, email, subject, role, teacherId]);
        }

        if (assignments !== undefined) {
            await dbRun('DELETE FROM teacher_class_subjects WHERE teacher_id = ?', [teacherId]);
            for (const a of (assignments || [])) {
                await dbRun('INSERT OR IGNORE INTO teacher_class_subjects (teacher_id, class_id, subject) VALUES (?,?,?)',
                    [teacherId, a.class_id, a.subject]);
            }
        }

        sync.syncTeacher({ id: teacherId, name, email, subject });
        io.emit('teachersUpdated');
        res.json({ success: true, message: 'Data guru berhasil diperbarui' });
    } catch (err) { apiError(res, err); }
});

app.delete('/api/teachers/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM teachers WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ success: false, message: 'Guru tidak ditemukan' });
        sync.syncDelete('teachers', req.params.id);
        io.emit('teachersUpdated');
        res.json({ success: true, message: 'Guru berhasil dihapus' });
    } catch (err) { apiError(res, err); }
});

// Get assignments for a teacher
app.get('/api/teachers/:id/assignments', authMiddleware, async (req, res) => {
    try {
        const rows = await dbAll(`
            SELECT tcs.id, tcs.class_id, tcs.subject, c.name as class_name
            FROM teacher_class_subjects tcs
            JOIN classes c ON tcs.class_id = c.id
            WHERE tcs.teacher_id = ?
            ORDER BY c.name, tcs.subject
        `, [req.params.id]);
        res.json(rows);
    } catch (err) { apiError(res, err); }
});

// ============================================
// STUDENTS API
// ============================================
app.get('/api/students', async (req, res) => {
    const { classId } = req.query;
    let sql = `SELECT s.id, s.nisn, s.name, s.class_id, c.name as class_name
               FROM students s LEFT JOIN classes c ON s.class_id = c.id`;
    const params = [];
    if (classId) { sql += ' WHERE s.class_id = ?'; params.push(classId); }
    sql += ' ORDER BY c.name, s.name';
    try {
        res.json(await dbAll(sql, params));
    } catch (err) { apiError(res, err); }
});

app.post('/api/students/upload', authMiddleware, adminOnly, upload.single('csvFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'File CSV diperlukan' });

    const { mode } = req.body;
    const filePath = req.file.path;
    const students = [];

    try {
        await new Promise((resolve, reject) => {
            fs.createReadStream(filePath).pipe(csv())
                .on('data', (row) => {
                    const nisn = (row.nisn || row.NISN || '').toString().trim();
                    const nama = (row.nama || row.Nama || '').toString().trim();
                    const kelas = (row.kelas || row.Kelas || '').toString().trim();
                    if (nama && kelas) students.push({ nisn, name: nama, className: kelas });
                })
                .on('end', resolve).on('error', reject);
        });

        try { fs.unlinkSync(filePath); } catch {}

        if (!students.length) return res.status(400).json({ success: false, message: 'Tidak ada data valid di CSV (kolom: nisn, nama, kelas)' });

        if (mode === 'overwrite') {
            await dbRun('DELETE FROM students');
            await dbRun('DELETE FROM classes');
        }

        let added = 0, skipped = 0;
        const classCache = {};
        const addedStudents = [];

        for (const s of students) {
            if (!classCache[s.className]) {
                let cls = await dbGet('SELECT id FROM classes WHERE name = ?', [s.className]);
                if (!cls) {
                    const r = await dbRun('INSERT OR IGNORE INTO classes (name) VALUES (?)', [s.className]);
                    cls = { id: r.lastID };
                    sync.syncClass({ id: r.lastID, name: s.className });
                }
                classCache[s.className] = cls.id;
            }

            try {
                const r = await dbRun('INSERT OR IGNORE INTO students (nisn, name, class_id) VALUES (?,?,?)',
                    [s.nisn || null, s.name, classCache[s.className]]);
                if (r.changes > 0) {
                    addedStudents.push({ id: r.lastID, nisn: s.nisn, name: s.name, class_id: classCache[s.className] });
                    added++;
                } else { skipped++; }
            } catch { skipped++; }
        }

        sync.syncStudentsBatch(addedStudents);
        io.emit('studentsUpdated');
        res.json({ success: true, message: `${added} siswa berhasil ditambahkan, ${skipped} dilewati` });
    } catch (err) {
        try { fs.unlinkSync(filePath); } catch {}
        apiError(res, err);
    }
});

app.delete('/api/students/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM students WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan' });
        sync.syncDelete('students', req.params.id);
        io.emit('studentsUpdated');
        res.json({ success: true, message: 'Siswa berhasil dihapus' });
    } catch (err) { apiError(res, err); }
});

app.delete('/api/students/class/:classId', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM students WHERE class_id = ?', [req.params.classId]);
        io.emit('studentsUpdated');
        res.json({ success: true, message: `${result.changes} siswa berhasil dihapus` });
    } catch (err) { apiError(res, err); }
});

// ============================================
// ATTENDANCE API
// ============================================
app.get('/api/attendance', async (req, res) => {
    const { date, classId, lesson } = req.query;
    if (!date || !classId || !lesson) return res.status(400).json({ success: false, message: 'Parameter date, classId, lesson diperlukan' });

    try {
        const rows = await dbAll(`
            SELECT a.student_id, a.status, a.notes
            FROM attendance a
            JOIN students s ON a.student_id = s.id
            WHERE a.date = ? AND a.lesson = ? AND s.class_id = ?
        `, [date, lesson, classId]);

        const log = rows.reduce((acc, r) => { acc[r.student_id] = { status: r.status, notes: r.notes }; return acc; }, {});
        res.json(log);
    } catch (err) { apiError(res, err); }
});

app.post('/api/attendance/batch', authMiddleware, async (req, res) => {
    const { date, lesson, subject, classId, attendanceData } = req.body;
    if (!date || !lesson || !classId || !attendanceData?.length) {
        return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
    }

    try {
        const addedRecords = [];
        for (const item of attendanceData) {
            const existing = await dbGet('SELECT id FROM attendance WHERE student_id=? AND date=? AND lesson=?',
                [item.student_id, date, lesson]);

            if (existing) {
                await dbRun('UPDATE attendance SET status=?, notes=?, teacher_id=?, subject=? WHERE id=?',
                    [item.status, item.notes || null, req.teacher.id, subject || null, existing.id]);
                addedRecords.push({ id: existing.id, student_id: item.student_id, teacher_id: req.teacher.id, date, lesson, subject, status: item.status, notes: item.notes });
            } else {
                const r = await dbRun('INSERT INTO attendance (student_id, teacher_id, date, lesson, subject, status, notes) VALUES (?,?,?,?,?,?,?)',
                    [item.student_id, req.teacher.id, date, lesson, subject || null, item.status, item.notes || null]);
                addedRecords.push({ id: r.lastID, student_id: item.student_id, teacher_id: req.teacher.id, date, lesson, subject, status: item.status, notes: item.notes });
            }
        }

        sync.syncAttendanceBatch(addedRecords);

        // Emit realtime update
        const summary = await getTodaySummary();
        io.emit('attendanceUpdated', { classId, date, lesson, summary });

        res.json({ success: true, message: `Absensi ${attendanceData.length} siswa berhasil disimpan` });
    } catch (err) { apiError(res, err); }
});

app.get('/api/attendance/summary/today', async (req, res) => {
    try {
        res.json(await getTodaySummary());
    } catch (err) { apiError(res, err); }
});

app.get('/api/attendance/summary/class', async (req, res) => {
    const { classId, startDate, endDate } = req.query;
    try {
        const rows = await dbAll(`
            SELECT s.id, s.name, s.nisn,
                SUM(CASE WHEN a.status='H' THEN 1 ELSE 0 END) as hadir,
                SUM(CASE WHEN a.status='I' THEN 1 ELSE 0 END) as izin,
                SUM(CASE WHEN a.status='S' THEN 1 ELSE 0 END) as sakit,
                SUM(CASE WHEN a.status='A' THEN 1 ELSE 0 END) as alpha,
                COUNT(a.id) as total
            FROM students s
            LEFT JOIN attendance a ON s.id = a.student_id
                AND (? IS NULL OR a.date >= ?)
                AND (? IS NULL OR a.date <= ?)
            WHERE s.class_id = ?
            GROUP BY s.id, s.name, s.nisn
            ORDER BY s.name
        `, [startDate || null, startDate || null, endDate || null, endDate || null, classId]);
        res.json(rows);
    } catch (err) { apiError(res, err); }
});

app.get('/api/attendance/report', async (req, res) => {
    const { startDate, endDate, classId } = req.query;
    try {
        let sql = `
            SELECT a.date, a.lesson, a.subject, a.status, a.notes,
                s.name as student_name, s.nisn,
                c.name as class_name, t.name as teacher_name
            FROM attendance a
            JOIN students s ON a.student_id = s.id
            JOIN classes c ON s.class_id = c.id
            LEFT JOIN teachers t ON a.teacher_id = t.id
            WHERE 1=1
        `;
        const params = [];
        if (startDate) { sql += ' AND a.date >= ?'; params.push(startDate); }
        if (endDate) { sql += ' AND a.date <= ?'; params.push(endDate); }
        if (classId) { sql += ' AND s.class_id = ?'; params.push(classId); }
        sql += ' ORDER BY a.date DESC, c.name, s.name, a.lesson';
        res.json(await dbAll(sql, params));
    } catch (err) { apiError(res, err); }
});

async function getTodaySummary() {
    const today = new Date().toISOString().split('T')[0];
    const rows = await dbAll(`
        SELECT c.name as kelas, a.status, COUNT(*) as count
        FROM attendance a
        JOIN students s ON a.student_id = s.id
        JOIN classes c ON s.class_id = c.id
        WHERE a.date = ?
        GROUP BY c.name, a.status
    `, [today]);

    const totalStudents = await dbGet('SELECT COUNT(*) as count FROM students');
    const uniquePresent = await dbGet(`SELECT COUNT(DISTINCT student_id) as count FROM attendance WHERE date = ?`, [today]);

    return {
        date: today,
        totalStudents: totalStudents?.count || 0,
        uniquePresent: uniquePresent?.count || 0,
        byClass: rows,
        byStatus: {
            H: rows.filter(r => r.status === 'H').reduce((a, b) => a + b.count, 0),
            I: rows.filter(r => r.status === 'I').reduce((a, b) => a + b.count, 0),
            S: rows.filter(r => r.status === 'S').reduce((a, b) => a + b.count, 0),
            A: rows.filter(r => r.status === 'A').reduce((a, b) => a + b.count, 0),
        }
    };
}

// ============================================
// VIOLATIONS API
// ============================================
app.get('/api/violations/categories', async (req, res) => {
    try { res.json(await dbAll('SELECT * FROM violation_categories ORDER BY name')); }
    catch (err) { apiError(res, err); }
});

app.post('/api/violations/categories', authMiddleware, adminOnly, async (req, res) => {
    const { name, description, default_points } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Nama kategori wajib diisi' });
    try {
        const r = await dbRun('INSERT INTO violation_categories (name, description, default_points) VALUES (?,?,?)',
            [name, description || null, default_points || 1]);
        sync.syncViolationCategory({ id: r.lastID, name, description, default_points });
        res.status(201).json({ success: true, id: r.lastID });
    } catch (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ success: false, message: 'Kategori sudah ada' });
        apiError(res, err);
    }
});

app.delete('/api/violations/categories/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        await dbRun('DELETE FROM violation_categories WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) { apiError(res, err); }
});

app.get('/api/violations', async (req, res) => {
    const { studentId, classId, startDate, endDate, categoryId } = req.query;
    let sql = `
        SELECT v.id, v.date, v.description, v.points, v.followup, v.created_at,
            s.name as student_name, s.nisn, s.class_id,
            c.name as class_name,
            t.name as teacher_name,
            vc.name as category_name
        FROM violations v
        JOIN students s ON v.student_id = s.id
        LEFT JOIN classes c ON s.class_id = c.id
        LEFT JOIN teachers t ON v.teacher_id = t.id
        LEFT JOIN violation_categories vc ON v.category_id = vc.id
        WHERE 1=1
    `;
    const params = [];
    if (studentId) { sql += ' AND v.student_id = ?'; params.push(studentId); }
    if (classId) { sql += ' AND s.class_id = ?'; params.push(classId); }
    if (startDate) { sql += ' AND v.date >= ?'; params.push(startDate); }
    if (endDate) { sql += ' AND v.date <= ?'; params.push(endDate); }
    if (categoryId) { sql += ' AND v.category_id = ?'; params.push(categoryId); }
    sql += ' ORDER BY v.date DESC, v.created_at DESC';

    try { res.json(await dbAll(sql, params)); }
    catch (err) { apiError(res, err); }
});

app.post('/api/violations', authMiddleware, async (req, res) => {
    const { student_id, category_id, date, description, points, followup } = req.body;
    if (!student_id || !date) return res.status(400).json({ success: false, message: 'student_id dan date wajib diisi' });

    try {
        const r = await dbRun(
            'INSERT INTO violations (student_id, teacher_id, category_id, date, description, points, followup) VALUES (?,?,?,?,?,?,?)',
            [student_id, req.teacher.id, category_id || null, date, description || null, points || 1, followup || null]
        );

        const violation = { id: r.lastID, student_id, teacher_id: req.teacher.id, category_id, date, description, points, followup };
        sync.syncViolation(violation);

        // Ambil detail untuk emit
        const detail = await dbGet(`
            SELECT v.*, s.name as student_name, c.name as class_name, vc.name as category_name
            FROM violations v
            JOIN students s ON v.student_id = s.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN violation_categories vc ON v.category_id = vc.id
            WHERE v.id = ?
        `, [r.lastID]);

        io.emit('violationAdded', detail);
        res.status(201).json({ success: true, id: r.lastID, message: 'Pelanggaran berhasil dicatat' });
    } catch (err) { apiError(res, err); }
});

app.put('/api/violations/:id', authMiddleware, async (req, res) => {
    const { category_id, date, description, points, followup } = req.body;
    try {
        await dbRun('UPDATE violations SET category_id=?, date=?, description=?, points=?, followup=? WHERE id=?',
            [category_id, date, description, points, followup, req.params.id]);
        io.emit('violationUpdated');
        res.json({ success: true, message: 'Pelanggaran berhasil diperbarui' });
    } catch (err) { apiError(res, err); }
});

app.delete('/api/violations/:id', authMiddleware, async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM violations WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
        sync.syncDelete('violations', req.params.id);
        io.emit('violationUpdated');
        res.json({ success: true, message: 'Pelanggaran berhasil dihapus' });
    } catch (err) { apiError(res, err); }
});

app.get('/api/violations/summary', async (req, res) => {
    const { classId } = req.query;
    let sql = `
        SELECT s.id, s.name, s.nisn, c.name as class_name,
            COUNT(v.id) as total_violations,
            COALESCE(SUM(v.points), 0) as total_points
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.id
        LEFT JOIN violations v ON v.student_id = s.id
        WHERE 1=1
    `;
    const params = [];
    if (classId) { sql += ' AND s.class_id = ?'; params.push(classId); }
    sql += ' GROUP BY s.id ORDER BY total_points DESC, s.name';
    try { res.json(await dbAll(sql, params)); }
    catch (err) { apiError(res, err); }
});

// ============================================
// EXPORT API
// ============================================
app.get('/api/export/attendance', async (req, res) => {
    const { startDate, endDate, classId, format } = req.query;
    try {
        let sql = `
            SELECT a.date, s.nisn, s.name as nama, c.name as kelas,
                a.lesson as jam_ke, a.subject as mapel, a.status, a.notes as keterangan
            FROM attendance a
            JOIN students s ON a.student_id = s.id
            JOIN classes c ON s.class_id = c.id
            WHERE 1=1
        `;
        const params = [];
        if (startDate) { sql += ' AND a.date >= ?'; params.push(startDate); }
        if (endDate) { sql += ' AND a.date <= ?'; params.push(endDate); }
        if (classId) { sql += ' AND s.class_id = ?'; params.push(classId); }
        sql += ' ORDER BY a.date, c.name, s.name, a.lesson';

        const rows = await dbAll(sql, params);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Tidak ada data' });

        const statusLabel = { H: 'Hadir', I: 'Izin', S: 'Sakit', A: 'Alpha' };
        const header = 'Tanggal,NISN,Nama,Kelas,Jam Ke,Mata Pelajaran,Status,Keterangan\n';
        const csvData = rows.map(r =>
            `${r.date},${r.nisn || ''},${r.nama},"${r.kelas}",${r.jam_ke},${r.mapel || ''},${statusLabel[r.status] || r.status},${r.keterangan || ''}`
        ).join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=absensi_${startDate || 'all'}_${endDate || 'all'}.csv`);
        res.send('\uFEFF' + header + csvData); // BOM for Excel compatibility
    } catch (err) { apiError(res, err); }
});

app.get('/api/export/violations', async (req, res) => {
    const { startDate, endDate, classId } = req.query;
    try {
        let sql = `
            SELECT v.date, s.nisn, s.name as nama, c.name as kelas,
                vc.name as kategori, v.description as deskripsi, v.points as poin,
                v.followup as tindak_lanjut, t.name as dicatat_oleh
            FROM violations v
            JOIN students s ON v.student_id = s.id
            LEFT JOIN classes c ON s.class_id = c.id
            LEFT JOIN violation_categories vc ON v.category_id = vc.id
            LEFT JOIN teachers t ON v.teacher_id = t.id
            WHERE 1=1
        `;
        const params = [];
        if (startDate) { sql += ' AND v.date >= ?'; params.push(startDate); }
        if (endDate) { sql += ' AND v.date <= ?'; params.push(endDate); }
        if (classId) { sql += ' AND s.class_id = ?'; params.push(classId); }
        sql += ' ORDER BY v.date DESC, s.name';

        const rows = await dbAll(sql, params);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Tidak ada data' });

        const header = 'Tanggal,NISN,Nama,Kelas,Kategori,Deskripsi,Poin,Tindak Lanjut,Dicatat Oleh\n';
        const csvData = rows.map(r =>
            `${r.date},${r.nisn || ''},${r.nama},"${r.kelas}","${r.kategori || ''}","${r.deskripsi || ''}",${r.poin},"${r.tindak_lanjut || ''}",${r.dicatat_oleh || ''}`
        ).join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=pelanggaran_${startDate || 'all'}.csv`);
        res.send('\uFEFF' + header + csvData);
    } catch (err) { apiError(res, err); }
});

// ============================================
// SUPABASE BACKUP API
// ============================================
app.get('/api/backup/status', authMiddleware, adminOnly, async (req, res) => {
    const status = await sync.checkStatus();
    res.json(status);
});

app.post('/api/backup/full', authMiddleware, adminOnly, async (req, res) => {
    const result = await sync.fullBackup(db);
    res.json(result);
});

// ============================================
// STATS API (untuk dashboard)
// ============================================
app.get('/api/stats/dashboard', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const [totalSiswa, totalGuru, totalKelas, absensiHariIni, pelanggaranHariIni, totalPelanggaran] = await Promise.all([
            dbGet('SELECT COUNT(*) as count FROM students'),
            dbGet('SELECT COUNT(*) as count FROM teachers WHERE role = "guru"'),
            dbGet('SELECT COUNT(*) as count FROM classes'),
            dbGet(`SELECT COUNT(DISTINCT student_id) as count FROM attendance WHERE date = ?`, [today]),
            dbGet(`SELECT COUNT(*) as count FROM violations WHERE date = ?`, [today]),
            dbGet('SELECT COUNT(*) as count, COALESCE(SUM(points),0) as total_points FROM violations')
        ]);

        // Tren absensi 7 hari terakhir
        const trendData = await dbAll(`
            SELECT date, 
                SUM(CASE WHEN status='H' THEN 1 ELSE 0 END) as hadir,
                SUM(CASE WHEN status='I' THEN 1 ELSE 0 END) as izin,
                SUM(CASE WHEN status='S' THEN 1 ELSE 0 END) as sakit,
                SUM(CASE WHEN status='A' THEN 1 ELSE 0 END) as alpha
            FROM attendance
            WHERE date >= date('now', '-7 days')
            GROUP BY date ORDER BY date
        `);

        // Top pelanggar
        const topViolators = await dbAll(`
            SELECT s.name, c.name as kelas, COUNT(v.id) as total, SUM(v.points) as poin
            FROM violations v
            JOIN students s ON v.student_id = s.id
            LEFT JOIN classes c ON s.class_id = c.id
            GROUP BY v.student_id ORDER BY poin DESC LIMIT 5
        `);

        res.json({
            stats: {
                totalSiswa: totalSiswa?.count || 0,
                totalGuru: totalGuru?.count || 0,
                totalKelas: totalKelas?.count || 0,
                absensiHariIni: absensiHariIni?.count || 0,
                pelanggaranHariIni: pelanggaranHariIni?.count || 0,
                totalPelanggaran: totalPelanggaran?.count || 0,
                totalPoinPelanggaran: totalPelanggaran?.total_points || 0
            },
            trendData,
            topViolators
        });
    } catch (err) { apiError(res, err); }
});

// ============================================
// PAGE ROUTES
// ============================================
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_PATH, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(FRONTEND_PATH, 'dashboard.html')));
app.get('/absensi', (req, res) => res.sendFile(path.join(FRONTEND_PATH, 'absensi-mobile.html')));
app.get('/pelanggaran', (req, res) => res.sendFile(path.join(FRONTEND_PATH, 'pelanggaran-mobile.html')));
app.get('/data-siswa', (req, res) => res.sendFile(path.join(FRONTEND_PATH, 'data-siswa.html')));
app.get('/data-guru', (req, res) => res.sendFile(path.join(FRONTEND_PATH, 'data-guru.html')));

// ============================================
// SOCKET.IO
// ============================================
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    // Kirim summary saat client konek
    getTodaySummary().then(summary => socket.emit('initialData', summary)).catch(() => {});
    socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ============================================
// ERROR HANDLING & START
// ============================================
app.use((req, res) => res.status(404).json({ message: 'Endpoint tidak ditemukan' }));
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
});

process.on('SIGINT', () => {
    db.close(() => { console.log('DB closed'); process.exit(0); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server: http://localhost:${PORT}`);
    console.log(`📱 Absensi Mobile: http://localhost:${PORT}/absensi`);
    console.log(`🌐 Dashboard: http://localhost:${PORT}/dashboard`);
});
