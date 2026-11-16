'use strict';

/* =========================================================
   1. PENGATURAN DASAR
   ========================================================= */
// v2 = versi dengan emas. Laci baru, supaya versi lama (planet) yang belum kenal
// emas tidak bisa menghapus catatan emas kalau tidak sengaja dibuka.
const KUNCI_SIMPAN = 'catatanUang.v2';   // nama "laci" di localStorage
const KUNCI_LAMA = 'catatanUang.v1';     // data versi sebelumnya, disalin sekali saat pertama dibuka
const KUNCI_HARGA = 'catatanUang.hargaEmas'; // cache harga emas (bukan data pribadi, tidak ikut backup)
const GRAM_PER_OZ = 31.1034768;          // 1 troy ounce = 31,1 gram
const JEDA_HARGA = 3 * 60 * 60 * 1000;   // harga emas diperbarui tiap 3 jam
const JEDA_COBA_LAGI = 10 * 60 * 1000;   // kalau gagal, coba lagi 10 menit kemudian
const KATEGORI = ['makan/minum', 'topup', 'langganan', 'jajan', 'foya foya', 'fashion', 'kirim ortu', 'kebutuhan lain'];
const KATEGORI_BEBAS = 'kebutuhan lain'; // kategori yang catatannya wajib diisi
const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const TIPE_EMAS = ['beliEmas', 'jualEmas'];
const TIPE_VALID = ['keluar', 'nabung', 'cair', ...TIPE_EMAS];

/* =========================================================
   2. MENYIMPAN & MEMUAT DATA (localStorage)
   Semua data ada di satu objek "data". Setiap ada perubahan,
   objek ini diubah jadi teks (JSON) lalu disimpan ke browser.
   Inilah yang membuat data tidak hilang saat halaman ditutup.
   ========================================================= */
function dataKosong() {
  return {
    versi: 2,
    transaksi: [],      // pengeluaran, nabung, cairkan, beliEmas, jualEmas
    gaji: {},           // contoh: { "2026-11": 5000000 }
    saldoAwal: 0,       // uang yang sudah dipegang sebelum mulai mencatat
    rdpu: { returnTahunan: 4.84, pembaruan: [] },
    terakhirBackup: null,
  };
}

// Memastikan data (dari localStorage atau file backup) bentuknya benar.
function rapikan(d) {
  const kosong = dataKosong();
  const tglValid = t => typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t);
  const transaksi = (Array.isArray(d.transaksi) ? d.transaksi : [])
    .filter(t => t && TIPE_VALID.includes(t.tipe) && Number(t.jumlah) > 0 && tglValid(t.tanggal))
    .filter(t => !TIPE_EMAS.includes(t.tipe) || Number(t.gram) > 0)
    .map(t => {
      const baru = {
        id: String(t.id || idBaru()),
        tipe: t.tipe,
        jumlah: Math.round(Number(t.jumlah)),
        kategori: t.tipe === 'keluar' ? String(t.kategori || KATEGORI_BEBAS) : null,
        catatan: String(t.catatan || ''),
        tanggal: t.tanggal,
        dibuat: Number(t.dibuat) || 0,
      };
      if (TIPE_EMAS.includes(t.tipe)) baru.gram = Math.round(Number(t.gram) * 10000) / 10000;
      return baru;
    });
  const gaji = {};
  if (d.gaji && typeof d.gaji === 'object') {
    for (const [b, n] of Object.entries(d.gaji)) if (/^\d{4}-\d{2}$/.test(b) && Number(n) > 0) gaji[b] = Math.round(Number(n));
  }
  const rdpu = d.rdpu || {};
  const pembaruan = (Array.isArray(rdpu.pembaruan) ? rdpu.pembaruan : [])
    .filter(p => p && Number(p.nilai) >= 0 && tglValid(p.tanggal))
    .map(p => ({ id: String(p.id || idBaru()), nilai: Math.round(Number(p.nilai)), tanggal: p.tanggal, dibuat: Number(p.dibuat) || 0 }));
  return {
    versi: 2,
    transaksi,
    gaji,
    saldoAwal: Math.round(Number(d.saldoAwal)) || 0,
    rdpu: {
      returnTahunan: typeof rdpu.returnTahunan === 'number' ? rdpu.returnTahunan : kosong.rdpu.returnTahunan,
      pembaruan,
    },
    terakhirBackup: Number(d.terakhirBackup) || null,
  };
}

function muat() {
  let teks = null;
  try {
    teks = localStorage.getItem(KUNCI_SIMPAN);
    if (!teks) teks = localStorage.getItem(KUNCI_LAMA); // pertama kali: ambil data versi planet
  } catch (e) {
    alert('Browser ini tidak mengizinkan penyimpanan. Data tidak akan tersimpan.');
    return dataKosong();
  }
  if (!teks) return dataKosong();
  try {
    return rapikan(JSON.parse(teks));
  } catch (e) {
    // Data rusak: simpan salinannya dulu supaya tidak tertimpa, lalu mulai kosong.
    try { localStorage.setItem(KUNCI_SIMPAN + '.rusak-' + Date.now(), teks); } catch (_) { /* abaikan */ }
    alert('Data tersimpan tidak bisa dibaca. Salinannya sudah diamankan. Kamu bisa memulihkan dari file backup.');
    return dataKosong();
  }
}

function simpan() {
  try {
    localStorage.setItem(KUNCI_SIMPAN, JSON.stringify(data));
  } catch (e) {
    alert('Gagal menyimpan: ' + e.message);
  }
}

function idBaru() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

let data = muat();

/* =========================================================
   3. ALAT BANTU: tanggal, format rupiah, keamanan teks
   ========================================================= */
