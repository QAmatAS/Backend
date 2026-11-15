# Backend Starter

A minimal Express.js backend starter. Plain JavaScript, no build step, no database —
just a clean structure you can grow into a real project.

## Requirements

- Node.js 18 or newer (Node 20+ recommended)

## Getting started

```bash
npm install
cp .env.example .env   # then edit the values if needed
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
    ├── server.js         # Starts the HTTP server, handles shutdown
    ├── app.js            # Express app: middleware + route mounting
    ├── routes
    │   ├── index.js      # GET /api, GET /api/health
    │   └── users.js      # Example resource (in-memory CRUD)
    └── middleware
        ├── notFound.js   # 404 handler
        └── errorHandler.js # Central error handler
```

## Endpoints

| Method | Path             | Description              |
| ------ | ---------------- | ------------------------ |
| GET    | `/api`           | API info                 |
| GET    | `/api/health`    | Health check             |
| GET    | `/api/users`     | List users               |
| GET    | `/api/users/:id` | Get one user             |
| POST   | `/api/users`     | Create user (`name`, `email`) |
| DELETE | `/api/users/:id` | Delete user              |

### Examples

```bash
curl http://localhost:3000/api/health

curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Charlie","email":"charlie@example.com"}'
```

## How to extend

- **Add a route:** create `src/routes/products.js`, export an `express.Router()`,
  then mount it in `src/routes/index.js` with `router.use('/products', productsRouter)`.
- **Add a database:** replace the in-memory array in `src/routes/users.js`.
  For example, Prisma (`npm i -D prisma && npx prisma init`) or Mongoose for MongoDB.
- **Errors:** call `next(err)` from a route and set `err.status`; the central
  error handler formats the response.
- **Environment:** all secrets belong in `.env` (already git-ignored). Read them
  with `process.env.KEY`.

## Scripts

| Script        | What it does                                  |
| ------------- | --------------------------------------------- |
| `npm start`   | Run the server once                           |
| `npm run dev` | Run with `node --watch` (restart on changes)  |
