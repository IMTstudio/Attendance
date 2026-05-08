// supabase-sync.js
// Module untuk backup data ke Supabase
// Data utama tetap di SQLite lokal, Supabase hanya backup/cloud mirror

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wfvbbqyvckdvfocgkpvk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmdmJicXl2Y2tkdmZvY2drcHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5NTg4MjMsImV4cCI6MjA3NDUzNDgyM30.1EcE3fZTROixdTFabaIcP35qWE8kZplPAeQakev3fSs';

let supabase = null;
let syncEnabled = false;

// Queue untuk menyimpan operasi sync yang pending
const syncQueue = [];
let isSyncing = false;

function initSupabase() {
    try {
        supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        syncEnabled = true;
        console.log('✅ Supabase backup initialized');
        // Proses queue yang mungkin sudah ada
        processQueue();
    } catch (err) {
        console.warn('⚠️  Supabase backup disabled:', err.message);
        syncEnabled = false;
    }
}

// Tambah operasi ke queue
function enqueue(operation) {
    syncQueue.push(operation);
    if (!isSyncing) processQueue();
}

// Proses queue satu per satu (tidak bloking server utama)
async function processQueue() {
    if (isSyncing || syncQueue.length === 0 || !syncEnabled) return;
    isSyncing = true;

    while (syncQueue.length > 0) {
        const op = syncQueue.shift();
        try {
            await op();
        } catch (err) {
            console.warn('⚠️  Supabase sync error (skipped):', err.message);
        }
    }

    isSyncing = false;
}

// ============================================
// SYNC FUNCTIONS - Dipanggil setelah operasi SQLite berhasil
// ============================================

/**
 * Sync kelas ke Supabase
 */
function syncClass(classData) {
    if (!syncEnabled) return;
    enqueue(async () => {
        await supabase.from('classes').upsert({
            local_id: classData.id,
            name: classData.name,
            updated_at: new Date().toISOString()
        }, { onConflict: 'local_id' });
    });
}

/**
 * Sync data guru ke Supabase
 */
function syncTeacher(teacherData) {
    if (!syncEnabled) return;
    enqueue(async () => {
        await supabase.from('teachers').upsert({
            local_id: teacherData.id,
            name: teacherData.name,
            email: teacherData.email,
            subject: teacherData.subject,
            updated_at: new Date().toISOString()
        }, { onConflict: 'local_id' });
    });
}

/**
 * Sync data siswa ke Supabase
 */
function syncStudent(studentData) {
    if (!syncEnabled) return;
    enqueue(async () => {
        await supabase.from('students').upsert({
            local_id: studentData.id,
            nisn: studentData.nisn,
            name: studentData.name,
            class_local_id: studentData.class_id,
            updated_at: new Date().toISOString()
        }, { onConflict: 'local_id' });
    });
}

/**
 * Sync batch siswa (untuk upload CSV)
 */
function syncStudentsBatch(studentsArray) {
    if (!syncEnabled || !studentsArray.length) return;
    enqueue(async () => {
        const payload = studentsArray.map(s => ({
            local_id: s.id,
            nisn: s.nisn,
            name: s.name,
            class_local_id: s.class_id,
            updated_at: new Date().toISOString()
        }));
        // Batch upsert dalam chunk 100
        for (let i = 0; i < payload.length; i += 100) {
            const chunk = payload.slice(i, i + 100);
            await supabase.from('students').upsert(chunk, { onConflict: 'local_id' });
        }
    });
}

/**
 * Sync data absensi ke Supabase
 */
function syncAttendance(attendanceData) {
    if (!syncEnabled) return;
    enqueue(async () => {
        await supabase.from('attendance').upsert({
            local_id: attendanceData.id,
            student_local_id: attendanceData.student_id,
            teacher_local_id: attendanceData.teacher_id || null,
            date: attendanceData.date,
            lesson: attendanceData.lesson,
            subject: attendanceData.subject || null,
            status: attendanceData.status,
            notes: attendanceData.notes || null,
            synced_at: new Date().toISOString()
        }, { onConflict: 'local_id' });
    });
}

/**
 * Sync batch absensi
 */
function syncAttendanceBatch(attendanceArray) {
    if (!syncEnabled || !attendanceArray.length) return;
    enqueue(async () => {
        const payload = attendanceArray.map(a => ({
            local_id: a.id,
            student_local_id: a.student_id,
            teacher_local_id: a.teacher_id || null,
            date: a.date,
            lesson: a.lesson,
            subject: a.subject || null,
            status: a.status,
            notes: a.notes || null,
            synced_at: new Date().toISOString()
        }));
        for (let i = 0; i < payload.length; i += 100) {
            const chunk = payload.slice(i, i + 100);
            await supabase.from('attendance').upsert(chunk, { onConflict: 'local_id' });
        }
    });
}