function isoTanggal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hariIni() { return isoTanggal(new Date()); }
function bulanDari(tanggal) { return tanggal.slice(0, 7); }           // "2026-11-14" -> "2026-11"
function bulanIni() { return bulanDari(hariIni()); }
function geserBulan(bulan, n) {                                       // "2026-11", +1 -> "2026-12"
  const [y, m] = bulan.split('-').map(Number);
  return isoTanggal(new Date(y, m - 1 + n, 1)).slice(0, 7);
}
function namaBulan(bulan) {
  const [y, m] = bulan.split('-').map(Number);
  return `${NAMA_BULAN[m - 1]} ${y}`;
}
function tanggalPendek(tanggal) {                                     // "2026-11-14" -> "14 Nov"
  const [, m, d] = tanggal.split('-').map(Number);
  return `${d} ${BULAN_PENDEK[m - 1]}`;
}
function selisihHari(dari, sampai) {
  const [y1, m1, d1] = dari.split('-').map(Number);
  const [y2, m2, d2] = sampai.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
// Hari libur Bursa Efek Indonesia yang jatuh di hari kerja (termasuk cuti bersama).
// Di hari ini NAB reksadana tidak bergerak, jadi tabungan RDPU tidak bertambah.
// Sumber: kalender libur bursa BEI 2026 (239 hari bursa) dan 2027 (241 hari bursa).
// PERLU DIPERBARUI setiap tahun (BEI biasanya mengumumkan kalender tahun depan sekitar September).
const LIBUR_BURSA = new Set([
  // 2026
  '2026-01-01', // Tahun Baru Masehi
  '2026-01-16', // Isra Mikraj
  '2026-02-16', '2026-02-17', // cuti bersama & Tahun Baru Imlek
  '2026-03-18', '2026-03-19', // cuti bersama & Hari Suci Nyepi
  '2026-03-20', '2026-03-23', '2026-03-24', // cuti bersama Idul Fitri 1447 H
  '2026-04-03', // Wafat Yesus Kristus
  '2026-05-01', // Hari Buruh
  '2026-05-14', '2026-05-15', // Kenaikan Yesus Kristus & cuti bersama
  '2026-05-27', '2026-05-28', // Idul Adha 1447 H & cuti bersama
  '2026-06-01', // Hari Lahir Pancasila
  '2026-06-16', // Tahun Baru Islam 1448 H
  '2026-08-17', // Proklamasi Kemerdekaan
  '2026-08-25', // Maulid Nabi
  '2026-12-24', '2026-12-25', // cuti bersama & Hari Natal
  '2026-12-31', // libur khusus bursa
  // 2027
  '2027-01-01', // Tahun Baru Masehi
  '2027-01-05', // Isra Mikraj
  '2027-02-05', // cuti bersama Imlek
  '2027-03-08', // Hari Suci Nyepi
  '2027-03-09', '2027-03-10', '2027-03-11', '2027-03-12', '2027-03-15', // Idul Fitri 1448 H & cuti bersama
  '2027-03-25', '2027-03-26', // Wafat Yesus Kristus & cuti bersama
  '2027-05-06', // Kenaikan Yesus Kristus
  '2027-05-17', '2027-05-18', '2027-05-19', '2027-05-20', // Idul Adha, cuti bersama, Waisak
  '2027-06-01', // Hari Lahir Pancasila
  '2027-08-17', // Proklamasi Kemerdekaan
  '2027-12-24', // cuti bersama Natal
  '2027-12-31', // libur khusus bursa
]);
const LIBUR_BURSA_SAMPAI = '2027-12-31'; // setelah tanggal ini hanya Sabtu-Minggu yang dilewati

// Jumlah hari bursa (Senin–Jumat, bukan libur bursa) setelah "dari" sampai dengan "sampai".
// Contoh: Jumat -> Senin = 1 (hanya Senin), Jumat -> Minggu = 0.
function hariKerja(dari, sampai) {
  const total = selisihHari(dari, sampai);
  if (total <= 0) return 0;
  const [y, m, d] = dari.split('-').map(Number);
  const mingguPenuh = Math.floor(total / 7);
  let n = mingguPenuh * 5;
  const mulai = new Date(Date.UTC(y, m - 1, d)).getUTCDay();          // 0 = Minggu, 6 = Sabtu
  for (let i = mingguPenuh * 7 + 1; i <= total; i++) {
    const hari = (mulai + i) % 7;
    if (hari !== 0 && hari !== 6) n++;
  }
  // kurangi libur bursa yang ada di dalam rentang (semuanya jatuh di hari kerja)
  for (const libur of LIBUR_BURSA) if (libur > dari && libur <= sampai) n--;
  return n;
}

const fmt = new Intl.NumberFormat('id-ID');                            // 1250000 -> "1.250.000"
function angka(n) { n = Math.round(n); return (n < 0 ? '−' : '') + fmt.format(Math.abs(n)); }
function rp(n) { n = Math.round(n); return (n < 0 ? '−' : '') + 'Rp ' + fmt.format(Math.abs(n)); }
function bacaRupiah(teks) {                                           // "Rp 25.000" -> 25000
  const digit = String(teks).replace(/\D/g, '');
  return digit ? parseInt(digit, 10) : 0;
}
function isiRupiah(input, n) { input.value = n ? 'Rp ' + fmt.format(n) : ''; }

// Mencegah teks ketikan (misal catatan) dianggap kode HTML.
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const $ = id => document.getElementById(id);
function tampilError(id, pesan) { const p = $(id); p.textContent = pesan; p.hidden = false; }
function urutTerbaru(a, b) {
  if (a.tanggal !== b.tanggal) return a.tanggal < b.tanggal ? 1 : -1;
  return b.dibuat - a.dibuat;
}

/* =========================================================
   4. HITUNGAN UANG PER BULAN
   sisa = bawaan bulan lalu + gaji − pengeluaran − nabung + cairkan
   Sisa bulan ini otomatis jadi "bawaan" bulan berikutnya.
   ========================================================= */
function bulanPertama() {
  const semua = [
    ...data.transaksi.map(t => bulanDari(t.tanggal)),
    ...Object.keys(data.gaji),
  ];
  const kini = bulanIni();
  if (!semua.length) return kini;
  const paling = semua.reduce((a, b) => (a < b ? a : b));
  return paling < kini ? paling : kini;
}

function hitungSemuaBulan() {
  const hasil = {};
  let bawaan = data.saldoAwal;
  for (let b = bulanPertama(); b <= bulanIni(); b = geserBulan(b, 1)) {
    const tx = data.transaksi.filter(t => bulanDari(t.tanggal) === b);
    const total = tipe => tx.filter(t => t.tipe === tipe).reduce((s, t) => s + t.jumlah, 0);
    const gaji = data.gaji[b] || 0;
    const keluar = total('keluar');
    const nabung = total('nabung');
    const cair = total('cair');
    const beliEmas = total('beliEmas');
    const jualEmas = total('jualEmas');
    const sisa = bawaan + gaji - keluar - nabung + cair - beliEmas + jualEmas;

    const perKategori = {};
    for (const t of tx) if (t.tipe === 'keluar') perKategori[t.kategori] = (perKategori[t.kategori] || 0) + t.jumlah;

    hasil[b] = { bulan: b, bawaan, gaji, keluar, nabung, cair, beliEmas, jualEmas, sisa, perKategori, tx };
    bawaan = sisa;
  }
  return hasil;
}

/* =========================================================
   5. HITUNGAN TABUNGAN RDPU
   Nilai tumbuh hanya di hari bursa, seperti di Bibit: Sabtu, Minggu,
   dan libur bursa tidak bertambah. Kenaikan per hari bursa diatur
   supaya total setahun (±240 hari bursa: 239 di 2026, 241 di 2027)
   sama dengan return per tahun (bunga majemuk).
   "Perbarui nilai" mengganti perkiraan dengan angka asli dari aplikasimu.
   ========================================================= */
const HARI_BURSA_SETAHUN = 240;
function kejadianRdpu() {
  return [
    ...data.transaksi
      .filter(t => t.tipe === 'nabung' || t.tipe === 'cair')
      .map(t => ({ id: t.id, jenis: t.tipe, jumlah: t.jumlah, tanggal: t.tanggal, dibuat: t.dibuat })),
    ...data.rdpu.pembaruan
      .map(p => ({ id: p.id, jenis: 'perbarui', jumlah: p.nilai, tanggal: p.tanggal, dibuat: p.dibuat })),
  ];
}

function hitungRdpu() {
  const r = data.rdpu.returnTahunan / 100;
  const kejadian = kejadianRdpu().sort((a, b) => -urutTerbaru(a, b)); // urut dari yang paling lama
  let nilai = 0, modal = 0, tgl = null, pasti = false;

  const tumbuhSampai = tanggal => {
    if (tgl && nilai > 0) {
      const hari = hariKerja(tgl, tanggal);
      if (hari > 0) { nilai *= Math.pow(1 + r, hari / HARI_BURSA_SETAHUN); pasti = false; }
    }
    tgl = tanggal;
  };

  for (const k of kejadian) {
    tumbuhSampai(k.tanggal);
    if (k.jenis === 'nabung') {
      nilai += k.jumlah; modal += k.jumlah;
    } else if (k.jenis === 'cair') {
      if (nilai > 0) modal *= Math.max(0, 1 - k.jumlah / nilai); // modal ikut berkurang sebanding
      nilai = Math.max(0, nilai - k.jumlah);
    } else {
      nilai = k.jumlah; pasti = true;
    }
  }
  tumbuhSampai(hariIni());
  return { nilai, modal, untung: nilai - modal, pasti, ada: kejadian.length > 0 };
}

/* =========================================================
   5b. HITUNGAN EMAS
   Modal memakai harga rata-rata: saat menjual sebagian, modal
   berkurang sebanding dengan gram yang dijual.
   Nilai sekarang = gram yang dimiliki × harga emas terbaru.
   ========================================================= */
function hitungEmas() {
  const tx = data.transaksi.filter(t => TIPE_EMAS.includes(t.tipe)).sort((a, b) => -urutTerbaru(a, b));
  let gram = 0, modal = 0;
  for (const t of tx) {
    if (t.tipe === 'beliEmas') { gram += t.gram; modal += t.jumlah; }
    else {
      if (gram > 0) modal *= Math.max(0, 1 - t.gram / gram);
      gram = Math.max(0, gram - t.gram);
    }
  }
  gram = Math.round(gram * 10000) / 10000;
  const harga = hargaEmas.data ? hargaEmas.data.perGram : null;
  const nilai = harga ? gram * harga : null;
  return { gram, modal, nilai, untung: nilai === null ? null : nilai - modal, ada: tx.length > 0 };
}
function teksGram(g) {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 }).format(g) + ' g';
}
function bacaGram(teks) {                                             // "2,5" atau "2.5" -> 2.5
  const v = parseFloat(String(teks).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/* =========================================================
   5c. HARGA EMAS (diambil langsung dari browser, tiap 3 jam)
   Sumber utama: harga spot dunia XAU/USD (gold-api.com) ×
   kurs USD→IDR (open.er-api.com), lalu dibagi 31,1 gram.
   Cadangan: kurs XAU→IDR harian dari currency-api (jsDelivr).
   Harga dicatat di riwayat untuk grafik kecil di tab Emas.
   ========================================================= */
const hargaEmas = {
  data: null,        // { perGram, usdOz, kurs, waktu, sumber }
  riwayat: [],       // [{ w: waktu, g: perGram }]
  memuat: false,
  gagal: null,       // pesan error terakhir
  cobaTerakhir: 0,
};

function muatCacheHarga() {
  try {
    const c = JSON.parse(localStorage.getItem(KUNCI_HARGA) || 'null');
    if (c && c.data && Number(c.data.perGram) > 0) hargaEmas.data = c.data;
    if (c && Array.isArray(c.riwayat)) hargaEmas.riwayat = c.riwayat.filter(r => r && r.g > 0 && r.w > 0);
  } catch (_) { /* cache rusak: abaikan, nanti diambil ulang */ }
}
function simpanCacheHarga() {
  try {
    localStorage.setItem(KUNCI_HARGA, JSON.stringify({ data: hargaEmas.data, riwayat: hargaEmas.riwayat }));
  } catch (_) { /* tidak penting kalau gagal */ }
}

async function ambilJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function ambilHargaUtama() {
  const [emas, kurs] = await Promise.all([
    ambilJson('https://api.gold-api.com/price/XAU'),
    ambilJson('https://open.er-api.com/v6/latest/USD'),
  ]);
  const usdOz = Number(emas && emas.price);
  const idr = Number(kurs && kurs.rates && kurs.rates.IDR);
  if (!(usdOz > 0) || !(idr > 0)) throw new Error('data harga tidak lengkap');
  return { perGram: (usdOz * idr) / GRAM_PER_OZ, usdOz, kurs: idr, sumber: 'gold-api.com + open.er-api.com' };
}

async function ambilHargaCadangan() {
  const j = await ambilJson('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/xau.json');
  const idrOz = Number(j && j.xau && j.xau.idr);
  const usdOz = Number(j && j.xau && j.xau.usd);
  if (!(idrOz > 0)) throw new Error('data cadangan tidak lengkap');
  return { perGram: idrOz / GRAM_PER_OZ, usdOz: usdOz || null, kurs: usdOz ? idrOz / usdOz : null, sumber: 'currency-api (harian)' };
}

async function perbaruiHarga(paksa = false) {
  if (hargaEmas.memuat) return;
  const umur = hargaEmas.data ? Date.now() - hargaEmas.data.waktu : Infinity;
  if (!paksa && umur < JEDA_HARGA) return;
  if (!paksa && hargaEmas.gagal && Date.now() - hargaEmas.cobaTerakhir < JEDA_COBA_LAGI) return;

  hargaEmas.memuat = true;
  hargaEmas.cobaTerakhir = Date.now();
  renderHargaSaja();
  try {
    let h;
    try { h = await ambilHargaUtama(); }
    catch (e) { h = await ambilHargaCadangan(); }
    h.waktu = Date.now();
    hargaEmas.data = h;
    hargaEmas.gagal = null;
    hargaEmas.riwayat.push({ w: h.waktu, g: Math.round(h.perGram) });
    if (hargaEmas.riwayat.length > 400) hargaEmas.riwayat = hargaEmas.riwayat.slice(-400);
    simpanCacheHarga();
  } catch (e) {
    hargaEmas.gagal = navigator.onLine === false ? 'sedang offline' : 'gagal mengambil harga';
  } finally {
    hargaEmas.memuat = false;
    renderSemua();
  }
}

function jamMenit(w) {
  const d = new Date(w);
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
}
function teksWaktuHarga() {
  const h = hargaEmas.data;
  if (hargaEmas.memuat) return 'mengambil harga…';
  if (!h) return hargaEmas.gagal ? `${hargaEmas.gagal} · coba lagi nanti` : 'belum ada harga';
  const hariSama = isoTanggal(new Date(h.waktu)) === hariIni();
  const kapan = hariSama ? jamMenit(h.waktu) : `${tanggalPendek(isoTanggal(new Date(h.waktu)))} ${jamMenit(h.waktu)}`;
  let t = `diperbarui ${kapan} · berikutnya ${jamMenit(h.waktu + JEDA_HARGA)}`;
  if (hargaEmas.gagal) t += ` · ${hargaEmas.gagal}`;
  return t;
}

// Grafik garis kecil dari riwayat harga (SVG)
function grafikHarga() {
  const r = hargaEmas.riwayat.slice(-60);
  if (r.length < 2) return '<p class="kecil">Grafik muncul setelah harga diperbarui beberapa kali.</p>';
  const W = 300, H = 56;
  const min = Math.min(...r.map(x => x.g)), max = Math.max(...r.map(x => x.g));
  const rentang = max - min || 1;
  const t0 = r[0].w, t1 = r[r.length - 1].w, rt = t1 - t0 || 1;
  const titik = r.map(x => `${(((x.w - t0) / rt) * W).toFixed(1)},${(H - 4 - ((x.g - min) / rentang) * (H - 8)).toFixed(1)}`).join(' ');
  const naik = r[r.length - 1].g >= r[0].g;
  const persen = ((r[r.length - 1].g - r[0].g) / r[0].g) * 100;
  return `<svg class="grafik" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Grafik harga emas">
      <polyline points="${titik}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="meta kecil"><span>${tanggalPendek(isoTanggal(new Date(t0)))} · ${angka(min)}–${angka(max)}</span>
    <span class="${naik ? 'plus' : 'turun'}">${naik ? '+' : '−'}${Math.abs(persen).toFixed(2).replace('.', ',')}%</span></div>`;
}

/* =========================================================
   6. STATUS TAMPILAN (tidak disimpan, hanya selama halaman terbuka)
   ========================================================= */
const ui = {
  tab: 'catat',
  kategori: KATEGORI[0],
  editId: null,          // id catatan yang sedang diubah
  gajiDibuka: false,     // form gaji dibuka lewat tombol "ubah"
  gajiDitutup: false,    // sudah menekan "Nanti saja"
  aksiRdpu: 'nabung',
  aksiEmas: 'beli',
  rekapBulan: bulanIni(),
};

/* =========================================================
   7. MENAMPILKAN (render) SETIAP TAB
   ========================================================= */
function renderSemua() {
  const semua = hitungSemuaBulan();
  renderTab();
  renderChips();
  renderCatat(semua);
  renderTabungan();
  renderEmas();
  renderRekap(semua);
  renderPengingat();
  renderRingkasan(semua);
}
const renderHargaSaja = () => renderSemua();

function renderTab() {
  document.querySelectorAll('.tab').forEach(b => {
    const on = b.dataset.tab === ui.tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on);
  });
  for (const t of ['catat', 'tabungan', 'emas', 'rekap']) $('tab-' + t).hidden = t !== ui.tab;
  document.body.dataset.tab = ui.tab; // dipakai CSS: bar sisa di HP disembunyikan di tab Catat
}

// Kolom teks di kanan + bulatan angka di pojok kanan atas
function renderRingkasan(semua) {
  const r = semua[bulanIni()];
  const e = hitungEmas();
  const t = hitungRdpu();
  const h = hargaEmas.data;
  const modalBulan = r.bawaan + r.gaji;
  const persen = modalBulan > 0 ? Math.round((r.keluar / modalBulan) * 100) : 0;
  for (const id of ['hero-sisa', 'sisa-hp-angka']) {
    $(id).textContent = rp(r.sisa);
    $(id).classList.toggle('minus', r.sisa < 0);
  }
  $('hero-bar').style.width = Math.min(100, Math.max(0, persen)) + '%';
  $('sisa-hp-bulan').textContent = '· ' + namaBulan(bulanIni());
  $('sum-sisa').innerHTML = `${esc(namaBulan(bulanIni()))} · habis <b class="mono">${rp(r.keluar)}</b> dari ${rp(modalBulan)} (${persen}%)`;
  $('sum-emas').innerHTML = h
    ? `<b class="mono">${rp(h.perGram)}</b> / gram<br><span class="redup">${esc(teksWaktuHarga())}</span>`
    : `<span class="redup">${esc(teksWaktuHarga())}</span>`;
  const punya = [];
  if (e.gram > 0) punya.push(`Emas ${teksGram(e.gram)}${e.nilai !== null ? ` ≈ ${rp(e.nilai)}` : ''}`);
  if (t.ada) punya.push(`RDPU ${rp(t.nilai)}`);
  $('sum-aset').innerHTML = punya.length ? punya.map(p => `<li>${esc(p)}</li>`).join('') : '<li>Belum ada tabungan atau emas.</li>';
  const jml = r.tx.length;
  $('counter').textContent = String(Math.min(jml, 99)).padStart(2, '0');
  $('counter').title = `${jml} catatan bulan ini`;
}

const PETUNJUK_EMAS = {
  beli: 'Uang pindah dari sisa uang ke emas. Isi berat dan total harga yang kamu bayar.',
  jual: 'Emas dijual, uangnya kembali ke sisa uang. Isi berat dan total uang yang kamu terima.',
};

function renderEmas() {
  const e = hitungEmas();
  const h = hargaEmas.data;
  $('emas-nilai').textContent = e.nilai !== null ? rp(e.nilai) : e.gram > 0 ? '—' : rp(0);
  $('emas-gram').textContent = teksGram(e.gram);
  $('emas-modal').textContent = angka(e.modal);
  const u = e.untung === null ? null : Math.round(e.untung);
  $('emas-untung').textContent = u === null ? '—' : (u >= 0 ? '+' : '−') + fmt.format(Math.abs(u));
  $('emas-untung').className = 'mono ' + (u === null ? '' : u >= 0 ? 'plus' : 'turun');

  $('harga-gram').textContent = h ? rp(h.perGram) : '—';
  $('harga-waktu').textContent = teksWaktuHarga();
  $('harga-detail').textContent = h && h.usdOz
    ? `XAU $${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(h.usdOz)}/oz${h.kurs ? ` · kurs ${angka(h.kurs)}` : ''} · ${h.sumber}`
    : '';
  $('harga-perbarui').disabled = hargaEmas.memuat;
  $('harga-grafik').innerHTML = grafikHarga();

  document.querySelectorAll('#aksi-emas .chip').forEach(c => {
    const on = c.dataset.aksi === ui.aksiEmas;
    c.classList.toggle('on', on);
    c.setAttribute('aria-pressed', on);
  });
  $('emas-petunjuk').textContent = PETUNJUK_EMAS[ui.aksiEmas];
  $('emas-submit').textContent = ui.aksiEmas === 'beli' ? 'Catat beli' : 'Catat jual';
  // Perkiraan total dari harga terbaru, sebagai bantuan di kolom rupiah
  const g = bacaGram($('emas-gram-input').value);
  $('emas-jumlah').placeholder = h && g ? `± ${rp(g * h.perGram)} (harga dunia)` : 'Rp 0';

  const riwayat = data.transaksi.filter(t => TIPE_EMAS.includes(t.tipe)).sort(urutTerbaru);
  $('emas-daftar').innerHTML = riwayat.length ? riwayat.map(t => `<li>
      <span class="isi">${t.tipe === 'beliEmas' ? 'beli' : 'jual'} ${teksGram(t.gram)}<small>${rp(t.jumlah / t.gram)}/g</small><small class="tgl">${tanggalPendek(t.tanggal)}</small></span>
      <span class="mono ${t.tipe === 'beliEmas' ? 'pindah' : 'plus'}">${t.tipe === 'beliEmas' ? '−' : '+'}${angka(t.jumlah)}</span>
      <span class="aksi-baris"><button type="button" class="link" data-hapus="${esc(t.id)}">hapus</button></span>
    </li>`).join('') : '<li class="kosong">Belum ada catatan emas.</li>';
}

function renderChips() {
  $('chips').innerHTML = KATEGORI.map(k =>
    `<button type="button" class="chip${k === ui.kategori ? ' on' : ''}" data-kategori="${esc(k)}" aria-pressed="${k === ui.kategori}">${esc(k)}</button>`
  ).join('');
  $('catat-catatan').placeholder = ui.kategori === KATEGORI_BEBAS ? 'untuk apa? (wajib diisi)' : 'catatan (boleh kosong)';
}

// Satu baris di daftar catatan
function barisHtml(t) {
  let judul, nominal, kelas = '';
  if (t.tipe === 'keluar') { judul = t.kategori; nominal = '−' + angka(t.jumlah); }
  else if (t.tipe === 'nabung') { judul = 'nabung RDPU'; nominal = '−' + angka(t.jumlah); kelas = 'pindah'; }
  else if (t.tipe === 'cair') { judul = 'cairkan RDPU'; nominal = '+' + angka(t.jumlah); kelas = 'plus'; }
  else if (t.tipe === 'beliEmas') { judul = `beli emas ${teksGram(t.gram)}`; nominal = '−' + angka(t.jumlah); kelas = 'pindah'; }
  else { judul = `jual emas ${teksGram(t.gram)}`; nominal = '+' + angka(t.jumlah); kelas = 'plus'; }
  const tombolUbah = t.tipe === 'keluar' ? `<button type="button" class="link" data-ubah="${esc(t.id)}">ubah</button>` : '';
  return `<li>
    <span class="isi">${esc(judul)}${t.catatan ? `<small>${esc(t.catatan)}</small>` : ''}<small class="tgl">${tanggalPendek(t.tanggal)}</small></span>
    <span class="mono ${kelas}">${nominal}</span>
    <span class="aksi-baris">${tombolUbah}<button type="button" class="link" data-hapus="${esc(t.id)}">hapus</button></span>
  </li>`;
}

function daftarHtml(r) {
  const baris = [...r.tx].sort(urutTerbaru).map(barisHtml);
  if (r.gaji) baris.push(`<li><span class="isi">gaji masuk</span><span class="mono plus">+${angka(r.gaji)}</span></li>`);
  return baris.join('');
}

function renderCatat(semua) {
  const b = bulanIni();
  const r = semua[b];
  const pertama = b === bulanPertama();

  $('catat-bulan').textContent = `${namaBulan(b)} · sisa`;
  $('catat-sisa').textContent = rp(r.sisa);
  $('catat-sisa').classList.toggle('minus', r.sisa < 0);

  const modal = r.bawaan + r.gaji;
  const persen = modal > 0 ? Math.round((r.keluar / modal) * 100) : 0;
  $('catat-bar').style.width = Math.min(100, Math.max(0, persen)) + '%';

  const masuk = [];
  if (r.bawaan) masuk.push(`${pertama ? 'Uang awal' : 'Bawaan ' + BULAN_PENDEK[Number(geserBulan(b, -1).slice(5)) - 1]} <b class="mono">${angka(r.bawaan)}</b>`);
  masuk.push(r.gaji ? `Gaji <b class="mono">${angka(r.gaji)}</b>` : 'Gaji belum diisi');
  $('catat-masuk').innerHTML = masuk.join(' + ') + ' · <button type="button" class="link" data-ubah-gaji>ubah</button>';

  const habis = [`Habis <b class="mono">${angka(r.keluar)}</b> (${persen}%)`];
  const ditabung = r.nabung - r.cair;
  if (ditabung) habis.push(`${ditabung > 0 ? 'Ditabung' : 'Dicairkan'} <b class="mono">${angka(Math.abs(ditabung))}</b>`);
  const keEmas = r.beliEmas - r.jualEmas;
  if (keEmas) habis.push(`${keEmas > 0 ? 'Ke emas' : 'Dari emas'} <b class="mono">${angka(Math.abs(keEmas))}</b>`);
  $('catat-habis').innerHTML = habis.join(' · ');

  // Form gaji muncul sendiri kalau gaji bulan ini belum diisi
  const perluIsi = !data.gaji[b] && !ui.gajiDitutup;
  $('form-gaji').hidden = !(ui.gajiDibuka || perluIsi);
  $('saldo-awal-wrap').hidden = !pertama;

  $('catat-daftar').innerHTML = daftarHtml(r) || '<li class="kosong">Belum ada catatan bulan ini.</li>';
}

const PETUNJUK_RDPU = {
  nabung: 'Uang pindah dari sisa uang ke tabungan. Tidak dihitung sebagai pengeluaran.',
  cair: 'Uang pindah dari tabungan kembali ke sisa uang.',
  perbarui: 'Salin nilai terbaru dari aplikasi reksadanamu. Perkiraan akan lanjut dari angka ini.',
};
const TOMBOL_RDPU = { nabung: 'Nabung', cair: 'Cairkan', perbarui: 'Simpan nilai' };

function renderTabungan() {
  const h = hitungRdpu();
  $('rdpu-status').textContent = !h.ada ? 'belum ada' : h.pasti ? 'nilai terbaru' : 'perkiraan';
  $('rdpu-nilai').textContent = rp(h.nilai);
  $('rdpu-setoran').textContent = angka(h.modal);
  const untung = Math.round(h.untung);
  $('rdpu-untung').textContent = (untung >= 0 ? '+' : '−') + fmt.format(Math.abs(untung));

  document.querySelectorAll('#aksi-rdpu .chip').forEach(c => c.classList.toggle('on', c.dataset.aksi === ui.aksiRdpu));
  $('rdpu-petunjuk').textContent = PETUNJUK_RDPU[ui.aksiRdpu];
  $('rdpu-submit').textContent = TOMBOL_RDPU[ui.aksiRdpu];
  $('rdpu-return').value = String(data.rdpu.returnTahunan).replace('.', ',');
  $('libur-sampai').textContent = hariIni() > LIBUR_BURSA_SAMPAI ? '2026–2027 (daftar tahun ini belum ada, perlu diperbarui)' : '2026–2027';

  const riwayat = kejadianRdpu().sort(urutTerbaru);
  $('rdpu-daftar').innerHTML = riwayat.length ? riwayat.map(k => {
    const judul = { nabung: 'nabung', cair: 'cairkan', perbarui: 'nilai diperbarui' }[k.jenis];
    const nominal = { nabung: '+', cair: '−', perbarui: '= ' }[k.jenis] + fmt.format(k.jumlah);
    const kelas = k.jenis === 'nabung' ? 'plus' : k.jenis === 'perbarui' ? 'pindah' : '';
    return `<li>
      <span class="isi">${judul}<small class="tgl">${tanggalPendek(k.tanggal)}</small></span>
      <span class="mono ${kelas}">${nominal}</span>
      <span class="aksi-baris"><button type="button" class="link" data-hapus-rdpu="${esc(k.id)}" data-jenis="${k.jenis}">hapus</button></span>
    </li>`;
  }).join('') : '<li class="kosong">Belum ada riwayat tabungan.</li>';
}

function renderRekap(semua) {
  const awal = bulanPertama(), kini = bulanIni();
  if (ui.rekapBulan < awal) ui.rekapBulan = awal;
  if (ui.rekapBulan > kini) ui.rekapBulan = kini;
  const b = ui.rekapBulan;
  const r = semua[b];
  const selesai = b < kini;

  $('rekap-bulan').textContent = namaBulan(b);
  $('rekap-prev').disabled = b <= awal;
  $('rekap-next').disabled = b >= kini;
  $('rekap-status').textContent = selesai ? 'bulan selesai' : 'bulan berjalan';

  const baris = [];
  if (b !== awal) baris.push([`Bawaan dari ${namaBulan(geserBulan(b, -1))}`, angka(r.bawaan)]);
  else if (r.bawaan) baris.push(['Uang awal', angka(r.bawaan)]);
  baris.push(['Gaji', angka(r.gaji)]);
  baris.push(['Habis', '−' + fmt.format(r.keluar)]);
  if (r.nabung) baris.push(['Ditabung ke RDPU', '−' + fmt.format(r.nabung)]);
  if (r.cair) baris.push(['Dicairkan dari RDPU', '+' + fmt.format(r.cair)]);
  if (r.beliEmas) baris.push(['Beli emas', '−' + fmt.format(r.beliEmas)]);
  if (r.jualEmas) baris.push(['Jual emas', '+' + fmt.format(r.jualEmas)]);
  const labelSisa = selesai ? `Sisa, dibawa ke ${namaBulan(geserBulan(b, 1))}` : 'Sisa sekarang';
  $('rekap-sum').innerHTML =
    baris.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="mono">${v}</dd>`).join('') +
    `<dt class="tot">${labelSisa}</dt><dd class="mono tot${r.sisa < 0 ? ' minus' : ''}">${rp(r.sisa)}</dd>`;

  const kategori = Object.entries(r.perKategori).sort((a, b2) => b2[1] - a[1]);
  const terbesar = kategori.length ? kategori[0][1] : 0;
  $('rekap-kategori').innerHTML = kategori.length ? kategori.map(([k, v]) => `
    <div class="kat-rekap">
      <div class="kat-kepala"><span>${esc(k)}</span><span class="mono">${fmt.format(v)}<small>${Math.round((v / r.keluar) * 100)}%</small></span></div>
      <div class="bar"><i style="width:${((v / terbesar) * 100).toFixed(1)}%"></i></div>
    </div>`).join('') : '<p class="kecil">Belum ada pengeluaran di bulan ini.</p>';

  $('rekap-daftar').innerHTML = daftarHtml(r) || '<li class="kosong">Belum ada catatan.</li>';
}

function renderPengingat() {
  let pesan = '';
  if (data.transaksi.length) {
    if (!data.terakhirBackup) {
      if (data.transaksi.length >= 10) pesan = 'Kamu belum pernah backup.';
    } else {
      const hari = Math.floor((Date.now() - data.terakhirBackup) / 86400000);
      if (hari >= 30) pesan = `Terakhir backup ${hari} hari lalu.`;
    }
  }
  $('pengingat').hidden = !pesan;
  if (pesan) $('pengingat').innerHTML = `<span>${esc(pesan)}</span><button type="button" class="link" data-backup>Backup sekarang</button>`;
}

/* =========================================================
   8. AKSI: apa yang terjadi saat tombol ditekan
   ========================================================= */

// Format otomatis "Rp 25.000" saat mengetik jumlah
document.querySelectorAll('[data-rupiah]').forEach(input => {
  input.addEventListener('input', () => isiRupiah(input, bacaRupiah(input.value)));
});

// Pindah tab
document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
  ui.tab = btn.dataset.tab;
  renderSemua();
}));

// Pilih kategori
$('chips').addEventListener('click', e => {
  const b = e.target.closest('[data-kategori]');
  if (!b) return;
  ui.kategori = b.dataset.kategori;
  $('catat-error').hidden = true;
  renderChips();
  if (ui.kategori === KATEGORI_BEBAS) $('catat-catatan').focus();
});

// Simpan pengeluaran (baru atau hasil ubah)
$('form-catat').addEventListener('submit', e => {
  e.preventDefault();
  const jumlah = bacaRupiah($('catat-jumlah').value);
  const catatan = $('catat-catatan').value.trim();
  const tanggal = $('catat-tanggal').value || hariIni();

  if (!jumlah) return tampilError('catat-error', 'Isi jumlah uangnya dulu.');
  if (ui.kategori === KATEGORI_BEBAS && !catatan) return tampilError('catat-error', 'Untuk "kebutuhan lain", tulis dulu dipakai buat apa.');
  if (tanggal > hariIni()) return tampilError('catat-error', 'Tanggalnya tidak boleh di masa depan.');

  if (ui.editId) {
    const t = data.transaksi.find(x => x.id === ui.editId);
    if (t) Object.assign(t, { jumlah, kategori: ui.kategori, catatan, tanggal });
  } else {
    data.transaksi.push({ id: idBaru(), tipe: 'keluar', jumlah, kategori: ui.kategori, catatan, tanggal, dibuat: Date.now() });
  }
  simpan();
  resetFormCatat();
  renderSemua();
  $('catat-jumlah').focus();
});
$('form-catat').addEventListener('input', () => { $('catat-error').hidden = true; });
$('catat-batal').addEventListener('click', () => { resetFormCatat(); renderSemua(); });

function resetFormCatat() {
  ui.editId = null;
  $('catat-jumlah').value = '';
  $('catat-catatan').value = '';
  $('catat-tanggal').value = hariIni();
  $('catat-submit').textContent = 'Catat';
  $('catat-batal').hidden = true;
  $('catat-error').hidden = true;
}

// Tombol "ubah" & "hapus" di daftar (tab Catat dan Rekap)
function tanganiDaftar(e) {
  const ubah = e.target.closest('[data-ubah]');
  const hapus = e.target.closest('[data-hapus]');
  if (ubah) mulaiUbah(ubah.dataset.ubah);
  if (hapus) hapusTransaksi(hapus.dataset.hapus);
}
$('catat-daftar').addEventListener('click', tanganiDaftar);
$('rekap-daftar').addEventListener('click', tanganiDaftar);

function mulaiUbah(id) {
  const t = data.transaksi.find(x => x.id === id);
  if (!t) return;
  ui.editId = id;
  ui.kategori = t.kategori;
  ui.tab = 'catat';
  isiRupiah($('catat-jumlah'), t.jumlah);
  $('catat-catatan').value = t.catatan;
  $('catat-tanggal').value = t.tanggal;
  $('catat-submit').textContent = 'Simpan perubahan';
  $('catat-batal').hidden = false;
  renderSemua();
  $('catat-jumlah').focus();
}

function hapusTransaksi(id) {
  const t = data.transaksi.find(x => x.id === id);
  if (!t) return;
  const nama = { keluar: t.kategori, nabung: 'nabung RDPU', cair: 'cairkan RDPU', beliEmas: `beli emas ${teksGram(t.gram || 0)}`, jualEmas: `jual emas ${teksGram(t.gram || 0)}` }[t.tipe];
  // Menghapus pembelian emas tidak boleh membuat emas yang sudah dijual jadi minus
  if (t.tipe === 'beliEmas') {
    const sisaGram = hitungEmas().gram - t.gram;
    if (sisaGram < -0.00005) return alert(`Tidak bisa dihapus: emas ini sebagian sudah dicatat terjual. Hapus dulu catatan jualnya.`);
  }
  if (!confirm(`Hapus "${nama}" Rp ${fmt.format(t.jumlah)} (${tanggalPendek(t.tanggal)})?`)) return;
  data.transaksi = data.transaksi.filter(x => x.id !== id);
  if (ui.editId === id) resetFormCatat();
  simpan();
  renderSemua();
}

// Gaji & uang awal
$('catat-masuk').addEventListener('click', e => {
  if (!e.target.closest('[data-ubah-gaji]')) return;
  ui.gajiDibuka = true;
  isiRupiah($('gaji-jumlah'), data.gaji[bulanIni()] || 0);
  isiRupiah($('saldo-awal'), data.saldoAwal);
  renderSemua();
  $('gaji-jumlah').focus();
});
$('form-gaji').addEventListener('submit', e => {
  e.preventDefault();
  const b = bulanIni();
  const gaji = bacaRupiah($('gaji-jumlah').value);
  if (gaji) data.gaji[b] = gaji; else delete data.gaji[b];
  if (b === bulanPertama()) data.saldoAwal = bacaRupiah($('saldo-awal').value);
  ui.gajiDibuka = false;
  ui.gajiDitutup = true;
  simpan();
  renderSemua();
});
$('gaji-batal').addEventListener('click', () => {
  ui.gajiDibuka = false;
  ui.gajiDitutup = true;
  renderSemua();
});

// Tabungan RDPU
$('aksi-rdpu').addEventListener('click', e => {
  const b = e.target.closest('[data-aksi]');
  if (!b) return;
  ui.aksiRdpu = b.dataset.aksi;
  $('rdpu-error').hidden = true;
  renderTabungan();
  $('rdpu-jumlah').focus();
});
$('form-rdpu').addEventListener('submit', e => {
  e.preventDefault();
  const n = bacaRupiah($('rdpu-jumlah').value);
  const tanggal = $('rdpu-tanggal').value || hariIni();
  const aksi = ui.aksiRdpu;

  if (!n && aksi !== 'perbarui') return tampilError('rdpu-error', 'Isi jumlahnya dulu.');
  if (tanggal > hariIni()) return tampilError('rdpu-error', 'Tanggalnya tidak boleh di masa depan.');
  if (aksi === 'cair') {
    const sekarang = Math.round(hitungRdpu().nilai);
    if (n > sekarang) return tampilError('rdpu-error', `Tabunganmu sekarang kira-kira ${rp(sekarang)}, tidak cukup untuk dicairkan sebanyak itu.`);
  }

  if (aksi === 'perbarui') {
    data.rdpu.pembaruan.push({ id: idBaru(), nilai: n, tanggal, dibuat: Date.now() });
  } else {
    data.transaksi.push({ id: idBaru(), tipe: aksi, jumlah: n, kategori: null, catatan: '', tanggal, dibuat: Date.now() });
  }
  simpan();
  $('rdpu-jumlah').value = '';
  $('rdpu-tanggal').value = hariIni();
  $('rdpu-error').hidden = true;
  renderSemua();
});
$('form-rdpu').addEventListener('input', () => { $('rdpu-error').hidden = true; });

$('rdpu-return').addEventListener('change', () => {
  const v = parseFloat($('rdpu-return').value.replace(',', '.'));
  if (Number.isFinite(v) && v >= 0 && v < 100) {
    data.rdpu.returnTahunan = v;
    simpan();
  }
  renderSemua();
});

$('rdpu-daftar').addEventListener('click', e => {
  const b = e.target.closest('[data-hapus-rdpu]');
  if (!b) return;
  const id = b.dataset.hapusRdpu;
  if (b.dataset.jenis === 'perbarui') {
    if (!confirm('Hapus pembaruan nilai ini?')) return;
    data.rdpu.pembaruan = data.rdpu.pembaruan.filter(p => p.id !== id);
    simpan();
    renderSemua();
  } else {
    hapusTransaksi(id);
  }
});

// Emas
$('aksi-emas').addEventListener('click', e => {
  const b = e.target.closest('[data-aksi]');
  if (!b) return;
  ui.aksiEmas = b.dataset.aksi;
  $('emas-error').hidden = true;
  renderEmas();
  $('emas-gram-input').focus();
});
$('emas-gram-input').addEventListener('input', () => renderEmas());
$('form-emas').addEventListener('input', () => { $('emas-error').hidden = true; });
$('form-emas').addEventListener('submit', e => {
  e.preventDefault();
  const gram = Math.round(bacaGram($('emas-gram-input').value) * 10000) / 10000;
  const jumlah = bacaRupiah($('emas-jumlah').value);
  const tanggal = $('emas-tanggal').value || hariIni();
  if (!gram) return tampilError('emas-error', 'Isi beratnya dulu, misalnya 0,5 atau 2.');
  if (!jumlah) return tampilError('emas-error', ui.aksiEmas === 'beli' ? 'Isi total harga yang kamu bayar.' : 'Isi total uang yang kamu terima.');
  if (tanggal > hariIni()) return tampilError('emas-error', 'Tanggalnya tidak boleh di masa depan.');
  if (ui.aksiEmas === 'jual') {
    const punya = hitungEmas().gram;
    if (gram > punya + 0.00005) return tampilError('emas-error', `Emasmu sekarang ${teksGram(punya)}, tidak cukup untuk dijual ${teksGram(gram)}.`);
  }
  data.transaksi.push({ id: idBaru(), tipe: ui.aksiEmas === 'beli' ? 'beliEmas' : 'jualEmas', jumlah, gram, kategori: null, catatan: '', tanggal, dibuat: Date.now() });
  simpan();
  $('emas-gram-input').value = '';
  $('emas-jumlah').value = '';
  $('emas-tanggal').value = hariIni();
  $('emas-error').hidden = true;
  renderSemua();
});
$('emas-daftar').addEventListener('click', tanganiDaftar);
$('harga-perbarui').addEventListener('click', () => perbaruiHarga(true));

// Rekap: geser bulan
$('rekap-prev').addEventListener('click', () => { ui.rekapBulan = geserBulan(ui.rekapBulan, -1); renderSemua(); });
$('rekap-next').addEventListener('click', () => { ui.rekapBulan = geserBulan(ui.rekapBulan, 1); renderSemua(); });

/* =========================================================
   9. BACKUP & PULIHKAN
   Backup = unduh semua data jadi file .json.
   Pulihkan = baca file .json itu dan ganti data sekarang.
   ========================================================= */
function backup() {
  data.terakhirBackup = Date.now();
  simpan();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `catatan-uang-${hariIni()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  renderSemua();
}
document.addEventListener('click', e => { if (e.target.closest('[data-backup]')) backup(); });

$('file-pulihkan').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const isi = JSON.parse(await file.text());
    if (!isi || !Array.isArray(isi.transaksi)) throw new Error('ini bukan file backup Catatan Uang.');
    if (!confirm(`Ganti semua data sekarang dengan isi backup ini (${isi.transaksi.length} catatan)?`)) return;
    data = rapikan(isi);
    simpan();
    resetFormCatat();
    ui.rekapBulan = bulanIni();
    renderSemua();
    alert('Data berhasil dipulihkan.');
  } catch (err) {
    alert('File ini tidak bisa dipulihkan: ' + err.message);
  }
});

/* =========================================================
   10. MULAI
   ========================================================= */
$('catat-tanggal').max = $('rdpu-tanggal').max = $('emas-tanggal').max = hariIni();
$('catat-tanggal').value = $('rdpu-tanggal').value = $('emas-tanggal').value = hariIni();
isiRupiah($('saldo-awal'), data.saldoAwal);
try { // salin data lama (versi planet) ke laci v2 sekali saja
  if (!localStorage.getItem(KUNCI_SIMPAN) && (data.transaksi.length || Object.keys(data.gaji).length)) simpan();
} catch (_) { /* penyimpanan diblokir: sudah diberi tahu saat memuat */ }
muatCacheHarga();
renderSemua();

// Harga emas: ambil saat dibuka kalau sudah lebih dari 3 jam, lalu cek tiap menit.
// (Cek per menit, bukan setTimeout 3 jam, supaya tetap tepat setelah laptop tidur.)
perbaruiHarga();
setInterval(() => perbaruiHarga(), 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) perbaruiHarga(); });
window.addEventListener('online', () => { hargaEmas.cobaTerakhir = 0; perbaruiHarga(); });
