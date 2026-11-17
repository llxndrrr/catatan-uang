/* =========================================================
   SINKRON CLOUD (opsional): masuk dengan akun Google, lalu data
   Catatan Uang disimpan juga di Firebase Firestore.

   - Data tetap disimpan di browser (localStorage) seperti biasa,
     jadi aplikasi tetap jalan tanpa internet / tanpa masuk akun.
   - Di cloud, setiap akun punya satu dokumen: catatanUang/{uid}.
     Aturan keamanan Firestore (firestore.rules) memastikan hanya
     pemilik akun yang bisa membaca & mengubah dokumennya.
   - Project Firebase-nya sama dengan Tugasku, jadi login sekali
     berlaku di kedua aplikasi (keduanya di llxndrrr.github.io).
   - Konfigurasi di bawah memang bukan rahasia: ia hanya menunjuk ke
     project Firebase. Yang menjaga data adalah aturan keamanan.
   ========================================================= */
import {
  initializeApp, getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  getFirestore, doc, getDoc, setDoc,
} from './vendor/firebase.js';

const app = initializeApp({
  apiKey: 'AIzaSyAQa6r-UV6VaxocS0ftXqv98lVffE5toNY',
  authDomain: 'tugasku-21eb7.firebaseapp.com',
  projectId: 'tugasku-21eb7',
  storageBucket: 'tugasku-21eb7.firebasestorage.app',
  messagingSenderId: '412418113186',
  appId: '1:412418113186:web:a4890ec8919f47a5e9e1fb',
});
const auth = getAuth(app);
const db = getFirestore(app);

const APP = window.CatatanUang;
const $ = id => document.getElementById(id);
const KOLEKSI = 'catatanUang';
const KUNCI_META = 'catatanUang.cloud';     // { uid, sinkronDiubah, kotor }
const JEDA_UNGGAH = 1500;                   // tunggu 1,5 detik setelah perubahan terakhir

let pengguna = null;
let timer = null;
let sibuk = false;
let perluLagi = false;
let teksStatus = '';
let kelasStatus = '';

/* ---------- catatan sinkron (disimpan di browser ini) ---------- */
function bacaMeta() {
  try { return JSON.parse(localStorage.getItem(KUNCI_META)) || {}; } catch (e) { return {}; }
}
function tulisMeta(m) {
  try { localStorage.setItem(KUNCI_META, JSON.stringify(m)); } catch (e) { /* abaikan */ }
}

/* ---------- tampilan ---------- */
function setStatus(teks, kelas = '') {
  teksStatus = teks;
  kelasStatus = kelas;
  const el = $('akun-status');
  if (el) { el.textContent = teks; el.className = 'akun-status ' + kelas; }
  renderAkun();
}

function renderAkun() {
  const chip = $('btn-akun');
  chip.hidden = false;
  chip.classList.toggle('masuk', !!pengguna);
  chip.dataset.status = pengguna ? kelasStatus : '';
  // Ikon & label terpisah: di layar HP labelnya disembunyikan supaya tidak menabrak logo
  const [ikon, label] = !pengguna ? ['', 'Masuk']
    : kelasStatus === 'gagal' ? ['⚠', 'Belum sinkron']
    : kelasStatus === 'proses' ? ['☁', 'Menyimpan…']
    : ['☁', 'Tersinkron'];
  const elIkon = document.createElement('span'); elIkon.className = 'ikon'; elIkon.textContent = ikon;
  const elLabel = document.createElement('span'); elLabel.className = 'label'; elLabel.textContent = label;
  chip.replaceChildren(...(ikon ? [elIkon, ' ', elLabel] : [elLabel]));
  chip.setAttribute('aria-label', pengguna ? `Akun: ${label}` : 'Masuk');
  chip.title = pengguna ? 'Akun & sinkron cloud' : 'Masuk untuk menyimpan ke cloud';
  const teks = pengguna
    ? 'Catatan tersimpan di browser ini dan di akun Google-mu (cloud).'
    : 'Semua catatan tersimpan di browser ini saja. Masuk dengan Google atau backup rutin supaya tidak hilang.';
  document.querySelectorAll('[data-teks-data]').forEach(el => { el.textContent = teks; });
  document.querySelectorAll('[data-buka-akun]').forEach(el => {
    el.hidden = false;
    el.textContent = pengguna ? 'Akun & sinkron ->' : 'Masuk dengan Google ->';
  });
}

