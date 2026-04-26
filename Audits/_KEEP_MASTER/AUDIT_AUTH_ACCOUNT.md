# AUDIT_AUTH_ACCOUNT.md — Auth / Account / Character / Session Lifecycle

**Date:** 2026-04-24
**Auditor:** Claude Sonnet 4.6 (hostile read-only pass)
**Scope:** `Auth.event.ts`, `Character.event.ts`, `Player.event.ts`, `discordAuth/*`, client `Auth.event.ts`, client `Player.event.ts`, `Browser.class.ts` (routing), frontend auth + selectcharacter pages
**RAGE:MP wiki:** https://wiki.rage.mp/wiki/Main_Page — returned HTTP 403 during audit. All RAGE:MP API behavior is marked **UNVERIFIED AGAINST LIVE DOCS** unless confirmed by code pattern or corroborated by multiple sources. No API calls or command codes were invented; all code references are taken directly from the source files read.

---

## Auth Flow (Context)

```
PASSWORD LOGIN
  CEF AuthForm
    → EventManager.emitServer("auth","loginPlayer",{username,password})
    → mp.events.callRemote("server::auth:loginPlayer", data)
  Server (Auth.event.ts:41)
    → DB lookup by username (case-insensitive)
    → bcrypt.compare / SHA-256 fallback
    → enterGameWithAccount(player, accountData)
    → player.account = accountData
    → spawnWithCharacter(player, characters[0])   ← always picks index 0; selectcharacter page bypassed
    → player.setVariable("loggedin", true)
    → CEF → mainmenu

DISCORD OAUTH
  CEF → auth::discordStart
  Server (Auth.event.ts:78)
    → crypto.randomBytes(32) = state (64 hex chars, 15-min TTL)
    → player.call("client::auth:discordOpen", [discordUrl])
  Client (Auth.event.ts:50)
    → mp.browsers.new(url)                       ← second CEF browser, no URL validation
  Discord → http://127.0.0.1:{port}/auth/discord/callback
  Server HTTP handler (DiscordOAuthServer.ts:72)
    → consumeOAuthState(state)                   ← state consumed on first use, TTL checked
    → exchangeDiscordOAuthCode(...)               ← no timeout
    → fetchDiscordUserMe(token)                  ← no timeout
    → Existing Discord user → enterGameWithAccount(player, existing)   ← no already-authed check
    → New Discord user  → createPendingRegistration(28 bytes, playerId-bound, 30-min TTL)
                        → cef.emit(player, "auth","discordPending", {pendingToken, suggestion})
  CEF DiscordUsernameForm → auth::completeDiscordRegistration
  Server (Auth.event.ts:106)
    → takePendingRegistration(token, player.id)  ← validates playerId binding ✓
    → repo.save(accountData) → enterGameWithAccount()

CHARACTER FLOW (post-auth)
  enterGameWithAccount() → spawnWithCharacter(player, characters[0])  if chars > 0
                         → startCreatorFlow(player)                    if no chars
  creator::create (Character.event.ts:154)
    → player.account check: kicks if null ✓
    → CharacterEntity.save() → spawnWithCharacter()
  character::select (Character.event.ts:132)
    → NO account check, NO ownership check     ← CRITICAL (live but bypassed by current flow)

DISCONNECT / RECONNECT
  onPlayerJoin: player.account=null, player.character=null, loggedin=false  ✓
  onPlayerQuit: saves char position to DB, clears match/combat/snapshot state  ✓
  clearDiscordPendingForPlayer on playerQuit ✓
```

---

## 1. Critical Findings

### AUTH-C01 — `character::select` has no authentication or ownership check
**File:** `Character.event.ts:132–144`
**Severity:** CRITICAL — confirms existing finding C05; directly verified in code

```typescript
RAGERP.cef.register("character", "select", async (player: PlayerMp, data: string) => {
    let id: number;
    try { id = JSON.parse(data); } catch { return player.showNotify(...); }

    const character = await RAGERP.database.getRepository(CharacterEntity)
        .findOne({ where: { id } });    // ← NO ownership check
    if (!character) return player.showNotify(...);
    await spawnWithCharacter(player, character);  // ← spawns with ANY character ID
});
```

**Two independent failures:**

1. **No auth gate** — `player.account` is never checked. An unauthenticated player (pre-login) can fire this event.
2. **No ownership check** — `character.account.id` is never compared to `player.account.id`. Any authenticated player can supply any numeric ID from the DB.

