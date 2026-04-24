# Testing the server on your own

You can run the RAGE:MP server locally and connect with a single client (or multiple clients) to test gamemodes.

## 1. Build and deploy the gamemode

From the **gamemode** folder (`gamemode-2/gamemode`):

```bash
npm run build:all
npm run deploy
```

Or, if you use a custom deploy path, build and copy:

- `packages/server` → your server's `packages/` (e.g. `ragemp-server/packages/pvp/`)
- `client_packages/package2` → your server's `client_packages/package2/`
- Frontend build output → inside `package2` as needed

Ensure `conf.json` in the server folder has `"gamemode": "pvp"` (or whatever folder name you use under `packages/`).

## 2. Run the RAGE:MP server

- Use your **ragemp-server** folder (e.g. `gamemode-2/ragemp-server` or `c:\ArenaServer\ragemp-server`).
- Run **ragemp-server.exe** from the server root (where `conf.json` and `packages/` live).
- If you don’t have the server files, download them via the official RAGE:MP updater and place your gamemode in `packages/<gamemode_name>/`.

## 3. Connect locally

- Start **RAGE:MP** (GTA V + RAGE MP client).
- In the client, connect to: **127.0.0.1:22005** (default port).
- You can test alone with one client; no need for other players.

## 4. Optional: bind to localhost only

In the server `conf.json`:

- `"bind": "127.0.0.1"` — only local connections.
- `"bind": "0.0.0.0"` — allow external connections (e.g. from another PC).

## 5. Testing with ped bots

Use the **/bot** command (admin/dev) to spawn peds near you for target practice or testing:

- `/bot` — spawns one ped in front of you.
- `/bot [count]` — spawns up to 5 peds (e.g. `/bot 3`).

Peds are not invincible and can be shot. They are simple NPCs (no AI); useful for testing combat and damage without a second player.

Requires admin level 1 or higher (or dev level set in the command).