function bukaDialogAkun() {
  $('akun-luar').hidden = !!pengguna;
  $('akun-dalam').hidden = !pengguna;
  if (pengguna) {
    $('akun-email').textContent = pengguna.email || pengguna.displayName || 'akun Google';
    setStatus(teksStatus || 'Tersimpan di cloud', kelasStatus || 'ok');
  }
  $('akun-error').hidden = true;
  $('dlg-akun').showModal();
}

// Dialog pilihan umum. Mengembalikan nilai tombol yang diklik, atau null kalau ditutup.
function pilih(judul, teks, tombol) {
  return new Promise(selesai => {
    const dlg = $('dlg-pilih');
    $('pilih-judul').textContent = judul;
    $('pilih-teks').replaceChildren(...teks.map(t => { const p = document.createElement('p'); p.textContent = t; return p; }));
    $('pilih-tombol').replaceChildren(...tombol.map(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = t.utama ? 'btn' : 'btn-dua';
      b.textContent = t.label;
      b.addEventListener('click', () => { dlg.returnValue = t.nilai; dlg.close(); });
      return b;
    }));
    dlg.returnValue = '';
    dlg.addEventListener('close', () => selesai(dlg.returnValue || null), { once: true });
    dlg.showModal();
  });
}

const tanggalJam = ms => new Date(ms).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/* ---------- baca & tulis cloud ---------- */
const ref = () => doc(db, KOLEKSI, pengguna.uid);

async function ambilCloud() {
  const s = await getDoc(ref());
  if (!s.exists()) return null;
  const d = s.data();
  return { diubah: d.diubah, data: JSON.parse(d.data) };
}

async function unggah() {
  const diubah = Date.now();
  await setDoc(ref(), { data: JSON.stringify(APP.ambil()), diubah, versi: 1 });
  tulisMeta({ uid: pengguna.uid, sinkronDiubah: diubah, kotor: false });
}

function terimaCloud(cloud) {
  APP.ganti(cloud.data);
  tulisMeta({ uid: pengguna.uid, sinkronDiubah: cloud.diubah, kotor: false });
}

// Data di cloud dan di perangkat ini sama-sama berubah -> pengguna yang memilih
async function pilihVersi(cloud) {
  const jawab = await pilih('Pilih data yang dipakai', [
    'Data di akunmu (cloud) berbeda dengan data di perangkat ini.',
    `Cloud: ${APP.ringkas(cloud.data)} · diubah ${tanggalJam(cloud.diubah)}`,
    `Perangkat ini: ${APP.ringkas(APP.ambil())}`,
    'Data yang tidak dipilih akan diganti. Kalau ragu, klik Backup dulu.',
  ], [
    { label: 'Pakai data perangkat ini', nilai: 'lokal' },
    { label: 'Pakai data cloud', nilai: 'cloud', utama: true },
  ]);
  if (jawab === 'cloud') terimaCloud(cloud);
  else if (jawab === 'lokal') await unggah();
  else return false;            // ditutup: biarkan dulu, nanti ditanya lagi
  return true;
}