`RAGERP.cef.register` maps to `new mp.Event("server::character:select", handler)` (CEFEvent.class.ts:51). Any client can call `mp.events.callRemote("server::character:select", anyId)` regardless of what CEF page the server thinks they are on. There is no framework-level auth gate in `Cef_Event.register`.

> **Note:** The current main flow bypasses this handler — `enterGameWithAccount` always uses `characters[0]` directly. The handler is legacy code, but it is **still registered and live**.

**Impact:** Any player can spawn as any character in the database — gaining that character's name, appearance, stats, and in-game identity. Exploitable pre-authentication when combined with AUTH-C02.

**Fix:**
```typescript
if (!player.account) return player.kick("Not authenticated.");
// load with ownership relation first:
const character = await repo.findOne({ where: { id }, relations: ["account"] });
if (!character || character.account?.id !== player.account.id)
    return player.kick("Character mismatch.");
```

---

### AUTH-C02 — `character::create` has no authentication gate
**File:** `Character.event.ts:148–150`
**Severity:** CRITICAL — existing finding H13, severity elevated on direct code review

```typescript
RAGERP.cef.register("character", "create", async (player: PlayerMp) => {
    startCreatorFlow(player);  // ← no player.account check
});
```

`startCreatorFlow` (lines 49–62):
- `exitMainMenuHoldingState(player)` — changes player dimension/state
- `enterCreatorPreviewState(player)` — teleports player to dimension `CREATOR_PREVIEW_DIMENSION_BASE + player.id`
- `player.call("client::creator:start")` — starts creator UI on client
- `RAGERP.cef.emit(player, "system","setPage","creator")` — routes CEF to creator page

An unauthenticated player can call `server::character:create` and be teleported to a preview dimension with the creator UI opened. The actual `creator::create` handler *does* check `if (!player.account) return player.kick(...)`, so character creation is blocked there. However, the dimension change and CEF routing happen pre-authentication.

**Compound risk:** An unauthenticated player manipulated into the creator dimension can chain AUTH-C01 (`server::character:select`) to spawn as any character while `player.account` is null — bypassing the kick guard in `creator::create`.

**Fix:**
```typescript
RAGERP.cef.register("character", "create", async (player: PlayerMp) => {
    if (!player.account) return player.kick("Not authenticated.");
    startCreatorFlow(player);
});
```

---

## 2. High Findings

### AUTH-H01 — No rate limiting on `loginPlayer` — brute-force attack vector
**File:** `Auth.event.ts:41–75`
**Severity:** HIGH — new finding

```typescript
RAGERP.cef.register("auth", "loginPlayer", async (player, data) => {
    const { username, password } = RAGERP.utils.parseObject(data);
    if (!username || !password) { return player.showNotify(...); }
    const accountData = await RAGERP.database.getRepository(AccountEntity)
        .findOne({ where: { username: String(username).toLowerCase() }, relations: ["characters"] });
    if (!accountData) { return player.showNotify(..., "We could not find that account!"); }
    // ...
    const passwordValid = await verifyPassword(password, accountData.password);
    if (!passwordValid) return player.showNotify(..., "Wrong password.");
    // ← no attempt counter, no lockout, no delay, no IP block
```

No mechanism prevents repeated failed login attempts:
- No per-player or per-IP failed attempt counter
- No account lockout after N failures
- No artificial delay on failure path
- No challenge mechanism

`bcrypt.compare` with 12 rounds takes ~200–400 ms server-side — roughly 150–300 attempts per minute per connected player. Multiple simultaneous connections compound this.

**RAGE:MP note (UNVERIFIED AGAINST LIVE DOCS):** RAGE:MP enforces no native rate limit on `callRemote` events. Rate limiting is entirely the application's responsibility.

**Fix:** Track per-player failed attempts in a Map; clear on success or disconnect; lock out for 60 s after 5 failures.

---

### AUTH-H02 — `loginPlayer` allows session overwrite without re-authentication
**Files:** `Auth.event.ts:41`, `AccountSession.ts:7–8`
**Severity:** HIGH — existing finding M11, severity elevated

`enterGameWithAccount` unconditionally overwrites `player.account`:

```typescript
// AccountSession.ts:7–8
export async function enterGameWithAccount(player: PlayerMp, accountData: AccountEntity): Promise<void> {
    player.account = accountData;  // ← always overwrites, no prior-state check
    player.name = player.account.username;
```

