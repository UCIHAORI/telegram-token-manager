# Telegram Token Manager — GitHub JSON Database

Dashboard ini menambahkan dan menghapus token langsung pada repository database GitHub terpisah melalui GitHub Contents API.

## Penyimpanan
File target default: `database.json`

Format file:
```json
{
  "tokenBot": {
    "Uciha": "TOKEN_BOT"
  }
}
```

Token disimpan sebagai teks biasa agar script lain dapat membacanya sesuai format yang diminta. Karena itu repository database WAJIB Private. Jangan membagikan file, token, atau akses repository. GitHub menyimpan riwayat commit; penghapusan dari file terbaru tidak menghapus token dari riwayat lama. Jika token pernah terekspos, revoke melalui BotFather.

## Environment Variables Vercel

Wajib:
- `ADMIN_PASSWORD`: password admin minimal 14 karakter.
- `SESSION_SECRET`: 64 karakter hex.
- `DATABASE_GITHUB_TOKEN`: GitHub PAT yang punya akses Contents Read and write pada repository database.
- `DATABASE_GITHUB_OWNER`: username/organisasi pemilik repository database.
- `DATABASE_GITHUB_REPO`: nama repository database, misalnya `UcihaTokenDatabase`.

Opsional:
- `DATABASE_GITHUB_BRANCH`: default `main`.
- `DATABASE_GITHUB_PATH`: default `database.json`.

Untuk Fine-grained PAT, pilih hanya repository database, Contents Read and write, Metadata Read-only. Classic PAT dapat dipakai dengan scope `repo`, tetapi aksesnya lebih luas.

## Deploy
1. Upload seluruh isi ZIP ke repository aplikasi.
2. Import/deploy repository aplikasi ke Vercel.
3. Isi Environment Variables di atas untuk Production.
4. Redeploy setelah perubahan environment variables.
5. Login ke dashboard. Add Token akan memvalidasi token dengan Telegram, lalu menambahkan `owner: token` ke object `tokenBot` di repository database. Delete menghapus key owner tersebut.

## Catatan
- Nama owner harus unik. Jika sudah ada, API menolak penambahan agar data lama tidak tertimpa.
- GitHub Contents API menggunakan SHA file untuk update. Jika dua penulisan bersamaan, salah satunya dapat gagal karena konflik; coba ulangi.
- Jangan commit PAT atau file `.env` ke repository aplikasi.


## Role OWNER dan MEMBER
- OWNER login dengan username `owner` dan nilai `ADMIN_PASSWORD` dari environment Vercel.
- OWNER dapat melihat/menghapus bot, mengirim pesan, membuat akun MEMBER, dan menghapus akun MEMBER.
- MEMBER login memakai username/password yang dibuat OWNER. MEMBER hanya dapat menambahkan token bot.
- Password MEMBER disimpan sebagai hash scrypt + salt di `database.json`, bukan plaintext.
- Data lama dengan hanya `tokenBot` tetap dapat dibaca; file berikutnya yang ditulis akan menyertakan properti `users`.
- Setelah mengganti file, push ke repository aplikasi lalu redeploy Vercel.

- Halaman login memiliki dua portal terpisah: Admin Login dan Member Login. Portal admin memakai akun `owner`; portal member meminta username dan password member.
