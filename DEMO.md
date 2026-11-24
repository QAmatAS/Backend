# Panduan demo SpoonShare (backend)

Checklist untuk hari demo: persiapan, uji kunci 5 menit, data demo yang kedaluwarsa
dalam hitungan menit, dan cadangan. Semua perintah dijalankan di **PowerShell**
(ketik `powershell` kalau masih di CMD) dari folder repo.

> Jika `npm` diblokir execution policy, pakai `npm.cmd`.

## 1. Persiapan (sebelum demo)

| # | Langkah | Perintah / cek |
| - | ------- | -------------- |
| 1 | MongoDB berjalan | `Get-Service MongoDB` harus `Running` |
| 2 | Dependensi terpasang | `npm.cmd ci` |
| 3 | `.env` ada dan **`JWT_SECRET` acak** | lihat di bawah |
| 4 | Akun demo, listing demo, admin | `npm.cmd run seed`, `npm.cmd run seed:foods`, `npm.cmd run seed:admin` |
| 5 | Server jalan | `npm.cmd run dev` (atau `npm.cmd run tunnel` untuk alamat publik) |
| 6 | Uji kunci lulus | bagian 2 |
| 7 | Cadangan dibuat | bagian 4 |

`JWT_SECRET` yang masih berupa contoh dari `.env.example` ada di GitHub, jadi siapa pun
bisa memalsukan token lewat tunnel publik. Buat nilai acak dan tempel ke `.env`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Setelah `JWT_SECRET` diganti, semua token lama tidak berlaku: login ulang sekali di app.
Lakukan ini **sebelum** hari demo. Saat server menyala, tidak boleh ada baris
`WARNING: JWT_SECRET is missing...` di konsol.

Akun `seed:admin` adalah `ADMIN_EMAIL` di `.env` (bawaan `alice@example.com`). Pakai akun
admin yang sama dengan yang dipakai di app.

## 2. Uji kunci 5 menit

Jalankan server dulu, lalu tempel seluruh blok ini di PowerShell (jendela lain). Semua baris
harus **PASS**. Bagian terakhir menunggu sekitar 70 detik untuk membuktikan arsip
kedaluwarsa; set `$withExpiry = $false` kalau ingin melewatinya.

