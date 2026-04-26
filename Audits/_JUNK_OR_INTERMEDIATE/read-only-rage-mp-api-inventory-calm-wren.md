# AUDIT_RAGEMP_EVENTS_NETWORKING.md — Events / Networking Family Audit

> **Scope:** `gamemode/source/` — Events/Networking family only (`mp.events.add`, `mp.events.callRemote`, `mp.events.call`, `mp.events.addProc`, `player.call`, `player.callProc`, `new mp.Event`, CEF bridge, synced-variable networking).  
> **Status:** READ-ONLY audit — no code modified, no fixes applied.  
> **Files read:** `shared/events.constants.ts`, `server/classes/CEFEvent.class.ts`, `client/clientprocs/Player.proc.ts`, `client/classes/Browser.class.ts`, `client/clientevents/Player.event.ts`, `server/serverevents/Player.event.ts`, `server/serverevents/Auth.event.ts`, `server/serverevents/DamageSync.event.ts`, `server/serverevents/Death.event.ts`, `server/serverevents/Arena.event.ts`, `server/serverevents/Admin.event.ts`, `server/serverevents/Chat.event.ts`, `server/serverevents/Voice.event.ts`

---

## Section 1 — Confirmed-Correct Usages

| # | Pattern | File | Notes |
|---|---------|------|-------|
| 1 | Duplicate registration guard | `server/classes/CEFEvent.class.ts` | `register()` throws `Error` if same page+pointer registered twice — prevents handler stomping |
| 2 | `server:PlayerHit` multi-layer validation | `server/serverevents/DamageSync.event.ts:170` | shooter exists, victim exists, shooter ≠ victim, dimension match, fire-rate check, duplicate-hit guard, distance sanity check all applied before any damage |
| 3 | Admin CEF events fully gated | `server/serverevents/Admin.event.ts` | All `RAGERP.cef.register("admin", ...)` handlers guarded by `isStaff()` (adminlevel ≥ 1) or `isZoneEditorStaff()` (adminlevel ≥ 6) at entry |
| 4 | Bcrypt + SHA-256 fallback auth | `server/serverevents/Auth.event.ts:16` | `verifyPassword()` detects legacy 64-char hex hashes and compares via SHA-256; new passwords use bcrypt rounds=12 |
| 5 | Spectate switch validates target | `server/serverevents/Arena.event.ts:184` | `server::arena:spectate:switch` checks `isSpectating` variable and validates target is inside `getSpectatableTeammates(player.id)` before calling `startSpectate` |
| 6 | HTML escaping in chat | `server/serverevents/Chat.event.ts:21` | `escapeHtml()` applied to player name, message, and PM target name before broadcast; 500 ms rate-limit enforced; 200-char message cap |
| 7 | Server-authoritative radio channel | `server/serverevents/Voice.event.ts:22` | `requestRadioListeners` reads `radioChannel` from server-side synced variable — client cannot spoof the channel value |
| 8 | Queue size allowlist | `server/serverevents/Arena.event.ts:25` | `(QUEUE_SIZES as readonly number[]).includes(s)` whitelist enforced before accepting queue size from CEF payload |
| 9 | Capture-point distance sanity | `server/serverevents/Admin.event.ts:812` | `server::admin:hopoutsZoneEditorSubmitCapture` cross-checks client-supplied XYZ against server `player.position`: 4.5m XY radius, 32m Z delta — rejects spoofed coordinates |
| 10 | Arena item use guards | `server/serverevents/Arena.event.ts:97` | `server::arena:useItem` validates match state is `"active"`, player is alive, item count > 0, zone rule check — all before consuming the item |
| 11 | CEF proc JSON error boundary | `client/clientprocs/Player.proc.ts` | `client::proc:applyWeaponPreset` wraps JSON.parse + apply in try/catch and returns `{success:false, error}` struct rather than throwing |

---

## Section 2 — High-Confidence API Misuse

### 2.1 CRITICAL — `emitServer()` / `emitClient()` have no event-name allowlist
**File:** `client/classes/Browser.class.ts`

```typescript
// emitServer — no allowlist, no validation
emitServer(receivedData: any): void {
    let data = Utils.tryParse(receivedData);
    let { event, args } = data;
    Array.isArray(args)
        ? (args.length === 1 ? mp.events.callRemote(event, JSON.stringify(args[0]))
                             : mp.events.callRemote(event, JSON.stringify(args)))
        : mp.events.callRemote(event, args);
}

// emitClient — no allowlist, no validation
emitClient(receivedData: any): void {
    let data = Utils.tryParse(receivedData);
    let { event, args } = data;
    if (Array.isArray(args)) { mp.events.call(event, ...args); }
    else { mp.events.call(event, args); }
}
```

