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
└── src
    ├── server.js         # Connects to MongoDB, starts the HTTP server
    ├── app.js            # Express app: middleware + route mounting
    ├── seed.js           # Creates the demo users (idempotent)
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
- The server refuses to start if MongoDB is unreachable, and reports the database
  state in `GET /api/health`.

Run `npm run seed` once to create the demo accounts. It uses upserts, so running
it again will not duplicate users or reset their passwords.

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
| POST   | `/api/foods`     | Save a new food listing (see below)  |
| PATCH  | `/api/foods/:id` | Update `status`, verification or listing content |
| DELETE | `/api/foods/:id` | Delete a food listing                |

### Demo accounts

| Email               | Password      |
| ------------------- | ------------- |
| `alice@example.com` | `password123` |
| `bob@example.com`   | `password123` |

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

## Postman

Import the collections from the `postman/` folder:

- `Backend-Login.postman_collection.json` — health check + login
  (success, wrong password `401`, missing fields `400`).
- `Backend-Foods.postman_collection.json` — creates, reads, updates and deletes
  food listings, with assertions on HTTP status, response shape, MongoDB
  persistence, validation and error messages.

Set the `baseUrl` collection variable to `http://localhost:3000` (default) or
`http://192.168.1.77:3000` when the API is reached from another machine. Run the
Foods collection from top to bottom: it generates its own test data (`food_test_*`)
and deletes both test documents in the last folder, so it is safe to re-run.

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
| `npm run seed`| Create the demo users in MongoDB              |
