# AUDIT: RAGE:MP Vehicles, Mods & Tuning API Usage

**Scope:** Vehicle creation/destruction APIs, vehicle mod/modkit/livery/tuning APIs, vehicle state/data usage, directly-related RAGE:MP calls only  
**Source:** `ragemp-server/packages/server/index.js` (webpack-bundled TypeScript), `ragemp-server/client_packages/app.js`  
**Date:** 2026-04-25  
**Method:** Static source analysis — no live RAGE:MP wiki access confirmed; items requiring docs verification are marked accordingly  
**Note:** No `RAGEMP_API_INDEX.md` was found in the repository — analysis is derived directly from the compiled source bundle

---

## Section 1 — Vehicle Creation & Destruction

| API | Line(s) | Side | Verdict | Notes |
|-----|---------|------|---------|-------|
| `mp.vehicles.new(model, pos, opts)` | 4662, 10769 | Server | ✓ CORRECT | Model passed as hash (int) or string → `mp.joaat()` conversion applied |
| `mp.vehicles.exists(vehicle)` | 4697, 35+ sites | Server | ✓ CORRECT | Guard before every property access — consistent pattern throughout |
| `mp.vehicles.at(id)` | 12949 | Server | ✓ CORRECT | Server-side internal ID lookup — correct context |
| `mp.vehicles.atRemoteId(id)` | app.js ~line 169 | Client | ✓ CORRECT | Client-side remote ID resolution — correct placement |
| `mp.vehicles.atHandle(handle)` | app.js ~line 169 | Client | ✓ CORRECT | Raycast handle resolution — client only, correct |
| `vehicle.destroy()` | 4867 | Server | ✓ CORRECT | Called within class destructor; `mp.vehicles.exists()` guard precedes it |

**Creation options object** (line 4662):
```js
mp.vehicles.new(model, position, {
    dimension,
    numberPlate,
    locked,
    engine,
    heading,
    color: [data.primaryColor, data.secondaryColor]
});
```
All options are valid RAGE:MP constructor fields. **UNVERIFIED AGAINST LIVE DOCS** — `color` as an array in the constructor option vs `setColor()` post-creation was not confirmed against live wiki.

---

## Section 2 — Vehicle Mod & Tuning APIs

### 2.1 Server-Side Mod Application

| API | Line(s) | Verdict | Notes |
|-----|---------|---------|-------|
| `vehicle.setMod(modIndex, value)` | 4896, 4951, 4977 | ✓ CORRECT (with caveat) | See V01 and V03 below |
| `vehicle.setModColor1(value, r, g)` | 4953 | ✓ CORRECT | Used for mod index 66 (primary respray) — correct special-case routing |
| `vehicle.setModColor2(value, r)` | 4967 | ✓ CORRECT | Used for mod index 67 (secondary respray) — correct special-case routing |
| `vehicle.setColorRGB(r1,g1,b1,r2,g2,b2)` | 4908 | ✓ CORRECT | Six-component RGB call |
| `vehicle.setColor(primary, secondary)` | 10778 | ✓ CORRECT | Palette index form |
| `vehicle.getColorRGB(slot)` | 4907 | ✓ CORRECT | Used to preserve secondary color before primary override |
| `vehicle.setNeonColor(r, g, b)` | 4904 | ✓ CORRECT | Three-component RGB |

### 2.2 LSC Respray Special Handling (Mods 66 & 67)

Mods 66 and 67 in GTA V are NOT standard vehicle modification slots — they represent the LSC primary and secondary paint respray operations and require dedicated API calls:

- Mod 66 → `vehicle.setModColor1(value, 0, 0)` (line 4953)
- Mod 67 → `vehicle.setModColor2(value, 0)` (line 4967)

The server correctly identifies these indices and routes to the appropriate calls rather than passing them to `setMod()`. A try/catch fallback to `setMod(66/67, v)` exists for edge cases (line 4951).

**UNVERIFIED AGAINST LIVE DOCS:** The exact semantics of `setModColor1()` / `setModColor2()` parameter ordering was not confirmed against the live RAGE:MP wiki.

### 2.3 Client-Side Mod APIs (Correct Placement)

These are client-only APIs and are correctly called only from `app.js`:

| API | Description |
|-----|-------------|
| `vehicle.setModKit(0)` | Required before applying mods to a vehicle — resets the mod kit |
| `vehicle.getNumMods(idx)` | Returns the count of available options for a mod slot; used for UI cap |
| `vehicle.toggleMod(20, bool)` | Enables/disables tyre smoke (mod slot 20) |
| `vehicle.setTyreSmokeColor(r, g, b)` | Sets tyre smoke RGB color |

---

## Section 3 — Vehicle State Properties

### 3.1 Server-Side Properties

