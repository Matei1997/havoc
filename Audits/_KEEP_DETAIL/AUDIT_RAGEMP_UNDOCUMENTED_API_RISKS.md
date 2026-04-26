# AUDIT: RAGE:MP Undocumented / Suspicious API Usage

**Date:** 2026-04-25  
**Scope:** All @ts-ignore suppressions, direct mp.game.* native wrappers, undocumented-looking APIs, experimental overlay/raycast/graphics calls, and custom prototype extensions tightly coupled to RAGE:MP behavior.  
**Codebase state:** Compiled webpack bundles only — no original TypeScript source present. Live wiki verification was not performed; items requiring verification are marked **UNVERIFIED AGAINST LIVE DOCS**.

---

## Risk Summary Table

| ID | API | File | Risk | Status |
|----|-----|------|------|--------|
| U01 | `mp.players.reloadResources()` | server/index.js:6673 | HIGH | UNVERIFIED AGAINST LIVE DOCS |
| U02 | `mp.gui.takeScreenshot(filename, type, quality, compression)` | client app.js (AdminPovCapture) | HIGH | UNVERIFIED AGAINST LIVE DOCS |
| U03 | `mp.game.graphics.createEntityOverlayBatch()` | client app.js (AdminPovCapture) | HIGH | UNVERIFIED AGAINST LIVE DOCS |
| U04 | `mp.game.graphics.setEntityOverlayPassEnabled()` | client app.js (AdminPovCapture) | HIGH | UNVERIFIED AGAINST LIVE DOCS |
| U05 | `player.callProc()` | server/index.js:1754, 4806 | MEDIUM | UNVERIFIED AGAINST LIVE DOCS |
| U06 | `player.getAdminLevel()` | server/index.js (multiple) | MEDIUM | UNVERIFIED AGAINST LIVE DOCS |
| U07 | `player.showNotify()` | server/index.js (multiple) | LOW | UNVERIFIED AGAINST LIVE DOCS |
| U08 | `eval()` / `pl.eval()` / `new Function()` | hot-loader/index.js:76,138,165 | CRITICAL (dev tool) | Confirmed pattern |
| U09 | `mp.game.graphics.world3dToScreen2d()` | hotloader/client/client.js:46 | LOW | Standard — verify signature |
| U10 | `entity.getBoneCoords(boneIndex, ...)` | hotloader/client/client.js:34,142,166 | MEDIUM | Numeric hash IDs, no documented constants |
| U11 | `entity.setBlockingOfNonTemporaryEvents()` | hotloader/client/client.js:96 | LOW | Standard native — subtle semantics |
| U12 | `entity.setCanRagdoll()` | hotloader/client/client.js:97 | LOW | Standard native |
| U13 | `mp.joaat()` vs `mp.game.joaat()` | server/index.js + client | LOW | Two forms — consistency risk |

---

## Detailed Findings

---

### U01 — `mp.players.reloadResources()` — HIGH — UNVERIFIED AGAINST LIVE DOCS

**File:** `ragemp-server/packages/server/index.js:6673`  
**Pattern:**
```js
//@ts-ignore
mp.players.reloadResources();
```

**Context:** Used inside an admin command handler to force all connected clients to reload their client-side packages. The `@ts-ignore` suppression is explicit — this function is absent from the official RAGE:MP TypeScript type definitions.

**Risk:**
- Function behavior is undefined if removed in future RAGE:MP versions — call will silently fail or throw, with no fallback.
- If callable by non-admin paths, triggers a full client resource reload on all players — mass disruption.
- No error handling around the call.
- The `@ts-ignore` is the only signal this is non-standard; without it the code would fail to compile.

**Verification needed:** Confirm existence and signature on RAGE:MP wiki / changelog.

---

### U02 — `mp.gui.takeScreenshot(filename, type, quality, compression)` — HIGH — UNVERIFIED AGAINST LIVE DOCS