```powershell
$base = 'http://localhost:3000/api'     # atau https://spoonshare-test-tunnel.loca.lt/api
$adminEmail = 'alice@example.com'        # ganti dengan akun admin di database ini
$pw = 'password123'
$withExpiry = $true
$inv = [System.Globalization.CultureInfo]::InvariantCulture

function Call($method, $path, $token, $body) {
  $h = @{ 'bypass-tunnel-reminder' = 'true' }
  if ($token) { $h['Authorization'] = "Bearer $token" }
  $p = @{ Uri = "$base$path"; Method = $method; Headers = $h; UseBasicParsing = $true }
  if ($null -ne $body) { $p.Body = ($body | ConvertTo-Json -Depth 8); $p.ContentType = 'application/json' }
  try {
    $r = Invoke-WebRequest @p
    $json = $null
    if ($r.Content) { $json = $r.Content | ConvertFrom-Json }
    return @{ status = [int]$r.StatusCode; json = $json; error = '' }
  } catch {
    $resp = $_.Exception.Response
    $text = ''
    $code = 0
    if ($resp) {
      $code = [int]$resp.StatusCode
      try { $text = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {}
    } else { $text = $_.Exception.Message }
    return @{ status = $code; json = $null; error = $text }
  }
}
function Check($name, $ok) {
  if ($ok) { Write-Host "PASS  $name" -ForegroundColor Green }
  else { Write-Host "FAIL  $name" -ForegroundColor Red }
}
# Has/HasItem: true hanya kalau respons 200 DAN id ada. Absent/AbsentItem: respons 200 DAN id tidak ada.
function Has($r, $id) { ($r.status -eq 200) -and $id -and $r.json -and (@($r.json.data | Where-Object { $_.food_id -eq $id }).Count -gt 0) }
function HasItem($r, $id) { ($r.status -eq 200) -and $id -and $r.json -and (@($r.json.items | Where-Object { $_.food_id -eq $id }).Count -gt 0) }
function Absent($r, $id) { ($r.status -eq 200) -and -not (Has $r $id) }
function AbsentItem($r, $id) { ($r.status -eq 200) -and -not (HasItem $r $id) }
function Iso($d) { $d.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', $inv) }
function NewListing($title, $expiry) {
  @{
    food_details = @{ title = $title; category = 'Makanan Berat'; quantity_portions = 3; expiry_timestamp = (Iso $expiry) }
    location = @{ location_name = 'Uji demo'; coordinates = @{ latitude = -7.9526; longitude = 112.6144 } }
  }
}

# 1. Server dan login
Check 'health: database connected' ((Call 'GET' '/health' $null).json.db -eq 'connected')
$t = @{}
$t.maya  = (Call 'POST' '/login' $null @{ email = 'maya@example.com'; password = $pw }).json.token
$t.bob   = (Call 'POST' '/login' $null @{ email = 'bob@example.com'; password = $pw }).json.token
$t.admin = (Call 'POST' '/login' $null @{ email = $adminEmail; password = $pw }).json.token
Check 'login maya, bob dan admin menghasilkan token' ($t.maya -and $t.bob -and $t.admin)
Check 'login password salah -> 401' ((Call 'POST' '/login' $null @{ email = 'maya@example.com'; password = 'salah-salah' }).status -eq 401)
Check 'login password angka -> 400 (bukan 500)' ((Call 'POST' '/login' $null @{ email = 'maya@example.com'; password = 123456 }).status -eq 400)
Check 'register password angka -> 400 (bukan 500)' ((Call 'POST' '/register' $null @{ name = 'Angka'; email = 'angka@example.com'; password = 123456 }).status -eq 400)

# 2. Akses
Check 'GET /foods tanpa token -> 401' ((Call 'GET' '/foods' $null).status -eq 401)
$list = Call 'GET' '/foods?limit=100' $t.bob
Check 'GET /foods dengan token -> 200' ($list.status -eq 200)
Check 'Explore hanya berisi approved' (@($list.json.data | Where-Object { $_.verification_status -ne 'approved' }).Count -eq 0)
$d = Call 'GET' '/foods/food_demo01' $t.bob
Check 'detail food_demo01 -> 200 dengan kontak' ($d.status -eq 200 -and $d.json.data.contributor.phone)

# 3. Alur listing: posting -> pending -> approve -> terlihat -> notifikasi
$geo = 'lat=-7.9526&lng=112.6144&radiusKm=5'
$before = Iso (Get-Date).AddMinutes(-1)
$c = Call 'POST' '/foods' $t.maya (NewListing 'Uji demo 5 menit' (Get-Date).AddHours(3))
$id = $c.json.data.food_id
Check 'maya posting -> 201 pending' ($c.status -eq 201 -and $c.json.data.verification_status -eq 'pending')
if ($c.status -ne 201) {
  Write-Host "BERHENTI: POST gagal. Status $($c.status): $($c.error)" -ForegroundColor Red
} else {
  Check 'pending: bob tidak bisa membuka -> 404' ((Call 'GET' "/foods/$id" $t.bob).status -eq 404)
  Check 'pending: maya bisa membuka -> 200' ((Call 'GET' "/foods/$id" $t.maya).status -eq 200)
  Check 'pending: tidak ada di Explore bob' (Absent (Call 'GET' '/foods?limit=100' $t.bob) $id)
  Check 'pending: admin melihatnya di antrean' (Has (Call 'GET' '/foods?verification_status=pending&limit=100' $t.admin) $id)
  Check 'pending: tidak ada di notifikasi bob' (AbsentItem (Call 'GET' "/foods/new?$geo&since=$before" $t.bob) $id)
  Check 'maya tidak bisa approve sendiri -> 403' ((Call 'PATCH' "/foods/$id/verify" $t.maya @{ decision = 'approved' }).status -eq 403)
  Check 'admin approve -> 200' ((Call 'PATCH' "/foods/$id/verify" $t.admin @{ decision = 'approved' }).status -eq 200)
  Check 'approved: bob bisa membuka -> 200' ((Call 'GET' "/foods/$id" $t.bob).status -eq 200)
  Check 'approved: muncul di Explore bob' (Has (Call 'GET' '/foods?limit=100' $t.bob) $id)
  Check 'approved: muncul di notifikasi bob' (HasItem (Call 'GET' "/foods/new?$geo&since=$before" $t.bob) $id)
  Check 'approved: maya tidak dinotifikasi listing sendiri' (AbsentItem (Call 'GET' "/foods/new?$geo&since=$before" $t.maya) $id)
  Check 'bob tidak boleh mengubah listing maya -> 403' ((Call 'PATCH' "/foods/$id" $t.bob @{ food_details = @{ title = 'x' } }).status -eq 403)
  Check 'PATCH food_details null -> 400' ((Call 'PATCH' "/foods/$id" $t.maya @{ food_details = $null }).status -eq 400)
  Check 'status available -> reserved -> 200' ((Call 'PATCH' "/foods/$id/status" $t.maya @{ status = 'reserved' }).status -eq 200)
  Check 'status reserved -> picked_up -> 200' ((Call 'PATCH' "/foods/$id/status" $t.maya @{ status = 'picked_up' }).status -eq 200)
  Check 'picked_up tidak bisa kembali -> 400' ((Call 'PATCH' "/foods/$id/status" $t.maya @{ status = 'available' }).status -eq 400)
  Check 'maya menghapus listing -> 204' ((Call 'DELETE' "/foods/$id" $t.maya).status -eq 204)
  Check 'sesudah dihapus -> 404' ((Call 'GET' "/foods/$id" $t.maya).status -eq 404)
}

# 4. Kedaluwarsa dan arsip (menunggu sekitar 70 detik)
if ($withExpiry) {
  $e = Call 'POST' '/foods' $t.maya (NewListing 'Uji kedaluwarsa' (Get-Date).AddMinutes(1))
  $eid = $e.json.data.food_id
  Check 'listing 1 menit dibuat -> 201' ($e.status -eq 201)
  Write-Host 'Menunggu 70 detik sampai listing kedaluwarsa...'
  Start-Sleep -Seconds 70
  $ed = Call 'GET' "/foods/$eid" $t.maya
  Check 'sesudah kedaluwarsa: detail tetap 200 dengan status expired' ($ed.status -eq 200 -and $ed.json.data.status -eq 'expired')
  Check 'sesudah kedaluwarsa: hilang dari Explore' (Absent (Call 'GET' '/foods?limit=100' $t.maya) $eid)
  $mine = Call 'GET' '/me/listings?limit=100' $t.maya
  Check 'sesudah kedaluwarsa: masih ada di "listing saya"' (Has $mine $eid)
  Check 'sesudah kedaluwarsa: summary.expired bertambah' ($mine.json.summary.expired -ge 1)
  Check 'listing arsip tidak bisa dihapus -> 404' ((Call 'DELETE' "/foods/$eid" $t.maya).status -eq 404)
}
```

