# AUDIT: Anti-Cheat, POV Capture & Diagnostics Systems

**Date:** 2026-04-25  
**Scope:** Anti-cheat, POV evidence capture, heartbeat/telemetry, admin diagnostics, and all wrappers/helpers these systems use.  
**Method:** Read-only static analysis of compiled artifacts (no TypeScript source present). Live RAGE:MP wiki verification not performed — items marked **UNVERIFIED AGAINST LIVE DOCS** where applicable.

---

## 1. Critical Findings

---

### AC-C01: Heartbeat is Trivially Bypassable — No Behavioral Challenge

**System:** Anti-Cheat / Heartbeat  
**Files:** `server/index.js` (AdminAntiCheat.service.ts), `client_packages/app.js` (AdminAntiCheat.module.ts)

**Description:**  
The heartbeat challenge is a simple nonce echo. The server sends `client::ac:heartbeat` with a nonce string `${player.id}:${timestamp}:${random}`. The client receives it and immediately calls `mp.trigger("server::ac:heartbeatAck", nonce)` with the same nonce. The server validates that the received nonce matches the pending nonce.

A modified (cheating) client only needs to implement one event listener:
```js
mp.events.add("client::ac:heartbeat", (nonce) => {
    mp.events.callRemote("server::ac:heartbeatAck", nonce);
});
```

This is trivial and indistinguishable from a legitimate client. The heartbeat provides **no proof of unmodified code execution, no behavioral verification, and no client state attestation**.

**Impact:**
- A cheat client passes all heartbeat checks indefinitely.
- The 3-strike kick system provides zero protection against any modified client that implements this one handler.
- The heartbeat's sole practical utility is detecting **disconnected/crashed clients** — it is not an integrity check.

**Exploitation:** Any cheat menu (e.g., FiveM/RAGE-compatible script injection) includes this as a single event handler.

---

### AC-C02: Silent POV Capture Failure — `mp.gui.takeScreenshot()` Unverified — UNVERIFIED AGAINST LIVE DOCS

**System:** POV Capture  
**Files:** `client_packages/app.js` (AdminPovCapture.module.ts)

**Description:**  
The entire POV evidence capture chain begins with:
```js
mp.gui.takeScreenshot(`pov_${requestId}.png`, 1, 80, 0);
await new Promise(r => setTimeout(r, 100));
// then fetch from CEF...
```

`mp.gui.takeScreenshot` is UNVERIFIED AGAINST LIVE DOCS. Its:
- existence in the target RAGE:MP version
- parameter signature (filename, type enum, quality, compression — or some different order)
- return value/error contract

...are all unknown from static analysis alone.

**Failure mode:** If `takeScreenshot` silently fails (wrong API version, wrong parameter types), no PNG is written to disk. The subsequent CEF `fetch("http://screenshots/pov_${requestId}.png")` returns a 404. The fetch `.then()` chain never calls `readAsDataURL`. The `frameChunk` sequence is never sent. The server receives no chunks, times out after 20 seconds, and the frame is silently dropped.

**Critical consequence:** Admin evidence capture appears to work (no error messages, no admin notifications) but produces empty frame buffers. A suspect being captured sees the overlay (350ms blue outline) but no evidence is actually collected. The POV export manifest would show `frameCount: 0` — indistinguishable from a legitimate "capture session started but no frames arrived yet" state.

**There is no error surfacing** from the takeScreenshot call, the CEF fetch, or the chunk timeout to the monitoring admin.

---

### AC-C03: Hot-loader `pl.eval()` — Arbitrary Client Code Execution if Active in Production

**System:** Hot-loader Dev Tool  
**Files:** `ragemp-server/packages/hot-loader/index.js:138`

**Description:**
```js
mp.players.forEach(pl => pl.eval(clientCode));
```

The hot-loader server module iterates all connected players and calls `pl.eval(code)` with arbitrary JavaScript. This executes the provided code in each client's RAGE:MP runtime with full `mp.*` API access.

**Production risk:**
- The `hot-loader` package lives in `ragemp-server/packages/` alongside the production server package.
- If `hot-loader` appears in the RAGE:MP packages load list (in `conf.json` or the packages directory auto-scan), it is active in production.
- Any process with filesystem write access to `hotloader/client/client.js` can execute arbitrary code on every connected player.
- No authentication, no integrity check, no admin command — purely file-system triggered.

**Also:** The server-side `eval(file)` (line 76) executes in the Node.js process — filesystem write → server RCE.