An already-authenticated player can call `server::auth:loginPlayer` again with different credentials. The existing session is silently replaced — no kick, no warning, no audit log entry. Combined with C06 (plaintext `.env` with DB credentials in the repo backup), an attacker with access to another account's credentials can mid-session hijack that account's server presence.

**Fix:** At the start of the `loginPlayer` handler:
```typescript
if (player.account) return player.showNotify(RageShared.Enums.NotifyType.TYPE_ERROR, "Already signed in.");
```
Apply the same guard inside `enterGameWithAccount`.

---

### AUTH-H03 — Discord HTTPS client has no request timeout
**File:** `discordHttps.ts:8–39`
**Severity:** HIGH — existing finding H12, directly confirmed

```typescript
const req = https.request(opt, (res) => {
    const chunks: Buffer[] = [];
    res.on("data", (c) => chunks.push(c as Buffer));
    res.on("end", () => { /* resolve */ });
});
req.on("error", reject);
if (body) req.write(body);
req.end();
// ← No req.setTimeout(), no req.destroy()
```

Both `exchangeDiscordOAuthCode` and `fetchDiscordUserMe` use this function. If Discord's API accepts the TCP connection but sends no data (partial hang), the Promise never resolves or rejects. The OAuth callback's `processFlow` async function awaits these calls and will stay suspended indefinitely. The player's CEF overlay remains open with no recovery path short of reconnecting.

**Fix:**
```typescript
req.setTimeout(10000, () => {
    req.destroy(new Error("Discord API request timed out"));
});
```

---

### AUTH-H04 — Discord OAuth callback does not check if player is already authenticated
**File:** `DiscordOAuthServer.ts:186–225`
**Severity:** HIGH — new finding

```typescript
const target = resolvePlayerById(st.playerId);
// ...
if (existing) {
    // ...
    await enterGameWithAccount(pl, existing);  // ← overwrites pl.account unconditionally
```

`auth::discordStart` (Auth.event.ts:78) creates a new OAuth state for any calling player regardless of whether `player.account` is already set. When the Discord callback fires, `enterGameWithAccount` replaces the player's current account with the Discord-linked account. A player logged in as account A can start Discord OAuth, complete it as account B (a different Discord user), and swap accounts mid-session without kicking or alerting.

**Privilege escalation path:** If an attacker can authenticate Discord as an admin's linked account, `enterGameWithAccount` sets `player.account = adminAccount`, making `player.account.adminlevel` the admin's level. Combined with H02 (no session-overwrite guard), this provides full privilege escalation.

**Fix:** In `auth::discordStart`:
```typescript
if (player.account) return player.showNotify(..., "Already signed in.");
```
And in `DiscordOAuthServer.ts` before `enterGameWithAccount`:
```typescript
if (!target || target.account !== null) { closeOverlay(); return; }
```

---

### AUTH-H05 — `creator::navigation` has no auth/state gate; no type check on parsed name
**File:** `Character.event.ts:116–127`
**Severity:** HIGH — new finding

```typescript
RAGERP.cef.register("creator", "navigation", async (player: PlayerMp, name: string) => {
    let parsedName: string;
    try {
        parsedName = JSON.parse(name);  // ← result is 'any', not guaranteed string
    } catch { return player.showNotify(...); }
    name = parsedName;

    const cameraName = "creator_" + name;  // ← arbitrary string concat, no sanitization
    player.call("client::creator:changeCamera", [cameraName]);
});
```

**Two independent issues:**

1. **No auth/creator-state gate:** Any player can call `server::creator:navigation` at any time, including pre-authentication and outside the creator flow. The handler fires `player.call("client::creator:changeCamera", [...])` on the target player unconditionally.

2. **No type check on `parsedName`:** `JSON.parse("123")` returns `123` (number); `JSON.parse("{}")` returns `{}` (object). `"creator_" + 123` = `"creator_123"`; `"creator_" + {}` = `"creator_[object Object]"`. These arbitrary strings are sent to the client.

**Impact:** Any player can trigger unexpected camera-change client events on any player currently in the creator flow. Input is not sanitized before being string-concatenated and dispatched to the client.

**Fix:**
```typescript
if (!player.account) return;
if (typeof parsedName !== "string" || parsedName.length > 64) return player.showNotify(..., "Invalid navigation.");
```

