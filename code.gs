/**
 * ===================================================================
 * DIGITAL EXAM PORTAL - BACKEND API ENGINE
 * Engine: Google Apps Script (Spreadsheet as Database & Headless CMS)
 * ===================================================================
 */

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. ENDPOINT CHECK SESI SISWA (Pemulihan Sesi Pasca Tutup Browser)
    if (e && e.parameter && e.parameter.action === "checkSession") {
      var config = readConfigSheet(ss);
      var nama = (e.parameter.nama || "").trim();
      var mapel = (e.parameter.mapel || "").trim();
      var sessionInfo = getStudentLatestSession(ss, nama, mapel, config.batasPelanggaran);

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        session: sessionInfo
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. ENDPOINT MONITORING RUANG (Khusus monitor.html)
    if (e && e.parameter && e.parameter.action === "getMonitoring") {
      var config = readConfigSheet(ss);
      var inputToken = (e.parameter.token || "").trim().toUpperCase();
      var inputRuang = (e.parameter.ruang || "").trim();

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

    // 3. ENDPOINT DEFAULT (Config, Ujian Aktif, Siswa)
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

// Menelusuri status dan pelanggaran tertinggi dari tab LOG
// GANTI FUNGSI getStudentLatestSession DI Code.gs DENGAN INI:
function getStudentLatestSession(ss, targetNama, targetMapel, batasPelanggaran) {
  var logSheet = ss.getSheetByName("LOG") || ss.getSheetByName("Log") || ss.getSheetByName("log");
  var info = {
    hasSession: false,
    isCompleted: false,
    isLocked: false,
    totalPelanggaran: 0,
    lastAktivitas: ""
  };

  if (!logSheet || logSheet.getLastRow() <= 1) return info;

  var data = logSheet.getDataRange().getValues();
  if (data.length <= 1) return info;

  // Baca Header Baris ke-1 secara dinamis
  var headers = data[0].map(function(h) { return h ? h.toString().trim().toLowerCase() : ""; });
  var idxMapel = headers.indexOf("mapel");
  var idxNama = headers.indexOf("nama siswa") !== -1 ? headers.indexOf("nama siswa") : headers.indexOf("nama");
  var idxAktivitas = headers.indexOf("aktivitas");
  var idxPelanggaran = headers.indexOf("pelanggaran ke") !== -1 ? headers.indexOf("pelanggaran ke") : headers.indexOf("pelanggaran");

  // Fallback jika nama kolom berbeda
  if (idxMapel === -1) idxMapel = 1;
  if (idxNama === -1) idxNama = 4;
  if (idxAktivitas === -1) idxAktivitas = 5;
  if (idxPelanggaran === -1) idxPelanggaran = 6;

  var maxV = 0;
  var foundLockAction = false;
  var foundAny = false;

  var cleanTargetNama = (targetNama || "").toString().trim().toLowerCase();
  var cleanTargetMapel = (targetMapel || "").toString().trim().toLowerCase();

  for (var i = data.length - 1; i >= 1; i--) {
    var rowMapel = data[i][idxMapel] ? data[i][idxMapel].toString().trim().toLowerCase() : "";
    var rowNama = data[i][idxNama] ? data[i][idxNama].toString().trim().toLowerCase() : "";
    var rawAktivitas = data[i][idxAktivitas] ? data[i][idxAktivitas].toString().trim() : "";
    var rowAktivitas = rawAktivitas.toLowerCase();
    var rowPelanggaran = parseInt(data[i][idxPelanggaran] || 0, 10);

    if (rowNama === cleanTargetNama && rowMapel === cleanTargetMapel) {
      if (!foundAny) {
        foundAny = true;
        info.hasSession = true;
        info.lastAktivitas = rawAktivitas;
      }

      if (rowPelanggaran > maxV) {
        maxV = rowPelanggaran;
      }

      // Deteksi Selesai Fleksibel: Mengandung kata "selesai" di riwayat mana pun
      if (rowAktivitas.indexOf("selesai") !== -1) {
        info.isCompleted = true;
      }

      if (!foundLockAction) {
        if (rowAktivitas.indexOf("terkunci") !== -1) {
          info.isLocked = true;
          foundLockAction = true;
        } else if (rowAktivitas.indexOf("dibuka kembali") !== -1 || rowAktivitas.indexOf("dipulihkan") !== -1) {
          info.isLocked = false;
          foundLockAction = true;
        }
      }
    }
  }

  info.totalPelanggaran = maxV;
  if (!foundLockAction && maxV >= batasPelanggaran) {
    info.isLocked = true;
  }

  return info;
}

function getRoomMonitoringData(ss, targetRuang) {
  var siswaSheet = ss.getSheetByName("SISWA");
  var logSheet = ss.getSheetByName("LOG") || ss.getSheetByName("Log") || ss.getSheetByName("log");
  
  var result = { peserta: [], liveFeed: [] };
  if (!siswaSheet) return result;

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

  var logMap = {};
  var feed = [];
  if (logSheet && logSheet.getLastRow() > 1) {
    var logRows = logSheet.getDataRange().getValues();
    for (var j = logRows.length - 1; j >= 1; j--) {
      var rowRuang = logRows[j][2] ? logRows[j][2].toString().trim() : "";
      if (rowRuang.toLowerCase() === targetRuang.toLowerCase()) {
        var namaSiswa = logRows[j][4] ? logRows[j][4].toString().trim() : "";
        var aktivitas = logRows[j][5] ? logRows[j][5].toString().trim() : "";
        var count = parseInt(logRows[j][6] || 0, 10);
        var waktu = logRows[j][0] ? logRows[j][0].toString() : "";

        if (!logMap[namaSiswa]) {
          logMap[namaSiswa] = { aktivitasTerakhir: aktivitas, pelanggaran: count, waktu: waktu };
        }

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

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (lockErr) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "Server sibuk"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName("LOG") || ss.getSheetByName("Log") || ss.getSheetByName("log");
    
    if (!logSheet) {
      logSheet = ss.insertSheet("LOG");
      logSheet.appendRow(["Waktu", "Mapel", "Ruang", "Kelas", "Nama Siswa", "Aktivitas", "Pelanggaran Ke"]);
    }

    var payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (errJson) {
        payload = { aktivitas: e.postData.contents };
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    var waktuSekarang = Utilities.formatDate(new Date(), "Asia/Jakarta", "dd/MM/yyyy HH:mm:ss");

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

function readActiveExams(ss) {
  var sheet = ss.getSheetByName("UJIAN");
  var activeExams = [];
  if (!sheet) return activeExams;

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return activeExams;

  var headers = data[0].map(function(h) { return h.toString().trim().toLowerCase(); });
  var idxMapel = headers.indexOf("mapel") !== -1 ? headers.indexOf("mapel") : 0;
  var idxTingkat = headers.indexOf("tingkat kelas") !== -1 ? headers.indexOf("tingkat kelas") : 1;
  var idxLink = headers.indexOf("link form") !== -1 ? headers.indexOf("link form") : 2;
  var idxActive = headers.indexOf("is_active") !== -1 ? headers.indexOf("is_active") : 3;
  var idxKet = headers.indexOf("keterangan");

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

function readSiswaSheet(ss) {
  var sheet = ss.getSheetByName("SISWA");
  var listSiswa = [];
  if (!sheet) return listSiswa;

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return listSiswa;

  var headers = data[0].map(function(h) { return h.toString().trim().toLowerCase(); });
  var idxRuang = headers.indexOf("ruang") !== -1 ? headers.indexOf("ruang") : 0;
  var idxKelas = headers.indexOf("kelas") !== -1 ? headers.indexOf("kelas") : 1;
  var idxNis = headers.indexOf("nis") !== -1 ? headers.indexOf("nis") : 2;
  var idxNama = headers.indexOf("nama siswa") !== -1 ? headers.indexOf("nama siswa") : (headers.indexOf("nama") !== -1 ? headers.indexOf("nama") : 3);

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

function formatDriveImageUrl(driveUrl) {
  if (!driveUrl) return "";
  var match = driveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || driveUrl.match(/id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return "https://lh3.googleusercontent.com/d/" + match[1];
  }
  return driveUrl;
}
