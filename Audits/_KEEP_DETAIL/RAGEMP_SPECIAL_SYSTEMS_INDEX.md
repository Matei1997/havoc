# RAGE:MP Special Systems Index

**Date:** 2026-04-25  
**Scope:** Inventory of all files, systems, and RAGE:MP APIs involved in anti-cheat, POV capture, evidence management, telemetry/heartbeat, admin diagnostics, and custom API wrappers.  
**Method:** Read-only static analysis of compiled artifacts. No code modifications.

---

## Systems Overview

| # | System | Files | Primary RAGE:MP APIs | Risk Priority |
|---|--------|-------|---------------------|---------------|
| 1 | Anti-Cheat (AdminAntiCheat) | server/index.js, client app.js | `player.call()`, `player.kick()`, `mp.events.add()` | HIGH |
| 2 | POV Capture (AdminPovCapture) | server/index.js, client app.js | `mp.gui.takeScreenshot()`, `mp.game.graphics.*`, `player.call()` | HIGH |
| 3 | Admin Logging (AdminLog + AdminAudit) | server/index.js | `mp.events.add()`, `player.getAdminLevel()` | MEDIUM |
| 4 | Heartbeat / Telemetry | server/index.js, client app.js | `player.call()`, `player.kick()`, `mp.events.add()` | HIGH |
| 5 | Hot-loader (Dev Tool) | packages/hot-loader/index.js, hotloader/client/client.js | `pl.eval()`, `mp.events.*`, `mp.game.*` | CRITICAL (if in prod) |

---

## System 1: Anti-Cheat (AdminAntiCheat)

### Files Involved
| File | Role |
|------|------|
| `ragemp-server/packages/server/index.js` | Compiled server bundle — contains AdminAntiCheat.service.ts logic |
| `ragemp-server/client_packages/app.js` | Compiled client bundle — contains AdminAntiCheat.module.ts logic |

Original source references visible in compiled comments:
- `./source/server/admin/AdminAntiCheat.service.ts`
- `./source/client/modules/AdminAntiCheat.module.ts`

### Main Entrypoints
| Entrypoint | Side | Description |
|------------|------|-------------|
| `processHeartbeat(player)` | Server | Sends a timestamped nonce challenge to client via `player.call("client::ac:heartbeat", [nonce])` |
| `evaluatePlayer(player)` | Server | Runs every 3 seconds; scans damage/kill logs for suspicious patterns; triggers POV export on flag |
| `client::ac:heartbeat` event handler | Client | Receives nonce, immediately sends back `server::ac:heartbeatAck` with same nonce |
| `server::ac:heartbeatAck` event handler | Server | Validates received nonce matches pending challenge; clears strike timer |

### Behavioral Logic
- **Heartbeat cycle:** Every 45 seconds, server sends `client::ac:heartbeat` with nonce `${player.id}:${Date.now()}:${Math.random()}`.
- **ACK timeout:** 7 seconds. If no ACK within 7s → strike increment.
- **Strike threshold:** 3 strikes → `player.kick()`. Strike counter resets after 10 minutes of clean ACKs.
- **Pattern detection (in `evaluatePlayer`):**
  - `rapid_kill_chain`: 3+ kills within 15 seconds → flag
  - `high_hit_cadence`: 12+ hits across 2+ victims within 10 seconds → flag
  - `long_range_hit_streak`: 6+ hits at distance >40m within 18 seconds → flag
  - `headshot_streak`: 3+ headshots within 20 seconds (reason code 20) → flag
- **On flag:** calls `triggerAutomaticEvidenceExport()` which initiates AdminPovCapture export.

### RAGE:MP APIs Used
| API | Notes |
|-----|-------|
| `player.call("client::ac:heartbeat", [nonce])` | Standard RPC |
| `player.kick(reason)` | Standard enforcement |
| `mp.events.add("server::ac:heartbeatAck", handler)` | Standard event registration |
| `mp.events.add("playerQuit", handler)` | Cleanup on disconnect |

### Highest-Risk Files to Verify Next
- Server anti-cheat section in `server/index.js` — nonce generation, strike logic, pattern thresholds
- Client `app.js` — heartbeat ACK handler (trivial echo pattern)

---

## System 2: POV Capture (AdminPovCapture)

### Files Involved
| File | Role |
|------|------|
| `ragemp-server/packages/server/index.js` | Server-side session management, frame reassembly, disk export |
| `ragemp-server/client_packages/app.js` | Client-side screenshot capture, CEF base64 encoding, chunked RPC upload |
| `ragemp-server/data/admin_pov/` | Export storage directory (runtime, not in backup) |