**File:** `ragemp-server/client_packages/app.js` (compiled from `AdminPovCapture.module.ts`)  
**Pattern:**
```js
mp.gui.takeScreenshot(`pov_${requestId}.png`, 1, 80, 0);
```

**Context:** Core of the POV evidence capture system. Captures the current game render to a PNG file in the RAGE:MP screenshots directory. Called on each capture cycle, then the file is retrieved via CEF `fetch("http://screenshots/pov_${requestId}.png")`.

**Risk:**
- If this API has a different signature in the deployed RAGE:MP version, the call silently fails — no PNG is written, the CEF fetch 404s, the frame chunk is never sent, and the evidence session accumulates empty frames. There is no explicit error check on the takeScreenshot call.
- Parameter `type: 1` (PNG) — if RAGE:MP changes the type enum, JPEG or corrupt data may be silently written.
- `quality: 80`, `compression: 0` — if these parameters are swapped in different versions, output quality may degrade without warning.
- The screenshot filename uses `requestId = ${playerId}_${timestamp}` which is partially player-controlled (playerId) — see also U03/path traversal risk in the POV audit.

**Verification needed:** Confirm `mp.gui.takeScreenshot` parameter order and type enum values against current RAGE:MP client docs.

---

### U03 — `mp.game.graphics.createEntityOverlayBatch()` — HIGH — UNVERIFIED AGAINST LIVE DOCS

**File:** `ragemp-server/client_packages/app.js` (compiled from `AdminPovCapture.module.ts`)  
**Pattern:**
```js
const batch = mp.game.graphics.createEntityOverlayBatch({
  color: 0xff4f7bff,
  width: 3,
  depthEnabled: false
});
```

**Context:** Creates a visual overlay batch used to highlight nearby players (within 250m) during a POV capture session. Renders blue outlines on player entities for 350ms as a visual signal that capture is active.

**Risk:**
- Not present in the standard RAGE:MP `mp.game.graphics` API documentation as a well-known function. Likely an extended or experimental client API.
- If unavailable in the deployed RAGE:MP version, the call throws and the entire capture cycle fails — frames are lost.
- No try/catch wrapping the overlay creation — an exception here halts the capture module.
- If the batch handle is never released, GPU resources may leak.

**Verification needed:** Confirm `createEntityOverlayBatch` exists in target RAGE:MP client version and validate parameter schema.

---

### U04 — `mp.game.graphics.setEntityOverlayPassEnabled()` — HIGH — UNVERIFIED AGAINST LIVE DOCS

**File:** `ragemp-server/client_packages/app.js` (compiled from `AdminPovCapture.module.ts`)  
**Pattern:**
```js
mp.game.graphics.setEntityOverlayPassEnabled(true);
// ... render ...
mp.game.graphics.setEntityOverlayPassEnabled(false);
```

**Context:** Enables/disables the overlay render pass during POV capture. Paired with U03.

**Risk:**
- Same RAGE:MP version-dependency concern as U03.
- If `setEntityOverlayPassEnabled(false)` is never reached (exception mid-capture), the overlay render pass stays enabled permanently for that client session — visual corruption for the rest of the session.
- No finally-block pattern to guarantee the pass is disabled on error.

**Verification needed:** Confirm API exists; verify toggle semantics and whether it is session-scoped or frame-scoped.

---

### U05 — `player.callProc()` — MEDIUM — UNVERIFIED AGAINST LIVE DOCS

**File:** `ragemp-server/packages/server/index.js:1754, 4806`  
**Pattern:**
```js
const result = await player.callProc("client::getWeaponPreset", [loadoutId]);
const model = await player.callProc("client::getVehicleModel", [vehicleId]);
```

**Context:** Used as an async RPC call that returns a Promise resolved by the client. Used for weapon preset loading and vehicle model lookups.

**Risk:**
- `callProc` is not a standard method in the official RAGE:MP `mp.Player` API (which provides `player.call()` for fire-and-forget). It may be a custom server-side extension or an undocumented RAGE:MP feature.
- No visible rejection/timeout handling on the Promise — if the client disconnects mid-call, the Promise may never resolve or reject, leaking the pending call state indefinitely.
- If this is a custom wrapper, it is compiled away — behavior cannot be audited without source.