---

### AUTH-H06 — Discord OAuth URL passed to client CEF without scheme/host validation
**File:** `source/client/clientevents/Auth.event.ts:50–57`
**Severity:** HIGH — existing finding H03, confirmed

```typescript
mp.events.add("client::auth:discordOpen", (url: string) => {
    if (!url || typeof url !== "string") return;
    // ← no url.startsWith("https://discord.com/") guard
    discordOAuthBrowser = mp.browsers.new(url);  // opens any URL in CEF
});
```

The URL is server-built (`buildDiscordAuthorizeUrl` always produces a `https://discord.com` URL). However, there is no client-side guard. If the server is compromised or the transport is MITM-attacked, any URL can be opened in the player's Chromium overlay. Combined with `allow-cef-debugging: true` in `conf.json` (existing finding H04), this allows arbitrary web content injection into the player's CEF context.

**RAGE:MP note (UNVERIFIED AGAINST LIVE DOCS):** `mp.browsers.new(url)` opens a Chromium-based browser overlay. Security of the loaded content depends entirely on the URL.

**Fix:**
```typescript
if (!url.startsWith("https://discord.com/api/oauth2/authorize")) return;
```

---

## 3. Medium Findings

### AUTH-M01 — No DB transaction on character creation or account creation
**Files:** `Character.event.ts:154–193`, `Auth.event.ts:106–160`
**Severity:** MEDIUM — existing finding H11, scope confirmed

`creator::create` (multi-step, no transaction):
```typescript
const result = await RAGERP.database.getRepository(CharacterEntity).save(characterData); // step 1
if (!result) return;
player.character = result;
player.setVariable("loggedin", true);
await spawnWithCharacter(player, result);  // step 2 (multiple side-effects)
```

`completeDiscordRegistration` (multi-step, no transaction):
```typescript
const saved = await repo.save(accountData);                                       // step 1
const loaded = await repo.findOne({ where: { id: saved.id }, relations: [...] }); // step 2
if (!loaded) { return player.showNotify(...); }
await enterGameWithAccount(player, loaded);                                       // step 3
```

A server crash between steps leaves: an orphaned character row (character exists in DB, player never spawned) or an orphaned account row (account saved, player never entered game). The player may be unable to recover without manual DB intervention on next login.

**Fix:** Wrap each multi-step create path in a TypeORM `QueryRunner` transaction with explicit `commit` / `rollback`.

---

### AUTH-M02 — `loginPlayer`: no server-side input length validation before DB query and bcrypt
**File:** `Auth.event.ts:41–75`
**Severity:** MEDIUM — new finding

```typescript
const { username, password } = RAGERP.utils.parseObject(data);
if (!username || !password) { return player.showNotify(...); }
// ← no length bounds checked before DB query or bcrypt.compare
```

- **Username:** DB column is `varchar(32)`. A username longer than 32 chars sent to `findOne({ where: { username } })` will cause a TypeORM/MySQL error. No `try/catch` on the `findOne` call in `loginPlayer` — this propagates as an unhandled async rejection.
- **Password:** bcrypt.js internally truncates passwords at 72 bytes before hashing. A very large password (e.g., 10 MB) sent before truncation still causes unnecessary memory allocation in `RAGERP.utils.parseObject`. Not a meaningful CPU attack against bcrypt itself, but a memory/allocation concern.

**Fix:**
```typescript
if (String(username).length > 32 || String(password).length > 128)
    return player.showNotify(RageShared.Enums.NotifyType.TYPE_ERROR, "Invalid credentials.");
```

---

### AUTH-M03 — Ban expiry `parseInt(lifttime)` produces `NaN` on malformed values
**File:** `Player.event.ts:244`
**Severity:** MEDIUM — existing finding M09, confirmed with risk re-assessment

```typescript
if (RAGERP.utils.hasDatePassedTimestamp(parseInt(banData.lifttime))) {
    await RAGERP.database.getRepository(BanEntity).delete({ id: banData.id });
}
```

If `banData.lifttime` is `null`, `undefined`, or a non-numeric string: `parseInt(null) === NaN`.

`Date.now() > NaN` evaluates to `false` in JavaScript. So `hasDatePassedTimestamp(NaN)` most likely returns `false` — meaning a ban with a corrupt `lifttime` will **never** be auto-expired and stays permanently enforced. While this is safer than wrongly deleting the ban, it means temporary bans with malformed lift times become silently permanent until manually cleared by an admin.

