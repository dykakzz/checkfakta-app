# SaringFakta — Pemindai Fakta Video & Tautan Media Sosial

**SaringFakta** adalah aplikasi web satu halaman (*Single-Page Social Video & Link Fact-Scanner*) untuk memverifikasi kebenaran klaim dari **video Instagram Reels, TikTok, Facebook, YouTube Shorts, tangkapan layar (screenshot), foto, maupun artikel berita** secara real-time.

---

## Panduan Konfigurasi Rahasia (Khusus Pemilik Aplikasi)

Pengunjung web publik hanya melihat antarmuka pemindai dan hasil cek fakta yang bersih. Seluruh kunci rahasia dikelola di belakang layar:

### 1. Mengatur Gemini API Key & Token Bot Telegram (Tanpa Terlihat Publik)
Di Google AI Studio, buka panel **Settings (ikon roda gigi) > Secrets**, lalu tambahkan:
- `CUSTOM_GEMINI_API_KEY`: *(Opsional — Prioritas 1)* Jika diisi lewat **Add Secret**, server otomatis memakai API Key Free Tier pilihan Anda sebagai prioritas utama (cocok bila ingin memisahkan kuota dari project default).
- `GEMINI_API_KEY`: API Key Google Gemini bawaan (cadangan otomatis bila `CUSTOM_GEMINI_API_KEY` kosong).
- `TELEGRAM_BOT_TOKEN`: *(Opsional)* Token Bot dari `@BotFather` jika Anda menghubungkan Bot Telegram ke server Cloud Run publik. Saat server menyala, webhook `/api/telegram/webhook` akan ditautkan secara otomatis di belakang layar. *(Kosongkan variabel ini jika Anda memilih menjalankan bot lewat Google Apps Script agar webhook tidak saling timpa.)*

### 2. Opsi Bot Telegram via Google Apps Script Standalone
Jika Anda ingin menjalankan Bot Telegram secara terpisah 24/7 (100% berdiri sendiri di akun Google Anda tanpa bergantung pada server web ini), buka file internal berikut:
- `/scripts/telegram-bot-standalone.gs`

Salin isi file tersebut ke [script.google.com](https://script.google.com), isi `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, dan `WEB_APP_URL` di dalam editor GAS Anda (jangan pernah commit token asli ke repositori publik), lalu deploy sebagai *Web App*.

### 3. Model AI & Ketahanan Kuota
Server Web App (mode Analisis Mendalam) dan script GAS standalone sama-sama memakai urutan fallback 4 lapis yang ramah Free Tier: **`gemini-4-hydrogen` (`thinkingLevel: LOW`)** sebagai model utama dengan cadangan otomatis **`gemini-3.1-flash-lite`**.
