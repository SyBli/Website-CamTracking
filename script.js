/* ============================================================
   HAND TRACKING — script.js
   Pure JavaScript (ES Module) + MediaPipe Hand Landmarker (CDN)
   Tanpa backend, tanpa Python. Harus dijalankan via http(s)/localhost.
   ============================================================ */

/* ---------------------------------------------------------
   0. AMBIL ELEMEN DOM & PASANG EVENT LISTENER DI PALING AWAL
   -----------------------------------------------------------
   PENTING: listener tombol dipasang SEBELUM ada operasi async
   apa pun (import MediaPipe, load model, dst). Ini memperbaiki
   bug umum "tombol tidak merespons": jika kode async di atas
   gagal / throw sebelum sempat memasang listener, tombol jadi
   mati total. Di sini listener selalu terpasang duluan.
--------------------------------------------------------- */

const startBtn = document.getElementById("startBtn");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const gestureText = document.getElementById("gestureText");
const placeholder = document.getElementById("placeholder");
const fileWarning = document.getElementById("fileWarning");
const errorBanner = document.getElementById("errorBanner");
const errorText = document.getElementById("errorText");
const videoContainer = document.getElementById("videoContainer");
const particlesLayer = document.getElementById("particles");

const overlayCtx = overlay.getContext("2d");

let handLandmarker = null;
let stream = null;
let rafId = null;

// Counter untuk smoothing / debounce gesture ✌️
let peaceOnFrames = 0;
let peaceOffFrames = 0;
let isBlurActive = false;

const CONFIRM_FRAMES = 5;   // frame berturut-turut untuk MENGAKTIFKAN efek
const RELEASE_FRAMES = 8;   // frame berturut-turut untuk MEMATIKAN efek (lebih lama = anti kedip)

// Counter smoothing / debounce untuk gesture 5 jari (open hand)
let openOnFrames = 0;
let openOffFrames = 0;
let isZoomActive = false;
let particleIntervalId = null;

// Sambungan antar landmark untuk digambar sebagai "skeleton" tangan
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],           // ibu jari
  [0, 5], [5, 6], [6, 7], [7, 8],           // telunjuk
  [5, 9], [9, 10], [10, 11], [11, 12],      // tengah
  [9, 13], [13, 14], [14, 15], [15, 16],    // manis
  [13, 17], [17, 18], [18, 19], [19, 20],   // kelingking
  [0, 17],
];

/* ---------------------------------------------------------
   1. CEK LINGKUNGAN (file:// akan gagal, beri peringatan dini)
--------------------------------------------------------- */
if (location.protocol === "file:") {
  fileWarning.classList.remove("hidden");
}

if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  showError(
    "Browser ini tidak mendukung akses kamera (navigator.mediaDevices.getUserMedia tidak tersedia). " +
    "Gunakan browser modern (Chrome/Edge/Firefox terbaru) dan akses melalui http://localhost atau https://."
  );
  startBtn.disabled = true;
}

/* ---------------------------------------------------------
   2. PASANG LISTENER TOMBOL (paling penting, harus jalan duluan)
--------------------------------------------------------- */
startBtn.addEventListener("click", onStartButtonClick);

/* ---------------------------------------------------------
   3. HANDLER UTAMA SAAT TOMBOL DIKLIK
--------------------------------------------------------- */
async function onStartButtonClick() {
  clearError();
  startBtn.disabled = true;

  try {
    await startCamera();

    if (!handLandmarker) {
      setStatus("loading", "Memuat model AI (MediaPipe Hand Landmarker)...");
      await initHandLandmarker();
    }

    setStatus("active", "Kamera aktif — mendeteksi tangan...");
    placeholder.classList.add("hidden-el");
    startDetectionLoop();
  } catch (err) {
    console.error(err);
    handleFatalError(err);
    startBtn.disabled = false;
  }
}

