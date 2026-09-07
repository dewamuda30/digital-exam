/**
 * ===================================================================
 * DIGITAL EXAM PORTAL - BACKEND API ENGINE
 * Engine: Google Apps Script (Spreadsheet as Database & Headless CMS)
 * ===================================================================
 */

// 1. ENDPOINT GET: Membaca Config, Ujian Aktif, dan Data Siswa
// GANTI FUNGSI doGet DENGAN INI:
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. ENDPOINT KHUSUS MONITORING RUANG (Dipanggil otomatis oleh monitor.html)
    if (e && e.parameter && e.parameter.action === "getMonitoring") {
      var config = readConfigSheet(ss);
      var inputToken = (e.parameter.token || "").trim().toUpperCase();
      var inputRuang = (e.parameter.ruang || "").trim();

      // Validasi Sandi Pengawas
      if (!config.tokenResetPengawas || inputToken !== config.tokenResetPengawas.toUpperCase()) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: "Sandi pengawas salah!"
        })).setMimeType(ContentService.MimeType.JSON);
      }

      var monitorData = getRoomMonitoringData(ss, inputRuang);
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        ruang: inputRuang,
        timestamp: Utilities.formatDate(new Date(), "Asia/Jakarta", "HH:mm:ss"),
        maxPelanggaran: config.batasPelanggaran,
        data: monitorData
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. ENDPOINT DEFAULT (Dipanggil oleh index.html)
    var config = readConfigSheet(ss);
    var ujianAktif = readActiveExams(ss);
    var siswa = readSiswaSheet(ss);

    var responseData = {
      status: "success",
      timestamp: new Date().toISOString(),
      config: config,
      ujianAktif: ujianAktif,
      siswa: siswa
    };

    return ContentService.createTextOutput(JSON.stringify(responseData))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// TAMBAHKAN FUNGSI INI DI PALING BAWAH Code.gs:
function getRoomMonitoringData(ss, targetRuang) {
  var siswaSheet = ss.getSheetByName("SISWA");
  var logSheet = ss.getSheetByName("LOG") || ss.getSheetByName("Log") || ss.getSheetByName("log");
  
  var result = {
    peserta: [],
    liveFeed: []
  };

  if (!siswaSheet) return result;

  // 1. Ambil daftar siswa di ruang target
  var siswaData = siswaSheet.getDataRange().getValues();
  var listSiswaRuang = [];
  for (var i = 1; i < siswaData.length; i++) {
    var r = siswaData[i][0] ? siswaData[i][0].toString().trim() : "";
    if (r.toLowerCase() === targetRuang.toLowerCase()) {
      listSiswaRuang.push({
        nama: siswaData[i][3] ? siswaData[i][3].toString().trim() : "",
        kelas: siswaData[i][1] ? siswaData[i][1].toString().trim() : "",
        ruang: r
      });
    }
  }

  // 2. Baca seluruh data riwayat tab LOG
  var logMap = {};
  var feed = [];
  if (logSheet && logSheet.getLastRow() > 1) {
    var logRows = logSheet.getDataRange().getValues();
    // Iterasi dari log terbaru ke terlama
    for (var j = logRows.length - 1; j >= 1; j--) {
      var rowRuang = logRows[j][2] ? logRows[j][2].toString().trim() : "";
      if (rowRuang.toLowerCase() === targetRuang.toLowerCase()) {
        var namaSiswa = logRows[j][4] ? logRows[j][4].toString().trim() : "";
        var aktivitas = logRows[j][5] ? logRows[j][5].toString().trim() : "";
        var count = parseInt(logRows[j][6] || 0, 10);
        var waktu = logRows[j][0] ? logRows[j][0].toString() : "";

        // Catat aktivitas terbaru per siswa
        if (!logMap[namaSiswa]) {
          logMap[namaSiswa] = {
            aktivitasTerakhir: aktivitas,
            pelanggaran: count,
            waktu: waktu
          };
        }

        // Ambil 8 riwayat aktivitas terakhir untuk ticker pengawas
        if (feed.length < 8) {
          feed.push({
            waktu: waktu.split(" ")[1] || waktu,
            nama: namaSiswa,
            kelas: logRows[j][3] || "",
            aktivitas: aktivitas,
            pelanggaran: count
          });
        }
      }
    }
  }

  // 3. Gabungkan status peserta
  listSiswaRuang.forEach(function(s) {
    var logInfo = logMap[s.nama];
    var status = "Belum Masuk";
    var violations = 0;
    var lastAkt = "-";

    if (logInfo) {
      violations = logInfo.pelanggaran;
      lastAkt = logInfo.aktivitasTerakhir;
      if (lastAkt.indexOf("Selesai Ujian") !== -1) {
        status = "Selesai";
      } else if (lastAkt.indexOf("Terkunci") !== -1) {
        status = "Terkunci";
      } else {
        status = "Mengerjakan";
      }
    }

    result.peserta.push({
      nama: s.nama,
      kelas: s.kelas,
      status: status,
      pelanggaran: violations,
      aktivitasTerakhir: lastAkt
    });
  });

  result.liveFeed = feed;
  return result;
}