/* ---------- inti sinkron ---------- */
async function sinkronkan() {
  if (!pengguna) return;
  if (sibuk) { perluLagi = true; return; }
  sibuk = true;
  setStatus('Menyinkronkan…', 'proses');
  try {
    const meta = bacaMeta();
    const akunSama = meta.uid === pengguna.uid;
    const cloud = await ambilCloud();
    let beres = true;

    if (!cloud) {
      await unggah();                                         // akun baru: kirim data perangkat ini
    } else if (!akunSama) {
      // Pertama kali akun ini dipakai di perangkat ini
      if (!APP.adaIsi()) terimaCloud(cloud);
      else beres = await pilihVersi(cloud);
    } else if (cloud.diubah === meta.sinkronDiubah) {
      if (meta.kotor) await unggah();                         // hanya perangkat ini yang berubah
    } else if (!meta.kotor) {
      terimaCloud(cloud);                                     // hanya cloud yang berubah (dari perangkat lain)
    } else {
      beres = await pilihVersi(cloud);                        // dua-duanya berubah
    }
    setStatus(beres ? 'Tersimpan di cloud' : 'Belum disinkronkan', beres ? 'ok' : 'gagal');
  } catch (e) {
    console.warn('Sinkron gagal:', e);
    setStatus(navigator.onLine ? 'Gagal sinkron, dicoba lagi nanti' : 'Offline · tersimpan di perangkat ini', 'gagal');
  } finally {
    sibuk = false;
    if (perluLagi) { perluLagi = false; jadwalkan(); }
  }
}

function jadwalkan() {
  clearTimeout(timer);
  timer = setTimeout(sinkronkan, JEDA_UNGGAH);
}

// Dipanggil app.js setiap kali pengguna mengubah data
window.saatSimpan = () => {
  const meta = bacaMeta();
  meta.kotor = true;
  tulisMeta(meta);
  if (pengguna) { setStatus('Menyimpan…', 'proses'); jadwalkan(); }
};

/* ---------- masuk & keluar ---------- */
$('btn-akun').addEventListener('click', bukaDialogAkun);
document.addEventListener('click', e => { if (e.target.closest('[data-buka-akun]')) bukaDialogAkun(); });
$('akun-nanti').addEventListener('click', () => $('dlg-akun').close());
$('akun-tutup').addEventListener('click', () => $('dlg-akun').close());

$('akun-masuk').addEventListener('click', async () => {
  $('akun-error').hidden = true;
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    $('dlg-akun').close();
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    const pesan = {
      'auth/popup-blocked': 'Jendela login diblokir browser. Izinkan pop-up untuk situs ini, lalu coba lagi.',
      'auth/unauthorized-domain': 'Alamat situs ini belum diizinkan untuk login.',
      'auth/network-request-failed': 'Tidak ada koneksi internet.',
    }[e.code] || 'Gagal masuk. Coba lagi sebentar lagi.';
    $('akun-error').textContent = pesan;
    $('akun-error').hidden = false;
  }
});

$('akun-keluar').addEventListener('click', async () => {
  $('dlg-akun').close();
  if (bacaMeta().kotor) await sinkronkan();                    // kirim perubahan terakhir dulu
  const jawab = await pilih('Keluar dari akun?', [
    'Catatanmu tetap aman di cloud dan muncul lagi saat kamu masuk.',
    'Kalau ini komputer umum atau milik orang lain, pilih hapus supaya catatan keuanganmu tidak tertinggal di sini.',
    'Keluar juga berlaku untuk Tugasku di browser ini.',
  ], [
    { label: 'Batal', nilai: 'batal' },
    { label: 'Keluar, data tetap di sini', nilai: 'simpan' },
    { label: 'Keluar & hapus dari perangkat ini', nilai: 'hapus', utama: true },
  ]);
  if (jawab !== 'simpan' && jawab !== 'hapus') return;
  clearTimeout(timer);
  await signOut(auth);
  if (jawab === 'hapus') {
    APP.hapusLokal();
    try { localStorage.removeItem(KUNCI_META); } catch (e) { /* abaikan */ }
  }
});

onAuthStateChanged(auth, user => {
  pengguna = user;
  kelasStatus = '';
  renderAkun();
  if (user) sinkronkan();
  else setStatus('');
});

// Kembali ke tab ini (misal habis mengubah di HP) -> ambil perubahan terbaru
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && pengguna && !document.querySelector('dialog[open]')) sinkronkan();
});
window.addEventListener('online', () => { if (pengguna) sinkronkan(); });