Original source references:
- `./source/server/admin/AdminPovCapture.service.ts`
- `./source/client/modules/AdminPovCapture.module.ts`

### Main Entrypoints
| Entrypoint | Side | Description |
|------------|------|-------------|
| `/povwatch [playerId] [intervalSec]` | Server command | Starts continuous capture session for target player |
| `/povdump [playerId]` | Server command | Exports current ring-buffer to disk |
| `/povstop [playerId]` | Server command | Stops capture, retains buffer |
| `/povclear [playerId]` | Server command | Destroys session entirely |
| `requestCapture(session)` | Server | Sends `client::admin:pov:capture` with requestId |
| `client::admin:pov:capture` handler | Client | Orchestrates screenshot → CEF encode → chunk upload |
| `server::admin:pov:frameBegin/Chunk/End` handlers | Server | Reassemble chunks into complete frame buffer |
| `triggerAutomaticEvidenceExport()` | Server | Called by anti-cheat on flag; auto-runs `/povdump` |

### Data Flow (Complete)
```
[Server] requestCapture(session)
    → player.call("client::admin:pov:capture", [requestId])

[Client] receives "client::admin:pov:capture"
    → wait 40ms (overlay render delay)
    → mp.gui.takeScreenshot(`pov_${requestId}.png`, 1, 80, 0)
    → wait 100ms
    → encodeInCef():
        browser.execute(`
          fetch("http://screenshots/pov_${requestId}.png")
            .then(r => r.blob())
            .then(b => FileReader.readAsDataURL(b))
            .then(base64 => mp.trigger("client::admin:pov:base64", base64))
        `)

[Client] receives "client::admin:pov:base64"
    → split base64 string into 6000-byte chunks
    → send: server::admin:pov:frameBegin  { requestId, totalChunks }
    → send: server::admin:pov:frameChunk  { requestId, index, data } × N
    → send: server::admin:pov:frameEnd    { requestId }

[Server] reassembles chunks within 20s timeout
    → stores frame: { capturedAt, name, mimeType, buffer }
    → ring buffer: max age 120 seconds

[Server] on /povdump or auto-trigger:
    → mkdir data/admin_pov/exports/{timestamp}_{id}_{name}/frames/
    → write frame_0001.png ... frame_NNNN.png
    → write manifest.json
    → write combat_logs.json
    → spawn ffmpeg (if available): -i frame_%04d.png → evidence.mp4
```

### Session Object Structure
```js
{
  targetId:       number,
  targetName:     string,
  intervalSec:    number,   // 1–10
  maxAgeMs:       120000,   // ring buffer max age
  frames:         Array<{ capturedAt, name, mimeType, buffer }>,
  requestTimer:   setInterval handle,
  autoPrimed:     boolean,
  lastCombatSeenAt: number
}
```

### RAGE:MP APIs Used
| API | Status | Notes |
|-----|--------|-------|
| `player.call("client::admin:pov:capture", [requestId])` | Standard | Normal RPC |
| `mp.gui.takeScreenshot(filename, type, quality, compression)` | **UNVERIFIED** | Core capture; silent failure risk |
| `mp.game.graphics.createEntityOverlayBatch({color, width, depthEnabled})` | **UNVERIFIED** | Overlay batch; experimental |
| `mp.game.graphics.setEntityOverlayPassEnabled(bool)` | **UNVERIFIED** | Overlay toggle; no try/catch |
| `mp.events.add("server::admin:pov:frameBegin/Chunk/End", ...)` | Standard | Chunk reassembly events |
| CEF `fetch("http://screenshots/...")` | Custom | RAGE:MP local resource server |

### Overlay Behavior
- During capture: creates entity overlay batch with blue outline (`0xff4f7bff`, 3px wide, depth disabled)
- All players within 250m added to overlay batch
- Overlay rendered for 350ms, then disabled
- Intended as visual signal that capture is active

### Export Directory Structure
```
data/admin_pov/exports/
  {ISO-timestamp}_{playerId}_{playerName}/
    frames/
      frame_0001.png
      frame_0002.png
      ...
    manifest.json      ← { generatedAt, targetId, targetName, frameCount, intervalSec, trigger, requestedBy, video }
    combat_logs.json   ← { damageLogs: [...], killLogs: [...] }
    evidence.mp4       ← optional, if ffmpeg available
```

### CEF Admin Panel Handlers
| Event | Description |
|-------|-------------|
| `admin::getPovEvidenceList` | Returns list of all export folders with metadata |
| `admin::getPovEvidenceDetail` | Returns full manifest + combat logs for specific export |

