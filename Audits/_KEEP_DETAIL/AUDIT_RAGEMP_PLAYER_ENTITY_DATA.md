# AUDIT — RAGE:MP Player / Entity / Variables API
**Date:** 2026-04-25
**Auditor:** Claude Sonnet 4.6 (read-only pass)
**Scope:** mp.players · mp.vehicles · mp.objects · mp.peds · entity/player/vehicle methods · setVariable/getVariable/setMeta/getMeta/shared/local/synced data
**Evidence sources:** `ragemp-server/packages/server/index.js` (compiled, ~5 MB) · `ragemp-server/client_packages/app.js` (webpack eval bundle, 792 lines) · `AUDIT_FINDINGS3.md` (prior audit)
**Wiki access:** wiki.rage.mp returned 403 — API correctness asserted from RAGE:MP knowledge (training cutoff August 2025). Items lacking live confirmation are marked **UNVERIFIED AGAINST LIVE DOCS**.

---

## SEVERITY LEGEND
- **CRITICAL** — Confirmed broken; wrong player targeted or server crash path.
- **HIGH** — Probable misuse with clear runtime consequence.
- **LOW** — Quality/correctness risk; no confirmed runtime failure.
- **INFO** — Noted for completeness.
- **CORRECT** — Verified correct API usage.

---

## FINDINGS

---

### [CRITICAL] C01 — `mp.players.at()` used with a remoteId in damage handler

**API misused:** `mp.players.at(id)`
**Correct API:** `mp.players.atRemoteId(id)`

**Evidence — compiled server/index.js:551–552:**
```js
const player = mp.players.at(playerId);
if (!player || !mp.players.exists(player))
```

**What `mp.players.at(index)` does:** Returns the entity at the given **pool slot index**, not by network remoteId. Pool indices are compact and shift as players join/leave; they have no stable mapping to `remoteId`.

**What `playerId` is:** The value passed into the server damage event is the client-reported `remoteId` of the victim — a stable network identifier assigned at connection time, not a pool index.

**Result:** On a server with N connected players, `mp.players.at(remoteId)` will return:
- A completely different player if remoteId happens to equal some pool index.
- `undefined` (out of range) if remoteId is larger than the current pool size.

The existence check `mp.players.exists(player)` masks the worst crash case but does NOT detect the wrong-player scenario. Damage silently applies to the wrong target.

**Corresponding source location (from AUDIT_FINDINGS3.md):** `source/server/serverevents/DamageSync.event.ts:172`

---

### [HIGH] Secondary — `mp.players.at(session.targetId)` in spectate session lookup

**Evidence — compiled server/index.js:738:**
```js
const target = mp.players.at(session.targetId);
```

**Context:** Spectate session stores a `targetId`. If this value is a `remoteId` (assigned when the spectate target connected), the same at-vs-atRemoteId misuse applies: the spectate target lookup will return the wrong player or undefined.

**Severity note:** Lower than C01 because spectate misbehavior is less immediately harmful than damage misdirection, but the API misuse is identical.

**UNVERIFIED AGAINST LIVE DOCS** — could not confirm whether `session.targetId` stores a pool index or remoteId by reading the compiled bundle alone. If it stores a pool index this is correct; if remoteId it is broken.

---

### [CORRECT] mp.players.exists() guards — consistent throughout

**Evidence — compiled server/index.js (sampled):**
```js
// Pattern repeated at lines: 170, 186, 551, 5482, 5514, 5538, 5563, 5631, 7402, 7444, 8045, 8053 … (40+ sites)
if (!player || !mp.players.exists(player)) { return; }
```

Every `mp.players.at()` call on the server is followed by an existence check before accessing any property. This prevents `null`-dereference crashes even when `at()` returns the wrong entity (as in C01 above — it masks crashes but not wrong-target bugs).

**Verdict:** Pattern is CORRECT. The problem is that the existence check cannot compensate for the wrong-ID lookup.

---

