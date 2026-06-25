# Upgrade to PostgreSQL (QTS_Startup v1.2.0)

## Database change

v1.2.0 replaces SQLite with PostgreSQL. All API routes, extension workflows, and QTS_Startup features work the same.

## Fresh install

1. Set `DATABASE_URL` in `server/.env` (see `server/.env.example`).
2. Start PostgreSQL (`docker compose up -d postgres` or use a cloud database).
3. Run `npm start` in `server/` — tables are created automatically.

## Migrate existing SQLite data

1. Keep your old `server/data/jobs.db` file.
2. Configure `DATABASE_URL` in `server/.env`.
3. Start the server once to create PostgreSQL tables.
4. Run:

```bat
cd server
npm run migrate:sqlite
```

## Cloud deployment

Set these environment variables on your host (Railway, Render, Fly.io, VPS, etc.):

- `DATABASE_URL` — PostgreSQL connection string from your provider
- `DATABASE_SSL=true` — for most managed databases
- `JWT_SECRET` — long random secret
- `HOST=0.0.0.0`
- `AUTO_OPEN_BROWSER=false`

Deploy with Docker:

```bat
docker compose up -d
```

Or build the server image only:

```bat
docker build -t qts-startup-server ./server
```

## Windows .exe

The packaged `QTS_Startup.exe` still runs the API server, but it now requires a PostgreSQL instance. Set `DATABASE_URL` in a `.env` file next to the executable.
