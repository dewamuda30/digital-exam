### 1. Penyiapan Database (Google Spreadsheet)

* **Pembuatan Lembar Kerja**: Buat spreadsheet baru dengan lima tab: `CONFIG`, `UJIAN`, `SISWA` dan `LOG`.
* **Tab `CONFIG**`: Siapkan kolom untuk mencatat parameter sistem, nilai konfigurasi, dan deskripsi, mencakup status buka/tutup portal, batas maksimal pelanggaran, token masuk siswa, token reset pengawas, serta identitas sekolah.
* **Tab `UJIAN**`: Siapkan kolom identitas ujian, nama mata pelajaran, jenjang kelas, durasi waktu pengerjaan, tautan formulir soal, dan status keaktifan paket soal.
* **Tab `SISWA**`: Siapkan data induk peserta yang memuat nomor induk siswa, nama lengkap, kelas, penempatan ruang, dan pembagian sesi.
* **Tab `LOG**`: Siapkan kolom stempel waktu, mata pelajaran, ruang, kelas, nama siswa, jenis aktivitas/interupsi, dan urutan angka pelanggaran.

---

### 2. Penerapan Backend (Google Apps Script)

* **Akses Editor Skrip**: Buka menu ekstensi pada spreadsheet dan pilih Apps Script.
* **Pengaturan Logika API**: Masukkan skrip pengolah permintaan web untuk membaca konfigurasi, memverifikasi status sesi pengerjaan, mencatat riwayat pelanggaran, serta memperbarui log pengawas dan rekapitulasi nilai.
* **Deployment Web App**: Lakukan proses deployment baru bertipe aplikasi web (*Web App*).
* **Konfigurasi Akses**: Setel hak eksekusi menggunakan akun pemilik spreadsheet dan buka izin akses untuk publik (*Anyone*) agar pengiriman data dari perangkat siswa tidak terhalang autentikasi akun Google.
* **Penyimpanan URL API**: Salin dan simpan alamat URL aplikasi web yang diterbitkan untuk dihubungkan ke berkas tampilan antarmuka.

---

### 3. Konfigurasi Naskah Soal (Google Forms)

* **Pengaturan Kuis**: Aktifkan mode kuis pada setelan formulir soal.
* **Pembatasan Rilis Nilai**: Alihkan rilis nilai ke peninjauan manual serta nonaktifkan tampilan jawaban benar, pertanyaan tak terjawab, dan poin nilai agar siswa tidak mendapatkan kunci jawaban di layar.
* **Isolasi Alur**: Matikan opsi pengiriman tanggapan lain untuk mencegah pembukaan jendela peramban baru.
* **Pesan Konfirmasi**: Tuliskan pesan penutup formulir yang mengarahkan siswa untuk segera menekan tombol selesai pada bilah navigasi ujian.
* **Penyambungan Tautan**: Salin tautan publik formulir soal dan masukkan ke kolom tautan form pada tab daftar ujian di Google Spreadsheet.

---

### 4. Penyusunan Berkas Antarmuka & GitHub

* **Struktur Berkas**: Siapkan berkas halaman masuk siswa, lembar ujian mode kiosk dengan pengunci layar penuh dan penahan layar menyala (*Screen Wake Lock*), dasbor pemantauan ruang kelas, halaman konfirmasi selesai, serta berkas konfigurasi perutean URL bersih (*clean URLs*).
* **Penyambungan API**: Perbarui konstanta URL backend pada setiap berkas web menggunakan alamat URL Apps Script yang telah disimpan.
* **Penyimpanan Repositori**: Buat repositori baru di GitHub dan unggah seluruh berkas antarmuka ke cabang utama (*main branch*).

---

### 5. Publikasi Web (Vercel)

* **Integrasi Akun**: Masuk ke platform Vercel menggunakan akun GitHub.
* **Impor Proyek**: Hubungkan dan impor repositori portal ujian dari GitHub ke dasbor Vercel.
* **Pengaturan Bangun (*Build Settings*)**: Pilih pratetap proyek situs statis standar tanpa perintah kompilasi khusus.
* **Penerbitan (*Deploy*)**: Jalankan proses publikasi hingga memperoleh domain resmi berprotokol HTTPS yang siap digunakan siswa dan pengawas.

---

### 6. Prosedur Operasional Hari Ujian

* **Tahap Aktivasi**: Buka status portal pada tab konfigurasi dan aktifkan mata pelajaran yang dijadwalkan pada tab ujian di spreadsheet.
* **Tahap Pengawasan**: Pengawas menghubungkan perangkat laptop ke proyektor kelas, membuka halaman pemantauan melalui domain publik, dan memilih ruang ujian yang sedang diawasi.
* **Tahap Pengerjaan**: Siswa membuka alamat web di gawai masing-masing, memilih data diri, masuk ke mode layar penuh, dan mengerjakan soal.
* **Tahap Penanganan Kendala**: Jika layar siswa terkunci akibat pelanggaran melebihi batas, pengawas ruang mendatangi meja siswa dan memasukkan token reset untuk membuka kembali akses. Apabila siswa tidak sengaja keluar sebelum tuntas, pengawas menghapus rekaman log selesai milik siswa tersebut di spreadsheet agar siswa dapat masuk kembali.
* **Tahap Penutupan**: Siswa mengirim tanggapan formulir soal dan mengonfirmasi penyelesaian ujian dengan memasukkan token ujian pada navigasi atas; status siswa otomatis tercatat pada lembar rekapitulasi nilai. Tutup kembali status portal setelah seluruh sesi berakhir.