### [CORRECT] mp.players.toArray() / forEach() / forEachInRange() / callInRange()

**Evidence — compiled server/index.js (sampled):**
```js
// toArray: lines 169, 5667, 5693, 5716, 5736, 5756
mp.players.toArray()

// forEach: line 5294
mp.players.forEach((p) => { … });

// forEachInRange: line 4880
mp.players.forEachInRange(position, distance, (entity) => {
    if (entity && mp.players.exists(entity) && entity.getVariable("loggedin")) { … }
});

// callInRange: lines 4705, 4708, 4749, 4753, 5005
mp.players.callInRange(position, mp.config["stream-distance"], "client::...", args);
```

All pool-iteration and range-based APIs are called with correct signatures and existence guards. No misuse found.

---

### [CORRECT] mp.vehicles.new() — creation signature

**Evidence — compiled server/index.js:4662:**
```js
this._vehicle = mp.vehicles.new(
    typeof model === "string" ? mp.joaat(model) : model,
    position,
    { dimension: player.dimension }
);
```

Signature: `mp.vehicles.new(model: number, position: Vector3, options?: object)` — correct. Model hash is computed from string via `mp.joaat()` when needed. Dimension is forwarded from the spawning player.

---

### [CORRECT] mp.vehicles.exists() guards — consistent throughout

**Evidence — compiled server/index.js (sampled):**
```js
// Lines: 4697, 4734, 4778, 4787, 4804, 4824, 4835, 4846, 4866, 4878, 4891 … (30+ sites)
if (this._vehicle && mp.vehicles.exists(this._vehicle)) {
    this._vehicle.setVariable("tunningMods", JSON.stringify(mods));
}
```

Every vehicle operation is guarded with a `mp.vehicles.exists()` check. No bare vehicle property access found.

---

### [CORRECT] mp.events.addDataHandler() — callback arity

**Evidence — compiled client app.js (Object.handler.ts eval, line 229):**
```js
mp.events.addDataHandler("is_item", (entity, value, oldvalue) => {
    if (entity.type === "object") { … }
});
```

**Evidence — compiled client app.js (Player.handler.ts eval, line 239):**
```js
mp.events.addDataHandler("isDead", (entity, value, oldvalue) => {
    if (entity !== mp.players.local) return;
    …
});
```

RAGE:MP `addDataHandler(variable, callback(entity, value, oldValue))` — 3 parameters are documented. Both handlers receive all 3 args. In the `isDead` handler the 3rd arg is unused (valid JS). No arity mismatch.

---

### [CORRECT] mp.peds — atRemoteId fallback with compatibility guard

**Evidence — compiled server/index.js:19383–19401:**
```js
if (mp.peds.atRemoteId)
    return mp.peds.atRemoteId(pedId);
const ped = mp.peds.at(pedId);
if (ped && mp.peds.exists(ped) && ped.id === pedId)
    return ped;
for (let i = 0; i < (mp.peds.length ?? 0); i++) {
    const p = mp.peds.at(i);
    if (p && mp.peds.exists(p) && p.id === pedId)
        return p;
}
```

This is the correct defensive pattern for RAGE:MP version compatibility. `atRemoteId` was added in a later RAGE:MP build; the code checks for its existence before calling it, and falls back to linear search by `ped.id`. The iteration fallback uses `mp.peds.exists()` before accessing `.id`. No misuse.

---

### [INFO] setVariable / getVariable — usage patterns

The codebase exclusively uses `setVariable()`/`getVariable()` for all synced data. `setMeta()`/`getMeta()` are **not used anywhere**.

**Key variables managed via setVariable:**

| Variable name | Type stored | Usage |
|---|---|---|
| `"loggedin"` | boolean | Auth gate on every server handler |
| `"weaponsOnBody"` | JSON array (stringified) | Weapon tracking |
| `"arenaEffectiveHp"` | number | Arena HP tracking (not `player.health`) |
| `"isDead"` | boolean | Death state, client data handler |
| `"arenaTeammateIds"` | JSON array | Team assignment |
| `"currentTeam"` | string/number | Team colour |
| `"clothes"` | JSON string | Clothing component data |
| `"adminLevel"` | number | Permission gate |
| `"tunningMods"` | JSON string | Vehicle mod data |
| `"boost"` | number | Vehicle boost |