**Fix:**
```typescript
const liftMs = parseInt(banData.lifttime ?? "");
if (!isNaN(liftMs) && RAGERP.utils.hasDatePassedTimestamp(liftMs)) {
    await RAGERP.database.getRepository(BanEntity).delete({ id: banData.id });
} else if (isNaN(liftMs)) {
    console.error(`[Ban] Malformed lifttime for ban ${banData.id}: "${banData.lifttime}"`);
}
```

---

### AUTH-M04 — Discord pending token transits through CEF with debugging enabled
**Files:** `DiscordOAuthServer.ts:249–253`, `DiscordUsernameForm.tsx:73`
**Severity:** MEDIUM — new finding

```typescript
// Server → CEF (DiscordOAuthServer.ts:249):
RAGERP.cef.emit(target, "auth", "discordPending", { pendingToken, suggestion });

// CEF → Server (DiscordUsernameForm.tsx:73):
EventManager.emitServer("auth", "completeDiscordRegistration", { pendingToken, username: raw });
```

The `pendingToken` (56-char hex, 30-min TTL) transits through the CEF context. With `allow-cef-debugging: true` in `conf.json` (existing finding H04), any player can open Chromium DevTools and inspect the token value in memory or network logs.

However, the server-side `takePendingRegistration(token, player.id)` validates `p.playerId !== playerId`, and `pendingRegByToken.delete(token)` is called on first use — so replay and cross-account theft are blocked. The direct harm is low: a player can only use their own token, and only once.

**Residual risk:** Defense-in-depth failure. If the `playerId` check is ever removed, or if a player can predict another's token (impossible for 28 random bytes), this becomes exploitable. The larger concern is the compound risk with CEF debugging.

---

### AUTH-M05 — `selectcharacter` page sends character ID to server; server has no ownership check
**Files:** `SelectCharacter.tsx:12–13`, `Character.event.ts:132–144`
**Severity:** MEDIUM — amplifier for AUTH-C01

```typescript
// SelectCharacter.tsx:12–13
const selectCharacter = useCallback((id: number) => {
    EventManager.emitServer("character", "select", id);
}, []);
```

The client sends a character ID from `store.characters`. With CEF debugging enabled, any player can inspect `store.characters`, extract IDs, or submit arbitrary IDs directly via `mp.events.callRemote`. Because the server has no ownership check (AUTH-C01), any numeric ID works.

This is the complete exploitation path for AUTH-C01: obtain any character ID (sequential guessing, CEF devtools, or DB leak) → `mp.events.callRemote("server::character:select", targetId)`.

---

## 4. Session / Auth Trust-Boundary Notes

### RAGE:MP event identity guarantee
In RAGE:MP, when a client calls `mp.events.callRemote("server::eventName", data)`, the server handler always receives the **actual sending player** as the first parameter. This identity is provided by the RAGE:MP infrastructure and cannot be spoofed by the client. **UNVERIFIED AGAINST LIVE DOCS** — based on RAGE:MP architecture documentation from training data.

This means the `player` object in all `RAGERP.cef.register` handlers reliably identifies the caller. What **cannot** be trusted are the event arguments — all `data` / `id` / `name` parameters are fully client-controlled.

### CEF event routing is not a trust boundary
`Browser.class.ts:634–638` shows that CEF calls `mp.events.callRemote(event, ...)` with a client-constructed event name:

```typescript
emitServer(receivedData: any): void {
    let data = Utils.tryParse(receivedData);
    let { event, args } = data;
    mp.events.callRemote(event, ...);  // event name is CEF-controlled
}
```

CEF runs in Chromium on the player's machine. A modified client can call any `mp.events.callRemote("server::anyEvent", ...)` directly — bypassing the React UI entirely. Auth handlers must not assume that only the legitimate UI paths will call them.

