# Backend Starter

A minimal Express.js + MongoDB backend starter. Plain JavaScript, no build step —
just a clean structure you can grow into a real project.

## Requirements

- Node.js 18 or newer (Node 20+ recommended)
- MongoDB running locally on port `27017`

## Getting started

```bash
npm install
cp .env.example .env   # then edit the values if needed
npm run seed           # creates the demo accounts (safe to re-run)
npm run seed:foods     # creates 10 demo food listings around Lowokwaru (safe to re-run)
npm run dev            # http://localhost:3000 (auto-restarts on file changes)
```

For production-style run:

```bash
npm start
```

> On Windows PowerShell, if `npm` is blocked by the execution policy, use
> `npm.cmd` instead (or run `Set-ExecutionPolicy -Scope Process Bypass`).

## Project structure

```
.
├── .env.example          # Sample environment variables
├── package.json
├── dummy
│   └── food-listings.json # 10 full food listing payloads (Lowokwaru)
├── uploads               # Uploaded images (served at /uploads, git-ignored)
└── src
    ├── server.js         # Connects to MongoDB, starts the HTTP server
    ├── app.js            # Express app: middleware + route mounting
    ├── seed.js           # Creates the demo users (idempotent)
    ├── seedFoods.js      # Creates 10 demo food listings around Lowokwaru
    ├── tunnel.js         # Starts the API and exposes it via localtunnel
    ├── config
    │   └── db.js         # Mongoose connection helper
    ├── models
    │   ├── User.js       # User schema (unique email, bcrypt hash, timestamps)
    │   └── FoodItemListing.js # Food listing schema (nested details, location, status)
    ├── routes
    │   ├── index.js      # GET /api, GET /api/health
    │   ├── login.js      # POST /api/login (JWT)
    │   ├── foods.js      # Create / list / read / update / delete food listings
    │   └── users.js      # Register / list / read / delete users
    └── middleware
        ├── notFound.js   # 404 handler
        ├── upload.js     # multer disk storage for food photos
        └── errorHandler.js # Central error handler
```

## Database

- Connection string: `mongodb://localhost:27017/backend` (database name `backend`,
  collection `users` + `food_items`). Override it with `MONGODB_URI` in `.env`.
- Mongoose is used for the schema, validation and queries.
- Emails are stored lowercase and are unique (unique index on `users.email`).
- Passwords are stored only as bcrypt hashes in `passwordHash`; the field is
  `select: false`, so it is never returned unless explicitly requested (login does).
- Users survive server restarts because they live in MongoDB, not process memory.
- Uploaded food photos are stored as files in `uploads/foods/` on this server,
  not in MongoDB; only their relative URLs are stored in `photo_urls`.
- The server refuses to start if MongoDB is unreachable, and reports the database
  state in `GET /api/health`.

Run `npm run seed` once to create the demo accounts. It uses upserts, so running
it again will not duplicate users or reset their passwords.

Run `npm run seed:foods` after that to fill the `food_items` collection with 10
demo listings located around Kecamatan Lowokwaru, Kota Malang (see below). The
data lives in `dummy/food-listings.json` as complete API payloads, exactly like
the body of `POST /api/foods`, so you can also copy any entry into Postman. The
seed is idempotent: demo documents use fixed ids `food_demo01`…`food_demo10`, so
a re-run updates them instead of adding duplicates.

## Endpoints

| Method | Path             | Description                          |
| ------ | ---------------- | ------------------------------------ |
| GET    | `/api`           | API info                             |
| GET    | `/api/health`    | Health check (+ DB state)            |
| POST   | `/api/login`     | Login, returns a JWT (`email`, `password`) |
| GET    | `/api/users`     | List users                           |
| GET    | `/api/users/:id` | Get one user (MongoDB ObjectId)      |
| POST   | `/api/users`     | Register (`name`, `email`, `password` min 6 chars) |
| DELETE | `/api/users/:id` | Delete user                          |
| GET    | `/api/foods`     | List food listings (filters: `status`, `verification_status`, `contributor_id`, `limit`, `skip`) |
| GET    | `/api/foods/:id` | Get one listing by `food_id` or ObjectId |
| POST   | `/api/foods`     | Save a listing (JSON, or multipart with photos) |
| PATCH  | `/api/foods/:id` | Update `status`, verification or listing content |
| DELETE | `/api/foods/:id` | Delete a food listing                |

### Demo accounts

| Email               | Password      |
| ------------------- | ------------- |
| `alice@example.com` | `password123` |
| `bob@example.com`   | `password123` |

### Demo food listings

`npm run seed:foods` inserts these 10 listings, all within Kecamatan Lowokwaru
(approximate coordinates near real landmarks):