Catatan: uji ini membuat satu listing yang ikut terarsip (masuk koleksi `Expired`). Itu
normal dan tidak mengganggu demo. Untuk uji yang lebih lengkap, jalankan koleksi Postman
`postman/Backend-Auth.postman_collection.json` lalu `postman/Backend-Foods.postman_collection.json`
dari atas ke bawah (Runner), atau pakai `curl.exe` untuk pengecekan cepat:

```powershell
curl.exe -s http://localhost:3000/api/health
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/api/foods                       # 401 tanpa token
curl.exe -s -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{\"email\":\"maya@example.com\",\"password\":\"password123\"}'
```

## 3. Data demo yang kedaluwarsa dalam menit

```powershell
npm.cmd run seed:demo
```

Membuat tiga listing yang sudah **approved** dan **available** di sekitar Lowokwaru, milik
Maya dan Budi, dengan id tetap:

| food_id | Pemilik | Kedaluwarsa |
| ------- | ------- | ----------- |
| `food_live01` | Maya | 2 menit setelah skrip dijalankan |
| `food_live02` | Budi | 3 menit |
| `food_live03` | Maya | 5 menit |

Skrip mencetak jam kedaluwarsa tiap listing (WIB). Aman dijalankan ulang kapan saja: listing
yang sudah terarsip dibersihkan lalu dibuat baru dengan tenggat baru. Jalankan **semenit
sebelum** bagian ini ditunjukkan.

Urutan yang bisa ditunjukkan saat demo:

