# Backend

Express 5 + MongoDB API for a food-rescue mobile app: users post surplus food,
others find it on a map and contact the contributor to pick it up.

## Requirements

- Node.js 18 or newer (20+ recommended)
- MongoDB running locally on port `27017`

## Quick start

```bash
npm install
cp .env.example .env      # then edit the values
npm run seed              # demo accounts (safe to re-run)
npm run seed:foods        # 10 demo listings around Lowokwaru (safe to re-run)
npm run seed:admin        # promote one account to admin
npm run dev               # http://localhost:3000
```

For a production-style run use `npm start`.

> On Windows PowerShell, if `npm` is blocked by the execution policy, use
> `npm.cmd`, or run `Set-ExecutionPolicy -Scope Process Bypass`.

## Scripts

| Script | What it does |
| ------ | ------------ |
| `npm start` | Run the server once |
| `npm run dev` | Run with `node --watch` |
| `npm run tunnel` | Start the API and expose it through localtunnel |
| `npm run seed` | Create the demo users (idempotent) |
| `npm run seed:foods` | Seed `dummy/food-listings.json` (idempotent) |
| `npm run seed:admin` | Promote `ADMIN_EMAIL` to the admin role |
| `npm run migrate:user-ids` | Backfill `user_id` for users created before it existed |
| `npm run migrate:geo` | Backfill `location.geo` for listings created before it existed |

## Project structure

```
.
├── .env.example           # Sample environment variables
├── dummy                  # Demo payloads used by the seed scripts
├── postman                # API collections
├── uploads                # Uploaded photos (git-ignored, served at /uploads)
└── src
    ├── server.js          # Connects to MongoDB, starts the HTTP server
    ├── app.js             # Express app: middleware + route mounting
    ├── seed.js            # Demo users
    ├── seedFoods.js       # Demo listings (dates shifted to stay current)
    ├── seedAdmin.js       # Promotes one account to admin
    ├── migrateUserIds.js  # Backfill user_id
    ├── migrateGeo.js      # Backfill location.geo
    ├── tunnel.js          # localtunnel helper
    ├── config
    │   ├── db.js          # Mongoose connection helper
    │   └── jwt.js         # Secret, signing and verification in one place
    ├── models
    │   ├── User.js        # Identity, role, contact info
    │   └── FoodItemListing.js
    ├── routes
    │   ├── index.js       # /api info (dev only) and /api/health
    │   ├── auth.js        # POST /register, POST /login
    │   ├── me.js          # GET /me, GET /me/listings
    │   └── foods.js       # Explore, contribute, owner actions, moderation
    ├── middleware
    │   ├── auth.js        # authenticate, optionalAuth, requireRole
    │   ├── upload.js      # multer disk storage for photos
    │   ├── notFound.js
    │   └── errorHandler.js
    └── utils
        └── validation.js  # Shared query/param helpers
```

## Authentication

`POST /api/login` returns a JWT. Send it as `Authorization: Bearer <token>`.

- Tokens are signed with `JWT_SECRET` and live for `JWT_EXPIRES_IN` (default `1d`).
- In production a missing `JWT_SECRET` stops the server at boot instead of failing the first login.
- The user is re-read on every request, so deleting an account invalidates its tokens immediately.

Two roles:

| Role | Can |
| ---- | --- |
| `contributor` (default) | Create listings, change status on **their own** listings, delete them |
| `admin` | Everything above, plus approve/reject any listing |

Nothing grants admin implicitly — promote an account with `npm run seed:admin`.

### Demo accounts

| Email | Password | Role |
| ----- | -------- | ---- |
| `alice@example.com` | `password123` | admin |
| `bob@example.com` | `password123` | contributor |
| `maya@example.com` | `password123` | contributor (`usr_9842a7f1`) |
| `budi@example.com` | `password123` | contributor (`usr_3c1d9e2b`) |

Maya and Budi use fixed `user_id` values because the demo listings in
`dummy/food-listings.json` reference them as `contributor_id`. Without those
accounts the detail screen would have no contact number to show.

## Endpoints