**Verification required:**
1. Check `ragemp-server/conf.json` for `hot-loader` in packages list.
2. Check if RAGE:MP auto-loads all packages in `ragemp-server/packages/`.

---

## 2. High Findings

---

### AC-H01: Entity Overlay APIs Unverified — Overlay Pass Can Get Stuck Enabled — UNVERIFIED AGAINST LIVE DOCS

**System:** POV Capture  
**Files:** `client_packages/app.js` (AdminPovCapture.module.ts)

**Description:**
```js
mp.game.graphics.setEntityOverlayPassEnabled(true);
const batch = mp.game.graphics.createEntityOverlayBatch({ color: 0xff4f7bff, width: 3, depthEnabled: false });
// ... add entities ...
// render for 350ms ...
mp.game.graphics.setEntityOverlayPassEnabled(false);
```

Both `createEntityOverlayBatch` and `setEntityOverlayPassEnabled` are UNVERIFIED AGAINST LIVE DOCS.

**Failure modes:**
1. If `createEntityOverlayBatch` throws (API unavailable), the exception propagates and `setEntityOverlayPassEnabled(false)` is never called. The overlay render pass remains enabled for the rest of the client session — blue outlines on all nearby players indefinitely.
2. If the batch handle is never explicitly freed, GPU batching resources leak per-capture cycle.
3. No try/finally or cleanup guard visible in the compiled code.

**Impact:** Client visual corruption. Repeated capture cycles accumulate leaked batch handles. On long sessions, potential client performance degradation.

---

### AC-H02: Screenshot Base64 Has No Integrity Check — Silent Corruption on Packet Loss

**System:** POV Capture  
**Files:** `server/index.js` (AdminPovCapture.service.ts), `client_packages/app.js`

**Description:**  
The POV capture client splits the base64-encoded PNG into 6000-byte chunks and sends them sequentially:
```
server::admin:pov:frameBegin  { requestId, totalChunks }
server::admin:pov:frameChunk  { requestId, index, data }  × N
server::admin:pov:frameEnd    { requestId }
```

**Issues:**
- No hash/checksum on the full base64 payload. If a single `frameChunk` event is dropped or reordered (RAGE:MP event delivery is not guaranteed to be ordered or reliable under load), the reassembled buffer is corrupt.
- A corrupt base64 string silently produces a corrupt PNG — the manifest records `frameCount: 1` and the file exists but cannot be opened.
- The server has a 20-second total timeout for the chunk sequence. If the timeout fires mid-reassembly, the partial buffer is silently discarded with no notification.
- No frame-level integrity: the server cannot distinguish a successfully reassembled frame from a truncated one without attempting PNG decode.

---

### AC-H03: Evidence Manifest Has No HMAC — Rogue Admin Forgery

**System:** Admin Logging / POV Export  
**Files:** `ragemp-server/data/admin_pov/exports/` (runtime), `server/index.js`

**Description:**  
The evidence export produces:
- `manifest.json` — metadata including trigger type, frame count, video path, combat logs
- `frame_NNNN.png` — raw PNG frames
- `combat_logs.json` — damage and kill log entries

All files are written to a local filesystem directory (`data/admin_pov/`) with no cryptographic signing, no HMAC, and no write-once protection.

**Risk:**
- A rogue admin with server filesystem access can modify `manifest.json` to alter the trigger reason, change `targetId`/`targetName`, reduce `frameCount`, or inject false combat log entries.
- Frame files can be replaced with edited PNGs.
- The admin panel (`admin::getPovEvidenceDetail`) reads manifest files verbatim — it cannot detect tampering.
- Evidence presented from these exports is not forensically sound.

---

### AC-H04: POV RequestId Path Used in CEF Fetch Without Visible Sanitization

**System:** POV Capture  
**Files:** `client_packages/app.js` (AdminPovCapture.module.ts)

**Description:**  
The `requestId` is constructed server-side as `${player.id}_${Date.now()}` and passed to the client via `player.call("client::admin:pov:capture", [requestId])`. The client then uses it in:
```js
fetch(`http://screenshots/pov_${requestId}.png`)
```

**Risk:**
- `player.id` is a RAGE:MP-assigned integer — safe.
- `Date.now()` is server-generated — safe.
- However, if the `requestId` construction changes (e.g., adding player name to the string), and the name contains `../` or URL metacharacters, the fetch URL could traverse the RAGE:MP local resource server's root.
- The RAGE:MP `http://screenshots/` endpoint serves files from the screenshots directory. It is unclear from static analysis whether RAGE:MP's built-in HTTP server applies path traversal protection.
- The current `${player.id}_${timestamp}` pattern is safe. This is a **latent risk** if the requestId format expands to include player-controlled strings.