### Trust table
| Data | Source | Server-trustable? |
|---|---|---|
| `player` (first handler param) | RAGE:MP infrastructure | **Yes** — always the actual sender |
| `player.account` | Set server-side by verified auth | **Yes** — `null` means not authenticated |
| `player.getVariable("loggedin")` | Set server-side by `spawnWithCharacter` | **Yes** |
| `player.getVariable("adminLevel")` | Set from `player.account.adminlevel` | **Yes** — when sourced from DB |
| `player.ping` | Server-side RAGE:MP metric | **Yes** |
| All event `data` / `args` | Client-sent | **No** — validate length, type, ownership |
| `(player as any).currentCefPage` | Client-sent via `server::player:setCefPage` | **No** — cosmetic only |
| `player.serial` | RAGE:MP HWID | **Partial** — spoofable on some RAGE:MP builds (UNVERIFIED) |
| `player.rgscId` | RAGE:MP Social Club ID | **Partial** — may be empty in some configs (UNVERIFIED) |

### No framework-level authentication gate in `RAGERP.cef.register`
`CEFEvent.class.ts` performs no authentication or authorization check when registering or dispatching events. Every `server::page:pointer` event fires for any player regardless of auth state. Authentication must be checked **manually** in each handler.

Current state of auth gates in the files reviewed:
| Handler | Auth gate |
|---|---|
| `auth::loginPlayer` | Not needed (this IS the auth endpoint) ✓ |
| `auth::discordStart` | Not needed (this IS the auth endpoint) ✓ |
| `auth::completeDiscordRegistration` | Not needed (validates via pending token) ✓ |
| `creator::create` | `if (!player.account) return player.kick(...)` ✓ |
| `character::select` | **MISSING** ✗ |
| `character::create` | **MISSING** ✗ |
| `creator::navigation` | **MISSING** ✗ |

### Session invalidation on disconnect is correct
`onPlayerJoin` (Player.event.ts:237–270) sets `player.account = null`, `player.character = null`, `loggedin = false`, and resets all server-side variables before any event can fire on a new connection. `onPlayerQuit` saves character state and cleans up combat/match tracking. `clearDiscordPendingForPlayer` is called on `playerQuit`. **No session resurrection is possible on reconnect.**

### Discord OAuth state management is correct
`discordAuthState.ts` is well-implemented:
- OAuth state: `crypto.randomBytes(32)` = 64-char hex — cryptographically secure ✓
- State consumed on first use (`consumeOAuthState` deletes it immediately) ✓
- State TTL: 15 minutes ✓
- Pending registration token: `crypto.randomBytes(28)` = 56-char hex, TTL 30 minutes ✓
- Token bound to `playerId`: `takePendingRegistration(token, player.id)` checks `p.playerId !== playerId` ✓
- Cleared on player disconnect ✓

The state/token management itself has no issues. Vulnerabilities are in the surrounding flow (AUTH-H04: no already-authed check; AUTH-H03: no HTTP timeout).

---

## 5. RAGE:MP API / Documentation Verification Notes

> **Wiki access:** `https://wiki.rage.mp/wiki/Main_Page` returned HTTP 403 during this audit.
> All behavior below is **UNVERIFIED AGAINST LIVE DOCS** unless noted.
> No API calls or command codes were invented or assumed — all code references are from source files read.

| API call | Location in code | Expected behavior | Verification |
|---|---|---|---|
| `mp.events.callRemote(event, ...args)` | Client-side throughout | First server-handler param = sending player, unforgeable | UNVERIFIED AGAINST LIVE DOCS |
| `mp.browsers.new(url)` | `Auth.event.ts (client):56` | Opens Chromium CEF overlay with given URL | UNVERIFIED AGAINST LIVE DOCS |
| `new mp.Event("server::x:y", handler)` | `CEFEvent.class.ts:51` | Registers a server event listener | UNVERIFIED AGAINST LIVE DOCS |
| `player.call(eventName, argsArray)` | Throughout server | Server → specific client event dispatch | UNVERIFIED AGAINST LIVE DOCS |
| `player.rgscId` | `Auth.event.ts:136` | Social Club / Rockstar ID | UNVERIFIED — may be empty or spoofable |
| `player.serial` | `Player.event.ts:240` | Hardware serial (HWID) | UNVERIFIED — historically spoofable on some builds |
| `player.ip` | `Player.event.ts:240` | Client IP address | UNVERIFIED — may be proxy/NAT IP |
| `mp.players.exists(player)` | Throughout | Validates player object is live | UNVERIFIED AGAINST LIVE DOCS |
| `player.setVariable(key, value)` | Throughout | Synced variable; available to client via `getVariable` | UNVERIFIED — sync scope unclear |
| `player.account` | Throughout | Custom TypeScript prototype extension, NOT native RAGE:MP | Application-defined — safe to trust server-side |
| `player.getAdminLevel()` | `Player.event.ts:359,362` | Custom method, source not read in this audit | Application-defined |