/* ---------------------------------------------------------
   4. MENGAKTIFKAN KAMERA (getUserMedia)
--------------------------------------------------------- */
async function startCamera() {
  setStatus("loading", "Meminta izin kamera...");

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user",
      },
      audio: false, // tidak perlu audio sama sekali
    });
  } catch (err) {
    // Terjemahkan error getUserMedia yang umum menjadi pesan yang jelas
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      throw new Error(
        "Izin kamera ditolak. Klik ikon gembok/kamera di address bar browser lalu izinkan akses kamera, kemudian coba lagi."
      );
    }
    if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      throw new Error("Tidak ada perangkat kamera yang terdeteksi di perangkat ini.");
    }
    if (err.name === "NotReadableError") {
      throw new Error("Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.");
    }
    if (location.protocol === "file:") {
      throw new Error(
        "Kamera tidak bisa diakses karena halaman dibuka via file://. Jalankan lewat server lokal (contoh: VS Code Live Server)."
      );
    }
    throw new Error("Gagal mengakses kamera: " + err.message);
  }

  video.srcObject = stream;

  // Tunggu video benar-benar siap sebelum lanjut, jangan asumsikan langsung siap
  await new Promise((resolve, reject) => {
    const onLoaded = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      resolve();
    };
    video.addEventListener("loadedmetadata", onLoaded);

    // Jaga-jaga: timeout kalau event tidak pernah muncul
    setTimeout(() => {
      video.removeEventListener("loadedmetadata", onLoaded);
      if (video.readyState >= 1) {
        resolve();
      } else {
        reject(new Error("Video kamera tidak kunjung siap (timeout menunggu loadedmetadata)."));
      }
    }, 8000);
  });

  await video.play();

  // Samakan resolusi canvas overlay dengan resolusi asli video
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
}

/* ---------------------------------------------------------
   5. INISIALISASI MEDIAPIPE HAND LANDMARKER
   -----------------------------------------------------------
   Semua versi (tasks-vision bundle, wasm, dan model .task)
   dikunci ke versi yang sama-sama kompatibel (0.10.14) supaya
   tidak terjadi mismatch API antara WASM dan JS wrapper.
--------------------------------------------------------- */
async function initHandLandmarker() {
  const VISION_VERSION = "0.10.14";

  let visionModule;
  try {
    visionModule = await import(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/vision_bundle.mjs`
    );
  } catch (err) {
    throw new Error(
      "Gagal memuat library MediaPipe dari CDN. Pastikan koneksi internet aktif dan tidak ada pemblokir (adblocker/firewall/CORS) yang menghalangi jsdelivr.net."
    );
  }

  const { HandLandmarker, FilesetResolver } = visionModule;

  let vision;
  try {
    vision = await FilesetResolver.forVisionTasks(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/wasm`
    );
  } catch (err) {
    throw new Error("Gagal memuat file WASM MediaPipe. Periksa koneksi internet dan coba muat ulang halaman.");
  }

  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  } catch (err) {
    // Coba fallback ke CPU delegate jika GPU tidak didukung perangkat
    try {
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (err2) {
      console.error(err2);
      throw new Error(
        "Gagal memuat model hand_landmarker.task. Periksa koneksi internet ke storage.googleapis.com, atau kemungkinan diblokir CORS/firewall."
      );
    }
  }
}

/* ---------------------------------------------------------
   6. LOOP DETEKSI REALTIME (requestAnimationFrame)
--------------------------------------------------------- */
function startDetectionLoop() {
  let lastVideoTime = -1;

  function loop() {
    rafId = requestAnimationFrame(loop);

    if (!handLandmarker || video.readyState < 2) return;

    if (video.currentTime === lastVideoTime) return; // frame belum berganti
    lastVideoTime = video.currentTime;

    let results;
    try {
      results = handLandmarker.detectForVideo(video, performance.now());
    } catch (err) {
      console.error("Deteksi gagal:", err);
      return;
    }

    drawResults(results);
    evaluateGestures(results);
  }

  loop();
}

/* ---------------------------------------------------------
   7. GAMBAR LANDMARK & SKELETON TANGAN DI CANVAS OVERLAY
--------------------------------------------------------- */
function drawResults(results) {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

  if (!results || !results.landmarks) return;

  for (const landmarks of results.landmarks) {
    overlayCtx.strokeStyle = "rgba(125, 255, 179, 0.9)";
    overlayCtx.lineWidth = 3;
    overlayCtx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const p1 = landmarks[a];
      const p2 = landmarks[b];
      overlayCtx.moveTo(p1.x * overlay.width, p1.y * overlay.height);
      overlayCtx.lineTo(p2.x * overlay.width, p2.y * overlay.height);
    }
    overlayCtx.stroke();

    overlayCtx.fillStyle = "rgba(108, 140, 255, 0.95)";
    for (const point of landmarks) {
      overlayCtx.beginPath();
      overlayCtx.arc(point.x * overlay.width, point.y * overlay.height, 4, 0, Math.PI * 2);
      overlayCtx.fill();
    }
  }
}