// 2. ENDPOINT POST: Menerima & Mencatat Riwayat Pelanggaran (Dengan Lock Service)
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Menunggu antrean maksimal 10 detik jika banyak siswa submit sekaligus
    lock.waitLock(10000);
  } catch (lockErr) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "Server sibuk mencatat data lain"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Cari tab LOG (kebal huruf besar/kecil atau spasi)
    var logSheet = ss.getSheetByName("LOG") || ss.getSheetByName("Log") || ss.getSheetByName("log");
    
    // Buat otomatis jika tab LOG belum ada
    if (!logSheet) {
      logSheet = ss.insertSheet("LOG");
      logSheet.appendRow([
        "Waktu", 
        "Mapel", 
        "Ruang", 
        "Kelas", 
        "Nama Siswa", 
        "Aktivitas", 
        "Pelanggaran Ke"
      ]);
    }

    var payload = {};

    // Ekstraksi payload dari fetch web
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (errJson) {
        payload = { aktivitas: e.postData.contents };
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    // Format stempel waktu lokal Indonesia (WIB)
    var waktuSekarang = Utilities.formatDate(
      new Date(), 
      "Asia/Jakarta", 
      "dd/MM/yyyy HH:mm:ss"
    );

    // Tulis baris baru ke tab LOG
    logSheet.appendRow([
      waktuSekarang,
      payload.mapel || "-",
      payload.ruang || "-",
      payload.kelas || "-",
      payload.nama || "-",
      payload.aktivitas || "-",
      payload.totalPelanggaran !== undefined ? payload.totalPelanggaran : 0
    ]);

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Log berhasil dicatat"
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// ===================================================================
// FUNGSI PEMBANTU (HELPER FUNCTIONS)
// ===================================================================

// Membaca tab CONFIG
function readConfigSheet(ss) {
  var sheet = ss.getSheetByName("CONFIG");
  var config = {
    portalAktif: false,
    logoInstansi: "",
    bannerUjian: "",
    pesanTutup: "Sesi ujian belum dibuka oleh panitia.",
    tokenUjian: "",
    batasPelanggaran: 3,
    tokenResetPengawas: ""
  };

  if (!sheet) return config;

  var values = sheet.getRange("A2:B8").getValues();
  values.forEach(function(row) {
    if (!row[0]) return;
    var param = row[0].toString().trim().toUpperCase();
    var val = row[1];

    switch (param) {
      case "PORTAL_AKTIF":
        config.portalAktif = (val === true || val.toString().toUpperCase() === "TRUE");
        break;
      case "LOGO_INSTANSI":
        config.logoInstansi = formatDriveImageUrl(val ? val.toString().trim() : "");
        break;
      case "BANNER_UJIAN":
        config.bannerUjian = formatDriveImageUrl(val ? val.toString().trim() : "");
        break;
      case "PESAN_TUTUP":
        if (val) config.pesanTutup = val.toString().trim();
        break;
      case "TOKEN_UJIAN":
        if (val) config.tokenUjian = val.toString().trim();
        break;
      case "BATAS_PELANGGARAN":
        var num = parseInt(val, 10);
        config.batasPelanggaran = !isNaN(num) && num > 0 ? num : 3;
        break;
      case "TOKEN_RESET_PENGAWAS":
        if (val) config.tokenResetPengawas = val.toString().trim();
        break;
    }
  });

  return config;
}

// Membaca tab UJIAN (hanya mengambil baris dengan is_active = TRUE)
function readActiveExams(ss) {
  var sheet = ss.getSheetByName("UJIAN");
  var activeExams = [];
  if (!sheet) return activeExams;

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return activeExams;

  var headers = data[0].map(function(h) { return h.toString().trim().toLowerCase(); });
  var idxMapel = headers.indexOf("mapel");
  var idxTingkat = headers.indexOf("tingkat kelas");
  var idxLink = headers.indexOf("link form");
  var idxActive = headers.indexOf("is_active");
  var idxKet = headers.indexOf("keterangan");

  if (idxMapel === -1) idxMapel = 0;
  if (idxTingkat === -1) idxTingkat = 1;
  if (idxLink === -1) idxLink = 2;
  if (idxActive === -1) idxActive = 3;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var isActive = (row[idxActive] === true || row[idxActive].toString().toUpperCase() === "TRUE");

    if (isActive) {
      activeExams.push({
        mapel: row[idxMapel] ? row[idxMapel].toString().trim() : "",
        tingkatKelas: row[idxTingkat] ? row[idxTingkat].toString().trim() : "",
        linkForm: row[idxLink] ? row[idxLink].toString().trim() : "",
        keterangan: idxKet !== -1 && row[idxKet] ? row[idxKet].toString().trim() : ""
      });
    }
  }

  return activeExams;
}

// Membaca tab SISWA (Master Peserta)
function readSiswaSheet(ss) {
  var sheet = ss.getSheetByName("SISWA");
  var listSiswa = [];
  if (!sheet) return listSiswa;

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return listSiswa;

  var headers = data[0].map(function(h) { return h.toString().trim().toLowerCase(); });
  var idxRuang = headers.indexOf("ruang");
  var idxKelas = headers.indexOf("kelas");
  var idxNis = headers.indexOf("nis");
  var idxNama = headers.indexOf("nama siswa") !== -1 ? headers.indexOf("nama siswa") : headers.indexOf("nama");

  if (idxRuang === -1) idxRuang = 0;
  if (idxKelas === -1) idxKelas = 1;
  if (idxNis === -1) idxNis = 2;
  if (idxNama === -1) idxNama = 3;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[idxRuang] && row[idxKelas] && row[idxNama]) {
      listSiswa.push({
        ruang: row[idxRuang].toString().trim(),
        kelas: row[idxKelas].toString().trim(),
        nis: row[idxNis] ? row[idxNis].toString().trim() : "",
        nama: row[idxNama].toString().trim()
      });
    }
  }

  return listSiswa;
}

// Konversi link share Google Drive biasa menjadi Direct Image Link
function formatDriveImageUrl(driveUrl) {
  if (!driveUrl) return "";
  
  var match = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || driveUrl.match(/id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    var fileId = match[1];
    return "https://lh3.googleusercontent.com/d/" + fileId;
  }
  
  return driveUrl;
}
