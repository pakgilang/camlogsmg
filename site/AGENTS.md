# CAMLOG — Site Module Documentation

Dokumen ini mendokumentasikan aturan lokal, alur kerja, dan batasan teknis di bawah direktori `site/`.

## Cakupan Modul
Direktori ini berisi seluruh aset frontend, kode kontroler aplikasi, dan logika kompresi/penyimpanan lokal/sinkronisasi.

## Indeks Berkas & Tanggung Jawab
* [index.html](file:///d:/CODEX/CAMLOG/site/index.html) — Tata letak UI, ikon SVG, modal pilihan, dan visualisasi multi-tema.
* [app.js](file:///d:/CODEX/CAMLOG/site/app.js) — Logika kontrol utama, event binding, penanganan transisi view, dan sinkronisasi status UI.
* [sw.js](file:///d:/CODEX/CAMLOG/site/sw.js) — Service worker yang mengatur caching offline static assets (termasuk CDN Tailwind & Google Fonts) dan dynamic resources.
* [smg_normalizer.js](file:///d:/CODEX/CAMLOG/site/smg_normalizer.js) — Validasi dan pemformatan otomatis No. PO berdasarkan wilayah/cabang.
* [smg_compress.js](file:///d:/CODEX/CAMLOG/site/smg_compress.js) & [compress_worker.js](file:///d:/CODEX/CAMLOG/site/compress_worker.js) — Kompresor gambar asinkron berbasis Web Worker.
* [smg_store.js](file:///d:/CODEX/CAMLOG/site/smg_store.js) & [smg_storage.js](file:///d:/CODEX/CAMLOG/site/smg_storage.js) — Pengatur state tersimpan lokal dan antarmuka database IndexedDB.
* [smg_uploader.js](file:///d:/CODEX/CAMLOG/site/smg_uploader.js) — Pengunggah data transaksi ke API Google Apps Script.

## Aturan Teknis Khuesus (`site/`)
1. **Aturan Caching sw.js:** 
   * Aset static CDN (Tailwind & Fonts) harus di-precache agar halaman langsung berbentuk rapi saat dibuka tanpa internet.
   * Hanya simpan respon dynamic fetch dengan status `200` (OK) atau `0` (CORS Opaque) untuk mencegah cache berkas rusak (seperti 404/500).
2. **Kamera & Galeri Fallback:**
   * Pengaturan `CAMERA_SOURCE` (`camera` atau `gallery`) disimpan di LocalStorage.
   * Jika bernilai `gallery`, atribut `capture` pada `<input id="camera-input">` harus dilepas agar pengguna dapat memilih gambar dari memori perangkat (bukan membuka kamera langsung).
3. **Pemberitahuan Edit Gambar:**
   * Di dalam lightbox, operator gudang dapat menggambar coretan (*draw*) atau memotong (*crop*) bukti dokumen fisik sebelum disimpan ke database IndexedDB.
