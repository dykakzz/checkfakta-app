# PROJECT_CONTEXT.md — SaringFakta (Single Source of Truth)

## 1. Ringkasan Tujuan Aplikasi
**SaringFakta** adalah aplikasi **Alat Pemindai & Pembedah Fakta Link Video Sosmed 1-Halaman (Single-Page Social Video & Link Fact-Scanner)** yang bersih dan siap dipublikasikan untuk penggunaan umum (*public trial*), dilengkapi dukungan **Bot Telegram 24/7** yang dikonfigurasi sepenuhnya di belakang layar (*server-side*).

### Cara Kerja Konfigurasi Rahasia (Khusus Pemilik Project)
Agar halaman web publik tetap bersih dan pengguna cukup langsung pakai (*easy-to-use*):
1. **Pengaturan API Key & Token Bot Telegram (Lewat Panel Secrets AI Studio / Cloud Run)**:
   - Buka **Settings (ikon roda gigi) > Secrets** di Google AI Studio, lalu isi:
     - `CUSTOM_GEMINI_API_KEY` *(opsional — Prioritas 1)*: Jika diisi via **Add Secret**, server otomatis memakai key Free Tier kustom pilihan pemilik (cocok untuk memakai key dari Project Google Cloud terpisah tanpa diarahkan ke billing).
     - `GEMINI_API_KEY` *(cadangan otomatis)*: API Key bawaan yang disuntikkan otomatis oleh Google AI Studio jika `CUSTOM_GEMINI_API_KEY` kosong.
     - `TELEGRAM_BOT_TOKEN`: Token Bot Telegram dari `@BotFather` (opsional, jika ingin mengaktifkan Bot Telegram 24/7 di Cloud Run).
   - Saat server (`server.ts`) menyala dan mendeteksi `TELEGRAM_BOT_TOKEN` + `APP_URL`, server otomatis mendaftarkan webhook `/api/telegram/webhook` ke server Telegram di belakang layar tanpa perlu form apapun di halaman web.
2. **Script Google Apps Script Standalone (`/scripts/telegram-bot-standalone.gs`)**:
   - Jika pemilik project ingin men-deploy Bot Telegram secara terpisah (100% independen dari web server ini) di akun Google Drive pribadinya, kode lengkapnya tersedia di file `/scripts/telegram-bot-standalone.gs` (hanya terlihat di kode sumber/repo, tidak pernah ditampilkan ke pengunjung web).

---

## 2. Tech Stack
- **Frontend**: React 19, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), Lucide React Icons, HTML5 `<canvas>` API (ekspor kartu PNG `1080x1350`).
- **Backend**: Node.js + Express (`server.ts`) dengan pemrosesan media murni di memori RAM (`0 MB Disk Impact`).
- **AI & Grounding SDK**: Resmi `@google/genai` (`>= 3.6.0`) di sisi server (`server/geminiClient.ts`) dengan prioritas utama `gemini-4-hydrogen` (`ThinkingLevel.LOW`) dan fallback otomatis ke `gemini-3.1-flash-lite` (selaras di Web App mode Mendalam dan Script GAS Standalone).

---

## 3. Peta Struktur Folder & Fungsi Tiap File