/* ---------------------------------------------------------
   8. DETEKSI GESTURE ✌️ (PEACE / V SIGN) — ROBUST VERSION
   -----------------------------------------------------------
   Tidak hanya mengandalkan koordinat Y (yang gagal saat tangan
   miring/diputar). Sebagai gantinya:

   a) Untuk tiap jari, hitung SUDUT antara ruas MCP→PIP dan
      PIP→TIP dalam ruang 3D (x, y, z dari MediaPipe).
      - Sudut kecil (mendekati 0°)  -> jari LURUS (extended)
      - Sudut besar (>~55°)         -> jari MENEKUK (curled)
      Metode sudut ini tahan terhadap rotasi/kemiringan tangan,
      karena yang diukur adalah bentuk relatif jari itu sendiri,
      bukan posisi absolut di layar.

   b) Sebagai penguat, bandingkan jarak ujung jari ke pergelangan
      tangan (wrist) dengan jarak sendi dasar (MCP) ke wrist.
      Jari yang lurus akan jauh lebih menjorok keluar.

   c) Untuk memastikan bentuk "V" (bukan dua jari yang menempel),
      jarak antar ujung telunjuk & tengah harus lebih besar
      dibanding jarak antar sendi dasarnya (fingers spread).

   Gesture ✌️ = telunjuk & tengah LURUS, manis & kelingking
   MENEKUK, dan kedua ujung jari tersebut merenggang (V shape).
--------------------------------------------------------- */

const EXTEND_ANGLE_MAX = 45;     // derajat, di bawah ini dianggap "lurus"
const CURL_ANGLE_MIN = 55;       // derajat, di atas ini dianggap "menekuk"
const EXTEND_DIST_RATIO = 1.15;  // tip harus > mcp * rasio ini dari wrist
const CURL_DIST_RATIO = 1.05;
const SPREAD_RATIO = 1.25;       // jarak ujung telunjuk-tengah vs jarak mcp-nya