/**
 * Sync kategori pelanggaran
 */
function syncViolationCategory(catData) {
    if (!syncEnabled) return;
    enqueue(async () => {
        await supabase.from('violation_categories').upsert({
            local_id: catData.id,
            name: catData.name,
            description: catData.description || null,
            default_points: catData.default_points || 1
        }, { onConflict: 'local_id' });
    });
}

/**
 * Sync pelanggaran ke Supabase
 */
function syncViolation(violationData) {
    if (!syncEnabled) return;
    enqueue(async () => {
        await supabase.from('violations').upsert({
            local_id: violationData.id,
            student_local_id: violationData.student_id,
            teacher_local_id: violationData.teacher_id || null,
            category_local_id: violationData.category_id || null,
            date: violationData.date,
            description: violationData.description || null,
            points: violationData.points || 1,
            followup: violationData.followup || null,
            synced_at: new Date().toISOString()
        }, { onConflict: 'local_id' });
    });
}

/**
 * Delete dari Supabase
 */
function syncDelete(table, localId) {
    if (!syncEnabled) return;
    enqueue(async () => {
        await supabase.from(table).delete().eq('local_id', localId);
    });
}

/**
 * Full backup - push semua data SQLite ke Supabase
 * Dipanggil manual dari admin dashboard
 */
async function fullBackup(db) {
    if (!syncEnabled) return { success: false, message: 'Supabase tidak aktif' };

    try {
        const tables = [
            { sql: 'SELECT * FROM classes', table: 'classes', mapFn: r => ({ local_id: r.id, name: r.name }) },
            { sql: 'SELECT * FROM teachers', table: 'teachers', mapFn: r => ({ local_id: r.id, name: r.name, email: r.email, subject: r.subject }) },
            { sql: 'SELECT * FROM students', table: 'students', mapFn: r => ({ local_id: r.id, nisn: r.nisn, name: r.name, class_local_id: r.class_id }) },
            { sql: 'SELECT * FROM violation_categories', table: 'violation_categories', mapFn: r => ({ local_id: r.id, name: r.name, description: r.description, default_points: r.default_points }) },
            { sql: 'SELECT * FROM attendance', table: 'attendance', mapFn: r => ({ local_id: r.id, student_local_id: r.student_id, teacher_local_id: r.teacher_id, date: r.date, lesson: r.lesson, subject: r.subject, status: r.status, notes: r.notes, synced_at: new Date().toISOString() }) },
            { sql: 'SELECT * FROM violations', table: 'violations', mapFn: r => ({ local_id: r.id, student_local_id: r.student_id, teacher_local_id: r.teacher_id, category_local_id: r.category_id, date: r.date, description: r.description, points: r.points, followup: r.followup, synced_at: new Date().toISOString() }) },
        ];

        let totalSynced = 0;
        for (const t of tables) {
            const rows = await new Promise((resolve, reject) => {
                db.all(t.sql, [], (err, rows) => err ? reject(err) : resolve(rows));
            });

            if (rows.length > 0) {
                const payload = rows.map(t.mapFn);
                for (let i = 0; i < payload.length; i += 100) {
                    const chunk = payload.slice(i, i + 100);
                    const { error } = await supabase.from(t.table).upsert(chunk, { onConflict: 'local_id' });
                    if (error) throw new Error(`Table ${t.table}: ${error.message}`);
                }
                totalSynced += rows.length;
            }
        }

        return { success: true, message: `Backup berhasil: ${totalSynced} record disinkronkan ke Supabase` };
    } catch (err) {
        return { success: false, message: `Backup gagal: ${err.message}` };
    }
}

/**
 * Cek status koneksi Supabase
 */
async function checkStatus() {
    if (!syncEnabled || !supabase) return { connected: false, message: 'Supabase tidak diinisialisasi' };
    try {
        const { error } = await supabase.from('classes').select('id').limit(1);
        if (error) throw error;
        return { connected: true, message: 'Supabase terhubung', queueLength: syncQueue.length };
    } catch (err) {
        return { connected: false, message: err.message };
    }
}

module.exports = {
    initSupabase,
    syncClass,
    syncTeacher,
    syncStudent,
    syncStudentsBatch,
    syncAttendance,
    syncAttendanceBatch,
    syncViolationCategory,
    syncViolation,
    syncDelete,
    fullBackup,
    checkStatus
};