| food_id | Title | Location | Coordinates | Status | Verification |
|---|---|---|---|---|---|
| `food_demo01` | Nasi Kotak Ayam Geprek | Kantin Pusat Universitas Brawijaya | -7.9526, 112.6144 | available | approved |
| `food_demo02` | Roti Tawar & Pastry Sisa Toko | Toko Roti Dinoyo | -7.9407, 112.6062 | available | approved |
| `food_demo03` | Sayur Sop & Tempe Goreng | Kos Putri Sumbersari | -7.9452, 112.6186 | available | pending |
| `food_demo04` | Buah Potong Segar | Warung Bu Tini Tlogomas | -7.9324, 112.5988 | available | pending |
| `food_demo05` | Nasi Uduk + Telur Balado | Rumah Makan Ketawanggede | -7.9570, 112.6078 | reserved | approved |
| `food_demo06` | Kue Basah Aneka Ragam | Toko Kue Merjosari | -7.9368, 112.5995 | available | rejected |
| `food_demo07` | Susu & Yogurt Mendekati Expired | Minimarket Suhat | -7.9518, 112.6183 | picked_up | approved |
| `food_demo08` | Nasi Ayam Bakar Madura | Food Court Mojolangu | -7.9318, 112.6269 | available | approved |
| `food_demo09` | Sandwich & Salad Kemasan | Tunjungsekar Bakery | -7.9355, 112.6306 | expired | approved |
| `food_demo10` | Air Mineral & Teh Kemasan | Jatimulyo Green Cafe | -7.9420, 112.6385 | available | pending |

The mix covers every status except `cancelled` and all three verification states,
so filters and UI states can be tested right away:

```bash
curl "http://localhost:3000/api/foods?status=available&limit=100"
curl "http://localhost:3000/api/foods?verification_status=pending"
curl "http://localhost:3000/api/foods?contributor_id=usr_9842a7f1"
```

The listings use two static demo contributor ids, `usr_9842a7f1` and
`usr_3c1d9e2b` (they are plain strings, not references to the `users`
collection).

### Login example

```bash
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"password123"}'
```

Response:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "tokenType": "Bearer",
  "expiresIn": "1d",
  "user": {
    "id": "6afa86b37cdc4ad7af40f014",
    "name": "Alice",
    "email": "alice@example.com",
    "createdAt": "2026-11-16T04:29:39.475Z",
    "updatedAt": "2026-11-16T04:29:39.475Z"
  }
}
```

- Wrong password and unknown email both return `401 Invalid email or password`.
- Missing fields return `400`; duplicate registration returns `409`.
- A malformed user id returns `400 Invalid id`.
- The token is signed with `JWT_SECRET` and lives for `JWT_EXPIRES_IN` (default `1d`).
  Set both in `.env`; production refuses to start a login without a secret.

Route matching is case-insensitive by default in Express, so `/api/LOGIN` works too.

### Register + login example

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Charlie","email":"charlie@example.com","password":"secret123"}'
```

### Food listing example

```bash
curl -X POST http://localhost:3000/api/foods \
  -H "Content-Type: application/json" \
  -d '{
    "food_id": "food_8821",
    "contributor_id": "usr_9842a7f1",
    "created_at": "2026-11-08T09:00:00Z",
    "verification_status": "approved",
    "verification_details": {
      "verified_by_admin_id": "adm_001",
      "verified_at": "2026-11-08T09:15:00Z",
      "rejection_reason": null
    },
    "food_details": {
      "title": "Nasi Kotak Ayam Bakar (5 Porsi)",
      "description": "Sisa acara ulang tahun keluarga, kondisi masih hangat dan higienis.",
      "category": "Makanan Berat",
      "dietary_tags": ["Halal", "Bebas Kacang"],
      "quantity_portions": 5,
      "expiry_timestamp": "2026-11-08T20:00:00Z",
      "photo_urls": ["https://images.app.example/foods/food_8821_1.jpg"]
    },
    "location": {
      "location_name": "Depan Pos Satpam Kompleks Asri",
      "address_text": "Jl. Mawar No. 12, Lowokwaru, Malang",
      "coordinates": { "latitude": -7.9521, "longitude": 112.6142 },
      "pickup_notes": "Makanan ditaruh di meja pos satpam.",
      "external_map_url": "https://maps.google.com/?q=-7.9521,112.6142"
    },
    "status": "available"
  }'
```

- Stored in the `food_items` collection; the response is `201 { "data": { ... } }`
  with `_id`/`__v` hidden.
- The exact same payload shape is used by `dummy/food-listings.json`, which
  `npm run seed:foods` inserts/updates.
- `food_id` is optional — generated as `food_<8 hex chars>` when omitted. It is unique:
  duplicates return `409`.
- Defaults: `created_at` = now, `status` = `available`,
  `verification_status` = `pending`.
- `verification_status: "approved"` sets `verified_at` to the current time if it is
  missing; `"rejected"` requires `verification_details.rejection_reason`.
- `location.external_map_url` is derived from `coordinates` when omitted.
- Missing required fields (`contributor_id`, `food_details.title`,
  `food_details.category`, `food_details.quantity_portions`,
  `food_details.expiry_timestamp`, `location.location_name`, coordinates) return `400`.

### Uploading listing photos

`POST /api/foods` also accepts `multipart/form-data`, so photos can be uploaded
together with a new listing:

- `data` — the same JSON payload as above, sent as a text field.
- `photos` — up to 5 files (`jpg`, `jpeg`, `png`, `webp`, `gif`), max 5 MB each.