**Access gate:** `player.getAdminLevel() >= 1` (staff check) on all POV commands and CEF handlers.

### Highest-Risk Files to Verify Next
- `mp.gui.takeScreenshot` call site in client `app.js` — no error handling visible
- Entity overlay creation/cleanup pattern — no finally block
- `requestId` path construction and CEF fetch URL — path traversal risk
- Chunk reassembly timeout logic — frame corruption on connection loss

---

## System 3: Admin Logging (AdminLog + AdminAudit)

### Files Involved
| File | Role |
|------|------|
| `ragemp-server/packages/server/index.js` | All logging logic (compiled from AdminLog.manager.ts, AdminAudit.service.ts) |

Original source references:
- `./source/server/admin/AdminLog.manager.ts`
- `./source/server/admin/AdminAudit.service.ts`

### Main Entrypoints
| Function | Description |
|----------|-------------|
| `logDamageHit(data)` | Records a damage event to in-memory damage log |
| `logKill(data)` | Records a kill event to in-memory kill log |
| Command audit trail | All admin commands (adminlevel >= 1) logged with actor, payload, result |

### Data Structures

**Damage log entry:**
```js
{
  timestamp,
  attackerId,   attackerName,
  victimId,     victimName,
  weaponHash,
  damage,
  distance,
  inArena
}
```

**Kill log entry:**
```js
{
  timestamp,
  killerId,   killerName,
  victimId,   victimName,
  reason,
  inArena
}
```

**Audit entry:**
```js
{
  actorId,    actorName,
  action:    "EXECUTE_COMMAND",
  payload:   { command: "full command text" },
  result:    "success" | "failure"
}
```

### Storage
| Log | Max Entries | Storage | Persistence |
|-----|-------------|---------|-------------|
| Damage log | 5000 | In-memory circular buffer | **Lost on restart** |
| Kill log | 5000 | In-memory circular buffer | **Lost on restart** |
| Command audit | 2000 | In-memory only | **Lost on restart** |

### RAGE:MP APIs Used
| API | Notes |
|-----|-------|
| `mp.events.add("playerDamage", ...)` | Populates damage log |
| `mp.events.add("playerDeath", ...)` | Populates kill log |
| `player.getAdminLevel()` | Admin command gate (UNVERIFIED API) |

### CEF Admin Panel Handlers
| Event | Description |
|-------|-------------|
| `admin::getPovEvidenceList` | Evidence folder listing |
| `admin::getPovEvidenceDetail` | Evidence manifest + combat logs |

### Highest-Risk Files to Verify Next
- Audit log persistence — currently all in-memory, lost on crash
- Command audit coverage — verify all privileged commands are actually logged

---

## System 4: Heartbeat / Telemetry

### Files Involved
- Same as System 1 (AdminAntiCheat) — heartbeat is embedded within the anti-cheat service.

### Constants
| Constant | Value | Meaning |
|----------|-------|---------|
| `HEARTBEAT_INTERVAL_MS` | 45,000 ms | Challenge sent every 45 seconds |
| `HEARTBEAT_TIMEOUT_MS` | 7,000 ms | ACK must arrive within 7 seconds |
| `HEARTBEAT_STRIKE_RESET_MS` | 600,000 ms | Strike counter resets after 10 clean minutes |
| `HEARTBEAT_MAX_STRIKES` | 3 | Kick threshold |

### Heartbeat State (per player)
```js
{
  lastPingAt:    timestamp,
  pendingNonce:  string,        // "${playerId}:${timestamp}:${random}"
  pendingSince:  timestamp,
  strikes:       number,
  lastStrikeAt:  timestamp,
  lastAckAt:     timestamp
}
```

### Flow Summary
```
Server (every 45s):  player.call("client::ac:heartbeat", [nonce])
Client (on receipt): mp.trigger("server::ac:heartbeatAck", nonce)   ← trivial echo
Server (on ACK):     validate nonce == pendingNonce → clear timer
Server (on timeout): strikes++ → if strikes >= 3: player.kick()
```

### Key Risk
The client-side implementation is a **trivial nonce echo** — no behavioral challenge, no client-side computation, no proof of unmodified code execution. A modified client that simply listens and re-emits the nonce will pass all heartbeat checks indefinitely.

---

## System 5: Hot-loader (Dev Tool)

### Files Involved
| File | Role |
|------|------|
| `ragemp-server/packages/hot-loader/index.js` | Server-side hot-reload module |
| `ragemp-server/hotloader/client/client.js` | Client-side hot-reload script (also contains hit detection dev code) |