**Severity elevated to High** because: the POV system is a security-critical feature; any future change to requestId format could silently introduce this issue; and the RAGE:MP local HTTP server's traversal behavior is UNVERIFIED AGAINST LIVE DOCS.

---

## 3. Medium Findings

---

### AC-M01: Combat Logs Lost on Crash/Restart — Evidence Export After Restart Has Empty Logs

**System:** Admin Logging  
**Files:** `server/index.js` (AdminLog.manager.ts)

**Description:**  
Damage logs (5000 max) and kill logs (5000 max) are stored in in-memory circular buffers. On server crash or restart, all log entries are lost.

**Impact:**  
- A POV export triggered after a restart includes an empty `combat_logs.json`.
- An admin reviewing evidence after a crash sees no kill/damage context for the captured frames.
- The circular buffer cap (5000 entries) means active servers may also lose older events even without a restart.

---

### AC-M02: Anti-Cheat Detection Thresholds Hardcoded in Compiled Bundle

**System:** Anti-Cheat  
**Files:** `server/index.js`

**Description:**  
Pattern detection constants are hardcoded:
```
rapid_kill_chain:       3 kills / 15 seconds
high_hit_cadence:       12 hits / 10 seconds / 2+ victims
long_range_hit_streak:  6 hits at >40m / 18 seconds
headshot_streak:        3 headshots / 20 seconds
```

**Impact:**
- Adjusting sensitivity requires a full server redeployment (recompile + restart).
- False-positive thresholds cannot be tuned for different game modes (e.g., sniper-only modes where long-range streak triggers constantly).
- Cheaters who profile the detection can stay just below thresholds indefinitely.

---

### AC-M03: No Admin Alert on Repeated Heartbeat False-Positives

**System:** Heartbeat / Anti-Cheat  
**Files:** `server/index.js`

**Description:**  
When a player accumulates heartbeat strikes due to network lag (not cheating), they are kicked after 3 strikes. The 10-minute strike reset mitigates some false positives, but:
- No admin notification is sent when a player accumulates strikes (only on kick).
- No distinction between "kick due to heartbeat timeout" and "kick due to pattern detection" in any log.
- Admins cannot distinguish network-lag kicks from anti-cheat enforcement kicks in post-session reviews.

---

### AC-M04: `data/admin_pov/` Has No Filesystem Access Control

**System:** POV Capture / Evidence Storage  
**Files:** `ragemp-server/data/admin_pov/` (runtime directory)

**Description:**  
Evidence is written to a local directory. There is no:
- OS-level file permission restriction (depends on server OS config)
- Quota or max-size limit on evidence storage
- Automatic cleanup of old exports

**Impact:**
- Any co-located process or compromised shell account can read, write, or delete evidence.
- No disk space limit: a high-volume capture session (1s interval, many simultaneous targets) could fill the disk.
- Evidence from months ago accumulates indefinitely with no retention policy.

---

### AC-M05: `player.getAdminLevel()` Undefined Behavior Under API Failure

**System:** All Admin Systems  
**Files:** `server/index.js`

**Description:**  
All admin permission gates use:
```js
if (player.getAdminLevel() >= 1) { ... }
```

`player.getAdminLevel()` is UNVERIFIED AGAINST LIVE DOCS — it is not in the standard RAGE:MP Player API.

**Failure modes:**
- If this is a custom method that fails to be registered (server startup error, extension unloaded), `player.getAdminLevel` is `undefined`. Calling `undefined()` throws `TypeError`, which propagates up the event handler — **all admin commands throw on every invocation**.
- If it returns `undefined` (method exists but not yet initialized), `undefined >= 1` evaluates to `false` — all admin commands silently denied for all players.
- Neither failure mode produces a clear diagnostic — server logs a JS exception trace, admins see commands as "not responding."

---

## 4. Trust-Boundary Findings

---

### TB-01: Client Reports Bone Hit — Headshot Detection Trusts Client

**System:** Anti-Cheat (headshot_streak pattern)  
**Files:** `server/index.js`, `client_packages/app.js`

**Description:**  
The client's damage sync module reports hit bone to the server as part of the `server:PlayerHit` event payload. The server's anti-cheat `headshot_streak` counter increments when the bone is reported as a headshot.

