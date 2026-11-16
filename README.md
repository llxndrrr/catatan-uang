# Catatan Uang

Aplikasi web untuk mencatat keuangan pribadi: pengeluaran bulanan, tabungan, dan emas. Harga emasnya diperbarui otomatis. Latarnya berupa awan partikel yang bergerak.

**🔗 Coba langsung:** https://llxndrrr.github.io/catatan-uang/

## Fitur

- **Catat**: masukkan gaji atau uang masuk bulan ini, catat setiap pengeluaran, lalu lihat sisa uang dan bar pemakaiannya.
- **Tabungan**: pantau tabungan reksa dana pasar uang (RDPU), plus **dana dingin** (dana darurat) dengan target dan progress bar.
- **Emas**: catat pembelian emas. Harga emas per gram (dalam Rupiah) diambil otomatis setiap 3 jam dari API publik.
- **Rekap**: ringkasan pemasukan dan pengeluaran per bulan.
- **Backup & pulihkan**: simpan data ke file, lalu pulihkan lagi kapan saja.
- **Tampilan HP**: sisa uang tetap kelihatan di layar kecil.
- **Latar partikel animasi** yang digambar dengan Canvas.

## Privasi

Semua data tersimpan di **browser kamu sendiri** (`localStorage`). Nggak ada server, nggak ada akun, dan nggak ada data yang dikirim ke mana pun. Satu-satunya yang diambil dari internet adalah harga emas dan kurs.

## Teknologi

- HTML, CSS, dan JavaScript murni, tanpa framework
- Canvas API untuk animasi partikel
- `localStorage` untuk penyimpanan
- [gold-api.com](https://gold-api.com) dan [open.er-api.com](https://open.er-api.com) untuk harga emas dan kurs

## Cara menjalankan

1. Download atau clone repo ini.
2. Buka `index.html` di browser.

Selesai. Nggak perlu install apa-apa.

---

Dibuat oleh [Abraham Alex](https://github.com/llxndrrr) bersama Claude.