**Note on `player.serial` and ban system:** The ban check at `Player.event.ts:240` includes `serial: player.serial` as a HWID vector. RAGE:MP `player.serial` reliability depends on client version and server anti-cheat configuration. On older RAGE:MP builds this value has been spoofable. Combined with existing finding H10 (no `rsgId` in ban record), hardware bans may be bypassable. Requires live-testing against the deployed RAGE:MP version. **UNVERIFIED AGAINST LIVE DOCS.**

---

## 6. Runtime Test Checklist — Auth / Account Only

### Pre-auth event injection
- [ ] Connect without completing auth. Call `mp.events.callRemote("server::character:select", 1)` directly.
  **Expect:** kicked or rejected. **Currently:** player spawns as character ID 1.
- [ ] Connect without completing auth. Call `mp.events.callRemote("server::character:create")`.
  **Expect:** kicked or rejected. **Currently:** player is teleported to creator preview dimension, creator UI opens.
- [ ] Connect without completing auth. Call `mp.events.callRemote("server::creator:navigation", '"general"')`.
  **Expect:** rejected. **Currently:** `changeCamera` event fires on the player.
- [ ] Connect without completing auth. Call `mp.events.callRemote("server::creator:create", '{}')`.
  **Expect:** player kicked. **Currently:** correctly kicks with "An error has occurred!" ✓

### Password login security
- [ ] Send `server::auth:loginPlayer` 30 times per second with wrong passwords for a known username.
  **Expect:** rate-limited after ~5 failures. **Currently:** no rate limit.
- [ ] Send a second `server::auth:loginPlayer` call while already authenticated.
  **Expect:** rejected. **Currently:** session silently overwritten.
- [ ] Send a login request with `username` = 500-character string.
  **Expect:** rejected at length check. **Currently:** TypeORM error / unhandled rejection.
- [ ] Send a login request with `password` = 1 MB string.
  **Expect:** rejected at length check. **Currently:** bcrypt truncates at 72 bytes (limited risk), but large allocation occurs.

### Discord OAuth flow
- [ ] Start Discord OAuth while already authenticated via password.
  **Expect:** rejected ("Already signed in"). **Currently:** OAuth flow starts; callback will overwrite session.
- [ ] Complete Discord OAuth callback twice using the same state (browser back/forward replay).
  **Expect:** second attempt rejected. **Currently:** correctly rejected — state consumed on first use ✓
- [ ] Start Discord OAuth; wait 16 minutes; complete callback.
  **Expect:** "Session expired" (try again). **Currently:** correctly expired by TTL check ✓
- [ ] Simulate Discord API hang during `exchangeDiscordOAuthCode` (no response after TCP connect).
  **Expect:** timeout + error to player after ~10 s. **Currently:** Promise hangs indefinitely; player stuck.
- [ ] Start Discord OAuth; trigger a server notification (e.g., welcome message) before completing.
  **Expect:** OAuth spinner unaffected. **Currently:** spinner resets (existing L17 bug).

### Character ownership
- [ ] Authenticate as player A (account_id=1, character_id=1). Call `server::character:select` with character_id=2 (owned by account_id=2).
  **Expect:** kicked or rejected. **Currently:** player spawns as character 2.
- [ ] Authenticate as player A. Call `server::character:select` with character_id=999999 (does not exist).
  **Expect:** `showNotify` error. **Currently:** correctly shows error ✓

### Session invalidation
- [ ] Authenticate → disconnect → reconnect within 60 s. Confirm `player.account === null` until re-auth completes.
- [ ] Authenticate → disconnect mid-character-creation (between DB save and `spawnWithCharacter`). Confirm orphaned character row exists. Confirm player can log in and select it on next session.

### Ban system edge cases
- [ ] Create a ban record with `lifttime = NULL` in DB. Connect with that player.
  **Expect:** ban enforced permanently. Verify no auto-delete fires.
- [ ] Create a ban record with `lifttime = "notanumber"`. Connect.
  **Expect:** same as above.
- [ ] Ban a player. Player changes IP and reconnects (no HWID spoof).
  **Expect:** ban still applied via `serial` match. Verify this actually fires.
- [ ] Ban a player. Player changes IP + spoofs serial. Confirm ban bypassable (existing H10 gap: no `rsgId` in ban record).