```text
/
├── .env.example                        # Template variabel environment (GEMINI_API_KEY, APP_URL, TELEGRAM_BOT_TOKEN)
├── index.html                          # Entry HTML berbahasa Indonesia + font Plus Jakarta Sans, DM Sans, JetBrains Mono
├── metadata.json                       # Metadata AI Studio (MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API)
├── package.json                        # Konfigurasi dependency dan script full-stack ("dev": "tsx server.ts")
├── PROJECT_CONTEXT.md                  # Dokumentasi konteks utama untuk handover antar-agent
├── README.md                           # Dokumentasi repositori & panduan konfigurasi Secrets pemilik
├── scripts/
│   └── telegram-bot-standalone.gs      # Kode Google Apps Script (Code.gs) standalone khusus pemilik project
├── server.ts                           # Server utama Express + Auto-Bootstrap Webhook Telegram saat startup
├── server/
│   ├── geminiClient.ts                 # Inisialisasi singleton GoogleGenAI server-side dengan header User-Agent: aistudio-build
│   ├── urlMediaExtractor.ts            # Multi-Stage In-Memory URL & Video Stream Extractor (TikTok, IG Reels, YT, Berita)
│   ├── webSearchFallback.ts            # Pencarian referensi berita & CekFakta Indonesia sisi server (penjaga akurasi Free Tier)
│   ├── factCheckService.ts             # Logika multimodal fact-check, In-Memory Link Cache, & Multi-Tier Quota Fallback
│   └── telegramService.ts              # Handler Webhook Bot Telegram 24/7
└── src/
    ├── App.tsx                         # Layout publik 1-Halaman (Scanner Video/Link + Laporan Verifikasi + Kartu Share WA)
    ├── index.css                       # Konfigurasi Tailwind v4, dark variant, dan variabel tipografi
    ├── main.tsx                        # Entry point React DOM
    ├── types/
    │   └── factCheck.ts                # Definisi tipe data TypeScript terpusat
    ├── services/
    │   └── factCheckApi.ts             # Pemanggilan HTTP client ke endpoint Express server
    ├── utils/
    │   └── canvasCardExporter.ts       # Renderer kartu ringkasan cek fakta ke gambar PNG 1080x1350 via HTML5 Canvas
    └── components/
        ├── Header.tsx                  # Navigasi atas bersih (3-Zone Top Bar Contract)
        ├── SocialVideoScannerBox.tsx   # Kotak pemindai utama (URL Reels/TikTok + Unggah Video/Screenshot)
        ├── FactCheckReportView.tsx     # Laporan hasil verifikasi (Info Sumber, Ucapan Video, Bukti Fakta, & Deteksi AI)
        └── ShareableCardStudio.tsx     # Pratinjau & ekspor kartu cek fakta ke WhatsApp / PNG
```

---

## 4. Status Fitur yang Sudah Selesai
- [x] Tampilan web publik 100% bersih tanpa jargon teknis ("RAM", "0 MB Disk", "Keluarga", dll.) dan tanpa form pengaturan bot/API key.
- [x] Auto-register Webhook Bot Telegram di belakang layar (`server.ts`) saat `TELEGRAM_BOT_TOKEN` disetel di *Secrets*.
- [x] Penyimpanan file kode Standalone Google Apps Script di `/scripts/telegram-bot-standalone.gs` khusus untuk pemilik project.
- [x] Ekstraksi stream video/audio & metadata dari link Instagram Reels, TikTok, Facebook (termasuk redirect `fb.watch`, `/share/r/`, `/share/v/`, dan *public video embed*), YouTube Shorts, dan berita.
- [x] Pengaman Anti-Halusinasi (*Strict Login-Wall & Boilerplate Sanitizer + Early-Return Gate*): berhenti jujur tanpa memanggil AI jika link Facebook/Instagram terkunci login wall (menampilkan tombol cepat unggah video/tempel klaim), serta menampilkan banner peringatan transparan jika analisis hanya bersumber dari teks *caption* tanpa suara video.
- [x] Transkripsi ucapan pembicara di dalam video + pembacaan teks visual (OCR) + deteksi Deepfake AI.
- [x] Klasifikasi **`OPINI / PENDAPAT PRIBADI`** berwarna biru/abu netral dengan pemisahan otomatis antara bagian opini subjektif pembicara dan verifikasi klaim data/angka/peristiwa yang diselipkan di dalamnya (pada laporan web, kartu PNG, dan teks WhatsApp/Telegram).
- [x] Kartu Ringkasan Siap Bagikan ke WhatsApp & Unduh PNG (`1080x1350`).
