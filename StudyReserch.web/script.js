/* ==========================================================================
   STUREKA RISA 2.0 — script.js
   Situs statis tanpa backend. Data penelitian: localStorage.
   Lampiran (file): IndexedDB. Editor teks: Quill (libraries/quill).
   Bagian: 1 Utilitas & penyimpanan · 2 Tampilan · 3 Editor, form, backup, init
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.SR_CONFIG || {};
  var BANNER = CFG.banner || {};
  var P = CFG.storagePrefix || 'sturekarisa';
  var KEY_DATA = P + '.data.v2';
  var KEY_THEME = P + '.theme';
  var OLD_KEY = 'studyresearch.projects.v1';
  var OLD_THEME = 'studyresearch.theme.v1';

  var STATUSES = ['Belum Mulai', 'Dalam Proses', 'Revisi', 'Selesai'];
  var BABS = { 1: 'Pendahuluan', 2: 'Kajian Pustaka', 3: 'Metode Penelitian', 4: 'Hasil dan Pembahasan', 5: 'Penutup' };
  var ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };
  var MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var TABS = [
    ['info', 'Informasi', 'info'], ['ide', 'Ide Penelitian', 'lightbulb'], ['referensi', 'Referensi', 'book-marked'],
    ['checklist', 'Checklist Bab', 'list-checks'], ['timeline', 'Timeline', 'calendar-clock'], ['catatan', 'Catatan', 'sticky-note'],
    ['lampiran', 'Lampiran', 'paperclip']
  ];

  /* ================= 1. UTILITAS ================= */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid(pre) { return (pre || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function nowIso() { return new Date().toISOString(); }

  function ic(name, cls) {
    var inner = (window.SR_ICONS || {})[name];
    if (!inner) return '';
    return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  function hydrate(root) {
    $$('i[data-ic]', root || document).forEach(function (el) {
      el.innerHTML = ic(el.getAttribute('data-ic'));
      el.removeAttribute('data-ic');
    });
  }

  function parseDay(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function daysUntil(s) {
    var d = parseDay(s);
    return d ? Math.round((d - startOfToday()) / 86400000) : null;
  }
  function fmtLong(v) {
    var d = typeof v === 'string' && v.length === 10 ? parseDay(v) : new Date(v);
    return d && !isNaN(d) ? d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() : '—';
  }
  function fmtShort(v) {
    var d = typeof v === 'string' && v.length === 10 ? parseDay(v) : new Date(v);
    return d && !isNaN(d) ? d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear() : '—';
  }
  function rel(iso) {
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'baru saja';
    if (m < 60) return m + ' menit lalu';
    if (m < 1440) return Math.floor(m / 60) + ' jam lalu';
    if (m < 10080) return Math.floor(m / 1440) + ' hari lalu';
    return fmtShort(iso);
  }
  function dueText(days) {
    if (days === null) return '';
    if (days < 0) return 'Terlambat ' + Math.abs(days) + ' hari';
    if (days === 0) return 'Hari ini';
    return 'Dalam ' + days + ' hari';
  }
  function hhmm() { var d = new Date(); return ('0' + d.getHours()).slice(-2) + '.' + ('0' + d.getMinutes()).slice(-2); }
  function countWords(t) { t = (t || '').trim(); return t ? t.split(/\s+/).length : 0; }
  function fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  }

  /* ================= PENYIMPANAN DATA ================= */
  var db = { version: 2, projects: [], activity: [], settings: {} };

  function blankProject(o) {
    var t = nowIso();
    var p = {
      id: uid('p'), title: '', category: '', subject: '', author: '', advisor: '', startDate: '', deadline: '', status: 'Belum Mulai',
      chapters: {}, references: [], checklist: { bab1: false, bab2: false, bab3: false, bab4: false, bab5: false },
      timeline: [], notes: { delta: [], words: 0, updatedAt: null }, attachments: [], createdAt: t, updatedAt: t
    };
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) p[k] = o[k];
    return normProject(p);
  }

  function normProject(p) {
    p.chapters = p.chapters || {};
    for (var i = 1; i <= 5; i++) {
      var c = p.chapters[i] || {};
      p.chapters[i] = { delta: Array.isArray(c.delta) ? c.delta : [], words: c.words || 0, preview: c.preview || '', updatedAt: c.updatedAt || null };
    }
    p.checklist = p.checklist || {};
    for (var j = 1; j <= 5; j++) p.checklist['bab' + j] = !!p.checklist['bab' + j];
    p.references = Array.isArray(p.references) ? p.references : [];
    p.timeline = Array.isArray(p.timeline) ? p.timeline : [];
    p.attachments = Array.isArray(p.attachments) ? p.attachments : [];
    p.notes = (p.notes && typeof p.notes === 'object') ? p.notes : { delta: [], words: 0, updatedAt: null };
    p.notes.delta = Array.isArray(p.notes.delta) ? p.notes.delta : [];
    if (STATUSES.indexOf(p.status) < 0) p.status = p.status === 'Proses' ? 'Dalam Proses' : 'Belum Mulai';
    p.title = p.title || ''; p.createdAt = p.createdAt || nowIso(); p.updatedAt = p.updatedAt || p.createdAt;
    return p;
  }

  function textToOps(t) { t = (t || '').trim(); return t ? [{ insert: t + '\n' }] : []; }

  /* Migrasi dari versi lama (StudyResearch 1.x). Data lama tidak dihapus. */
  function migrateProject(o, pendingFiles) {
    o = o || {};
    var idea = o.idea || {};
    function block(items) {
      var ops = [];
      items.forEach(function (it) {
        var v = (idea[it[0]] || '').trim();
        if (!v) return;
        ops.push({ insert: it[1], attributes: { bold: true } }, { insert: '\n' }, { insert: v + '\n' });
      });
      return ops;
    }
    var b1 = block([['background', 'Latar Belakang'], ['problem', 'Rumusan Masalah'], ['purpose', 'Tujuan Penelitian'], ['hypothesis', 'Hipotesis'], ['benefit', 'Manfaat Penelitian']]);
    var b3 = block([['variables', 'Variabel Penelitian'], ['method', 'Metode'], ['object', 'Objek Penelitian']]);
    var chapters = {};
    chapters[1] = { delta: b1, words: countWords(b1.map(function (x) { return x.insert; }).join(' ')), preview: '', updatedAt: o.updatedAt || null };
    chapters[3] = { delta: b3, words: countWords(b3.map(function (x) { return x.insert; }).join(' ')), preview: '', updatedAt: o.updatedAt || null };
    [1, 3].forEach(function (n) { chapters[n].preview = chapters[n].delta.map(function (x) { return x.insert; }).join(' ').replace(/\s+/g, ' ').slice(0, 200); });
    var atts = [];
    (o.attachments || []).forEach(function (f) {
      if (!f || !f.id) return;
      atts.push({ id: f.id, name: f.name || 'lampiran', type: f.type || 'application/octet-stream', size: f.size || 0, addedAt: f.addedAt || nowIso() });
      if (f.data && pendingFiles) pendingFiles.push({ id: f.id, data: f.data });
    });
    return blankProject({
      id: o.id || uid('p'), title: o.title || '', category: o.category || '', subject: o.subject || '', author: o.author || '', advisor: o.advisor || '',
      startDate: o.startDate || '', deadline: o.deadline || '', status: o.status === 'Proses' ? 'Dalam Proses' : (o.status || 'Belum Mulai'),
      chapters: chapters, checklist: o.checklist || {},
      references: (o.references || []).map(function (r) {
        return { id: r.id || uid('r'), title: r.title || '', author: r.author || '', year: r.year || '', type: r.type || 'Buku', link: r.link || '', note: r.note || '' };
      }),
      timeline: (o.timeline || []).map(function (t) {
        return { id: t.id || uid('t'), date: t.date || '', title: t.title || '', desc: t.desc || '', done: !!t.done };
      }),
      notes: { delta: textToOps(o.notes), words: countWords(o.notes), updatedAt: o.updatedAt || null },
      attachments: atts, createdAt: o.createdAt || nowIso(), updatedAt: o.updatedAt || nowIso()
    });
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY_DATA); } catch (e) { /* storage dinonaktifkan */ }
    if (raw) {
      try {
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.projects)) {
          db = d; db.projects = db.projects.map(normProject);
          db.activity = Array.isArray(db.activity) ? db.activity : []; db.settings = db.settings || {};
          return;
        }
      } catch (e) {
        console.warn('Data rusak, salinan disimpan terpisah.', e);
        try { localStorage.setItem(P + '.corrupt.' + Date.now(), raw); } catch (e2) { /* abaikan */ }
      }
    }
    db = { version: 2, projects: [], activity: [], settings: {} };
    try {
      var old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null');
      if (Array.isArray(old) && old.length) {
        var pending = [];
        db.projects = old.map(function (o) { return migrateProject(o, pending); });
        db.activity.push({ at: nowIso(), text: 'Data dari versi lama (' + old.length + ' penelitian) berhasil dipindahkan' });
        persist();
        pending.forEach(function (f) {
          fetch(f.data).then(function (r) { return r.blob(); }).then(function (b) { return idbPut(f.id, b); }).catch(function (e) { console.warn('Lampiran lama gagal dipindah', e); });
        });
      }
    } catch (e) { console.warn('Migrasi dilewati', e); }
  }

  function persist() {
    try { localStorage.setItem(KEY_DATA, JSON.stringify(db)); return true; }
    catch (e) {
      console.error(e);
      toast('Gagal menyimpan: penyimpanan browser penuh atau dinonaktifkan. Segera Ekspor JSON.', 'err');
      return false;
    }
  }

  function log(text, key) {
    var a = db.activity, last = a[0];
    if (key && last && last.key === key && Date.now() - new Date(last.at).getTime() < 600000) { last.at = nowIso(); last.text = text; return; }
    a.unshift({ at: nowIso(), text: text, key: key || '' });
    if (a.length > 40) a.length = 40;
  }
  function getP(id) { for (var i = 0; i < db.projects.length; i++) if (db.projects[i].id === id) return db.projects[i]; return null; }
  function touch(p) { p.updatedAt = nowIso(); }

  /* ----- Progres (50% checklist bab + 30% timeline + 20% referensi) ----- */
  function progressOf(p) {
    var cl = Object.keys(p.checklist).filter(function (k) { return p.checklist[k]; }).length / 5;
    var tl = p.timeline.length ? p.timeline.filter(function (t) { return t.done; }).length / p.timeline.length : 0;
    var rf = Math.min(p.references.length / 3, 1);
    return { total: Math.round((cl * 0.5 + tl * 0.3 + rf * 0.2) * 100), checklist: Math.round(cl * 100), timeline: Math.round(tl * 100), reference: Math.round(rf * 100) };
  }
  function avgProgress(list) {
    return list.length ? Math.round(list.reduce(function (s, p) { return s + progressOf(p).total; }, 0) / list.length) : 0;
  }

  /* ----- IndexedDB untuk lampiran ----- */
  var idbPromise = null;
  function idb() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('IndexedDB tidak tersedia')); return; }
      var r = indexedDB.open(P + '-files', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('files'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return idbPromise;
  }
  function idbDo(mode, fn) {
    return idb().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction('files', mode), q = fn(t.objectStore('files'));
        t.oncomplete = function () { res(q ? q.result : undefined); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  function idbPut(id, blob) { return idbDo('readwrite', function (s) { return s.put(blob, id); }); }
  function idbGet(id) { return idbDo('readonly', function (s) { return s.get(id); }); }
  function idbDel(id) { return idbDo('readwrite', function (s) { return s.delete(id); }); }
  function idbClear() { return idbDo('readwrite', function (s) { return s.clear(); }); }

  /* ================= TEMA ================= */
  function getTheme() { return document.documentElement.getAttribute('data-theme') || 'light'; }
  function applyTheme(t, save) {
    document.documentElement.setAttribute('data-theme', t);
    if (save) { try { localStorage.setItem(KEY_THEME, t); } catch (e) { /* abaikan */ } }
    var dark = t === 'dark';
    var top = $('#themeTop'); if (top) top.innerHTML = ic(dark ? 'sun' : 'moon');
    var meta = $('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', dark ? '#0b1222' : '#1d4ed8');
  }
  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(KEY_THEME) || localStorage.getItem(OLD_THEME); } catch (e) { /* abaikan */ }
    applyTheme(saved === 'dark' || saved === 'light' ? saved : getTheme(), !!saved);
  }

  /* ================= UI DASAR: toast, modal, konfirmasi ================= */
  function toast(msg, type) {
    var box = $('#toasts'), el = document.createElement('div');
    el.className = 'toast' + (type === 'err' ? ' err' : '');
    el.textContent = msg; box.appendChild(el);
    setTimeout(function () { el.remove(); }, type === 'err' ? 6000 : 3000);
  }

  var modalStack = [];
  function openModal(o) {
    var ov = document.createElement('div'); ov.className = 'overlay';
    var extras = (o.extras || []).map(function (x, i) { return '<button type="button" class="btn ' + (x.cls || '') + '" data-extra="' + i + '">' + esc(x.label) + '</button>'; }).join('');
    ov.innerHTML =
      '<form class="modal ' + (o.size || '') + '" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
      '<div class="modal-h"><h2>' + esc(o.title) + '</h2><button type="button" class="icon-btn" data-close aria-label="Tutup">' + ic('x') + '</button></div>' +
      '<div class="modal-b">' + o.body + '</div>' +
      '<div class="modal-f">' + (o.cancel === false ? '' : '<button type="button" class="btn" data-close>' + esc(o.cancel || 'Batal') + '</button>') + extras +
      (o.submit ? '<button type="submit" class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '">' + esc(o.submit) + '</button>' : '') + '</div></form>';
    document.body.appendChild(ov);
    var form = $('form', ov), prevFocus = document.activeElement;
    var api = { el: ov, form: form, close: function () {
      var i = modalStack.indexOf(api); if (i > -1) modalStack.splice(i, 1);
      ov.remove(); if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) { /* abaikan */ } }
    } };
    modalStack.push(api);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) api.close(); });
    $$('[data-close]', ov).forEach(function (b) { b.addEventListener('click', api.close); });
    $$('[data-extra]', ov).forEach(function (b) { b.addEventListener('click', function () { o.extras[+b.getAttribute('data-extra')].fn(api); }); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (o.onSubmit && o.onSubmit(form, api) === false) return;
      api.close();
    });
    var first = $('input:not([type=hidden]), select, textarea', form) || $('button[type=submit]', form) || $('[data-close]', form);
    if (first) setTimeout(function () { first.focus(); }, 30);
    if (o.onMount) o.onMount(form, api);
    return api;
  }

  function confirmBox(o) {
    openModal({
      title: o.title, size: 'sm', submit: o.confirm || 'Hapus', danger: o.danger !== false,
      body: '<div class="center"><div class="confirm-ico">' + ic('triangle-alert') + '</div><p>' + o.desc + '</p></div>',
      onSubmit: function () { o.onConfirm(); }
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modalStack.length) { modalStack[modalStack.length - 1].close(); }
  });

  /* ================= 2. TAMPILAN ================= */
  var app = null;
  var S = { q: '', status: '', sort: 'newest' };   // state daftar penelitian
  var refQuery = '';
  var activeEd = null;

  function statusClass(s) { return { 'Belum Mulai': 'b-belum', 'Dalam Proses': 'b-proses', 'Revisi': 'b-revisi', 'Selesai': 'b-selesai' }[s] || 'b-belum'; }
  function badge(s) { return '<span class="badge ' + statusClass(s) + '">' + esc(s) + '</span>'; }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }
  function curRoute() { return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent); }

  /* ---------- Banner ---------- */
  var bannerOK = true;
  function setupBanner() {
    var img = $('#bannerImg');
    img.alt = BANNER.alt || 'Banner';
    var mq = window.matchMedia('(max-width:' + (BANNER.mobileMaxWidth || 700) + 'px)');
    function pick() {
      var src = mq.matches && BANNER.mobile ? BANNER.mobile : BANNER.desktop;
      img.onerror = function () {
        if (img.getAttribute('src') !== BANNER.desktop && BANNER.desktop) img.src = BANNER.desktop;
        else { bannerOK = false; showBanner(false); }
      };
      img.onload = function () { bannerOK = true; };
      if (src) img.src = src; else { bannerOK = false; showBanner(false); }
    }
    pick();
    if (mq.addEventListener) mq.addEventListener('change', pick); else if (mq.addListener) mq.addListener(pick);
  }
  function showBanner(show) { $('#bannerWrap').hidden = !(show && bannerOK); }

  /* ---------- Router ---------- */
  function route(keepScroll) {
    flushEditor();
    closeFloating();
    var p = curRoute(), a = p[0] || 'dashboard';
    $$('[data-nav]').forEach(function (n) {
      n.classList.toggle('is-active', n.getAttribute('data-nav') === (a === 'penelitian' && p[1] ? 'penelitian' : a));
    });
    $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show');
    showBanner(a === 'dashboard' || (a === 'penelitian' && !p[1]));
    if (a === 'dashboard') viewDashboard();
    else if (a === 'penelitian') { if (!p[1]) viewAll(); else viewRoom(p[1], p[2] || 'info', p[3]); }
    else if (a === 'pengaturan') viewSettings();
    else if (a === 'tentang') viewAbout();
    else { location.replace('#/dashboard'); return; }
    hydrate(app);
    if (!keepScroll) window.scrollTo(0, 0);
    updateBell();
    document.title = (a === 'penelitian' && p[1] && getP(p[1]) ? getP(p[1]).title + ' — ' : '') + 'STUREKA RISA';
  }
  function rerender() { route(true); }

  /* ---------- Daftar penelitian ---------- */
  function filtered() {
    var q = S.q.trim().toLowerCase();
    var arr = db.projects.filter(function (p) {
      return (!S.status || p.status === S.status) &&
        (!q || (p.title + ' ' + p.category + ' ' + p.subject + ' ' + p.author + ' ' + p.advisor).toLowerCase().indexOf(q) > -1);
    });
    arr.sort(function (a, b) {
      if (S.sort === 'oldest') return a.createdAt < b.createdAt ? -1 : 1;
      if (S.sort === 'prog-desc') return progressOf(b).total - progressOf(a).total;
      if (S.sort === 'prog-asc') return progressOf(a).total - progressOf(b).total;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    return arr;
  }

  function rowHTML(p) {
    var pr = progressOf(p).total;
    return '<article class="rrow" tabindex="0" role="link" data-act="open" data-id="' + p.id + '" aria-label="Buka ' + esc(p.title) + '">' +
      '<div class="r-title-wrap"><div class="r-title">' + esc(p.title || '(Tanpa judul)') + '</div>' +
      '<div class="r-date">' + ic('calendar-days') + 'Dibuat: ' + fmtLong(p.createdAt) + '</div></div>' +
      '<div class="r-meta">' + badge(p.status) + '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pr + '"><i style="width:' + pr + '%"></i></div><span class="r-pct">' + pr + '%</span></div>' +
      '<button class="menu-btn" type="button" data-act="kebab" data-id="' + p.id + '" aria-label="Menu penelitian" aria-haspopup="menu">' + ic('ellipsis-vertical') + '</button></article>';
  }

  function renderRows(limit) {
    var mount = $('#listMount'); if (!mount) return;
    var all = filtered(), list = limit ? all.slice(0, limit) : all, html;
    if (!db.projects.length) {
      html = '<div class="empty"><h3>Belum ada penelitian</h3><p>Mulai dengan menambahkan penelitian pertama Anda.</p><button class="btn btn-primary" data-act="add-research">' + ic('plus') + 'Tambah Penelitian</button></div>';
    } else if (!all.length) {
      html = '<div class="empty"><h3>Tidak ditemukan</h3><p>Coba kata kunci atau filter lain.</p></div>';
    } else {
      html = list.map(rowHTML).join('');
      if (limit && all.length > limit) html += '<a class="more-link" href="#/penelitian">Lihat semua (' + all.length + ') ' + ic('arrow-right') + '</a>';
    }
    mount.innerHTML = html;
  }

  function listSection(limit) {
    return '<div class="sec-head"><div class="ttl"><span class="sec-ico">' + ic('folder-open') + '</span><div><h2>Semua Penelitian</h2><p>Kelola semua proyek penelitian Anda di sini.</p></div></div>' +
      '<div class="list-tools">' +
      '<label class="field-inline">' + ic('search') + '<input id="listQ" type="search" placeholder="Cari penelitian…" value="' + esc(S.q) + '" style="width:150px"></label>' +
      '<label class="field-inline"><select id="listStatus" aria-label="Filter status"><option value="">Semua Status</option>' +
      STATUSES.map(function (s) { return '<option' + (S.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      '<label class="field-inline">' + ic('arrow-up-down') + '<select id="listSort" aria-label="Urutkan">' +
      [['newest', 'Terbaru'], ['oldest', 'Terlama'], ['prog-desc', 'Progres tertinggi'], ['prog-asc', 'Progres terendah']].map(function (o) {
        return '<option value="' + o[0] + '"' + (S.sort === o[0] ? ' selected' : '') + '>Urutkan: ' + o[1] + '</option>';
      }).join('') + '</select></label>' +
      '<button class="btn btn-primary" data-act="add-research">' + ic('plus') + 'Tambah Penelitian</button></div></div>' +
      '<div class="card rlist" id="listMount"></div>';
  }

  /* ---------- Dashboard ---------- */
  function viewDashboard() {
    var ps = db.projects, now = new Date();
    var d = now.getDate() + ' ' + MONTHS[now.getMonth()] + ' ' + now.getFullYear();
    var weekNew = ps.filter(function (p) { return Date.now() - new Date(p.createdAt).getTime() < 7 * 86400000; }).length;
    var active = ps.filter(function (p) { return p.status === 'Dalam Proses' || p.status === 'Revisi'; });
    var revisi = ps.filter(function (p) { return p.status === 'Revisi'; }).length;
    var done = ps.filter(function (p) { return p.status === 'Selesai'; }).length;
    var withDl = ps.filter(function (p) { return p.status !== 'Selesai' && p.deadline; }).sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; });
    var near = null;
    withDl.forEach(function (p) { if (!near && daysUntil(p.deadline) >= 0) near = p; });
    if (!near && withDl.length) near = withDl[0];
    var nd = near ? daysUntil(near.deadline) : null;
    var avg = avgProgress(ps);

    var stats =
      '<div class="stat c1"><div class="st-top"><span class="st-ico">' + ic('file-text') + '</span>Total Penelitian</div><div class="st-val">' + ps.length + '</div><div class="st-sub">+' + weekNew + ' dalam 7 hari terakhir</div></div>' +
      '<div class="stat c2"><div class="st-top"><span class="st-ico">' + ic('clock') + '</span>Sedang Dikerjakan</div><div class="st-val">' + active.length + '</div><div class="st-sub">' + revisi + ' dalam revisi</div></div>' +
      '<div class="stat c3"><div class="st-top"><span class="st-ico">' + ic('check') + '</span>Selesai</div><div class="st-val">' + done + '</div><div class="st-sub">' + (ps.length ? Math.round(done / ps.length * 100) : 0) + '% dari total</div></div>' +
      '<div class="stat c4"><div class="st-top"><span class="st-ico">' + ic('calendar-days') + '</span>Deadline Terdekat</div><div class="st-val sm">' + (near ? fmtShort(near.deadline) : '—') + '</div>' +
      '<div class="st-sub' + (nd !== null && nd < 0 ? ' late' : '') + '">' + (near ? dueText(nd) : 'Belum ada deadline') + '</div></div>' +
      '<div class="stat c5"><div class="st-top"><span class="st-ico">' + ic('trending-up') + '</span>Progres Rata-Rata</div><div class="st-val">' + avg + '%</div><div class="bar"><i style="width:' + avg + '%"></i></div></div>';

    var m = now.getMonth(), y = now.getFullYear();
    var thisM = ps.filter(function (p) { var c = new Date(p.createdAt); return c.getMonth() === m && c.getFullYear() === y; }).length;
    var lastM = ps.filter(function (p) { var c = new Date(p.createdAt), l = new Date(y, m - 1, 1); return c.getMonth() === l.getMonth() && c.getFullYear() === l.getFullYear(); }).length;
    var overdue = ps.filter(function (p) { return p.status !== 'Selesai' && p.deadline && daysUntil(p.deadline) < 0; }).length;
    var info = lastM > 0
      ? 'Penelitian baru bulan ini: ' + thisM + ' (' + (thisM >= lastM ? '+' : '') + Math.round((thisM - lastM) / lastM * 100) + '% dibanding bulan lalu).'
      : thisM + ' penelitian dibuat bulan ini.';
    if (overdue) info += ' ' + overdue + ' penelitian melewati deadline.';
    var bars = ps.slice().sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; }).slice(0, 6).reverse()
      .map(function (p) { return '<i title="' + esc(p.title) + ': ' + progressOf(p).total + '%" style="height:' + Math.max(progressOf(p).total, 6) + '%"></i>'; }).join('');

    var acts = db.activity.slice(0, 5).map(function (a) { return '<li><span>' + esc(a.text) + '</span><time>' + rel(a.at) + '</time></li>'; }).join('') ||
      '<li><span class="muted">Belum ada aktivitas.</span></li>';

    app.innerHTML =
      '<div class="sec-head" style="margin-top:6px"><div class="ttl"><span class="sec-ico">' + ic('layout-dashboard') + '</span><div><h1>Dashboard</h1><p>Ringkasan kegiatan penelitian Anda.</p></div></div>' +
      '<span class="date-chip">' + ic('calendar-days') + DAYS[now.getDay()] + ', ' + d + '</span></div>' +
      '<div class="stats">' + stats + '</div>' + listSection(5) +
      '<div class="dash-bottom"><div class="card panel"><h3>' + ic('info') + 'Informasi Cepat</h3><div class="quick"><p>' + esc(info) + '</p><div class="mini-bars" aria-hidden="true">' + bars + '</div></div></div>' +
      '<div class="card panel"><h3>' + ic('clock') + 'Aktivitas Terbaru<a class="link" href="#" data-act="all-activity">Lihat Semua</a></h3><ul class="act">' + acts + '</ul></div></div>';
    renderRows(5);
  }

  function viewAll() {
    app.innerHTML = '<div style="margin-top:6px"></div>' + listSection(0).replace('<h2>Semua Penelitian</h2>', '<h1>Semua Penelitian</h1>');
    renderRows(0);
  }

  /* ---------- Research Room ---------- */
  function viewRoom(id, tab, sub) {
    var p = getP(id);
    if (!p) {
      app.innerHTML = '<div class="card empty" style="margin-top:20px"><h3>Penelitian tidak ditemukan</h3><p>Mungkin sudah dihapus.</p><a class="btn btn-primary" href="#/penelitian">Kembali ke daftar</a></div>';
      return;
    }
    if (tab === 'ide' && sub) {
      var n = parseInt(sub, 10);
      if (n >= 1 && n <= 5) { viewChapterEditor(p, n); return; }
    }
    if (!TABS.some(function (t) { return t[0] === tab; })) tab = 'info';
    var pr = progressOf(p).total;
    var head =
      '<a class="back" href="#/penelitian">' + ic('arrow-left') + 'Semua Penelitian</a>' +
      '<div class="card room-head"><div class="rh-main"><h1>' + esc(p.title || '(Tanpa judul)') + '</h1><div class="rh-meta">' + badge(p.status) +
      '<span>' + ic('calendar-days') + ' Deadline: ' + (p.deadline ? fmtLong(p.deadline) : '—') + '</span></div></div>' +
      '<div class="rh-prog"><div class="row"><span>Progres rata-rata</span><span>' + pr + '%</span></div><div class="bar"><i style="width:' + pr + '%"></i></div></div>' +
      '<div class="rh-actions"><button class="btn" data-act="edit-research" data-id="' + p.id + '">' + ic('pencil') + 'Edit</button>' +
      '<button class="btn btn-ghost-danger" data-act="delete-research" data-id="' + p.id + '">' + ic('trash-2') + 'Hapus</button></div></div>' +
      '<nav class="tabs" aria-label="Menu penelitian">' + TABS.map(function (t) {
        return '<a class="tab' + (t[0] === tab ? ' is-active' : '') + '" href="#/penelitian/' + p.id + '/' + t[0] + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + ic(t[2]) + t[1] + '</a>';
      }).join('') + '</nav><div id="panel"></div>';
    app.innerHTML = head;
    var panel = $('#panel');
    ({ info: tabInfo, ide: tabIde, referensi: tabRef, checklist: tabChecklist, timeline: tabTimeline, catatan: tabNotes, lampiran: tabFiles })[tab](p, panel);
  }

  function tabInfo(p, el) {
    var pr = progressOf(p);
    function kv(k, v) { return '<div><dt>' + k + '</dt><dd>' + (v ? esc(v) : '—') + '</dd></div>'; }
    el.innerHTML = '<div class="card"><dl class="kv" style="margin:0">' + kv('Judul', p.title) + kv('Kategori', p.category) + kv('Mata Pelajaran / Bidang', p.subject) +
      kv('Penulis', p.author) + kv('Pembimbing', p.advisor) + kv('Tanggal Mulai', p.startDate ? fmtLong(p.startDate) : '') + kv('Deadline', p.deadline ? fmtLong(p.deadline) : '') +
      kv('Status', p.status) + kv('Dibuat', fmtLong(p.createdAt)) + kv('Terakhir diubah', fmtLong(p.updatedAt)) + '</dl>' +
      '<div class="break"><div class="bi"><small>Checklist Bab (50%)</small><b>' + pr.checklist + '%</b></div><div class="bi"><small>Timeline (30%)</small><b>' + pr.timeline + '%</b></div><div class="bi"><small>Referensi (20%, target 3)</small><b>' + pr.reference + '%</b></div></div>' +
      '<div class="note-box">Progres dihitung otomatis dari checklist bab, timeline yang selesai, dan jumlah referensi. Ubah data lewat menu masing-masing.</div></div>';
  }

  function tabIde(p, el) {
    el.innerHTML = '<div class="grid-2">' + [1, 2, 3, 4, 5].map(function (n) {
      var c = p.chapters[n];
      return '<div class="card chap"><div class="c-top"><span class="c-num">' + n + '</span><div><h3>Bab ' + n + ' — ' + BABS[n] + '</h3><div class="c-meta">' +
        (c.words ? c.words + ' kata · diubah ' + rel(c.updatedAt || p.updatedAt) : 'Belum ditulis') + '</div></div></div>' +
        '<p class="c-prev">' + (c.preview ? esc(c.preview) : '<span class="muted">Klik tombol di bawah untuk mulai menulis.</span>') + '</p>' +
        '<a class="btn btn-primary btn-sm" href="#/penelitian/' + p.id + '/ide/' + n + '">' + ic('file-pen') + (c.words ? 'Lanjutkan menulis' : 'Buka editor') + '</a></div>';
    }).join('') + '</div>';
  }

  /* ----- Referensi ----- */
  function refIcon(t) { return t === 'Website' ? 'external-link' : t === 'Jurnal' ? 'file-text' : 'book-open'; }
  function tabRef(p, el) {
    el.innerHTML = '<div class="toolbar-row"><label class="field-inline grow">' + ic('search') + '<input id="refQ" type="search" placeholder="Cari referensi…" value="' + esc(refQuery) + '" style="width:100%"></label>' +
      '<button class="btn btn-primary" data-act="ref-add" data-id="' + p.id + '">' + ic('plus') + 'Tambah Referensi</button></div><div id="refMount"></div>';
    renderRefs(p);
  }
  function renderRefs(p) {
    var q = refQuery.trim().toLowerCase();
    var list = p.references.filter(function (r) { return !q || (r.title + ' ' + r.author + ' ' + r.note).toLowerCase().indexOf(q) > -1; })
      .sort(function (a, b) { return (+b.year || 0) - (+a.year || 0); });
    $('#refMount').innerHTML = list.length ? list.map(function (r) {
      return '<div class="card item"><span class="it-ico">' + ic(refIcon(r.type)) + '</span><div class="it-main"><h4>' + esc(r.title) + '</h4><div class="it-sub">' + esc(r.author) + (r.year ? ' · ' + esc(r.year) : '') + ' · ' + esc(r.type) + '</div>' +
        (r.link ? '<div class="it-sub"><a href="' + esc(r.link) + '" target="_blank" rel="noopener noreferrer">' + esc(r.link) + '</a></div>' : '') +
        (r.note ? '<div class="it-note">' + esc(r.note) + '</div>' : '') + '</div><div class="it-act"><button class="icon-btn" data-act="ref-edit" data-id="' + p.id + '" data-rid="' + r.id + '" aria-label="Edit referensi">' + ic('pencil') + '</button>' +
        '<button class="icon-btn" data-act="ref-del" data-id="' + p.id + '" data-rid="' + r.id + '" aria-label="Hapus referensi">' + ic('trash-2') + '</button></div></div>';
    }).join('') : '<div class="card empty"><h3>' + (p.references.length ? 'Tidak ditemukan' : 'Belum ada referensi') + '</h3><p>' + (p.references.length ? 'Coba kata kunci lain.' : 'Catat buku, jurnal, atau website yang Anda gunakan.') + '</p></div>';
  }

  /* ----- Checklist ----- */
  function tabChecklist(p, el) {
    var pr = progressOf(p).checklist;
    el.innerHTML = '<div class="card panel" style="margin-bottom:12px"><div class="rh-prog" style="min-width:0"><div class="row"><span>Bab selesai</span><span>' + pr + '%</span></div><div class="bar"><i style="width:' + pr + '%"></i></div></div></div>' +
      [1, 2, 3, 4, 5].map(function (n) {
        var on = p.checklist['bab' + n];
        return '<label class="card chk' + (on ? ' done' : '') + '"><input type="checkbox" data-chg="chk" data-id="' + p.id + '" data-n="' + n + '"' + (on ? ' checked' : '') + '><span class="c-main"><strong>Bab ' + ROMAN[n] + ' — ' + BABS[n] + '</strong>' +
          '<span class="it-sub" style="display:block">' + (p.chapters[n].words ? p.chapters[n].words + ' kata ditulis' : 'Belum ditulis') + '</span></span>' +
          '<a class="btn btn-sm" href="#/penelitian/' + p.id + '/ide/' + n + '">Tulis</a></label>';
      }).join('');
  }

  /* ----- Timeline ----- */
  function tabTimeline(p, el) {
    var list = p.timeline.slice().sort(function (a, b) { return (a.date || '9') < (b.date || '9') ? -1 : 1; });
    el.innerHTML = '<div class="toolbar-row"><span class="grow muted">' + p.timeline.filter(function (t) { return t.done; }).length + ' dari ' + p.timeline.length + ' target selesai</span>' +
      '<button class="btn btn-primary" data-act="tl-add" data-id="' + p.id + '">' + ic('plus') + 'Tambah Target</button></div>' +
      (list.length ? '<div class="tl">' + list.map(function (t) {
        var late = !t.done && t.date && daysUntil(t.date) < 0;
        return '<div class="card tl-item' + (t.done ? ' done' : '') + (late ? ' late' : '') + '"><input type="checkbox" data-chg="tl" data-id="' + p.id + '" data-tid="' + t.id + '"' + (t.done ? ' checked' : '') + ' aria-label="Tandai selesai">' +
          '<div class="tl-main"><h4>' + esc(t.title) + '</h4><div class="it-sub">' + (t.date ? fmtLong(t.date) : 'Tanpa tanggal') + (late ? ' · <b style="color:var(--danger)">' + dueText(daysUntil(t.date)) + '</b>' : '') + '</div>' +
          (t.desc ? '<div class="it-note">' + esc(t.desc) + '</div>' : '') + '</div><div class="it-act"><button class="icon-btn" data-act="tl-edit" data-id="' + p.id + '" data-tid="' + t.id + '" aria-label="Edit target">' + ic('pencil') + '</button>' +
          '<button class="icon-btn" data-act="tl-del" data-id="' + p.id + '" data-tid="' + t.id + '" aria-label="Hapus target">' + ic('trash-2') + '</button></div></div>';
      }).join('') + '</div>' : '<div class="card empty"><h3>Belum ada target</h3><p>Susun tahapan dan tenggat penelitian Anda.</p></div>');
  }

  /* ----- Catatan (editor teks) ----- */
  function tabNotes(p, el) {
    el.innerHTML = '<div class="ed-head"><div class="grow"><h2 style="font-size:17px">Catatan Penelitian</h2><p>Format tulisan tersimpan otomatis.</p></div>' +
      '<span class="save-state" id="saveState">Tersimpan</span><button class="btn btn-primary" data-act="ed-save">' + ic('save') + 'Simpan</button></div><div id="edMount"></div>';
    mountEditor({
      mount: $('#edMount'), delta: p.notes.delta, placeholder: 'Tulis catatan penting di sini…',
      save: function (ops, text) { p.notes = { delta: ops, words: countWords(text), updatedAt: nowIso() }; touch(p); return persist(); }
    });
  }

  /* ----- Lampiran ----- */
  function tabFiles(p, el) {
    var max = CFG.maxAttachmentMB || 25;
    el.innerHTML = '<div class="dropzone" id="dropzone">' + ic('upload') + '<p style="margin-top:6px"><b>Tarik file ke sini</b> atau pilih dari perangkat</p>' +
      '<button class="btn btn-primary" data-act="file-pick">' + ic('paperclip') + 'Pilih File</button><p class="hint">Maksimal ' + max + ' MB per file. File disimpan di browser ini (IndexedDB) dan tidak diunggah ke server.</p></div>' +
      '<div class="toolbar-row" style="margin-top:16px"><span class="grow muted">' + p.attachments.length + ' lampiran</span><span class="muted" id="quotaInfo"></span></div><div id="fileMount"></div>';
    $('#fileMount').innerHTML = p.attachments.length ? p.attachments.map(function (f) {
      return '<div class="card item"><span class="it-ico">' + ic('file') + '</span><div class="it-main"><h4>' + esc(f.name) + '</h4><div class="it-sub">' + fmtBytes(f.size) + ' · ' + fmtShort(f.addedAt) + '</div></div>' +
        '<div class="it-act"><button class="icon-btn" data-act="file-dl" data-id="' + p.id + '" data-fid="' + f.id + '" aria-label="Unduh">' + ic('download') + '</button>' +
        '<button class="icon-btn" data-act="file-del" data-id="' + p.id + '" data-fid="' + f.id + '" aria-label="Hapus lampiran">' + ic('trash-2') + '</button></div></div>';
    }).join('') : '<div class="card empty"><h3>Belum ada lampiran</h3><p>Simpan dokumen, data, atau gambar pendukung di sini.</p></div>';
    showQuota('#quotaInfo');
    var dz = $('#dropzone');
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
    dz.addEventListener('drop', function (e) { addFiles(p, e.dataTransfer.files); });
  }
  function showQuota(sel) {
    var el = $(sel);
    if (!el || !navigator.storage || !navigator.storage.estimate) return;
    navigator.storage.estimate().then(function (e) {
      if (e && e.quota && $(sel)) $(sel).textContent = 'Penyimpanan browser: ' + fmtBytes(e.usage || 0) + ' terpakai dari ± ' + fmtBytes(e.quota);
    }).catch(function () { /* abaikan */ });
  }
  function addFiles(p, fileList) {
    var files = Array.prototype.slice.call(fileList || []), max = (CFG.maxAttachmentMB || 25) * 1048576, skipped = 0, added = 0;
    if (!files.length) return;
    files.reduce(function (chain, f) {
      return chain.then(function () {
        if (f.size > max) { skipped++; return; }
        var id = uid('f');
        return idbPut(id, f).then(function () {
          p.attachments.push({ id: id, name: f.name, type: f.type || 'application/octet-stream', size: f.size, addedAt: nowIso() }); added++;
        }).catch(function (e) { console.error(e); skipped++; });
      });
    }, Promise.resolve()).then(function () {
      if (added) { touch(p); log('Lampiran ditambahkan pada “' + p.title + '”'); persist(); }
      if (skipped) toast(skipped + ' file dilewati (melebihi ' + (CFG.maxAttachmentMB || 25) + ' MB atau penyimpanan penuh).', 'err');
      else if (added) toast(added + ' lampiran ditambahkan.');
      if (curRoute()[2] === 'lampiran') rerender();
    });
  }

  /* ---------- Pengaturan & Tentang ---------- */
  function viewSettings() {
    var nm = db.settings.name || '';
    app.innerHTML = '<div class="sec-head" style="margin-top:6px"><div class="ttl"><span class="sec-ico">' + ic('settings') + '</span><div><h1>Pengaturan</h1><p>Profil, cadangan data, dan penyimpanan.</p></div></div></div><div class="set-grid">' +
      '<div class="card set-card"><h3>' + ic('graduation-cap') + 'Profil</h3><p>Nama dipakai untuk inisial pada avatar.</p><div class="row"><input id="setName" class="btn" style="font-weight:400;flex:1;min-width:160px" placeholder="Nama Anda" value="' + esc(nm) + '" maxlength="40"><button class="btn btn-primary" data-act="save-name">Simpan</button></div></div>' +
      '<div class="card set-card"><h3>' + ic('download') + 'Cadangkan Data (Export JSON)</h3><p>Unduh semua penelitian. Sertakan lampiran agar bisa dipulihkan lengkap (file bisa besar).</p><div class="row"><button class="btn btn-primary" data-act="export" data-files="0">Ekspor tanpa lampiran</button><button class="btn" data-act="export" data-files="1">Ekspor dengan lampiran</button></div></div>' +
      '<div class="card set-card"><h3>' + ic('upload') + 'Pulihkan Data (Import JSON)</h3><p>Pilih file cadangan. Anda bisa menggabungkan dengan data yang ada atau menimpanya.</p><div class="row"><button class="btn btn-primary" data-act="import">Pilih file JSON</button></div></div>' +
      '<div class="card set-card"><h3>' + ic('database') + 'Penyimpanan</h3><p>' + db.projects.length + ' penelitian tersimpan di browser ini.</p><p class="muted" id="quotaSet"></p><div class="row"><button class="btn" data-act="persist-storage">Minta penyimpanan permanen</button></div></div>' +
      '<div class="card set-card"><h3>' + ic('trash-2') + 'Hapus Semua Data</h3><p>Menghapus seluruh penelitian dan lampiran dari browser ini. Pastikan sudah mengekspor cadangan.</p><div class="row"><button class="btn btn-danger" data-act="reset-all">Hapus semua data</button></div></div></div>';
    showQuota('#quotaSet');
  }
  function viewAbout() {
    app.innerHTML = '<div class="sec-head" style="margin-top:6px"><div class="ttl"><span class="sec-ico">' + ic('info') + '</span><div><h1>Tentang</h1><p>STUREKA RISA ' + esc(CFG.version || '2.0') + '</p></div></div></div>' +
      '<div class="card prose"><p><b>STUREKA RISA</b> (Study Research) membantu Anda mengelola penelitian: dari mencatat ide, menulis bab, mengumpulkan referensi, memantau progres, sampai menyimpan lampiran.</p>' +
      '<h3>Cara kerja</h3><ul><li>Seluruh data tersimpan di browser Anda. Tidak ada akun, server, atau database online.</li><li>Teks bab dan catatan tersimpan lengkap dengan formatnya.</li><li>Gunakan Export JSON secara berkala sebagai cadangan, terutama sebelum membersihkan data browser.</li></ul>' +
      '<h3>Perlu diketahui</h3><ul><li>Data hanya ada di browser dan perangkat yang dipakai. Berpindah perangkat berarti Import JSON.</li><li>Lampiran besar memakai kuota browser; batasnya berbeda tiap perangkat.</li></ul>' +
      '<h3>Pintasan</h3><ul><li><b>Ctrl + K</b>: cari penelitian</li><li><b>Ctrl + S</b>: simpan tulisan di editor</li></ul></div>';
  }

  /* ---------- Bell & aktivitas ---------- */
  function dueSoon() {
    return db.projects.filter(function (p) { return p.status !== 'Selesai' && p.deadline && daysUntil(p.deadline) <= 7; })
      .sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; });
  }
  function updateBell() {
    var n = dueSoon().length; $('#bellDot').hidden = !n;
    var s = (db.settings.name || 'S').trim(); $('#avatar').textContent = (s.charAt(0) || 'S').toUpperCase();
  }
  function closeFloating() { var b = $('#bellPop'); if (b) b.hidden = true; $$('.kmenu').forEach(function (k) { k.remove(); }); }

  /* ================= 3. EDITOR TEKS (Quill) ================= */
  var FONTS = [['georgia', 'Georgia'], ['times', 'Times New Roman'], ['arial', 'Arial'], ['verdana', 'Verdana'], ['trebuchet', 'Trebuchet MS'], ['courier', 'Courier New']];
  var SIZES = ['12px', '14px', '18px', '20px', '24px', '28px', '32px', '40px'];
  var SPACING = ['1', '1.15', '1.5', '2', '2.5'];
  var PARA = ['0px', '8px', '16px', '24px'];
  var quillReady = false;

  function registerQuill() {
    if (quillReady) return; quillReady = true;
    var Size = Quill.import('attributors/style/size'); Size.whitelist = SIZES.concat(['16px']); Quill.register(Size, true);
    var Font = Quill.import('formats/font'); Font.whitelist = FONTS.map(function (f) { return f[0]; }); Quill.register(Font, true);
    var Parchment = Quill.import('parchment');
    Quill.register(new Parchment.Attributor.Style('lineheight', 'line-height', { scope: Parchment.Scope.BLOCK, whitelist: SPACING }), true);
    Quill.register(new Parchment.Attributor.Style('paraspace', 'margin-bottom', { scope: Parchment.Scope.BLOCK, whitelist: PARA }), true);
  }

  function toolbarHTML() {
    function btn(c, t, v) { return '<button type="button" class="ql-' + c + '"' + (v !== undefined ? ' value="' + v + '"' : '') + ' title="' + t + '" aria-label="' + t + '"></button>'; }
    return '<span class="ql-formats"><button type="button" class="ql-undo" title="Urungkan (Ctrl+Z)" aria-label="Urungkan">' + ic('undo-2') + '</button>' +
      '<button type="button" class="ql-redo" title="Ulangi (Ctrl+Y)" aria-label="Ulangi">' + ic('redo-2') + '</button></span>' +
      '<span class="ql-formats"><select class="ql-font" title="Jenis font"><option selected>Inter</option>' + FONTS.map(function (f) { return '<option value="' + f[0] + '">' + f[1] + '</option>'; }).join('') + '</select>' +
      '<select class="ql-size" title="Ukuran font">' + SIZES.map(function (s, i) { return (i === 2 ? '<option selected>16</option>' : '') + '<option value="' + s + '">' + parseInt(s, 10) + '</option>'; }).join('') + '</select></span>' +
      '<span class="ql-formats">' + btn('bold', 'Tebal (Ctrl+B)') + btn('italic', 'Miring (Ctrl+I)') + btn('underline', 'Garis bawah (Ctrl+U)') + btn('strike', 'Coret') + '</span>' +
      '<span class="ql-formats"><select class="ql-color" title="Warna teks"></select><select class="ql-background" title="Warna highlight"></select></span>' +
      '<span class="ql-formats">' + btn('align', 'Rata kiri', '') + btn('align', 'Rata tengah', 'center') + btn('align', 'Rata kanan', 'right') + btn('align', 'Rata kiri-kanan', 'justify') + '</span>' +
      '<span class="ql-formats">' + btn('list', 'Daftar nomor', 'ordered') + btn('list', 'Daftar poin', 'bullet') + btn('indent', 'Kurangi indentasi', '-1') + btn('indent', 'Tambah indentasi', '+1') + '</span>' +
      '<span class="ql-formats"><select class="ql-lineheight" title="Spasi baris" aria-label="Spasi baris"><option selected>Spasi baris</option>' + SPACING.map(function (s) { return '<option value="' + s + '">Spasi ' + s + '</option>'; }).join('') + '</select>' +
      '<select class="ql-paraspace" title="Jarak antarparagraf" aria-label="Jarak paragraf"><option selected>Jarak paragraf</option>' + PARA.map(function (s) { return '<option value="' + s + '">Jarak ' + parseInt(s, 10) + ' px</option>'; }).join('') + '</select></span>' +
      '<span class="ql-formats">' + btn('clean', 'Hapus format') + '</span>';
  }

  /* o: { mount, delta, placeholder, save(ops, text) -> boolean } */
  function mountEditor(o) {
    registerQuill();
    o.mount.innerHTML = '<div class="editor-wrap"><div class="ed-tb">' + toolbarHTML() + '</div><div class="ed-body"></div></div>';
    var quill = new Quill($('.ed-body', o.mount), {
      theme: 'snow', placeholder: o.placeholder || '',
      modules: {
        history: { delay: 900, maxStack: 300, userOnly: true },
        toolbar: { container: $('.ed-tb', o.mount), handlers: { undo: function () { this.quill.history.undo(); }, redo: function () { this.quill.history.redo(); } } }
      }
    });
    if (o.delta && o.delta.length) quill.setContents(o.delta, 'silent');
    var stEl = $('#saveState'), dirty = false, timer = null;
    function setState(c, t) { if (stEl && document.body.contains(stEl)) { stEl.className = 'save-state ' + c; stEl.textContent = t; } }
    function save(force) {
      if (!dirty && !force) return true;
      clearTimeout(timer); setState('saving', 'Menyimpan…');
      var ok = o.save(quill.getContents().ops, quill.getText());
      if (ok) { dirty = false; setState('', 'Tersimpan ' + hhmm()); if (force) toast('Tersimpan.'); }
      else setState('error', 'Gagal menyimpan');
      return ok;
    }
    quill.on('text-change', function (d, old, src) {
      if (src === 'silent') return;
      dirty = true; setState('dirty', 'Belum disimpan…');
      clearTimeout(timer); timer = setTimeout(function () { save(); }, 1200);
    });
    setState('', o.delta && o.delta.length ? 'Tersimpan' : 'Siap menulis');
    activeEd = { quill: quill, save: save, flush: function () { if (dirty) save(); } };
    return quill;
  }
  function flushEditor() { if (activeEd) { activeEd.flush(); activeEd = null; } }

  function viewChapterEditor(p, n) {
    var c = p.chapters[n];
    app.innerHTML = '<a class="back" href="#/penelitian/' + p.id + '/ide">' + ic('arrow-left') + 'Ide Penelitian</a>' +
      '<div class="ed-head"><div class="grow"><h1>Bab ' + ROMAN[n] + ' — ' + BABS[n] + '</h1><p>' + esc(p.title) + '</p></div><span class="save-state" id="saveState">…</span>' +
      (n > 1 ? '<a class="icon-btn" style="border-color:var(--border)" href="#/penelitian/' + p.id + '/ide/' + (n - 1) + '" aria-label="Bab sebelumnya" title="Bab sebelumnya">' + ic('arrow-left') + '</a>' : '') +
      (n < 5 ? '<a class="icon-btn" style="border-color:var(--border)" href="#/penelitian/' + p.id + '/ide/' + (n + 1) + '" aria-label="Bab berikutnya" title="Bab berikutnya">' + ic('arrow-right') + '</a>' : '') +
      '<button class="btn btn-primary" data-act="ed-save">' + ic('save') + 'Simpan</button></div><div id="edMount"></div>';
    mountEditor({
      mount: $('#edMount'), delta: c.delta, placeholder: 'Mulai menulis Bab ' + ROMAN[n] + ' — ' + BABS[n] + '…',
      save: function (ops, text) {
        c.delta = ops; c.words = countWords(text); c.preview = text.trim().replace(/\s+/g, ' ').slice(0, 200); c.updatedAt = nowIso(); touch(p);
        log('Bab ' + n + ' pada “' + p.title + '” disimpan', 'bab:' + p.id + ':' + n);
        return persist();
      }
    });
  }

  /* ================= FORM: penelitian, referensi, timeline ================= */
  function fld(label, name, val, o) {
    o = o || {};
    var input = o.tag === 'select'
      ? '<select name="' + name + '">' + o.options.map(function (x) { return '<option' + (x === val ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>'
      : o.tag === 'textarea' ? '<textarea name="' + name + '" rows="3">' + esc(val) + '</textarea>'
      : '<input name="' + name + '" type="' + (o.type || 'text') + '" value="' + esc(val) + '"' + (o.req ? ' required' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.attrs || '') + '>';
    return '<div class="fld' + (o.full ? ' full' : '') + '"><label>' + label + (o.req ? ' *' : '') + '</label>' + input + '</div>';
  }

  function researchForm(id) {
    var p = id ? getP(id) : null; p = p || {};
    openModal({
      title: p.id ? 'Edit Penelitian' : 'Tambah Penelitian', submit: p.id ? 'Simpan Perubahan' : 'Simpan Penelitian',
      body: '<div class="form-grid">' + fld('Judul Penelitian', 'title', p.title || '', { full: true, req: true, ph: 'Contoh: Pengaruh Gadget terhadap Prestasi Belajar', attrs: ' maxlength="200"' }) +
        fld('Kategori', 'category', p.category || '', { ph: 'Contoh: Sosial, IoT' }) + fld('Mata Pelajaran / Bidang', 'subject', p.subject || '') +
        fld('Penulis', 'author', p.author || '') + fld('Pembimbing', 'advisor', p.advisor || '') +
        fld('Tanggal Mulai', 'startDate', p.startDate || '', { type: 'date' }) + fld('Deadline', 'deadline', p.deadline || '', { type: 'date' }) +
        fld('Status', 'status', p.status || 'Belum Mulai', { tag: 'select', options: STATUSES, full: true }) + '</div>',
      onSubmit: function (form) {
        var f = form.elements, v = function (n) { return f[n].value.trim(); };
        if (!v('title')) { toast('Judul penelitian wajib diisi.', 'err'); return false; }
        if (v('startDate') && v('deadline') && v('deadline') < v('startDate')) { toast('Deadline tidak boleh sebelum tanggal mulai.', 'err'); return false; }
        var data = { title: v('title'), category: v('category'), subject: v('subject'), author: v('author'), advisor: v('advisor'), startDate: v('startDate'), deadline: v('deadline'), status: f.status.value };
        if (p.id) {
          for (var k in data) p[k] = data[k];
          touch(p); log('Penelitian “' + p.title + '” diperbarui', 'edit:' + p.id); persist(); toast('Perubahan disimpan.'); rerender();
        } else {
          var np = blankProject(data); db.projects.push(np); log('Penelitian “' + np.title + '” ditambahkan'); persist(); toast('Penelitian ditambahkan.');
          go('#/penelitian/' + np.id);
        }
      }
    });
  }

  function deleteProject(id) {
    var p = getP(id); if (!p) return;
    confirmBox({
      title: 'Hapus penelitian?',
      desc: 'Penelitian <b>' + esc(p.title) + '</b> beserta seluruh isinya (bab, referensi, timeline, catatan, dan lampiran) akan dihapus permanen dan tidak bisa dikembalikan.',
      onConfirm: function () {
        p.attachments.forEach(function (a) { idbDel(a.id).catch(function () { /* abaikan */ }); });
        db.projects = db.projects.filter(function (x) { return x.id !== id; });
        log('Penelitian “' + p.title + '” dihapus'); persist(); toast('Penelitian dihapus.');
        var r = curRoute();
        if (r[0] === 'penelitian' && r[1] === id) go('#/penelitian'); else rerender();
      }
    });
  }

  function refForm(pid, rid) {
    var p = getP(pid), r = rid ? p.references.filter(function (x) { return x.id === rid; })[0] : null; r = r || {};
    openModal({
      title: r.id ? 'Edit Referensi' : 'Tambah Referensi', submit: 'Simpan Referensi',
      body: '<div class="form-grid">' + fld('Judul Referensi', 'title', r.title || '', { full: true, req: true }) + fld('Penulis', 'author', r.author || '', { req: true }) +
        fld('Tahun', 'year', r.year || '', { type: 'number', attrs: ' min="1000" max="2100"' }) + fld('Jenis', 'type', r.type || 'Buku', { tag: 'select', options: ['Buku', 'Jurnal', 'Website', 'Lainnya'] }) +
        fld('Link (opsional)', 'link', r.link || '', { type: 'url', ph: 'https://…' }) + fld('Catatan (opsional)', 'note', r.note || '', { tag: 'textarea', full: true }) + '</div>',
      onSubmit: function (form) {
        var f = form.elements, d = { title: f.title.value.trim(), author: f.author.value.trim(), year: f.year.value.trim(), type: f.type.value, link: f.link.value.trim(), note: f.note.value.trim() };
        if (!d.title || !d.author) { toast('Judul dan penulis wajib diisi.', 'err'); return false; }
        if (r.id) { for (var k in d) r[k] = d[k]; } else { d.id = uid('r'); p.references.push(d); log('Referensi ditambahkan pada “' + p.title + '”'); }
        touch(p); persist(); toast('Referensi disimpan.'); rerender();
      }
    });
  }

  function timelineForm(pid, tid) {
    var p = getP(pid), t = tid ? p.timeline.filter(function (x) { return x.id === tid; })[0] : null; t = t || {};
    openModal({
      title: t.id ? 'Edit Target' : 'Tambah Target Timeline', submit: 'Simpan Target',
      body: '<div class="form-grid">' + fld('Tanggal', 'date', t.date || '', { type: 'date', req: true }) + fld('Judul Target', 'title', t.title || '', { req: true }) +
        fld('Deskripsi (opsional)', 'desc', t.desc || '', { tag: 'textarea', full: true }) + '</div>',
      onSubmit: function (form) {
        var f = form.elements, d = { date: f.date.value, title: f.title.value.trim(), desc: f.desc.value.trim() };
        if (!d.date || !d.title) { toast('Tanggal dan judul wajib diisi.', 'err'); return false; }
        if (t.id) { for (var k in d) t[k] = d[k]; } else { d.id = uid('t'); d.done = false; p.timeline.push(d); log('Target timeline ditambahkan pada “' + p.title + '”'); }
        touch(p); persist(); toast('Target disimpan.'); rerender();
      }
    });
  }

  /* ================= EXPORT / IMPORT JSON ================= */
  function blobToDataUrl(b) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; r.readAsDataURL(b); });
  }
  function exportJSON(withFiles) {
    var out = { app: 'STUREKA RISA', format: 2, exportedAt: nowIso(), includesFiles: !!withFiles, data: db, files: {} };
    var chain = Promise.resolve();
    if (withFiles) {
      db.projects.forEach(function (p) {
        p.attachments.forEach(function (a) {
          chain = chain.then(function () {
            return idbGet(a.id).then(function (b) { if (b) return blobToDataUrl(b).then(function (u) { out.files[a.id] = { dataUrl: u }; }); }).catch(function () { /* lewati */ });
          });
        });
      });
    }
    chain.then(function () {
      var url = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
      var a = document.createElement('a'), d = new Date();
      a.href = url; a.download = 'sturekarisa-backup-' + d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + '.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      toast('Cadangan berhasil diunduh.');
    }).catch(function (e) { console.error(e); toast('Ekspor gagal.', 'err'); });
  }

  function handleImport(file) {
    var r = new FileReader();
    r.onerror = function () { toast('File tidak bisa dibaca.', 'err'); };
    r.onload = function () {
      var obj, list, acts = [], files = {};
      try { obj = JSON.parse(r.result); } catch (e) { toast('File bukan JSON yang valid.', 'err'); return; }
      if (obj && obj.app === 'STUREKA RISA' && obj.data && Array.isArray(obj.data.projects)) {
        list = obj.data.projects.map(normProject); acts = Array.isArray(obj.data.activity) ? obj.data.activity : []; files = obj.files || {};
      } else if (Array.isArray(obj)) {            // cadangan format lama
        var pend = []; list = obj.map(function (o) { return migrateProject(o, pend); });
        pend.forEach(function (f) { files[f.id] = { dataUrl: f.data }; });
      } else { toast('Format cadangan tidak dikenali.', 'err'); return; }
      list = list.filter(function (p) { return p && p.id; });
      openModal({
        title: 'Pulihkan Data', cancel: 'Batal',
        body: '<p>File berisi <b>' + list.length + ' penelitian</b>. Pilih cara memulihkan:</p><p class="hint"><b>Gabungkan</b>: menambah penelitian baru; penelitian dengan ID sama diperbarui dari file.<br><b>Timpa semua</b>: seluruh data saat ini diganti isi file.</p>',
        extras: [
          { label: 'Gabungkan', cls: 'btn-primary', fn: function (api) { api.close(); applyImport(list, acts, files, false); } },
          { label: 'Timpa semua', cls: 'btn-danger', fn: function (api) { api.close(); applyImport(list, acts, files, true); } }
        ]
      });
    };
    r.readAsText(file);
  }

  function applyImport(list, acts, files, replace) {
    var pre = replace ? idbClear().catch(function () { /* abaikan */ }) : Promise.resolve();
    pre.then(function () {
      return Promise.all(list.map(function (p) {
        return Promise.all(p.attachments.map(function (a) {
          var f = files[a.id];
          if (f && f.dataUrl) return fetch(f.dataUrl).then(function (x) { return x.blob(); }).then(function (b) { return idbPut(a.id, b); }).then(function () { return a; }).catch(function () { return null; });
          if (replace) return null;
          return idbGet(a.id).then(function (b) { return b ? a : null; }).catch(function () { return null; });
        })).then(function (keep) { p.attachments = keep.filter(Boolean); return p; });
      }));
    }).then(function (ready) {
      if (replace) { db.projects = ready; db.activity = acts.slice(0, 40); }
      else {
        ready.forEach(function (p) {
          var i = -1; db.projects.forEach(function (x, k) { if (x.id === p.id) i = k; });
          if (i > -1) db.projects[i] = p; else db.projects.push(p);
        });
        db.activity = acts.concat(db.activity).sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 40);
      }
      log('Data dipulihkan dari cadangan (' + ready.length + ' penelitian)');
      if (persist()) toast('Data berhasil dipulihkan.');
      go('#/dashboard');
    }).catch(function (e) { console.error(e); toast('Impor gagal.', 'err'); });
  }

  /* ================= AKSI & EVENT ================= */
  function listLimit() { return curRoute()[0] === 'penelitian' ? 0 : 5; }
  function pid() { return curRoute()[1]; }

  var actions = {
    'add-research': function () { researchForm(); },
    'toggle-theme': function () { applyTheme(getTheme() === 'dark' ? 'light' : 'dark', true); },
    'open-sidebar': function () { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); },
    'close-sidebar': function () { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); },
    'open': function (el) { go('#/penelitian/' + el.dataset.id); },
    'edit-research': function (el) { researchForm(el.dataset.id); },
    'delete-research': function (el) { deleteProject(el.dataset.id); },
    'kebab': function (el) {
      var row = el.closest('.rrow'), had = $('.kmenu', row); closeFloating(); if (had) return;
      var m = document.createElement('div'); m.className = 'kmenu'; m.setAttribute('role', 'menu');
      m.innerHTML = ['open|folder-open|Buka', 'edit-research|pencil|Edit', 'delete-research|trash-2|Hapus'].map(function (s) {
        var a = s.split('|'); return '<button type="button" role="menuitem" class="' + (a[0] === 'delete-research' ? 'danger' : '') + '" data-act="' + a[0] + '" data-id="' + el.dataset.id + '">' + ic(a[1]) + a[2] + '</button>';
      }).join('');
      row.appendChild(m);
    },
    'bell': function () {
      var pop = $('#bellPop'), was = pop.hidden, list = dueSoon();
      pop.innerHTML = '<div class="pop-title">Pengingat deadline</div>' + (list.length ? list.map(function (p) {
        var d = daysUntil(p.deadline);
        return '<a class="pop-item' + (d < 0 ? ' late' : '') + '" href="#/penelitian/' + p.id + '">' + esc(p.title) + '<small>' + dueText(d) + ' · ' + fmtShort(p.deadline) + '</small></a>';
      }).join('') : '<div class="pop-item muted">Tidak ada deadline dalam 7 hari ke depan.</div>');
      pop.hidden = !was;
    },
    'all-activity': function (el, e) {
      e.preventDefault();
      openModal({ title: 'Aktivitas Terbaru', cancel: 'Tutup', body: '<ul class="act">' + (db.activity.map(function (a) { return '<li><span>' + esc(a.text) + '</span><time>' + rel(a.at) + '</time></li>'; }).join('') || '<li><span class="muted">Belum ada aktivitas.</span></li>') + '</ul>' });
    },
    'ref-add': function (el) { refForm(el.dataset.id); },
    'ref-edit': function (el) { refForm(el.dataset.id, el.dataset.rid); },
    'ref-del': function (el) {
      var p = getP(el.dataset.id);
      confirmBox({ title: 'Hapus referensi?', desc: 'Referensi ini akan dihapus dari penelitian.', onConfirm: function () {
        p.references = p.references.filter(function (r) { return r.id !== el.dataset.rid; }); touch(p); persist(); toast('Referensi dihapus.'); rerender();
      } });
    },
    'tl-add': function (el) { timelineForm(el.dataset.id); },
    'tl-edit': function (el) { timelineForm(el.dataset.id, el.dataset.tid); },
    'tl-del': function (el) {
      var p = getP(el.dataset.id);
      confirmBox({ title: 'Hapus target?', desc: 'Target timeline ini akan dihapus.', onConfirm: function () {
        p.timeline = p.timeline.filter(function (t) { return t.id !== el.dataset.tid; }); touch(p); persist(); toast('Target dihapus.'); rerender();
      } });
    },
    'file-pick': function () { $('#attachFile').click(); },
    'file-dl': function (el) {
      var p = getP(el.dataset.id), f = p.attachments.filter(function (a) { return a.id === el.dataset.fid; })[0];
      idbGet(f.id).then(function (b) {
        if (!b) { toast('File tidak ditemukan di penyimpanan browser ini.', 'err'); return; }
        var u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 5000);
      }).catch(function () { toast('Gagal membuka file.', 'err'); });
    },
    'file-del': function (el) {
      var p = getP(el.dataset.id);
      confirmBox({ title: 'Hapus lampiran?', desc: 'File lampiran akan dihapus permanen dari browser ini.', onConfirm: function () {
        idbDel(el.dataset.fid).catch(function () { /* abaikan */ });
        p.attachments = p.attachments.filter(function (a) { return a.id !== el.dataset.fid; }); touch(p); persist(); toast('Lampiran dihapus.'); rerender();
      } });
    },
    'ed-save': function () { if (activeEd) activeEd.save(true); },
    'save-name': function () { db.settings.name = $('#setName').value.trim(); persist(); updateBell(); toast('Nama disimpan.'); },
    'export': function (el) { exportJSON(el.dataset.files === '1'); },
    'import': function () { $('#importFile').click(); },
    'persist-storage': function () {
      if (!navigator.storage || !navigator.storage.persist) { toast('Browser ini tidak mendukung fitur tersebut.', 'err'); return; }
      navigator.storage.persist().then(function (ok) { toast(ok ? 'Penyimpanan permanen aktif.' : 'Browser tidak memberi izin penyimpanan permanen.', ok ? '' : 'err'); });
    },
    'reset-all': function () {
      openModal({
        title: 'Hapus semua data?', submit: 'Hapus Semua', danger: true,
        body: '<p>Seluruh penelitian, tulisan, dan lampiran di browser ini akan dihapus permanen. Ketik <b>HAPUS</b> untuk melanjutkan.</p><div class="fld" style="margin-top:12px"><input name="c" autocomplete="off" placeholder="HAPUS"></div>',
        onSubmit: function (form) {
          if (form.elements.c.value.trim() !== 'HAPUS') { toast('Ketik HAPUS dengan huruf kapital.', 'err'); return false; }
          idbClear().catch(function () { /* abaikan */ });
          db = { version: 2, projects: [], activity: [], settings: {} }; persist(); toast('Semua data dihapus.'); go('#/dashboard');
        }
      });
    }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!(el && el.dataset.act === 'kebab') && !e.target.closest('.kmenu')) $$('.kmenu').forEach(function (k) { k.remove(); });
    if (!e.target.closest('.pop-wrap')) $('#bellPop').hidden = true;
    if (!el) return;
    var fn = actions[el.dataset.act];
    if (!fn) return;
    if (el.dataset.act !== 'kebab') $$('.kmenu').forEach(function (k) { k.remove(); });
    fn(el, e);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('rrow')) { go('#/penelitian/' + e.target.dataset.id); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#topSearch').focus(); $('#topSearch').select(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && activeEd) { e.preventDefault(); activeEd.save(true); }
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'listQ' || t.id === 'topSearch') {
      S.q = t.value;
      var r = curRoute(), onList = r[0] === 'dashboard' || (r[0] === 'penelitian' && !r[1]);
      if (onList) { var lq = $('#listQ'); if (lq && t.id === 'topSearch') lq.value = S.q; if (t.id === 'listQ') $('#topSearch').value = S.q; renderRows(listLimit()); }
      else if (t.value) { go('#/penelitian'); }
    } else if (t.id === 'refQ') {
      refQuery = t.value; var p = getP(pid()); if (p) renderRefs(p);
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target, k = t.getAttribute && t.getAttribute('data-chg');
    if (k === 'chk') {
      var p = getP(t.dataset.id); p.checklist['bab' + t.dataset.n] = t.checked; touch(p);
      if (t.checked) log('Bab ' + t.dataset.n + ' pada “' + p.title + '” ditandai selesai'); persist(); rerender();
    } else if (k === 'tl') {
      var q = getP(t.dataset.id), item = q.timeline.filter(function (x) { return x.id === t.dataset.tid; })[0]; item.done = t.checked; touch(q);
      if (t.checked) log('Target “' + item.title + '” selesai'); persist(); rerender();
    } else if (t.id === 'listStatus') { S.status = t.value; renderRows(listLimit()); }
    else if (t.id === 'listSort') { S.sort = t.value; renderRows(listLimit()); }
    else if (t.id === 'attachFile') { var pp = getP(pid()); if (pp) addFiles(pp, t.files); t.value = ''; }
    else if (t.id === 'importFile') { if (t.files[0]) handleImport(t.files[0]); t.value = ''; }
  });

  window.addEventListener('hashchange', function () { route(); });
  window.addEventListener('beforeunload', function () { if (activeEd) activeEd.flush(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && activeEd) activeEd.flush(); });

  /* ================= MULAI ================= */
  function init() {
    app = $('#app');
    hydrate(document);
    load();
    initTheme();
    $('#sideQuote').textContent = CFG.quote || '';
    setupBanner();
    if (!location.hash) location.replace('#/dashboard');
    route();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