function vecSub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dist3D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function angleBetweenDeg(v1, v2) {
  const mag1 = Math.sqrt(v1.x ** 2 + v1.y ** 2 + v1.z ** 2);
  const mag2 = Math.sqrt(v2.x ** 2 + v2.y ** 2 + v2.z ** 2);
  if (mag1 === 0 || mag2 === 0) return 0;
  let cos = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (mag1 * mag2);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

function fingerAngle(landmarks, mcpIdx, pipIdx, tipIdx) {
  const v1 = vecSub(landmarks[pipIdx], landmarks[mcpIdx]);
  const v2 = vecSub(landmarks[tipIdx], landmarks[pipIdx]);
  return angleBetweenDeg(v1, v2);
}

function isFingerExtended(landmarks, wristIdx, mcpIdx, pipIdx, tipIdx) {
  const angle = fingerAngle(landmarks, mcpIdx, pipIdx, tipIdx);
  const tipToWrist = dist3D(landmarks[tipIdx], landmarks[wristIdx]);
  const mcpToWrist = dist3D(landmarks[mcpIdx], landmarks[wristIdx]);
  return angle < EXTEND_ANGLE_MAX && tipToWrist > mcpToWrist * EXTEND_DIST_RATIO;
}

function isFingerCurled(landmarks, wristIdx, mcpIdx, pipIdx, tipIdx) {
  const angle = fingerAngle(landmarks, mcpIdx, pipIdx, tipIdx);
  const tipToWrist = dist3D(landmarks[tipIdx], landmarks[wristIdx]);
  const mcpToWrist = dist3D(landmarks[mcpIdx], landmarks[wristIdx]);
  return angle > CURL_ANGLE_MIN || tipToWrist < mcpToWrist * CURL_DIST_RATIO;
}

function isPeaceSign(landmarks) {
  const WRIST = 0;

  const indexExtended = isFingerExtended(landmarks, WRIST, 5, 6, 8);
  const middleExtended = isFingerExtended(landmarks, WRIST, 9, 10, 12);
  const ringCurled = isFingerCurled(landmarks, WRIST, 13, 14, 16);
  const pinkyCurled = isFingerCurled(landmarks, WRIST, 17, 18, 20);

  if (!(indexExtended && middleExtended && ringCurled && pinkyCurled)) {
    return false;
  }

  // Pastikan membentuk huruf "V" (kedua ujung jari merenggang)
  const tipSpread = dist3D(landmarks[8], landmarks[12]);
  const mcpSpread = dist3D(landmarks[5], landmarks[9]);
  const isSpread = tipSpread > mcpSpread * SPREAD_RATIO;

  return isSpread;
}

/* ---------------------------------------------------------
   8b. DETEKSI GESTURE 🖐️ (5 JARI TERBUKA)
   -----------------------------------------------------------
   Memakai ulang isFingerExtended() yang sudah ada untuk
   telunjuk, tengah, manis, kelingking. Untuk ibu jari dipakai
   pendekatan terpisah karena sendi ibu jari bergerak menyamping
   (bukan menekuk searah telapak seperti 4 jari lain), sehingga
   sudut MCP→IP→TIP saja kurang akurat. Sebagai gantinya dipakai
   kombinasi:
   a) jarak ujung ibu jari ke wrist harus jauh lebih besar dari
      jarak sendi dasarnya ke wrist (ibu jari menjulur keluar), dan
   b) jarak ujung ibu jari ke pangkal telunjuk (index MCP) harus
      cukup jauh (ibu jari merenggang dari telapak, bukan menempel
      / terlipat ke dalam seperti saat mengepal).
--------------------------------------------------------- */

const THUMB_DIST_RATIO = 1.2;   // tip ibu jari vs mcp-nya, relatif ke wrist
const THUMB_SPREAD_RATIO = 0.55; // jarak tip ibu jari ke index-MCP, relatif ke lebar telapak

function isThumbExtended(landmarks) {
  const WRIST = 0;
  const THUMB_MCP = 2;
  const THUMB_TIP = 4;
  const INDEX_MCP = 5;
  const PINKY_MCP = 17;

  const tipToWrist = dist3D(landmarks[THUMB_TIP], landmarks[WRIST]);
  const mcpToWrist = dist3D(landmarks[THUMB_MCP], landmarks[WRIST]);
  const tipToIndexMcp = dist3D(landmarks[THUMB_TIP], landmarks[INDEX_MCP]);
  const palmWidth = dist3D(landmarks[INDEX_MCP], landmarks[PINKY_MCP]);

  const reachesOut = tipToWrist > mcpToWrist * THUMB_DIST_RATIO;
  const isSpread = palmWidth > 0 && tipToIndexMcp > palmWidth * THUMB_SPREAD_RATIO;

  return reachesOut && isSpread;
}

// Menghitung berapa jari yang terbuka (0-5), memakai ulang fungsi deteksi yang sudah ada
function countExtendedFingers(landmarks) {
  const WRIST = 0;
  let count = 0;

  if (isThumbExtended(landmarks)) count++;
  if (isFingerExtended(landmarks, WRIST, 5, 6, 8)) count++;   // telunjuk
  if (isFingerExtended(landmarks, WRIST, 9, 10, 12)) count++;  // tengah
  if (isFingerExtended(landmarks, WRIST, 13, 14, 16)) count++; // manis
  if (isFingerExtended(landmarks, WRIST, 17, 18, 20)) count++; // kelingking

  return count;
}

function isOpenHand(landmarks) {
  return countExtendedFingers(landmarks) === 5;
}

/* ---------------------------------------------------------
   9. EVALUASI SEMUA GESTURE (✌️ & 🖐️) + SMOOTHING, LALU UPDATE UI
   -----------------------------------------------------------
   Kedua gesture dievaluasi dalam satu kali loop atas hasil
   deteksi tangan supaya efisien. Gesture ✌️ (peace) dan 🖐️
   (5 jari) bersifat saling eksklusif secara alami (peace butuh
   manis & kelingking menekuk, open-hand butuh semua lurus),
   jadi keduanya tidak akan aktif bersamaan.
--------------------------------------------------------- */
function evaluateGestures(results) {
  let rawPeaceDetected = false;
  let rawOpenDetected = false;

  if (results && results.landmarks) {
    for (const landmarks of results.landmarks) {
      if (isPeaceSign(landmarks)) rawPeaceDetected = true;
      if (isOpenHand(landmarks)) rawOpenDetected = true;
    }
  }

  // --- Gesture ✌️ (fitur lama, tidak diubah logikanya) ---
  if (rawPeaceDetected) {
    peaceOnFrames++;
    peaceOffFrames = 0;
  } else {
    peaceOffFrames++;
    peaceOnFrames = 0;
  }

  if (!isBlurActive && peaceOnFrames >= CONFIRM_FRAMES) {
    isBlurActive = true;
    setBlurEffect(true);
  } else if (isBlurActive && peaceOffFrames >= RELEASE_FRAMES) {
    isBlurActive = false;
    setBlurEffect(false);
  }

  // --- Gesture 🖐️ (fitur baru: zoom + partikel) ---
  if (rawOpenDetected) {
    openOnFrames++;
    openOffFrames = 0;
  } else {
    openOffFrames++;
    openOnFrames = 0;
  }

  if (!isZoomActive && openOnFrames >= CONFIRM_FRAMES) {
    isZoomActive = true;
    setZoomEffect(true);
  } else if (isZoomActive && openOffFrames >= RELEASE_FRAMES) {
    isZoomActive = false;
    setZoomEffect(false);
  }
}

function setBlurEffect(active) {
  if (active) {
    video.classList.add("blurred");
    gestureText.classList.add("show");
  } else {
    video.classList.remove("blurred");
    gestureText.classList.remove("show");
  }
}

/* ---------------------------------------------------------
   9b. EFEK GESTURE 5 JARI: ZOOM-IN + PARTIKEL BINTANG/BUBBLE
   -----------------------------------------------------------
   - Zoom murni CSS (transform: scale) via toggle class, jadi
     ringan dan otomatis smooth berkat transition di style.css.
   - Partikel dibuat berkala lewat setInterval selagi gesture
     aktif, tiap partikel adalah 1 elemen DOM kecil yang otomatis
     menghapus dirinya sendiri saat animasi CSS-nya selesai
     (event "animationend") — tidak ada partikel menumpuk/bocor.
   - Interval spawn sengaja dibuat jarang (~450ms) dan jumlah
     partikel per spawn kecil (1) supaya tetap ringan di HP.
--------------------------------------------------------- */
function setZoomEffect(active) {
  if (active) {
    videoContainer.classList.add("zoomed");
    video.classList.add("blurred-light");
    startParticles();
  } else {
    videoContainer.classList.remove("zoomed");
    video.classList.remove("blurred-light");
    stopParticles();
  }
}

function startParticles() {
  if (particleIntervalId) return; // sudah berjalan
  particleIntervalId = setInterval(() => {
    // Bubble selalu muncul tiap tick (dibuat lebih banyak sesuai permintaan),
    // sesekali disertai bubble kedua dan/atau bintang supaya lebih ramai
    // tapi masih terkendali (bukan setiap tick semuanya muncul sekaligus).
    spawnParticle("bubble");
    if (Math.random() < 0.55) spawnParticle("bubble");
    if (Math.random() < 0.6) spawnParticle("star");
  }, 260);
}

function stopParticles() {
  if (particleIntervalId) {
    clearInterval(particleIntervalId);
    particleIntervalId = null;
  }
}

function spawnParticle(type) {
  const el = document.createElement("div");
  const leftPercent = 10 + Math.random() * 80; // hindari mepet tepi
  const rise = 160 + Math.random() * 120; // jarak naik ke atas (px)
  const drift = (Math.random() - 0.5) * 60; // sedikit gerak menyamping
  const duration = 1800 + Math.random() * 1200; // ms

  el.style.left = leftPercent + "%";
  el.style.setProperty("--rise", `-${rise}px`);
  el.style.setProperty("--drift", `${drift}px`);
  el.style.animationDuration = duration + "ms";

  if (type === "star") {
    el.className = "particle particle-star";
    el.textContent = "✨";
  } else {
    el.className = "particle particle-bubble";
    const size = 10 + Math.random() * 20;
    el.style.width = size + "px";
    el.style.height = size + "px";
  }

  el.addEventListener("animationend", () => el.remove());
  particlesLayer.appendChild(el);
}

/* ---------------------------------------------------------
   10. UTIL: STATUS & ERROR UI
--------------------------------------------------------- */
function setStatus(kind, message) {
  statusText.textContent = message;
  statusDot.className = "status-dot" + (kind ? " " + kind : "");
}

function showError(message) {
  errorText.textContent = message;
  errorBanner.classList.remove("hidden");
  setStatus("error", "Terjadi kesalahan");
}

function clearError() {
  errorBanner.classList.add("hidden");
  errorText.textContent = "";
}

function handleFatalError(err) {
  showError(err && err.message ? err.message : "Terjadi kesalahan yang tidak diketahui.");
  stopEverything();
}

function stopEverything() {
  if (rafId) cancelAnimationFrame(rafId);
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  stopParticles();
  isZoomActive = false;
  videoContainer.classList.remove("zoomed");
}

// Bersihkan kamera saat halaman ditutup/pindah
window.addEventListener("beforeunload", stopEverything);