Both methods destructure `{event, args}` directly from the CEF payload and pass the event name verbatim to RAGE:MP. Any CEF page — or an XSS/injection into any CEF page — can supply an arbitrary event name:

- `emitServer` path → arbitrary `callRemote` to any registered server event  
- `emitClient` path → arbitrary `mp.events.call` to any registered client event

**Concrete client-side escalation examples via emitClient:**
- `{event: "client::player:freeze", args: [false]}` — unfreezes a frozen player  
- `{event: "client::player:setVitals", args: [[200, 100]]}` — sets HP to full  
- `{event: "client::arena:castLock", args: [false]}` — removes cast weapon lock  
- `{event: "client::player:canAcceptDeath", args: [true]}` — overrides death acceptance flag  

**Concrete server-side escalation examples via emitServer:**
- `{event: "server::player:noclip", args: [...]}` — triggers noclip toggle (has its own check but unintended surface)  
- `{event: "server::arena:useItem", args: ["..."]}` — consumes arena items outside normal CEF page flow  
- `{event: "server::chat:sendMessage", args: ["..."]}` — bypasses the CEF chat UI entirely

**Risk level:** CRITICAL. The CEF layer is meant to be untrusted user input. Without an allowlist, the browser bridge is a universal event injector.

---

### 2.2 HIGH — `new mp.Event(name, handler)` constructor is non-standard
**File:** `server/classes/CEFEvent.class.ts`

```typescript
const _event = new mp.Event(`server::${page}:${pointer}`, handler);
```

`mp.Event` used as a constructor is not part of the documented RAGE:MP server API. The standard and only documented registration call is `mp.events.add(name, fn)`. If this constructor form is silently unsupported in the deployed RAGE:MP build:

- All `RAGERP.cef.register(...)` calls across the entire codebase produce no live handler
- Every Auth, Arena, Admin, Wardrobe, Settings, Profile, etc. CEF→server RPC silently drops
- No error is thrown, so the failure is invisible at startup

---

### 2.3 HIGH — `mp.events.add({...})` object syntax is non-standard
**File:** `server/serverevents/Player.event.ts`

```typescript
mp.events.add({ "playerQuit": onPlayerQuit, "playerJoin": onPlayerJoin });
```

RAGE:MP's `events.add(name, fn)` takes exactly two arguments: a string name and a handler. Object-syntax batch registration is not documented. If unsupported:

- `playerJoin` never fires → no character session created, no `loggedin` variable set, no player data loaded
- `playerQuit` never fires → no session cleanup, no save on disconnect

Both are game-breaking silent failures with no error output.

---

### 2.4 MEDIUM — `arena::debugEndRound` has zero authorization check
**File:** `server/serverevents/Arena.event.ts:87`

```typescript
RAGERP.cef.register("arena", "debugEndRound", async (player: PlayerMp, data?: string) => {
    // NO admin/role check
    forceSoloRoundEnd(player, winner);
});
```

Any player in a match who fires `server::arena:debugEndRound` (reachable via the `emitServer` no-allowlist path, §2.1) can force-end their own match round with a chosen winner. Even without §2.1, this event fires from the "arena" CEF page which is shown to all players in a match.

---

### 2.5 MEDIUM — Voice listeners missing `loggedin` check
**File:** `server/serverevents/Voice.event.ts:8`

```typescript
mp.events.add("server::voice:addListener", (player: PlayerMp, targetId: number) => {
    if (player == null || !mp.players.exists(player)) return;  // only existence check
    const target = mp.players.at(targetId);  // targetId is client-supplied
    if (target && mp.players.exists(target)) player.enableVoiceTo(target);
});
```

Unlike virtually every other server event handler in the codebase, these voice events do **not** check `player.getVariable("loggedin")`. A connecting (pre-login) player can call `enableVoiceTo` / `disableVoiceTo` for any player ID they supply. No range or team check is applied.

---

## Section 3 — Suspicious / Undocumented Usage

### 3.1 `(target as any).currentCefPage` — setter not found via obvious search
**Files:** `server/serverevents/Player.event.ts`, `server/serverevents/Admin.event.ts:321,417,489`

Used in page-routing decisions and admin dashboard snapshot. If the property is never written (setter not found in files read), all CEF page routing falls back to `""` (empty string) and admin panel "current page" shows blank.

### 3.2 `(player as any).sessionStartedAt` — setter provenance unknown
**File:** `server/serverevents/Admin.event.ts:341`