### Main Entrypoints
| Function | Description |
|----------|-------------|
| File watcher | Monitors source directory for changes |
| Server eval (line 76) | `eval(file)` — re-evaluates changed server scripts |
| Client eval (line 138) | `pl.eval(clientCode)` — pushes changed client code to all players |
| Scoped eval (line 165) | `new Function('mp', code)(mp)` — isolated scope variant |

### RAGE:MP APIs Used
| API | Notes |
|-----|-------|
| `pl.eval(code)` | Sends arbitrary JS to player client for execution — **critical risk if in prod** |
| `mp.events.add(...)` | Dev event registration |
| `mp.game.joaat()` | Weapon/ped hash generation (in client hit detection script) |
| `mp.game.weapon.getWeapontypeGroup()` | Weapon classification |
| `mp.game.system.vdist()` | Distance calculation |
| `mp.game.graphics.world3dToScreen2d()` | Damage number positioning |
| `mp.peds.new()` | Test ped spawning |
| `mp.gui.chat.push()` | Dev logging to game chat |

### Hit Detection Dev Script (hotloader/client/client.js)
The hot-loader client includes a complete hit detection implementation used during development:
- Registers `mp.Event("incomingDamage", ...)` handler
- Calculates head/torso bone distances to bullet trajectory
- Reports bone hits back to server via `mp.events.call()`
- **This code runs on the dev client, not production** — but may share logic with the production client bundle.

### Production Risk Assessment
If `hot-loader` appears in `ragemp-server/conf.json` under the `packages` list, it is **active in production** and represents:
- Full server-side RCE via filesystem write + module reload
- Full client-side RCE (`pl.eval()`) on all connected players
- No authentication or integrity checks on reloaded code

**Verification required:** Check `ragemp-server/conf.json` `packages` array for `hot-loader` inclusion.

---

## Custom Wrappers and Bridging Systems

### CefEvent Class
**Location:** `ragemp-server/packages/server/index.js` (~line 4095–4130)  
**Purpose:** Wraps `player.call("client::eventManager", ...)` with a structured event routing layer.  
**Methods:**
- `emit(page, pointer, ...args)` — sends formatted event `cef::{page}:{pointer}` to client eventManager
- `emitAsync(page, pointer, ...args)` — Promise-based variant

**RAGE:MP dependency:** `player.call()` — standard.  
**Risk:** If `client::eventManager` event handler in the client bundle is removed or renamed, all CEF UI interactions silently stop working.

### NativeMenu Class
**Location:** `ragemp-server/packages/server/index.js` (~line 4318–4404)  
**Purpose:** Custom GTA-style in-world menu. Attached to `player.nativemenu`.  
**Methods:** `closeMenu()`, `onItemSelected(handler)`  
**RAGE:MP dependency:** `mp.colshapes.newSphere()` for interaction zones.  
**Risk:** Custom property on player object — must be initialized before any menu command runs.

### DynamicPointPool
**Location:** `ragemp-server/packages/server/index.js` (~line 4435–4568)  
**Purpose:** Manages a pool of 3D interaction points using collision spheres and 3D labels.  
**RAGE:MP dependencies:** `mp.colshapes.newSphere()`, `mp.labels.new()`, `mp.colshapes.exists()`  
**Risk:** Geometry-dependent; world-space points must be within server-configured dimension and world bounds.

---

## Cross-System Dependencies

```
Anti-Cheat flag
    └─→ triggerAutomaticEvidenceExport()
            └─→ AdminPovCapture.exportPov()
                    └─→ writes to data/admin_pov/exports/
                    └─→ spawns ffmpeg (if available)
                    └─→ notifies online admins via player.showNotify()

AdminPovCapture.requestCapture()
    └─→ player.call("client::admin:pov:capture")
            └─→ mp.gui.takeScreenshot()         ← UNVERIFIED API
            └─→ mp.game.graphics.*Overlay*()    ← UNVERIFIED APIs
            └─→ CEF fetch("http://screenshots/")
            └─→ chunked server::admin:pov:frame* events
```

---

## Files Requiring Deepest Verification

1. **`ragemp-server/packages/server/index.js`** — Anti-cheat pattern detection, POV session management, frame reassembly, admin logging, permission gates via `getAdminLevel()`
2. **`ragemp-server/client_packages/app.js`** — POV capture client module (screenshot + overlay + chunk upload), heartbeat echo handler
3. **`ragemp-server/packages/hot-loader/index.js`** — eval chain; verify production exclusion
4. **`ragemp-server/conf.json`** — Verify `allow-cef-debugging: false` and hot-loader absent from packages list