**Verification needed:** Check RAGE:MP wiki for `callProc`; if custom, locate implementation in compiled bundle.

---

### U06 — `player.getAdminLevel()` — MEDIUM — UNVERIFIED AGAINST LIVE DOCS

**File:** `ragemp-server/packages/server/index.js` (multiple occurrences)  
**Pattern:**
```js
if (player.getAdminLevel() >= 1) { ... }
if (player.getAdminLevel() < 3) { return; }
```

**Context:** Used throughout admin command gates, POV capture authorization, evidence listing, and anti-cheat override permissions.

**Risk:**
- `getAdminLevel()` is not in the official RAGE:MP `mp.Player` interface. This is almost certainly a custom method added via a server-side extension or monkey-patched onto the Player prototype.
- If the method is missing (RAGE:MP version change, extension unloaded), every admin check silently throws or returns `undefined`, with `undefined >= 1` evaluating to `false` — all admin commands become inaccessible to all players. Alternatively if it returns `NaN`, numeric comparisons misbehave.
- No fallback or null-check pattern visible around `getAdminLevel()` calls.

**Verification needed:** Locate the `getAdminLevel` definition in compiled server bundle; verify it is always defined before any player event fires.

---

### U07 — `player.showNotify()` — LOW — UNVERIFIED AGAINST LIVE DOCS

**File:** `ragemp-server/packages/server/index.js` (frequent usage)  
**Pattern:**
```js
player.showNotify("You have been kicked for suspicious activity.");
player.showNotify("Match starting in 10 seconds.");
```

**Context:** Used extensively for player-facing status messages throughout match lifecycle, admin actions, and system notifications.

**Risk:**
- Not in the standard RAGE:MP `mp.Player` API. Likely a convenience wrapper around `player.call("client::showNotification", [msg])`.
- If the underlying event name changes, all notifications silently stop working — no runtime error.
- Low immediate security risk but a reliability concern.

**Verification needed:** Locate `showNotify` definition in compiled bundle; confirm it is a wrapper and not a native RAGE:MP function.

---

### U08 — `eval()` / `pl.eval()` / `new Function('mp', code)` — CRITICAL (dev tool)

**File:** `ragemp-server/packages/hot-loader/index.js:76, 138, 165`

**Three distinct patterns:**

**Pattern A — Server-side eval (line 76):**
```js
eval(file);  // file = fs.readFileSync(scriptPath)
```
Evaluates a server-side script file directly in the current Node.js scope.

**Pattern B — Client-side eval via RAGE:MP (line 138):**
```js
pl.eval(clientCode);  // pl = connected player object
```
Sends JavaScript code to a connected player's client for immediate evaluation. This executes arbitrary code in the RAGE:MP client context with full `mp.*` API access.

**Pattern C — Scoped eval (line 165):**
```js
new Function('mp', code)(mp);
```
Wraps client code in a function scope with `mp` injected, then invokes it.

**Risk:**
- **If the hot-loader package is active in production**, any operator with filesystem write access (or any path traversal vulnerability) can execute arbitrary code on the server and all connected clients.
- `pl.eval()` has no player filtering — it appears to broadcast to all players or iterate all connected clients. Full client-side RCE for all players.
- No integrity check (hash/signature) on loaded script files.
- The hot-loader server module (`packages/hot-loader/index.js`) is in the `packages/` directory alongside the production server — verify it is NOT loaded as a RAGE:MP package in production.

**Verification needed:**
1. Check `ragemp-server/packages/` directory listing — is `hot-loader` package registered/active?
2. Check `conf.json` `packages` list for hot-loader inclusion.
3. If active in production: disable immediately.

---

### U09 — `mp.game.graphics.world3dToScreen2d()` — LOW

**File:** `ragemp-server/hotloader/client/client.js:46`  
**Pattern:**
```js
const screenPos = mp.game.graphics.world3dToScreen2d(worldPos.x, worldPos.y, worldPos.z);
```

