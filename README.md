# Sistem Absensi & Pelanggaran Sekolah

Sistem absensi realtime dengan backup Supabase untuk sekolah. Dibangun dengan Node.js, SQLite (primary), dan Supabase (backup cloud).

## 🚀 Fitur Utama

- **Absensi Realtime** - Dashboard update otomatis saat guru input absensi (WebSocket)
- **Pelanggaran Siswa** - Input dan rekap pelanggaran dengan sistem poin
- **Multi-platform** - WebView Android untuk guru + Dashboard web untuk admin
- **Backup Otomatis** - Data di-backup ke Supabase secara asynchronous
- **Export Data** - Export absensi dan pelanggaran ke CSV/Excel
- **Manajemen Data** - CRUD siswa, guru, kelas, dan kategori pelanggaran

## 📁 Struktur Folder

```
/workspace/
├── server.js                 # Backend utama (Express + SQLite + Socket.IO)
├── supabase-sync.js          # Module sync ke Supabase
├── supabase-schema.sql       # Schema SQL untuk Supabase
├── package.json              # Dependencies Node.js
├── frontend/
│   ├── login.html            # Halaman login
│   ├── dashboard.html        # Dashboard admin dengan monitor realtime
│   ├── data-siswa.html       # Manajemen data siswa
│   ├── pelanggaran-dashboard.html  # Rekap pelanggaran
│   ├── absensi-mobile.html   # UI absensi untuk WebView Android
│   └── pelanggaran-mobile.html     # UI input pelanggaran mobile
├── database/                 # SQLite database (auto-created)
└── uploads/                  # Temporary upload folder
```

## 🔧 Instalasi

### 1. Install Dependencies

```bash
cd /workspace
npm install
```

### 2. Setup Supabase (Optional - untuk backup)

Jalankan schema SQL di Supabase SQL Editor:
- File: `supabase-schema.sql`
- URL Project: https://wfvbbqyvckdvfocgkpvk.supabase.co

### 3. Jalankan Server

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

Server akan berjalan di: `http://localhost:3000`

## 📱 Akses Aplikasi

| Halaman | URL | Deskripsi |
|---------|-----|-----------|
| Login | `/` | Halaman login semua user |
| Dashboard | `/dashboard` | Dashboard admin dengan monitor realtime |
| Data Siswa | `/data-siswa` | CRUD siswa + upload CSV |
| Pelanggaran | `/pelanggaran-dashboard` | Rekap pelanggaran siswa |
| Input Absensi | `/absensi` | UI mobile untuk guru (WebView) |
| Input Pelanggaran | `/pelanggaran` | UI mobile input pelanggaran |

## 🔐 Default Login

```
Email: admin@sekolah.sch.id
Password: admin123
```

## 🛠️ API Endpoints

### Auth
- `POST /api/auth/login` - Login user

### Classes
- `GET /api/classes` - List kelas
- `POST /api/classes` - Tambah kelas (admin only)
- `DELETE /api/classes/:id` - Hapus kelas (admin only)

### Students
- `GET /api/students` - List siswa (filter by classId)
- `POST /api/students` - Tambah siswa
- `POST /api/students/upload` - Upload CSV siswa
- `DELETE /api/students/:id` - Hapus siswa

### Attendance
- `POST /api/attendance/batch` - Submit absensi batch
- `GET /api/attendance/today` - Absensi hari ini
- `GET /api/export/attendance` - Export CSV absensi

### Violations
- `GET /api/violations/categories` - List kategori pelanggaran
- `GET /api/violations` - List pelanggaran
- `POST /api/violations` - Input pelanggaran
- `GET /api/violations/summary` - Rekap per siswa
- `GET /api/export/violations` - Export CSV pelanggaran

### Stats & Backup
- `GET /api/stats/dashboard` - Statistik dashboard
- `GET /api/backup/status` - Status koneksi Supabase
- `POST /api/backup/full` - Full backup manual

## 🔄 Realtime Updates

Dashboard menggunakan Socket.IO untuk update realtime:
- `attendanceUpdated` - Trigger saat ada absensi baru
- `violationUpdated` - Trigger saat ada pelanggaran baru
- `initialData` - Data awal saat client connect

## 💾 Backup Supabase

Sistem menggunakan arsitektur hybrid:
- **Primary**: SQLite lokal (cepat, offline-capable)
- **Backup**: Supabase PostgreSQL (cloud mirror)

Sync dilakukan secara asynchronous setelah operasi SQLite berhasil, tidak memblokir response API.

## 📊 Database Schema

### Tables (SQLite & Supabase)
- `classes` - Data kelas
- `teachers` - Data guru/admin
- `teacher_class_subjects` - Relasi guru-kelas-mapel
- `students` - Data siswa
- `attendance` - Record absensi (H/I/S/A)
- `violation_categories` - Kategori pelanggaran
- `violations` - Record pelanggaran

## 🎨 Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **Database**: SQLite3 (primary), Supabase (backup)
- **Frontend**: Vanilla JS, HTML5, CSS3
- **Mobile**: WebView-compatible UI
- **Charts**: Chart.js

## 📝 License

MIT License

---

Dibuat dengan ❤️ untuk sistem pendidikan Indonesia