| Property | Line(s) | Mode | Type | Notes |
|----------|---------|------|------|-------|
| `vehicle.engine` | 4741 | Write | boolean | `typeof value === "boolean" ? value : false` guard applied |
| `vehicle.locked` | 4745 | Write | boolean | Same boolean guard applied |
| `vehicle.numberPlate` | 4765 | Write | string | Direct string assignment |
| `vehicle.numberPlateType` | 4898 | Write | int | Set from `_mods.plateColor` |
| `vehicle.neonEnabled` | 4893 | Write | boolean | Set to `false` on mod reset |
| `vehicle.windowTint` | 4894 | Write | int | Set to `0` on mod reset |
| `vehicle.wheelType` | 4901 | Write | int | Set from `_mods.wheelType` |
| `vehicle.position` | 4705 | Read | Vector3 | Used for `mp.players.callInRange()` radius check |
| `vehicle.heading` | 5064 | Read | float | Saved to DB with position data |
| `vehicle.dimension` | 5062 | Read/Write | int | Used to separate match instances |
| `vehicle.model` | 5059 | Read | int (hash) | Read for DB persistence |
| `vehicle.id` | 5133 | Read | int | Internal sequential ID comparison |

### 3.2 Client-Side Properties

| Property | Description |
|----------|-------------|
| `vehicle.handle` | Native GTA handle — used in raycast and `atHandle()` resolution |
| `vehicle.getClass()` | Returns vehicle class int — used to skip extra reset on planes/helis |
| `vehicle.getEngineHealth()` | Engine health float — read for status display |

---

## Section 4 — Custom Data Variables

### 4.1 Server-Side Writes

| Call | Line | Value |
|------|------|-------|
| `vehicle.setVariable("tunningMods", JSON.stringify(mods))` | 4699 | Serialized mod index → value map |
| `vehicle.setVariable("boost", 1.3)` | 4924 | Turbo multiplier (mod 18 active) |
| `vehicle.setVariable(key, value)` | 4702 | Generic variable setter |

### 4.2 Client-Side Reads

| Call | Location | Purpose |
|------|----------|---------|
| `vehicle.getVariable("tunningMods")` | app.js ~line 169 | Parse and apply mods on `entityStreamIn` |
| `vehicle.getVariable("windows")` | app.js ~line 169 | Restore window open/close state on stream-in |

**Tuning mods flow:**
1. Server stores mods as `JSON.stringify({"modIndex": value, ...})` in `tunningMods` variable
2. Client reads on `entityStreamIn` → `JSON.parse()` → applies each mod
3. Client also listens to `client::vehicle:applyTuningMod` for live updates

**Issue V04 (INFO):** No JSON schema validation on the client parse of `tunningMods`. A corrupted or malformed variable value (e.g., from server bug) would throw an uncaught parse error client-side. Not an attack surface since variables originate server-side only.

---

## Section 5 — Client-Only Vehicle APIs (Correct Placement)

All of the following are called exclusively from `app.js` (client bundle). None appear server-side — correct.

| API | Context |
|-----|---------|
| `vehicle.rollDownWindow(idx)` / `rollUpWindow(idx)` | Window state sync from `client::vehicle:setWindowState` |
| `vehicle.fixWindow(idx)` | Window repair |
| `vehicle.setDoorOpen(idx, ...)` / `setDoorShut(idx, ...)` | Trunk (5) and hood (4) state sync |
| `vehicle.setExtra(i, 1)` — loop i=0..9 | Reset all extras to visible on stream-in |
| `vehicle.setTyreBurst(wheelIndex, false, 1000)` | Tyre damage state sync |
| `vehicle.setTyreFixed(wheelIndex)` | Tyre repair |
| `vehicle.setDirtLevel(level)` | Dirt level sync from `client::vehicle:setDirtLevel` |
| `vehicle.setEngineOn(running, crank, noSound)` | Engine state sync |

---

## Section 6 — Vehicle Events

| Event | File | Line | Handler |
|-------|------|------|---------|
| `entityStreamIn` | app.js | ~169 | Vehicle stream-in handler: reads `tunningMods`, applies mods, restores windows/extras/doors |
| `client::vehicle:setWindowState` | app.js | ~169 | Server → client: sync window open/close |
| `client::vehicle:setDirtLevel` | app.js | ~169 | Server → client: sync dirt level |
| `client::vehicle:setTrunkState` | app.js | ~169 | Server → client: sync trunk state |
| `client::vehicle:setHoodState` | app.js | ~169 | Server → client: sync hood state |
| `client::vehicle:applyTuningMod` | app.js | ~169 | Server → client: live mod apply |
| `client::vehicle:setModColor` | app.js | ~169 | Server → client: mod 66/67 color apply |
| `vstaticAttachments.Add` | index.js | 12948 | Server event: add attachment to vehicle by remote ID |
| `vstaticAttachments.Remove` | index.js | 12957 | Server event: remove attachment from vehicle by remote ID |