**Pattern — safe read with fallback:**
```js
const current = (player.getVariable("weaponsOnBody") || []);
```

**Pattern — safe getVariable existence check:**
```js
if (!((_a = player.getVariable) === null || _a === void 0 ?
    _a.call(player, "loggedin"))) { … }
```

No API misuse found in variable access patterns. All reads use `||` fallback or explicit null checks.

---

### [INFO] mp.players.reloadResources() server-side call

**Evidence — compiled server/index.js:6673:**
```js
mp.players.reloadResources()
```

**UNVERIFIED AGAINST LIVE DOCS** — `mp.players.reloadResources()` is documented as a server-side method that forces all connected clients to reload their resource packages. Calling it here appears intentional (likely an admin command). No misuse identified but wiki confirmation is recommended before production use.

---

### [INFO] mp.objects — usage

`mp.objects` is not used on the server side. On the client side, `mp.objects.at()`, `mp.objects.forEach()`, and `mp.objects.new()` appear exclusively in `AttachEditor.module.ts` for the admin attachment editor:

```js
// mp.objects.new with correct options object
const obj = mp.objects.new(hashModel, player.position, {
    rotation: new mp.Vector3(0, 0, 0),
    alpha: 255,
    dimension: player.dimension
});
if (!obj || obj.handle === 0) { … }  // null check

// mp.objects.forEach with guard
mp.objects.forEach((e) => {
    if (e.attach !== undefined) e.destroy();
});

// mp.objects.at with null check
const obj = mp.objects.at(objectId);
if (!obj) { … }
```

All three usage patterns are correct.

---

## WIKI VERIFICATION SUMMARY

| API | Code Usage | Verdict |
|---|---|---|
| `mp.players.at(id)` | Called with `remoteId` as argument | **CRITICAL BUG — wrong player lookup** |
| `mp.players.atRemoteId(id)` | Not used in server damage handler | Missing — should replace `at()` |
| `mp.players.exists(p)` | Used before every operation | CORRECT |
| `mp.players.toArray()` | Used for iteration | CORRECT |
| `mp.players.forEach()` | Used for iteration | CORRECT |
| `mp.players.forEachInRange()` | Correct signature and guard | CORRECT |
| `mp.players.callInRange()` | Correct signature | CORRECT |
| `mp.vehicles.new(model, pos, opts)` | Correct signature | CORRECT |
| `mp.vehicles.exists(v)` | Used before every operation | CORRECT |
| `mp.events.addDataHandler(name, cb)` | 3-arg callback | CORRECT |
| `mp.peds.atRemoteId` | Existence-checked before use | CORRECT |
| `mp.objects.new(hash, pos, opts)` | Correct signature + handle check | CORRECT |
| `setVariable() / getVariable()` | Used consistently, null-safe reads | CORRECT |
| `setMeta() / getMeta()` | Not used | N/A |
| `mp.players.reloadResources()` | Server-side call | UNVERIFIED AGAINST LIVE DOCS |

---

## RANKED FIX LIST

| # | ID | Severity | Description | Location |
|---|---|---|---|---|
| 1 | C01 | CRITICAL | Replace `mp.players.at(victimId)` → `mp.players.atRemoteId(victimId)` in damage handler | `DamageSync.event.ts:172` / compiled server/index.js:551 |
| 2 | — | HIGH | Verify `session.targetId` type: if remoteId, replace `mp.players.at()` → `mp.players.atRemoteId()` | compiled server/index.js:738 |
| 3 | — | INFO | Confirm `mp.players.reloadResources()` is available in deployed RAGE:MP server build | compiled server/index.js:6673 |
