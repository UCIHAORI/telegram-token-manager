# Telegram Token Manager — Web Add/Delete

Versi ini memakai GitHub private repository sebagai penyimpanan permanen, bukan MongoDB. Dashboard memiliki menu utama list bot, form tambah dengan `Nama Owner` dan `Token Telegram`, serta tombol hapus.

## Arsitektur
- Frontend: HTML/CSS/JS.
- Backend: Express pada Vercel Functions.
- Penyimpanan: file `data/bots.enc.json` dibuat/diperbarui otomatis melalui GitHub Contents API.
- Token Telegram dienkripsi AES-256-GCM sebelum disimpan ke repository.
- Login admin memakai cookie HttpOnly + HMAC.

## 1. GitHub
1. Buat repository Private.
2. Upload seluruh isi ZIP ke root repository.
3. Buat Fine-grained Personal Access Token di GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens.
4. Repository access: Only select repositories → pilih repository ini.
5. Repository permissions: Contents = Read and write. Metadata = Read-only.
6. Simpan token PAT dengan aman. Jangan masukkan ke source code.

## 2. Vercel
Import repository di https://vercel.com/new. Framework Preset Other, Install Command `npm install`, Build Command kosong, Output Directory kosong.

Tambahkan Environment Variables berikut untuk Production:

- `ADMIN_PASSWORD`: password admin minimal 14 karakter.
- `SESSION_SECRET`: hasil `openssl rand -hex 32`.
- `TOKEN_ENCRYPTION_KEY`: hasil `openssl rand -hex 32` yang berbeda.
- `GITHUB_TOKEN`: fine-grained PAT dari langkah GitHub.
- `GITHUB_OWNER`: username atau organisasi pemilik repository.
- `GITHUB_REPO`: nama repository, misalnya `telegram-token-manager`.
- `GITHUB_BRANCH`: nama branch, biasanya `main`.

Opsional:
- `GITHUB_DATA_PATH`: default `data/bots.enc.json`.

Deploy. Jika mengubah Environment Variables, lakukan Redeploy.

## 3. Menggunakan dashboard
1. Buka URL Vercel dan login dengan ADMIN_PASSWORD.
2. Menu utama menampilkan list bot.
3. Klik Tambah Token.
4. Isi Nama Owner, misalnya `Uciha`.
5. Isi token asli dari BotFather di kolom Token Telegram.
6. Tekan Validasi & Simpan Token.
7. Backend memanggil Telegram `getMe`, mengenkripsi token, lalu menyimpan data terenkripsi ke file di repository GitHub.
8. Hapus bot dengan tombol Hapus pada baris bot.

## 4. Mengirim pesan
Pilih bot, isi Chat ID dan pesan, lalu Send message. Bot harus sudah di-Start oleh pengguna atau ditambahkan ke grup dengan izin yang sesuai.

## Catatan keamanan dan batasan
- Repository harus Private. File penyimpanan berisi token terenkripsi, bukan token mentah.
- Simpan `TOKEN_ENCRYPTION_KEY` dengan aman. Jika hilang/berubah, token tersimpan tidak dapat didekripsi.
- Jangan commit PAT, token Telegram, `.env`, atau secret ke GitHub.
- GitHub API menyimpan riwayat commit. Penghapusan bot membuat file terbaru tidak lagi memuat tokennya, tetapi token terenkripsi mungkin masih ada di riwayat commit lama. Jika token pernah terekspos, revoke melalui BotFather.
- GitHub Contents API bukan database transaksional. Untuk penggunaan admin tunggal dan skala kecil, ini pendekatan sederhana; hindari banyak perubahan bersamaan.
- Jangan pernah mengirim token Telegram atau PAT ke chat.