Used to calculate playtime in admin dashboard. If never set, `sessionStartedAt ?? Date.now()` always returns `Date.now()` at query time → playtime always 0 minutes.

### 3.3 `(player as any)._lastChatTick` — dynamic property on RAGE:MP entity
**File:** `server/serverevents/Chat.event.ts:196`

Rate-limit state stored directly on the RAGE:MP `PlayerMp` object. Works in practice but depends on RAGE:MP not garbage-collecting or recycling the player object reference between ticks.

### 3.4 450 ms admin spectate roster broadcast — O(n × sessions) payload
**File:** `server/serverevents/Player.event.ts` (`startAdminSpectateSession`)

`setInterval(push, 450)` JSON-stringifies the full roster every 450 ms per active admin spectate session. Multiple simultaneous sessions scale linearly. On a populated server, this generates significant JSON serialization + `player.call` traffic per tick.

### 3.5 `client:ShowHitmarker` — inconsistent event namespace convention
**File:** `server/serverevents/DamageSync.event.ts:287,320`

```typescript
shooter.call("client:ShowHitmarker", [...]);
```

Project convention is `client::namespace:event` (double colon). This call uses `client:ShowHitmarker` (single colon). If the client registers the handler with double-colon notation and RAGE:MP does exact string matching, the hitmarker never appears without error.

### 3.6 `(mp.peds as any).atRemoteId` — cast `as any`, may not exist at runtime
**File:** `server/serverevents/DamageSync.event.ts:296`

```typescript
if ((mp.peds as any).atRemoteId) return (mp.peds as any).atRemoteId(pedId);
const ped = mp.peds.at(pedId);
// fallback: iterates all peds
```

`atRemoteId` is existence-checked before calling (correct defensive pattern), but the fallback iterates all server peds by pool index — O(N) per bot hit event.

### 3.7 `CEFEvent.emitAsync()` — no timeout on server-side `callProc`
**File:** `server/classes/CEFEvent.class.ts`

`emitAsync()` calls `player.callProc()` which returns a Promise that resolves only when the client-side proc responds. If the CEF page is closed or unresponsive, the Promise never resolves. No timeout is set; async callers that `await emitAsync(...)` can leak indefinitely.

---

## Section 4 — Wrong-Runtime-Side Risks

### 4.1 `client::admin:getWaypointPos` sends NaN to server when waypoint absent
**File:** `client/clientevents/Player.event.ts:222`

```typescript
mp.events.callRemote("server::admin:waypointResult", NaN, NaN, NaN);
```

Server receives three NaN float arguments. If the server handler uses these directly as coordinates (e.g., `player.position = new mp.Vector3(x, y, z)` or `mp.vehicles.new(hash, pos, ...)`) without `Number.isFinite()` guards, the entity position is corrupted. The handler receiving this was not in scope of files read — unverified whether guarded.

### 4.2 CEF proc hang risk — `emitAsync` without timeout
**File:** `server/classes/CEFEvent.class.ts`

`player.callProc()` is a RAGE:MP client→server async round-trip. If the client disconnects mid-call, the server Promise never settles. This is a wrong-assumption risk: callers treat it as always-resolving.

---

## Section 5 — Signature / Parameter Mismatch Risks

### 5.1 `client::player:setVitals` overloaded signature — array branch is dead code
**File:** `client/clientevents/Player.event.ts:89`

```typescript
mp.events.add("client::player:setVitals", (healthOrArr: number | number[], armour?: number) => {
    const rawHealth = Array.isArray(healthOrArr) ? (healthOrArr[0] ?? 100) : healthOrArr;
    const rawArmour = Array.isArray(healthOrArr) ? (healthOrArr[1] ?? 100) : (armour ?? 100);
```

All actual callers in the codebase use `player.call(ClientEvents.PLAYER_SET_VITALS, [victim.health, victim.armour])`. In RAGE:MP, `player.call(name, [a, b])` passes `a` and `b` as two **separate** arguments — client receives `healthOrArr=a` (number) and `armour=b` (number). The `Array.isArray()` branch only triggers if someone passes a single nested-array arg `[[health, armour]]`, which no caller does. The array-handling branch is silently dead.

If a future caller mistakenly does `player.call(name, [[health, armour]])`, the defaults (`?? 100`) would silently apply instead of erroring.

### 5.2 `server:PlayerHit` uses `mp.players.at(victimId)` with client-supplied index
**File:** `server/serverevents/DamageSync.event.ts:172`

```typescript
const victim = mp.players.at(victimId);
```

