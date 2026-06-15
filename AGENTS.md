# CAMLOG — Root Agents Documentation

Dokumen ini berfungsi sebagai panduan arsitektur global untuk AI Agent yang bekerja pada repositori **CAMLOG**.

## Deskripsi & Tujuan Proyek
**CAMLOG** adalah aplikasi Progressive Web App (PWA) utilitas mobile-first yang dirancang untuk operator logistik Gudang SMG untuk mencatat nomor PO/GIT, mengambil/mengunggah foto bukti fisik barang (koli, material, surat jalan), dan menyinkronkan data secara offline-first.

## Arsitektur & Teknologi Utama
* **Frontend SPA:** Terdiri dari berkas HTML5, Vanilla JavaScript, dan CSS dengan framework Tailwind (CDN).
* **Pemrosesan Gambar:** Kompresi asinkron menggunakan Web Workers untuk menjaga performa UI tetap lancar (60 FPS).
* **Penyimpanan Lokal:** Menggunakan IndexedDB untuk menyimpan data foto terkompresi dan LocalStorage untuk pengaturan sederhana.
* **Sinkronisasi Luring (Offline-First):** Mendeteksi koneksi jaringan dan secara otomatis mengunggah data ke Google Apps Script (GAS) saat online.

## Aturan Pengembangan Global
1. **Performa Mobile:** Tombol harus berukuran besar untuk memudahkan ketukan jempol operator gudang di lapangan.
2. **Kinerja Rendah-Macet:** Proses kompresi gambar yang berat tidak boleh dijalankan di thread utama. Harus selalu didelegasikan ke Web Worker (`compress_worker.js`).
3. **PWA Standalone:** Perubahan CSS atau HTML harus kompatibel dengan rendering mandiri (standalone mode) di perangkat Android dan iOS.

## Indeks Direktori Utama
* [site/](file:///d:/CODEX/CAMLOG/site/AGENTS.md) — Seluruh kode sumber frontend aplikasi (HTML, CSS, JS, Service Worker, Web Workers).