**Trust issue:** The client controls the bone field. A cheating client can:
- Report all hits as non-headshots (evade headshot_streak detection even while aimbotting).
- Report all hits as headshots when using any weapon (inflate headshot stats without triggering suspicion since the server may apply headshot multipliers only for valid weapon types).

The server does not cross-validate bone against weapon type, shooter angle, or target geometry.

---

### TB-02: Heartbeat ACK Trust — Nonce Equality Check Only, No Signing

**System:** Heartbeat / Anti-Cheat  
**Files:** `server/index.js`, `client_packages/app.js`

**Description:**  
The heartbeat validation is:
```js
if (receivedNonce === this.pendingNonce) { clearTimeout(timer); }
```

The nonce is a plain string. A modified client that intercepts the `client::ac:heartbeat` event and echoes the nonce passes this check identically to a legitimate client. There is no HMAC, no computation requirement, no timing proof, no memory attestation.

**Trust boundary:** The heartbeat event flows `Server → Client → Server`. There is zero trust asymmetry: the client-side code is visible to any player who opens DevTools (which is enabled in the production config — see TB-04).

---

### TB-03: CEF `http://screenshots/` Endpoint — Scope of Served Files Unverified

**System:** POV Capture  
**Files:** `client_packages/app.js`

**Description:**  
The client uses:
```js
fetch("http://screenshots/pov_{requestId}.png")
```

This hits RAGE:MP's built-in local resource HTTP server. The scope of this server — whether it restricts file serving to the screenshots directory only — is UNVERIFIED AGAINST LIVE DOCS.

**Trust issue:** If the local HTTP server serves files from a broader path scope, a crafted `requestId` could cause the CEF context to fetch and base64-encode arbitrary files from the server filesystem, which are then transmitted to the server via the chunk upload mechanism.

Current `requestId` format (`${integer}_${timestamp}`) is safe. This is a latent trust-boundary issue that activates if requestId is ever expanded to include player-controlled strings.

---

### TB-04: CEF DevTools Enabled — Client-Side JS Fully Inspectable and Mutable

**System:** All CEF-adjacent systems  
**Files:** `ragemp-server/conf.json`

**Description:**
```json
"allow-cef-debugging": true
```

This is set in the production server config. Any player can:
1. Open Chromium DevTools in-game.
2. Inspect and modify all MobX store state (adminLevel, match state, loadouts).
3. Trigger CEF → client events manually: `mp.trigger("server::admin:pov:base64", ...)`.
4. Observe all `client::ac:heartbeat` events and their nonce values in the network/console panel.
5. Modify the anti-cheat heartbeat handler in-memory to log and replay nonces.

**Combined with TB-02:** DevTools makes the heartbeat bypass trivial to implement at runtime without any client modification — pure browser console scripting.

---

## 5. RAGE:MP API / Doc Verification Notes

| API | Used In | Verification Status | Risk if Wrong |
|-----|---------|--------------------|----|
| `mp.gui.takeScreenshot(filename, type, quality, compression)` | POV capture | **UNVERIFIED AGAINST LIVE DOCS** | Silent evidence capture failure |
| `mp.game.graphics.createEntityOverlayBatch({color, width, depthEnabled})` | POV overlay | **UNVERIFIED AGAINST LIVE DOCS** | Client exception, overlay stuck enabled |
| `mp.game.graphics.setEntityOverlayPassEnabled(bool)` | POV overlay | **UNVERIFIED AGAINST LIVE DOCS** | Overlay stuck enabled permanently |
| `mp.players.reloadResources()` | Admin reload command | **UNVERIFIED AGAINST LIVE DOCS** — @ts-ignore | Silent failure or exception on admin reload |
| `player.getAdminLevel()` | All admin permission gates | **UNVERIFIED AGAINST LIVE DOCS** | All admin commands throw or silently deny |
| `player.callProc(event, args)` | Weapon preset loading, vehicle model lookup | **UNVERIFIED AGAINST LIVE DOCS** | Unresolved Promise leaks, server state corruption |
| `player.showNotify(msg)` | Admin alerts, system messages | **UNVERIFIED AGAINST LIVE DOCS** | Silent notification failure |
| `pl.eval(code)` (hot-loader) | Dev tool — client code reload | Confirmed pattern — risk is production presence | Full client RCE |
| `http://screenshots/` CEF endpoint | POV capture — base64 encode | **UNVERIFIED AGAINST LIVE DOCS** — path scope unknown | Latent path traversal |
| Bone IDs `31086`, `24818` in `getBoneCoords()` | Hit detection | Unverified against GTA V native DB | Wrong bone positions, broken headshot detection |