`victimId` is sent by the shooter's client. `mp.players.at(n)` in RAGE:MP looks up by pool slot, which generally corresponds to `player.id`, but this is not guaranteed across RAGE:MP versions. Preferred for client-supplied IDs is `mp.players.atRemoteId(victimId)` (used elsewhere in the codebase, e.g., Spectate.class.ts). If pool slot ≠ player ID, damage applies to the wrong player.

### 5.3 `client::weapon:giveWeapon` — no hash validation before `giveWeapon()`
**File:** `client/clientevents/Player.event.ts:63`

```typescript
mp.events.add("client::weapon:giveWeapon", (weapon: number, totalAmmo: number) => {
    mp.players.local.giveWeapon(weapon, totalAmmo, true);
});
```

`weapon` comes from a server-side `player.call`. No validation that it is a known/non-zero hash before passing to `giveWeapon()`. Passing `0`, `-1`, or an unmapped hash to `giveWeapon()` can cause GTA V scripting engine errors or give corrupted weapon entries.

### 5.4 CEFEvent `emit()` args array shape
**File:** `server/classes/CEFEvent.class.ts`

```typescript
return player.call("client::eventManager", [eventName, obj]);
```

RAGE:MP `player.call(event, [arg1, arg2])` passes `arg1` and `arg2` as separate arguments to the client handler. The client's `client::eventManager` handler must expect `(eventName: string, data: any)` as separate positional args — not a single array. This appears consistent with Browser.class.ts's handler signature, but the coupling is implicit and fragile.

---

## Section 6 — Unverified Items (Live Doc Access Not Available)

| # | Item | Reason unverified |
|---|------|-------------------|
| 1 | `new mp.Event(name, fn)` constructor | Not in RAGE:MP TS types; live runtime behavior unknown; no official docs available |
| 2 | `mp.events.add({key: fn})` object syntax | Not in RAGE:MP official API; live runtime behavior unknown |
| 3 | Client-side code that emits `server:PlayerHit` | The client incomingDamage handler file was not read; victimId type (remoteId vs pool index) unconfirmed |
| 4 | `(mp.peds as any).atRemoteId` runtime existence | Cast `as any`; not in RAGE:MP TS types; whether exists in deployed version unknown |
| 5 | `server::admin:waypointResult` handler | Whether it guards `Number.isFinite()` before using NaN coords — handler file not read |
| 6 | `currentCefPage` assignment | Where this property is written on the server player object — not found in files read |
| 7 | `sessionStartedAt` assignment | Where this property is written — not found in files read |
| 8 | RAGE:MP `player.call` arg flattening | Whether `[arg1, arg2]` is passed as two separate args or as one array — depends on undocumented RAGE:MP runtime behavior |

---

## Section 7 — Top Dangerous Findings (Priority Order)

| Rank | Severity | Finding | File | Impact |
|------|----------|---------|------|--------|
| 1 | **CRITICAL** | `emitServer()`/`emitClient()` zero-allowlist CEF bridge — any event name injectable from CEF | `client/classes/Browser.class.ts` | Full arbitrary event injection: unfreeze self, set own vitals, call any server RPC |
| 2 | **HIGH** | `new mp.Event()` non-standard constructor — all RAGERP.cef.register handlers may silently never fire | `server/classes/CEFEvent.class.ts` | All Auth/Arena/Admin/Wardrobe/etc. CEF→server RPCs drop silently |
| 3 | **HIGH** | `mp.events.add({})` object syntax — `playerJoin`/`playerQuit` may silently never fire | `server/serverevents/Player.event.ts` | No session creation on join, no cleanup on quit |
| 4 | **HIGH** | `arena::debugEndRound` — zero authorization check | `server/serverevents/Arena.event.ts:87` | Any player can force-end their own match round with chosen winner |
| 5 | **MEDIUM** | `server::voice:addListener/removeListener` — no `loggedin` check; any player ID accepted | `server/serverevents/Voice.event.ts` | Pre-auth players can manipulate voice streams; no range/team enforcement |
| 6 | **MEDIUM** | `server:PlayerHit` uses `mp.players.at(victimId)` with client-supplied index | `server/serverevents/DamageSync.event.ts:172` | Potential wrong-player damage if pool slot ≠ player.id |
| 7 | **MEDIUM** | `client::admin:getWaypointPos` sends NaN coords to server | `client/clientevents/Player.event.ts:222` | Server may corrupt entity position if waypointResult handler lacks NaN guard |

---

*Audit scope: Events/Networking family only. No code modified. No fixes applied.*  
*Written: 2026-04-25*