1. Buka Explore: ketiga listing tampil, timer di app berjalan.
2. Tunggu 2 menit lalu muat ulang Explore: `food_live01` hilang (diarsipkan saat ada
   permintaan baca berikutnya, jadi muat ulang dulu).
3. Buka detail `food_live01` dari tautan lama: masih terbuka dengan status **expired**.
4. Login sebagai Maya, buka "listing saya": `food_live01` ada di riwayat dan hitungan
   *expired* bertambah.
5. Sesudah 3 dan 5 menit, ulangi untuk `food_live02` dan `food_live03`.

Notifikasi "makanan baru di dekatmu" **tidak** dipicu oleh listing ini: server hanya
mengumumkan listing yang masih punya lebih dari 45 menit sebelum kedaluwarsa, dan hanya
setelah admin meng-approve. Untuk menunjukkan notifikasi, gunakan alur nyata: user A
posting dengan tenggat minimal 1 jam, admin approve di app, lalu HP user B (yang sudah
membuka app dan polling) menerima notifikasi.

## 4. Cadangan database

`mongodump` tidak ikut terpasang bersama MongoDB Server 4.4 ke atas; pasang **MongoDB Database
Tools** secara terpisah (paket `msi` atau `zip` untuk Windows x86_64 dari
<https://www.mongodb.com/try/download/database-tools>). Cek di jendela PowerShell **baru**:

```powershell
mongodump --version
```

Kalau perintah tidak dikenali, cari lokasinya dan panggil dengan alamat lengkap:

```powershell
Get-ChildItem 'C:\Program Files\MongoDB' -Recurse -Filter mongodump.exe -ErrorAction SilentlyContinue | Select-Object -First 1 FullName
```

Buat cadangan (database `backend` mengikuti `MONGODB_URI` di `.env`; sesuaikan kalau namanya
lain):

```powershell
$stamp = Get-Date -Format 'yyyyMMdd_HHmm'
$dir = "D:\backup\spoonshare_$stamp"
New-Item -ItemType Directory -Force $dir | Out-Null
mongodump --uri="mongodb://127.0.0.1:27017" --db=backend --out="$dir\db"
Copy-Item .\uploads "$dir\uploads" -Recurse
Get-ChildItem "$dir\db\backend"
```

Isi folder `db\backend` harus berupa beberapa file `.bson` (users dan listing). Foto listing dan
avatar **tidak** ada di database, karena disimpan di folder `uploads`; itu sebabnya folder itu
ikut disalin. `.env` berisi rahasia: kalau ingin menyimpannya, simpan di tempat pribadi dan
jangan masuk GitHub.

Pulihkan (menimpa koleksi yang ada di dump):

```powershell
mongorestore --uri="mongodb://127.0.0.1:27017" --drop --nsInclude="backend.*" "$dir\db"
Copy-Item "$dir\uploads\*" .\uploads -Recurse -Force
```

Setelah pulih, jalankan ulang server dan uji kunci (bagian 2). Buat cadangan **sebelum** demo
(setelah `seed`, `seed:foods`, `seed:admin`) dan satu lagi sesudah semua akun uji siap.

## 5. Jika ada masalah

| Gejala | Cek |
| ------ | --- |
| Semua request `500` | Baca pesan di jendela server (`npm.cmd run dev`), pesan asli hanya ada di sana |
| `Failed to start server` / tidak bisa konek DB | `Get-Service MongoDB` harus `Running`; cek `MONGODB_URI` di `.env` |
| `401` di app padahal sudah login | Token berlaku 1 hari (`JWT_EXPIRES_IN`) dan hilang kalau `JWT_SECRET` diganti: login ulang |
| Explore kosong | Jalankan `npm.cmd run seed:foods` dan `npm.cmd run seed:demo` (listing lama bisa sudah kedaluwarsa) |
| Listing baru tidak muncul di Explore | Wajar: harus di-approve admin dulu; pemiliknya melihatnya di "listing saya" |
| Tunnel menampilkan halaman pengingat | Kirim header `bypass-tunnel-reminder: true` dari klien API |
| Alamat tunnel berubah | `TUNNEL_SUBDOMAIN` di `.env` harus tetap; skrip memperingatkan kalau namanya berbeda |
