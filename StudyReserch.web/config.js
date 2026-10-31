/* ==========================================================================
   config.js — Pengaturan sederhana STUREKA RISA.
   Anda hanya perlu mengubah file ini jika ingin menyesuaikan teks atau jalur
   gambar. Untuk mengganti banner, cukup timpa file di folder images/ dengan
   nama yang sama (lihat README.md).
   ========================================================================== */

window.SR_CONFIG = {
  appName: 'STUREKA RISA',
  fullName: 'Study Research',
  tagline: 'Study Research, Realize Your Ideas',
  quote: '“Meneliti hari ini, untuk masa depan nanti.”',
  version: '2.0',

  banner: {
    desktop: 'images/banner-desktop.jpg',
    mobile: 'images/banner-mobile.jpg', // opsional; jika tidak ada, banner desktop dipakai
    alt: 'Banner STUREKA RISA',
    mobileMaxWidth: 700 // lebar layar (px) di bawah ini memakai banner mobile
  },

  // Batas ukuran satu file lampiran (MB). Lampiran disimpan di IndexedDB browser.
  maxAttachmentMB: 25,

  // Awalan kunci penyimpanan browser. Jangan diubah setelah data terisi.
  storagePrefix: 'sturekarisa'
};