`GET /api` (the endpoint list) only exists outside production.

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| GET | `/api/health` | — | Health check plus database state |
| POST | `/api/register` | — | Create an account (`name`, `email`, `password` ≥ 6) |
| POST | `/api/login` | — | Returns a JWT |
| GET | `/api/me` | Bearer | Current user, role, contact info, derived stats |
| GET | `/api/me/listings` | Bearer | The signed-in user's own listings |
| GET | `/api/foods` | optional | Explore: search, filters, radius, paging |
| GET | `/api/foods/new` | Bearer | Notification poll: what appeared nearby since a cursor |
| GET | `/api/foods/:id` | optional | One listing (`food_id` or ObjectId) plus its contributor |
| POST | `/api/foods` | Bearer | Create a listing (JSON or multipart with photos) |
| PATCH | `/api/foods/:id` | Bearer, owner | Update listing content |
| PATCH | `/api/foods/:id/status` | Bearer, owner | Change the availability mark |
| PATCH | `/api/foods/:id/verify` | Bearer, **admin** | Approve or reject a listing |
| DELETE | `/api/foods/:id` | Bearer, owner | Delete a listing and its photos |

### Listing shape

```jsonc
{
  "food_id": "food_8821",
  "contributor_id": "usr_9842a7f1",   // equals User.user_id
  "created_at": "2026-11-22T09:00:00.000Z",
  "updated_at": "2026-11-22T09:00:00.000Z",
  "verification_status": "pending",   // pending | approved | rejected
  "verification_details": {
    "verified_by_admin_id": null,
    "verified_at": null,
    "rejection_reason": null
  },
  "food_details": {
    "title": "Nasi Kotak Ayam Geprek",
    "description": "",
    "category": "Makanan Berat",
    "dietary_tags": ["Halal"],
    "quantity_portions": 8,
    "quantity_unit": "porsi",          // free string: porsi, kotak, bungkus …
    "expiry_timestamp": "2026-11-23T16:00:00.000Z",
    "photo_urls": ["/uploads/foods/Image_food_8821.jpg"]
  },
  "location": {
    "location_name": "Kantin Pusat Universitas Brawijaya",
    "address_text": "Jl. Veteran, Lowokwaru, Malang",
    "coordinates": { "latitude": -7.9526, "longitude": 112.6144 },
    "pickup_notes": "Datang ke kantin lantai 1.",
    "external_map_url": "https://maps.google.com/?q=-7.9526,112.6144"
  },
  "status": "available"
}
```

`quantity_portions` and `quantity_unit` are display labels only — nothing is
decremented. **`status` is the single source of truth for availability.**

`GET /api/foods/:id` additionally returns a `contributor` block resolved from the
owner account at read time:

```json
"contributor": { "user_id": "usr_9842a7f1", "display_name": "Maya Lin",
                 "avatar_url": "", "phone": "+6281234567890" }
```

It is `null` if the account no longer exists, and never contains an email.
The list endpoints omit it to keep the feed light.

### Status transitions

```
available → reserved | cancelled | expired
reserved  → available | picked_up | cancelled
picked_up → terminal
cancelled → terminal
expired   → available
```

Anything else returns `400`. Sending the current status again is a `200` no-op.

### Explore: `GET /api/foods`

| Query | Default | Notes |
| ----- | ------- | ----- |
| `q` | — | Case-insensitive search over title and description (regex-escaped) |
| `category` | — | Exact match, case-insensitive |
| `status` | all except `cancelled` | Enum value, validated |
| `verification_status` | all except `rejected` | Enum value, validated |
| `contributor_id` | — | Filter by owner |
| `lat`, `lng` | — | Must be sent together |
| `radiusKm` | `5` | Only with `lat`/`lng`, max `100` |
| `page` | `1` | 1-based |
| `limit` | `20` | Max `100` |

Response: `{ count, total, page, limit, hasMore, data }`. With `lat`/`lng`
results come back nearest-first; otherwise newest-first.

### Notifications: `GET /api/foods/new`

```
GET /api/foods/new?lat=-7.9526&lng=112.6144&radiusKm=5&since=2026-11-22T09:00:00.000Z
→ { server_time, count, items: [{ food_id, title, quantity_portions, quantity_unit, created_at }] }
```

