# RageMP Server Setup – Step by Step

Do these steps in order. Don’t skip.

---

## PART A: Get the RageMP server files

**Important if you play other servers:**  
The updater puts the server files **inside your normal RageMP folder** (the one you use to play). You must **copy** those server files to a **different folder** and use that for hosting. Then you put your client back to normal so you can keep playing other servers. Steps below do that.

---

**Step 1.** Download the RageMP client from https://rage.mp and run the **updater** so it installs (if you haven’t already).

**Step 2.** Find your **RageMP folder** (the one you use to play – e.g. where `RageMP.exe` or the updater lives). Inside it, open the **config** file (often `config.xml`).

**Step 3.** In that config, find the word **prerelease** and change it to **prerelease_server**. Save the file.

**Step 4.** Run the **updater** again. It will download the server files. When it’s done, a **new folder** appears inside your RageMP folder.  
Its name is: **`server-files`** (with a hyphen).

So the full path looks like:
```
Your RageMP folder\
   server-files\          ← THIS IS WHAT YOU COPY
      ragemp-server.exe   ← must be inside
      packages\
      client_packages\
      ...
```
(There is no `conf.json` here — you get that from the **gamemode** project; see Part D.)

**Step 5.** Copy the **whole `server-files` folder** (don’t move it).

- **From:** `Your RageMP folder\server-files`  
- **To:** a new place. Two ways:
  - **Option A:** Copy so the **contents** of `server-files` end up in your new folder.  
    Example: open `server-files`, select everything inside (ragemp-server.exe, packages, etc.), copy, then paste into a new folder like `C:\ragemp-server`.  
    Then `C:\ragemp-server\ragemp-server.exe` exists. **That folder is your server root.**
  - **Option B:** Copy the **folder** `server-files` itself to e.g. `C:\`. You get `C:\server-files\ragemp-server.exe`. You can rename `C:\server-files` to `C:\ragemp-server`.  
    **Your server root** = the folder that has `ragemp-server.exe` directly inside it (e.g. `C:\ragemp-server`).

For the rest of this guide, “ragemp-server folder” or “server root” = the folder that **contains `ragemp-server.exe`** (and packages, client_packages). The **gamemode** project provides `conf.json`; you copy it into the server folder in Part D.

**Step 6.** Put your RageMP client back to normal so you can play other servers:
- Open the **config** in your **original** RageMP folder again.
- Change **prerelease_server** back to **prerelease**. Save.
- Run the **updater** again. Your client is back to normal for playing.

You’re done with Part A. Use only the **copied** folder (e.g. `C:\ragemp-server`) for the rest of the setup. Don’t use your play folder for hosting.

---

## PART B: Set up the database (PostgreSQL)

**Step 7.** Install PostgreSQL on your PC if you don’t have it. Create a **database** (e.g. name it `ragemp`).

**Step 8.** In your **gamemode** project folder, find the file **`.env.example`** (inside the `gamemode` folder).  
Copy it and rename the copy to **`.env`**.

**Step 9.** Open **`.env`** and fill in your database details:
- `DB_HOST=localhost` (or your DB host)
- `DB_USER=your_postgres_username`
- `DB_PASS=your_postgres_password`
- `DB_DATABASE=ragemp` (or whatever you named the database)

Save the file.

---

## PART C: Build your gamemode

**Step 10.** Open a terminal (PowerShell or CMD). Go to the **gamemode** folder of this project:
```bash
cd C:\Users\Matei\Downloads\gamemode-2\gamemode
```
(Use your real path if it’s different.)

**Step 11.** Install dependencies:
```bash
npm install
```
Wait until it finishes.

**Step 12.** Build everything:
```bash
npm run build:all
```
Wait until it finishes. If you see errors, fix them before going on.

---

## PART D: Put the gamemode into the RageMP server folder

**Step 13.** Your RageMP server folder (the **copy** you made in Part A) must be **next to** the project and named **ragemp-server**.  
So you must have something like:
```
gamemode-2
├── gamemode          ← the project with the code
└── ragemp-server     ← the RageMP server folder from Part A
```

If your RageMP folder is somewhere else or has a different name, either:
- move/rename it so it’s `gamemode-2\ragemp-server`, or  
- after Step 14, manually copy `packages/server` and `client_packages` from `ragemp-server` into your real server folder.

**Step 14.** In the same terminal (still in the `gamemode` folder), run:
```bash
npm run deploy
```
This copies the built gamemode **into** the `ragemp-server` folder.

**Step 15.** Copy your **`.env`** file into the **RageMP server folder** (the same folder where `ragemp-server.exe` is).  
So: copy `gamemode\.env` → into `ragemp-server\.env`.  
The server needs this file in **its** folder to connect to the database.

**Step 15b.** Copy **`conf.json`** from the **gamemode** folder into the **ragemp-server** folder.  
So: copy `gamemode\conf.json` → into `ragemp-server\conf.json`.  
The RageMP server reads name, port, maxplayers, etc. from this file (it does not come with the RageMP server-files download).

---

## PART E: Start the server and play

**Step 16.** Go into the **ragemp-server** folder and double‑click **ragemp-server.exe** (or run it from a terminal).  
The server should start. You should see it say something like “Database connected” if the `.env` is correct.

**Step 17.** Open the **RageMP client**, start GTA V, and connect to:
- Address: **127.0.0.1** (for you, on the same PC as the server)
- Port: **22005** (or whatever port is in `gamemode\conf.json`)

---

## Playing with a friend (someone else from another place)

**127.0.0.1** only means “this computer.” Your friend cannot use 127.0.0.1 — that would point to *their* PC, not yours.

**Port forwarding ("Google method") – do this if you can use your router:**

1. **Config:** In `conf.json` (in both gamemode and ragemp-server), keep `"announce": false` and `"bind": "0.0.0.0"`. If you have `fqdn` or `fastdl-host` (from tunnel setup), **remove those two lines**. Copy `conf.json` to ragemp-server and restart.
2. **Your local IP:** Run `ipconfig` in Command Prompt; note **IPv4 Address** (e.g. 192.168.1.105).
3. **Router:** Log in (e.g. 192.168.1.1 in browser) → Port Forwarding / Virtual Server. Forward to that IP: **22005 UDP**, **22005 TCP**, **22006 TCP**. Save.
4. **Firewall:** Allow ragemp-server.exe when Windows asks.
5. **Public IP:** Open whatismyip.com in the browser; note your public IP (e.g. 85.123.45.67).
6. **Friend:** RageMP → Direct Connect → Address: *your public IP*, Port: **22005**. You use **127.0.0.1:22005**.

---

For a friend to join (detailed):

1. **Let the server accept external connections**  
   In `gamemode\conf.json` (and in `ragemp-server\conf.json` after you copy it) there is **`"bind": "0.0.0.0"`**. That makes the server listen on all interfaces so others can connect. If you removed it, add it back.

2. **Find your public IP**  
   On the PC that runs the server: open a browser and go to e.g. https://whatismyip.com or search “what is my IP”. That’s the address your friend will use (e.g. `85.123.45.67`).

3. **Port forwarding on your router**  
   Forward these ports from the internet to the PC where the server runs:
   - **22005** (game connection)
   - **22006** (resource transfer — the server log says which port it uses)  
   How to do this depends on your router (often “Port forwarding” or “Virtual server” in the admin page). Forward TCP and UDP for both ports to your PC’s local IP (e.g. 192.168.1.100).

4. **Windows Firewall**  
   Allow **ragemp-server.exe** (and optionally the ports 22005, 22006) through the firewall when Windows asks, or add an inbound rule for those ports.

5. **What your friend does**  
   They open RageMP, start GTA V, and connect to:
   - Address: **your public IP** (e.g. `85.123.45.67`)
   - Port: **22005**

You (on the same PC as the server) can keep using **127.0.0.1:22005**.

### Without touching your router (virtual LAN)

If you can’t change router/port forwarding, use a **virtual LAN** so your PC and your friend’s PC act like they’re on the same network. No router setup needed.

1. **Pick a tool** (you and your friend both install the same one):
   - **Radmin VPN** (free): https://www.radmin-vpn.com  
   - **LogMeIn Hamachi** (free for small networks): https://vpn.net  
   - **ZeroTier** (free): https://www.zerotier.com  

2. **Create a network** (in the app) and get the network name/ID. **Invite your friend** to that network so they join it.

3. **Find your virtual IP** in the app (e.g. Radmin shows something like `26.x.x.x`, Hamachi `25.x.x.x`, ZeroTier `10.x.x.x`). That’s the IP you’ll give your friend.

4. **Server and firewall**  
   Keep **`"bind": "0.0.0.0"`** in `conf.json` so the server listens on all adapters (including the virtual one). Allow the server (or ports 22005 / 22006) in Windows Firewall when prompted.

5. **Your friend connects in RageMP** to:
   - Address: **your virtual IP** (from step 3)
   - Port: **22005**

You still use **127.0.0.1:22005** on the PC that runs the server.

### Friend installs nothing (you run a tunnel)

Only **you** install and run a tunnel app; your friend just gets an address and connects in RageMP — **they don’t install anything**.  
**Catch:** many free tunnel services don’t support **UDP** (which RageMP needs), or only allow it on a **paid** plan (e.g. LocalXpose UDP is Pro-only). So free “no install for friend” options are limited.

- **LocalXpose (Pro)**: https://localxpose.io — UDP tunnels work; free tier may not allow UDP. If you have Pro: “To Address” = `localhost:22005`, create tunnel, give your friend the endpoint (e.g. `eu.loclx.io:22005`).
- Otherwise search for “game server UDP tunnel no port forward” and check if the free tier allows UDP.

If you can’t pay and can’t port forward, the **free** option is the virtual LAN below (Radmin VPN / Hamachi / ZeroTier): your friend installs one small app, joins your network, and connects to your virtual IP — no router changes, no cost.

---

## Arena (Hopouts) setup

To create and play arena maps you need **admin level 6** and then use in-game commands.

**1. Make your account admin (first time only)**  
Open your database (e.g. pgAdmin, HeidiSQL) and run (use your real username):

```sql
UPDATE accounts SET adminlevel = 6 WHERE username = 'your_username';
```

Replace `your_username` with the account name you use to log in (lowercase). Restart the server or rejoin so your level is applied. You should see “You are logged in as LEVEL 6 admin!” in chat.

**2. Create an arena location in-game**  
Go to the spot on the map where you want the arena. Then run these commands **in order** (use one short id, e.g. `test1`):

- `/arena_mark test1 center`   (stand where the center is)
- `/arena_mark test1 redspawn`  (red team spawn)
- `/arena_mark test1 bluespawn` (blue team spawn)
- `/arena_mark test1 redcar`    (red team car spawn)
- `/arena_mark test1 bluecar`   (blue team car spawn)

Then save it:

- `/arena_save test1 "My Arena"`   (saves as “My Arena”; you can change the name)

**3. Useful commands**  
- `/arena_locations` or `/hopouts_locations` – list saved arenas  
- `/arena_solo` or `/hopouts_solo` – start a solo test match (no queue)  
- `/arena_solo test1` – start solo on the arena with id `test1`

Arena data is stored in **ragemp-server/data/arenas.json** (created automatically on first save). After changing code, run `npm run deploy` again; your arena file stays in ragemp-server.

**4. Give someone else admin**  
If you are already level 6, you can use: `/setadmin [username] [0-6]` (e.g. `/setadmin friend 6`).

---

## Quick checklist

- [ ] Part A: RageMP server folder with `ragemp-server.exe`
- [ ] Part B: PostgreSQL installed, database created, `gamemode\.env` filled in
- [ ] Part C: `npm install` and `npm run build:all` in `gamemode`
- [ ] Part D: `npm run deploy`, copy `gamemode\.env` and `gamemode\conf.json` to `ragemp-server\`
- [ ] Part E: Run `ragemp-server.exe`, then connect with RageMP client to 127.0.0.1:22005

If something doesn’t work, say which step number and what you see (error message or behavior).