**Context:** Converts a 3D world coordinate to a 2D screen position. Used to position floating damage numbers in the CEF overlay.

**Risk:** Standard GTA V native wrapper. Well-documented in the RAGE:MP ecosystem. Low risk.  
**Note:** Returns `{x, y}` normalized 0–1 coordinates. Off-screen positions return values outside [0,1] — verify the damage number renderer handles out-of-bounds gracefully (no negative coordinate crash in React layout).

---

### U10 — `entity.getBoneCoords(boneIndex, ...)` with numeric hash IDs — MEDIUM

**File:** `ragemp-server/hotloader/client/client.js:34, 142, 166`  
**Pattern:**
```js
const headPos  = entity.getBoneCoords(31086, 0, 0, 0);  // Head bone
const torsoPos = entity.getBoneCoords(24818, 0, 0, 0);  // Torso bone
```

**Context:** Used in the hot-loader hit detection script to get world positions of head and torso bones for damage calculation.

**Risk:**
- Bone IDs `31086` and `24818` are GTA V `SKEL_*` hash values (head = `SKEL_Head`, torso = `SKEL_Spine_Root` or equivalent). These are undocumented magic numbers not defined as named constants.
- If these hash values differ for non-standard ped models (animals, special peds), bone lookup silently returns a zero-vector or invalid position, causing incorrect hit detection without error.
- The hot-loader client runs in a dev context but the same bone access pattern may be replicated in the production client bundle.

**Verification needed:** Confirm `31086` = `SKEL_Head` and `24818` = correct torso bone in the GTA V native database.

---

### U11 — `entity.setBlockingOfNonTemporaryEvents(true)` — LOW

**File:** `ragemp-server/hotloader/client/client.js:96`  

**Context:** Suppresses AI task interruption by ambient events (traffic, explosions, etc.) on a spawned test ped.

**Risk:** Standard GTA V native. Well-understood behavior. Low risk. Used correctly on a dev-only test ped.

---

### U12 — `entity.setCanRagdoll(false)` — LOW

**File:** `ragemp-server/hotloader/client/client.js:97`  

**Context:** Prevents a test ped from entering ragdoll physics.

**Risk:** Standard GTA V native. Low risk. Dev-only test ped context.

---

### U13 — `mp.joaat()` vs `mp.game.joaat()` — LOW

**Files:**  
- Server: `ragemp-server/packages/server/index.js` — uses `mp.joaat(modelName)`  
- Client: `ragemp-server/hotloader/client/client.js:11,19-22` — uses `mp.game.joaat(modelName)`

**Context:** Both compute Jenkins One-At-A-Time hashes for GTA V model/weapon name strings.

**Risk:** Two different call paths for the same underlying function. On the server `mp.joaat()` is a top-level helper; on the client it is namespaced under `mp.game`. If either form is removed in a RAGE:MP update, the other still works. Inconsistency increases maintenance confusion — a developer may not realize these are equivalent.

---

## Notes on Source Availability

All findings above are based on compiled webpack bundles. The original TypeScript source files are not present in this backup. This means:
- Line numbers reference the compiled output, not original source lines.
- @ts-ignore counts and locations reflect the compiled artifact, not the original source (which may have had more suppressions).
- Some APIs flagged as UNVERIFIED may have had documentation comments in the original source that are not visible here.

---

## Highest-Risk Items for Immediate Attention

1. **U08** — Hot-loader eval chain: if active in production, this is a full RCE vector for the server and all clients.
2. **U01** — `mp.players.reloadResources()`: undocumented, @ts-ignore suppressed, mass-disruption potential.
3. **U02** — `mp.gui.takeScreenshot()`: silent failure means evidence capture is broken with no admin awareness.
4. **U03 / U04** — Entity overlay batch APIs: unverified, no try/catch, overlay pass can get stuck enabled.
5. **U06** — `player.getAdminLevel()`: if undefined, all admin permission gates silently fail closed (or open, depending on error handling).