---

## 6. Runtime Test Checklist — Anti-Cheat / POV / Diagnostics Only

### Heartbeat / Anti-Cheat
- [ ] Connect a test client. Observe `client::ac:heartbeat` firing every 45 seconds in DevTools console.
- [ ] Block client network for 8 seconds. Confirm server increments strike counter in server logs.
- [ ] Repeat 3 times within 10 minutes. Confirm `player.kick()` fires on 3rd strike.
- [ ] After kick, reconnect. Verify strike counter is reset (new session).
- [ ] Wait 10 minutes after 1 strike without additional timeouts. Confirm strike counter resets.
- [ ] Implement a minimal nonce-echo script in DevTools console. Confirm it passes heartbeat indefinitely (validates AC-C01).
- [ ] Trigger `rapid_kill_chain` (3 kills in <15s in arena). Confirm `triggerAutomaticEvidenceExport()` fires.
- [ ] Trigger `headshot_streak` (3 headshots in <20s). Confirm auto POV export with reason code 20.
- [ ] Trigger `high_hit_cadence` (12+ hits on 2 targets in <10s). Confirm flag fires.
- [ ] Trigger `long_range_hit_streak` (6 hits at >40m in <18s). Confirm flag fires.
- [ ] Confirm detection cooldown: fire same flag type twice within 30 seconds. Second should not double-trigger export.

### POV Capture
- [ ] Run `/povwatch [targetId] 1` (1-second interval). Confirm no server error.
- [ ] Wait 5 seconds. Run `/povdump [targetId]`. Verify `data/admin_pov/exports/` folder created.
- [ ] Verify `manifest.json` contains correct targetId, targetName, intervalSec.
- [ ] Verify `frame_0001.png` through `frame_000N.png` exist and are valid PNG files (open in image viewer).
- [ ] Verify `combat_logs.json` exists and contains damage/kill entries from the session.
- [ ] If ffmpeg is installed: verify `evidence.mp4` is present and playable.
- [ ] If ffmpeg is NOT installed: verify `manifest.json` records `video: { ok: false }` without crashing.
- [ ] Run `/povwatch [targetId] 1`, then immediately restart server. Recheck: no orphaned session, no partial frame files.
- [ ] Test requestId with `../` prefix: call `client::admin:pov:capture` manually with requestId `../etc/passwd_1234`. Verify fetch returns 404 or sanitization prevents traversal.
- [ ] Test POV capture of offline player (invalid targetId). Confirm graceful error, no server exception.
- [ ] Run `/povstop [targetId]`. Confirm capture stops. Buffer retained.
- [ ] Run `/povclear [targetId]`. Confirm session destroyed, buffer cleared.
- [ ] Verify admin notification fires to online staff when auto-export triggers.
- [ ] Open admin CEF panel → Evidence tab. Verify `admin::getPovEvidenceList` returns the export folder.
- [ ] Click evidence entry. Verify `admin::getPovEvidenceDetail` returns manifest, frame count, combat logs.

### Diagnostics / Logging
- [ ] Execute an admin command (e.g., `/kick [id] test`). Verify command appears in audit trail.
- [ ] Restart server. Verify audit trail is empty (confirms in-memory only — documents AC-M01 baseline).
- [ ] Run 6000 damage events. Verify damage log caps at 5000 (circular buffer).
- [ ] Verify `player.getAdminLevel()` returns correct integer for admin and non-admin accounts.
- [ ] Remove admin status from a player mid-session. Verify `getAdminLevel()` returns 0 immediately on next command attempt.

### Hot-loader Production Check
- [ ] Check `ragemp-server/conf.json` — confirm `hot-loader` is absent from packages list.
- [ ] Check `ragemp-server/packages/` directory — confirm hot-loader package is not auto-loaded.
- [ ] If hot-loader IS active: `pl.eval("mp.gui.chat.push('RCE_TEST')")` — if chat message appears on all clients, RCE is confirmed active (AC-C03).

### CEF Debugging
- [ ] Open a game client and attempt to open Chromium DevTools (F12 or RAGE:MP dev shortcut).
- [ ] If DevTools opens: confirm `allow-cef-debugging` is `true` in conf.json — documents TB-04.
- [ ] In DevTools console: observe `client::ac:heartbeat` events in network panel to confirm nonce visibility (validates TB-02).