```bash
curl -X POST http://localhost:3000/api/foods \
  -F 'data={"contributor_id":"usr_9842a7f1","food_details":{"title":"Nasi Box","category":"Makanan Berat","quantity_portions":3,"expiry_timestamp":"2026-11-18T12:00:00Z"},"location":{"location_name":"Kantin UB","coordinates":{"latitude":-7.9526,"longitude":112.6144}},"status":"available"}' \
  -F 'photos=@nasi.jpg' \
  -F 'photos=@nasi-2.jpg'
```

Files are written to `uploads/foods/` and renamed to the listing's `food_id`,
then their relative paths are appended to `food_details.photo_urls`:

```json
"photo_urls": ["/uploads/foods/Image_food_8821.png"]
```

- Naming format is `Image_<food_id>.<ext>`, e.g. `food_8821` →
  `Image_food_8821.png`.
- Extra photos for the same listing get a numeric suffix: `Image_food_8821_2.png`,
  `Image_food_8821_3.png`, … (up to 5).
- Characters outside `A-Z a-z 0-9 _ -` in `food_id` are replaced with `_`, so a
  crafted id cannot write outside the uploads folder.
- Uploading again with the same (currently unused) `food_id` overwrites the base
  file name.
- `GET /uploads/foods/<file>` serves the image directly (`express.static`).
- Compose full URLs on the client with `${baseUrl}${photoUrl}`. The stored path
  has no host, so it works on localhost, a LAN IP and a localtunnel URL.
- Failed requests (wrong file type, over 5 MB, invalid listing, duplicate
  `food_id`) delete the just-uploaded files, so no orphans are left behind.
- `uploads/` is git-ignored; only `.gitkeep` is tracked.
- Plain JSON requests and external `photo_urls` keep working exactly as before.
- In Postman: Body → **form-data**, add `data` as text (the JSON), and `photos`
  as **File** (repeat the key for multiple images).

## Postman

Import the collections from the `postman/` folder:

- `Backend-Login.postman_collection.json` — health check + login
  (success, wrong password `401`, missing fields `400`).
- `Backend-Foods.postman_collection.json` — creates, reads, updates and deletes
  food listings, with assertions on HTTP status, response shape, MongoDB
  persistence, validation and error messages. Folder **1b. Photo upload
  (multipart)** uploads `postman/sample-food.png` and verifies the stored name
  (`Image_<food_id>.png`), the served image, duplicate `409`, missing `data`
  `400`, and cleanup.

Set the `baseUrl` collection variable to `http://localhost:3000` (default) or
`http://192.168.1.77:3000` when the API is reached from another machine. Run the
Foods collection from top to bottom: it generates its own test data (`food_test_*`,
`food_pm_upload_*`) and deletes its test documents in the last folder, so it is
safe to re-run.

For the upload folder, the `photos` file field points to
`postman/sample-food.png`. If Postman cannot resolve that bundled relative path,
select the file manually in the request's **Body** tab (form-data row `photos`).
Deleting the test listing does not remove the image from `uploads/foods/` — the
folder's last request asserts this current behavior, so delete the file manually
if you want a clean disk.

## Expose the API with localtunnel

Share the local API with a phone or another machine without deploying:

```bash
npm run tunnel
```

This starts the server exactly like `npm start`, then opens a public
`https://<random>.loca.lt` URL and prints it in the terminal. Keep the terminal
open; `Ctrl+C` stops both the tunnel and the server. An internet connection is
required.

- Use the printed URL as `baseUrl` in Postman or as the API base URL in the app.
- Set `TUNNEL_SUBDOMAIN=my-unique-name` in `.env` to request a fixed subdomain
  (`https://my-unique-name.loca.lt`); it must not already be taken.
- localtunnel may show a password/reminder page when the URL is opened in a
  browser: enter the public IP shown at <https://loca.lt/mytunnelpassword>. API
  clients can send the header `bypass-tunnel-reminder: true` if they receive
  that HTML page instead of JSON.
- The tunnel forwards to the port in `PORT` (default `3000`) and is meant for
  development only, not as a production deployment.

## How to extend

- **Add a route:** create `src/routes/products.js`, export an `express.Router()`,
  then mount it in `src/routes/index.js` with `router.use('/products', productsRouter)`.
- **Add a model:** create `src/models/Product.js` with a Mongoose schema, then use
  it in the route with `await Product.find()` / `await Product.create(...)`.
  Express 5 forwards rejected promises to the error handler automatically.
- **Errors:** call `next(err)` from a route and set `err.status`; the central
  error handler formats the response. Mongoose validation, invalid ObjectIds and
  duplicate keys are already mapped to `400`/`409`.
- **Environment:** all secrets belong in `.env` (already git-ignored). Read them
  with `process.env.KEY`.

## Scripts

| Script        | What it does                                  |
| ------------- | --------------------------------------------- |
| `npm start`   | Run the server once                           |
| `npm run dev` | Run with `node --watch` (restart on changes)  |
| `npm run tunnel` | Start the API and open a public localtunnel URL |
| `npm run seed`| Create the demo users in MongoDB              |
| `npm run seed:foods` | Seed `dummy/food-listings.json` into MongoDB |
