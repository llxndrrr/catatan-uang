# Catatan Uang

Aplikasi web untuk mencatat keuangan pribadi: pengeluaran bulanan, tabungan, dan emas. Harga emasnya diperbarui otomatis. Latarnya berupa awan partikel yang bergerak.

**🔗 Coba langsung:** https://llxndrrr.github.io/catatan-uang/

## Fitur

- **Catat**: masukkan gaji atau uang masuk bulan ini, catat setiap pengeluaran, lalu lihat sisa uang dan bar pemakaiannya.
- **Tabungan**: pantau tabungan reksa dana pasar uang (RDPU), plus **dana dingin** (dana darurat) dengan target dan progress bar.
- **Emas**: catat pembelian emas. Harga emas per gram (dalam Rupiah) diambil otomatis setiap 3 jam dari API publik.
- **Rekap**: ringkasan pemasukan dan pengeluaran per bulan.
- **Simpan ke cloud (opsional)**: masuk dengan akun Google, catatan tersinkron otomatis antara HP dan laptop.
- **Backup & pulihkan**: simpan data ke file, lalu pulihkan lagi kapan saja.
- **Tampilan HP**: sisa uang tetap kelihatan di layar kecil.
- **Latar partikel animasi** yang digambar dengan Canvas.

## Privasi

Tanpa masuk akun, semua data tersimpan di **browser kamu sendiri** (`localStorage`) dan nggak dikirim ke mana pun. Yang diambil dari internet cuma harga emas dan kurs.

Kalau kamu memilih **masuk dengan Google**, isi aplikasi juga disimpan di Firebase Firestore, satu dokumen per akun. [Aturan keamanannya](firestore.rules) memastikan setiap akun **hanya bisa membaca dan mengubah catatannya sendiri**. Aturan ini sudah dites di Firebase Emulator dengan 33 skenario, termasuk percobaan membaca catatan akun lain dan menulis tanpa login. Saat keluar, kamu bisa memilih menghapus data dari perangkat itu (penting kalau pakai komputer umum).

## Teknologi

- HTML, CSS, dan JavaScript murni, tanpa framework
- Canvas API untuk animasi partikel
- `localStorage` untuk penyimpanan di browser
- Firebase Authentication (login Google) dan Cloud Firestore untuk sinkron cloud, dengan SDK yang dibundel di repo (tanpa CDN)
- [gold-api.com](https://gold-api.com) dan [open.er-api.com](https://open.er-api.com) untuk harga emas dan kurs

## Cara menjalankan

1. Download atau clone repo ini.
2. Buka `index.html` di browser.

Selesai. Nggak perlu install apa-apa.

---

Dibuat oleh [Abraham Alex](https://github.com/llxndrrr).
