# RageMP GTA V Server – How to Run

This is a **RageMP** (RAGE:MP) gamemode for GTA V. It uses TypeScript, Webpack, a PostgreSQL database, and a CEF (browser) frontend.

---

## Prerequisites

1. **Node.js** (v18 or v20 LTS recommended)  
   - [Download](https://nodejs.org/)

2. **PostgreSQL**  
   - Install and create a database for the server.  
   - You need: host, port, user, password, database name.

3. **RageMP server files**  
   - From [RageMP](https://rage.mp/) get the **server** package (not the client).  
   - Extract it to a folder, e.g. `ragemp-server`, next to this project (or wherever you want to run the server from).

4. **GTA V**  
   - For testing, you need the game and the RageMP client to connect to your server.

---

## What your server folder should look like

After you get the RageMP server files and run **build + deploy**, your server root folder (e.g. `ragemp-server` or `server-files`) should look **exactly** like this:

```
ragemp-server/                    ← RageMP server root (where you run ragemp-server.exe)
├── .env                          ← Your database config (copy from gamemode/.env)
├── conf.json                     ← Server settings (name, port, maxplayers, etc.)
├── ragemp-server.exe             ← From RageMP updater (starts the server)
├── plugins/                      ← From RageMP (optional .dll plugins)
├── maps/                         ← From RageMP (optional map JSONs)
├── packages/
│   └── server/                   ← From deploy (your gamemode server code)
│       ├── index.js              ← Main entry – required
│       └── ...                   ← Other built .js / .map files
└── client_packages/              ← From deploy (your gamemode client + CEF UI)
    ├── app.js                    ← Main client bundle
    ├── *.bundle.js                ← Webpack chunks (if any)
    └── package2/
        └── dist/                 ← CEF frontend (HTML/JS/CSS)
            ├── index.html
            └── assets/
                └── ...
```

- **From RageMP:** `ragemp-server.exe`, `conf.json`, `plugins/`, `maps/` (updater creates these).
- **From you:** `.env` (copy from `gamemode/.env`).
- **From deploy:** `packages/server/` and `client_packages/` (after `npm run build:all` then `npm run deploy`).

Run **ragemp-server.exe** from inside this folder. The server loads `packages/server/index.js` and serves `client_packages` to players.

---

## 1. Configure the database

In the **gamemode** folder, create a `.env` file (copy from `.env.example` and edit):

```bash
cd gamemode
copy .env.example .env
# Edit .env with your PostgreSQL settings
```

Required variables:

- `DB_HOST` – PostgreSQL host (e.g. `localhost`)
- `DB_USER` – PostgreSQL user
- `DB_PASS` – PostgreSQL password
- `DB_DATABASE` – Database name

Optional:

- `DB_BETA_PASSWORD` – Used if you switch the code to non-beta.
- `DEBUG_MODE` – Set to enable extra debug logging.

---

## 2. Install dependencies and build

From the project root:

```bash
cd gamemode
npm install
npm run build:all
```

This will:

- Build the **server** bundle → `gamemode/packages/server/index.js`
- Build the **client** bundle → `gamemode/client_packages/`
- Build the **CEF frontend** (Vite) into the client packages

---

## 3. Deploy into the RageMP server folder

The deploy script copies the built gamemode into a RageMP server folder named `ragemp-server` **next to** this project (e.g. `gamemode-2/ragemp-server/`).

If your RageMP server is elsewhere, either:

- Put the RageMP server in `gamemode-2/ragemp-server/`, or  
- After running deploy once, copy `ragemp-server/packages/server` and `ragemp-server/client_packages` from there into your real server folder.

Run deploy:

```bash
cd gamemode
npm run deploy
```

This copies:

- `packages/server` → `../ragemp-server/packages/server`
- `client_packages` → `../ragemp-server/client_packages`

---

## 4. RageMP server configuration

In the **RageMP server root** (e.g. `ragemp-server/`), ensure you have a `conf.json`. You can use the one from this repo:

- Copy `gamemode/conf.json` into your RageMP server root, or create one like:

```json
{
  "maxplayers": 100,
  "name": "Your Server Name",
  "gamemode": "pvp",
  "stream-distance": 300.0,
  "announce": false,
  "port": 22005
}
```

- `gamemode` is the **display name** of the mode (can stay `"pvp"`).
- Adjust `name`, `maxplayers`, `port` as needed.

---

## 5. Database config when running the server

The server code loads database settings from a **`.env` file in the current working directory**. When you start the RageMP server, that directory is the **RageMP server folder** (e.g. `ragemp-server/`), not the gamemode folder.

So either:

- **Copy** `gamemode/.env` into your RageMP server root (e.g. `ragemp-server/.env`), or  
- Set the env vars when starting the server (e.g. `DB_HOST=localhost DB_USER=... node ...`), or  
- Keep a `.env` in the RageMP server folder and fill it with the same `DB_*` values.

Without a valid `.env` in the server’s working directory, you’ll get a database connection error.

---

## 6. Start the RageMP server

1. Start your RageMP server executable from the **RageMP server folder** (where `conf.json`, `packages/`, and `client_packages/` are), e.g.:

   - Run `ragemp-server.exe` (or whatever the official server package provides).

2. The server will load `packages/server/index.js` (Node.js) and serve `client_packages` to the client.

3. Connect with the **RageMP client** and GTA V to `127.0.0.1:22005` (or your IP/port).

---

## Quick reference

| Step              | Command / action |
|-------------------|------------------|
| Install deps      | `cd gamemode && npm install` |
| Build everything  | `npm run build:all` |
| Deploy to RageMP  | `npm run deploy` |
| Dev: watch server | `npm run watch:server` |
| Dev: watch client | `npm run watch:client` |
| Dev: both         | `npm run watch:both` |
| Dev: CEF frontend | `npm run watch:cef` |

---

## Troubleshooting

- **“Database connection error”**  
  Check `.env` in `gamemode/`: correct `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_DATABASE`. Ensure PostgreSQL is running and the database exists.

- **Server doesn’t start / no gamemode**  
  Ensure you ran `npm run build:all` and then `npm run deploy`, and that the RageMP server root contains `packages/server/index.js` and `client_packages/`.

- **Port in use**  
  Change `port` in `conf.json` (e.g. to `22006`).

- **CEF / UI not loading**  
  Make sure you ran `build:all` (which includes `build:cef`). For CEF debugging you can set `"allow-cef-debugging": true` in `conf.json` (dev only).

---

## Project layout

- `gamemode/source/server/` – Server-side TypeScript (entry: `index.ts`)
- `gamemode/source/client/` – Client-side TypeScript
- `gamemode/source/shared/` – Shared code
- `gamemode/frontend/` – CEF (Vite/React) UI
- `gamemode/conf.json` – Example RageMP server config
- `gamemode/scripts/deploy.js` – Copies build output to `../ragemp-server/`