### Vehicle Attachment Events (lines 12948–12963)

```js
// Add attachment
let vehicle = mp.vehicles.at(remoteVehicle);      // line 12949
vehicle.addAttachment(parsed >>> 0, false);         // line 12954

// Remove attachment
vehicle.addAttachment(parsed >>> 0, true);          // line 12963 (isRemoval = true)
```

`mp.vehicles.at()` is used here for server-side ID resolution — correct in server context.

**UNVERIFIED AGAINST LIVE DOCS:** `vehicle.addAttachment(hash, isRemoval)` parameter semantics (second param as removal flag) were not confirmed against live wiki.

---

## Section 7 — APIs Expected but NOT Found

The following vehicle/mod-related RAGE:MP APIs were searched for and are **absent** from the codebase:

| API | Status |
|-----|--------|
| `vehicle.setLivery()` / `getLivery()` | NOT USED |
| `vehicle.setPrimaryColor()` / `setSecondaryColor()` | NOT USED — `setColor()` / `setColorRGB()` used instead |
| `vehicle.getModKit()` on server | NOT USED — only `setModKit(0)` client-side |
| `vehicle.getModsCount()` | NOT USED — `getNumMods(idx)` used instead |
| `vehicle.getExtra()` | NOT USED — only `setExtra()` |
| `playerEnterVehicle` event | NOT REGISTERED |
| `playerExitVehicle` event | NOT REGISTERED |
| `vehicleDeath` event | NOT REGISTERED |
| `mp.vehicles.streamed()` | NOT USED |

**Note:** The absence of `playerEnterVehicle` / `playerExitVehicle` events means the server does not react to players entering or leaving vehicles. Any vehicle-entry logic is managed through client events or separate colshape/proximity detection.

---

## Section 8 — Issues Found

### HIGH

| ID | Location | API Involved | Problem |
|----|----------|--------------|---------|
| **V02** | Freeroam vehicle spawn handler | `mp.vehicles.new()` | **No per-player vehicle spawn limit.** A player can invoke the freeroam vehicle spawn command repeatedly, creating vehicles without bound. The server vehicle pool has a hard cap; exhausting it prevents any new vehicle creation server-wide. The only guard is a per-player existing-vehicle check — not a rate limit or global cap. |

### MEDIUM

| ID | Location | API Involved | Problem |
|----|----------|--------------|---------|
| **V01** | Line 4977 | `vehicle.setMod(modIndex, v)` | **Mod values not range-checked.** The value `v` applied via `setMod()` comes from the tuning data object without an upper or lower bound check (beyond filtering mod indices 66/67 for color routing). An invalid value for a given mod slot on a given vehicle model is passed directly to the RAGE:MP API. Behavior on out-of-range values is engine-defined. **UNVERIFIED AGAINST LIVE DOCS** — whether RAGE:MP clamps or errors on invalid mod values was not confirmed. |

### LOW

| ID | Location | API Involved | Problem |
|----|----------|--------------|---------|
| **V03** | Line 4896 | `setMod(i, -1)` loop i=0..79 | **Fixed 80-slot reset loop.** All mod slots 0–79 are reset to `-1` before applying stored mods. GTA V mod slot count varies by vehicle model. Iterating beyond a model's actual slot count likely no-ops or throws internally, but the specific behavior is **UNVERIFIED AGAINST LIVE DOCS**. |

### INFO

| ID | Location | API Involved | Problem |
|----|----------|--------------|---------|
| **V04** | app.js, `entityStreamIn` | `vehicle.getVariable("tunningMods")` | `JSON.parse()` on the variable value has no try/catch. A corrupt or unexpected variable value (e.g., server-side serialization bug) will throw an uncaught client-side exception. Not a security issue — the variable is server-authored. |

---

## Summary

| Category | Count |
|----------|-------|
| Vehicle creation/destruction APIs used correctly | 6 |
| Vehicle mod/color APIs used correctly | 8 |
| Vehicle state properties accessed | 13 |
| Custom data variables (`setVariable`/`getVariable`) | 5 |
| Client-only APIs correctly placed on client | 10 |
| Vehicle-related events handled | 9 |
| HIGH issues | 1 (V02 — spawn limit) |
| MEDIUM issues | 1 (V01 — mod value range) |
| LOW issues | 1 (V03 — fixed slot loop) |
| INFO issues | 1 (V04 — JSON parse no try/catch) |
| Expected APIs confirmed absent | 9 |

**Overall assessment:** Vehicle API usage is architecturally sound. The tuning mod flow (server serialization → variable → client `entityStreamIn` application) is the correct RAGE:MP pattern. No server/client boundary violations were found. The three substantive issues (V01, V02, V03) are pre-existing hardening gaps rather than API misuse.