Returns only listings that are `available`, not `rejected`, not the caller's own,
inside the radius, created strictly after `since`, and expiring more than
**45 minutes** from now.

- **Omit `since`** to bootstrap: `count` is `0` and you get a `server_time` to
  store. This stops a fresh install notifying about food that was already there.
- **Always use the returned `server_time` as the next `since`.** Using the phone
  clock instead means a skewed device silently replays or skips listings.
- `items` is a preview capped at 20; `count` is the true number of matches.

Notification frequency (cooldown, quiet hours, daily cap) is decided by the
client — it is a local notification, so the app owns that policy.

### Creating a listing

`POST /api/foods` accepts JSON, or `multipart/form-data` with a `data` text field
holding the same JSON plus up to five `photos` files:

```bash
curl -X POST http://localhost:3000/api/foods \
  -H "Authorization: Bearer $TOKEN" \
  -F 'data={"food_details":{"title":"Nasi Box","category":"Makanan Berat","quantity_portions":3,"expiry_timestamp":"2026-12-01T12:00:00Z"},"location":{"location_name":"Kantin UB","coordinates":{"latitude":-7.9526,"longitude":112.6144}}}' \
  -F 'photos=@nasi.jpg'
```

- `contributor_id` is taken from the token; any value in the body is ignored.
- Every new listing starts `status: "available"` and `verification_status: "pending"`.
  Self-approval is not possible.
- `food_id` is optional (`food_<8hex>` when omitted) and unique.
- `location.external_map_url` is derived from the coordinates when omitted.
- Photos: JPEG/PNG/WEBP/GIF, max 5 MB each, max 5 per listing. Stored in
  `uploads/foods/` as `Image_<food_id>.<ext>` and served from `/uploads/...`.
  `photo_urls` are **relative**, so the client prefixes its base URL.
- `DELETE` removes the listing's own photo files from disk.

## Errors

All errors use the same envelope:

```json
{ "error": { "message": "Food listing not found" } }
```

| Status | When |
| ------ | ---- |
| 400 | Validation, bad enum/query value, illegal status transition |
| 401 | Missing, invalid or expired token |
| 403 | Authenticated but not the owner, or not an admin |
| 404 | Unknown route or listing |
| 409 | Duplicate email, `user_id` or `food_id` |
| 500 | Masked as `Internal server error` |

## Upgrading an existing database

Two fields were added after the first version. Run these once against any
database created before them — they are idempotent:

```bash
npm run migrate:user-ids   # users created before user_id existed
npm run migrate:geo        # listings created before location.geo existed
```

Without `migrate:geo`, older listings are invisible to the radius queries.
Without `migrate:user-ids`, a user cannot be matched to their listings.

## Postman

Import both collections from `postman/`:

- `Backend-Auth.postman_collection.json` — health, register, login, `/api/me`
  (10 requests).
- `Backend-Foods.postman_collection.json` — explore, contribute, owner actions,
  moderation and cleanup (30 requests).

Set `baseUrl` (`http://localhost:3000`, or your LAN IP / tunnel URL) and run each
collection **top to bottom**: the Auth collection saves the token, and the Foods
collection creates its own listings and deletes them in the final folder, so it is
safe to re-run. The multipart request bundles `postman/sample-food.png`; if
Postman cannot resolve that relative path, select the file manually on the
`photos` row.

## Tunnel

```bash
npm run tunnel
```

Starts the server and exposes it at a **fixed** public address:

```
https://spoonshare-test-tunnel.loca.lt
```

Because the name is fixed, the mobile app can keep a single base URL instead of
being reconfigured after every restart. Override it with `TUNNEL_SUBDOMAIN` in
`.env` if that name is already taken — the script warns if localtunnel hands back
a different one.

If a browser shows the localtunnel reminder page, API clients can send
`bypass-tunnel-reminder: true`. Development only, not a deployment.

## Deployment notes

- Set `JWT_SECRET` (the server refuses to boot in production without it).
- Point `MONGODB_URI` at your database.
- Uploaded photos live on local disk under `uploads/`. A stateless host needs
  persistent storage or an object store before this can scale.
