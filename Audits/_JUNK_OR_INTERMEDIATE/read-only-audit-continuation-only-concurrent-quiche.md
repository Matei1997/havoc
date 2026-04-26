# Audit Plan — Stage 1 + Auth/Account Subsystem

## ─── PART A: Stage 1 Consolidation (previously planned) ───

### Output files (worktree root)
- `AUDIT_REPORT_STAGE1.md` — Executive summary, inventory, top-10 fix list, test checklist
- `AUDIT_FINDINGS_STAGE1.md` — All 70 issues with verified/unverified markers
*(content described in prior plan — unchanged)*

---

## ─── PART B: AUDIT_AUTH_ACCOUNT.md ───

### Output file
`C:\Users\Matei\Downloads\arena-server-backup-master\.claude\worktrees\relaxed-rubin-fbda0d\AUDIT_AUTH_ACCOUNT.md`

### Source files read (all fully read)
| File | Lines |
|---|---|
| `source/server/serverevents/Auth.event.ts` | 171 |
| `source/server/serverevents/Character.event.ts` | 198 |
| `source/server/serverevents/Player.event.ts` | 386 |
| `source/server/modules/discordAuth/AccountSession.ts` | 18 |
| `source/server/modules/discordAuth/discordAuthState.ts` | 76 |
| `source/server/modules/discordAuth/DiscordOAuthServer.ts` | 288 |
| `source/server/modules/discordAuth/discordHttps.ts` | 97 |
| `source/client/clientevents/Auth.event.ts` | 65 |
| `source/client/clientevents/Player.event.ts` | 241 |
| `source/client/classes/Browser.class.ts` | 666 |
| `source/server/classes/CEFEvent.class.ts` | 136 |
| `source/server/api/index.ts` | 103 |
| `source/server/database/entity/Account.entity.ts` | 41 |
| `source/server/modules/menu/MainMenuState.module.ts` | 39 |
| `frontend/src/pages/auth/Authentication.tsx` | 269 |
| `frontend/src/pages/auth/components/AuthForm.tsx` | 197 |
| `frontend/src/pages/auth/components/DiscordUsernameForm.tsx` | 140 |
| `frontend/src/pages/selectcharacter/SelectCharacter.tsx` | 61 |

---

### Auth Flow Summary (for document context section)

```
Password login:
  CEF AuthForm → EventManager.emitServer("auth","loginPlayer",{username,password})
  → client::eventManager::emitServer → mp.events.callRemote("server::auth:loginPlayer", JSON.stringify({username,password}))
  → server Auth.event.ts: RAGERP.cef.register("auth","loginPlayer")
  → DB lookup by username → bcrypt.compare → enterGameWithAccount()
  → player.account = accountData
  → spawnWithCharacter(player, characters[0])  [skips selectcharacter entirely]
  → player.setVariable("loggedin", true) + CEF → mainmenu

Discord OAuth:
  CEF → "auth::discordStart" → server creates crypto state (32 bytes, 15min TTL)
  → player.call("client::auth:discordOpen", [discordUrl])
  → client opens mp.browsers.new(discordUrl) [second browser]
  → Discord redirects → http://127.0.0.1:{port}/auth/discord/callback
  → server HTTP handler: consumeOAuthState(state) → exchange code → fetch /users/@me
  → Existing user: enterGameWithAccount(player, existing)
  → New user: createPendingRegistration(28 bytes, 30min TTL, playerId-bound)
             → RAGERP.cef.emit(player, "auth","discordPending", {pendingToken, suggestion})
             → CEF shows DiscordUsernameForm → user submits username + pendingToken
             → "auth::completeDiscordRegistration": takePendingRegistration(token, player.id) validates playerId binding
             → save AccountEntity → enterGameWithAccount()

Character selection/creation:
  enterGameWithAccount() → spawnWithCharacter(player, characters[0]) if chars exist
  otherwise → startCreatorFlow() → creator::create → saves CharacterEntity
  character::select event still registered but bypassed by current flow
```

---

### AUDIT_AUTH_ACCOUNT.md — Full Content

---

```markdown
# AUDIT_AUTH_ACCOUNT.md — Auth / Account / Character / Session Lifecycle
**Date:** 2026-04-24
**Auditor:** Claude Sonnet 4.6 (hostile read-only pass)
**Scope:** Auth.event.ts, Character.event.ts, Player.event.ts, discordAuth/*, client Auth.event.ts, client Player.event.ts, Browser.class.ts (routing), frontend auth + selectcharacter pages
**RAGE:MP wiki:** https://wiki.rage.mp/wiki/Main_Page — returned HTTP 403 during audit. All RAGE:MP API behavior marked UNVERIFIED AGAINST LIVE DOCS unless confirmed by code pattern or multiple sources.

---

## 1. CRITICAL FINDINGS

### AUTH-C01 — character::select has no authentication or ownership check
**Files:** `Character.event.ts:132–144`
**Severity:** CRITICAL (existing finding C05, directly verified)

```typescript
RAGERP.cef.register("character", "select", async (player: PlayerMp, data: string) => {
    let id: number;
    try { id = JSON.parse(data); } catch { return player.showNotify(...); }
    const character = await RAGERP.database.getRepository(CharacterEntity)
        .findOne({ where: { id } });   // ← NO ownership check
    if (!character) return player.showNotify(...);
    await spawnWithCharacter(player, character);  // ← spawns with any character
});
```

Two independent failures:
1. **No auth gate** — `player.account` is never checked. An unauthenticated player can call `server::character:select` directly.
2. **No ownership check** — `character.account.id` is never compared to `player.account.id`. Any authenticated player can pass any numeric character ID from the DB.

`RAGERP.cef.register` maps directly to `new mp.Event("server::character:select", handler)` (CEFEvent.class.ts:51). Any client can call `mp.events.callRemote("server::character:select", anyId)` at any time regardless of what page the server believes the player is on.

**Note:** Current main flow bypasses `character::select` — `enterGameWithAccount` always takes `characters[0]`. The handler is a leftover but is still live and registered.

**Impact:** Any player can spawn with any character in the database — appearance, name, and stats. Combined with AUTH-C02, this is exploitable pre-authentication.

**Fix:** Add at the top of the handler:
```typescript
if (!player.account) return player.kick("Not authenticated.");
if (character.account?.id !== player.account.id) return player.kick("Character mismatch.");
```

---

### AUTH-C02 — character::create has no authentication gate
**Files:** `Character.event.ts:148–150`
**Severity:** CRITICAL (existing finding H13, re-classified up on review)

```typescript
RAGERP.cef.register("character", "create", async (player: PlayerMp) => {
    startCreatorFlow(player);  // ← no player.account check
});
```

`startCreatorFlow` (lines 49–62):
- Sets `player.setVariable("adminLevel", player.account?.adminlevel ?? 0)` — no account = 0, harmless
- Calls `exitMainMenuHoldingState(player)` — safe
- Calls `enterCreatorPreviewState(player)` — teleports player to a preview dimension (`CREATOR_PREVIEW_DIMENSION_BASE + player.id`)
- Sends CEF page change to "creator"

Any unauthenticated player can call `server::character:create` and be teleported to the creator preview dimension and have the creator UI opened. The actual `creator::create` handler does check `if (!player.account) return player.kick(...)`, so character creation itself is blocked. But the state manipulation (dimension change, camera events) occurs pre-authentication.

**Compound risk:** An unauthenticated player in the creator dimension does not have `player.account` set. If the player then calls `server::character:select` (AUTH-C01), they can spawn with any character while `player.account` is null, bypassing even the minimal kick guard.

**Fix:**
```typescript
RAGERP.cef.register("character", "create", async (player: PlayerMp) => {
    if (!player.account) return player.kick("Not authenticated.");
    startCreatorFlow(player);
});
```

---

## 2. HIGH FINDINGS

### AUTH-H01 — No rate limiting on loginPlayer (brute-force attack vector)
**Files:** `Auth.event.ts:41–75`
**Severity:** HIGH (new finding)

```typescript
RAGERP.cef.register("auth", "loginPlayer", async (player, data) => {
    const { username, password } = RAGERP.utils.parseObject(data);
    // ...
    const accountData = await RAGERP.database.getRepository(AccountEntity)
        .findOne({ where: { username: String(username).toLowerCase() }, relations: ["characters"] });
    // ...
    const passwordValid = await verifyPassword(password, accountData.password);
    if (!passwordValid) return player.showNotify(..., "Wrong password.");
    // ← no attempt counter, no lockout, no delay, no ban
```

No mechanism prevents repeated failed login attempts:
- No per-IP attempt counter
- No per-account lockout after N failures
- No artificial delay on failure
- No CAPTCHA or challenge

A malicious client can call `mp.events.callRemote("server::auth:loginPlayer", ...)` in a tight loop. `bcrypt.compare` with 12 rounds takes ~200–400ms server-side — so ~150–300 attempts/minute per player connection. With multiple connections this compounds.

**RAGE:MP note (UNVERIFIED AGAINST LIVE DOCS):** RAGE:MP does not enforce any native rate limit on `callRemote` events. Rate limiting is entirely the application's responsibility.

**Fix:** Track per-player failed attempts in a Map (reset on success/disconnect); lock out after 5 failures for 60 seconds.

---

### AUTH-H02 — loginPlayer allows session overwrite without re-authentication
**Files:** `Auth.event.ts:41`, `AccountSession.ts:7–8`
**Severity:** HIGH (existing finding M11, re-classified)

`enterGameWithAccount` unconditionally sets `player.account = accountData` with no prior state check:

```typescript
export async function enterGameWithAccount(player: PlayerMp, accountData: AccountEntity): Promise<void> {
    player.account = accountData;  // ← always overwrites
    player.name = player.account.username;
    // ...
```

An already-authenticated player can call `server::auth:loginPlayer` again with a different account's credentials. The existing session is silently replaced — no kick, no warning, no audit log. Combined with the plaintext `.env` (C06, admin credentials exposed), an attacker knowing another account's credentials can take over their server session mid-match.

**Fix:** Add at start of `loginPlayer` handler:
```typescript
if (player.account) return player.showNotify(RageShared.Enums.NotifyType.TYPE_ERROR, "Already logged in.");
```
Apply the same guard to `enterGameWithAccount`.

---

### AUTH-H03 — Discord HTTPS client has no request timeout
**Files:** `discordHttps.ts:8–39`
**Severity:** HIGH (existing finding H12, confirmed)

```typescript
const req = https.request(opt, (res) => { ... });
req.on("error", reject);
if (body) req.write(body);
req.end();
// ← No req.setTimeout() / req.destroy()
```

Both `exchangeDiscordOAuthCode` and `fetchDiscordUserMe` use this helper. If Discord's API hangs mid-connection (accepts TCP but sends no data), the Promise never resolves or rejects. The OAuth callback handler `processFlow` awaits these and will stay suspended indefinitely. The player's CEF browser overlay remains stuck open with no timeout or recovery path.

**Fix:**
```typescript
req.setTimeout(10000, () => {
    req.destroy(new Error("Discord API request timed out"));
});
```

---

### AUTH-H04 — Discord OAuth callback does not check if player is already authenticated
**Files:** `DiscordOAuthServer.ts:186–225`
**Severity:** HIGH (new finding)

```typescript
const target = resolvePlayerById(st.playerId);
// ...
if (existing) {
    // ...
    await enterGameWithAccount(pl, existing);  // ← no check if pl.account is already set
```

A player who is already authenticated (e.g., logged in via password as account A) can start a Discord OAuth flow. The state is created with `createOAuthState(player.id)` regardless of auth state. When the callback arrives, `enterGameWithAccount(pl, existing)` is called and unconditionally overwrites `pl.account` with account B (the Discord account). This allows a player to switch accounts mid-session or, if they can complete OAuth as an admin's Discord account, elevate their own privileges.

**Fix:** In `DiscordOAuthServer.ts` before calling `enterGameWithAccount`:
```typescript
if (target.account !== null) {
    target.showNotify(RageShared.Enums.NotifyType.TYPE_ERROR, "Already authenticated.");
    closeOverlay();
    return;
}
```
Also add the same guard to `auth::discordStart`:
```typescript
if (player.account) return player.showNotify(..., "Already signed in.");
```

---

### AUTH-H05 — creator::navigation has no auth/state gate and no type check on parsed name
**Files:** `Character.event.ts:116–127`
**Severity:** HIGH (new finding)

```typescript
RAGERP.cef.register("creator", "navigation", async (player: PlayerMp, name: string) => {
    let parsedName: string;
    try {
        parsedName = JSON.parse(name);  // ← result type is 'any', not 'string'
    } catch {
        return player.showNotify(...);
    }
    name = parsedName;
    const cameraName = "creator_" + name;  // ← injected into string without sanitization
    player.call("client::creator:changeCamera", [cameraName]);  // ← sent to client
});
```

Two issues:
1. **No auth/state gate:** Any player can call `server::creator:navigation` at any time, regardless of whether they are in the creator flow.
2. **No type check on `parsedName`:** If the JSON value is `{"__proto__": "..."}`, `[1,2,3]`, or `null`, `parsedName` is not a string. `"creator_" + parsedName` produces `"creator_[object Object]"` etc. and is sent to `client::creator:changeCamera` on an unsuspecting target player.

**Impact:** Any player can trigger unexpected `changeCamera` calls on a player who is in the creator flow. The camera name is arbitrary string-concatenated from client input.

**Fix:** Add `if (!player.account) return;` at the start. Add `if (typeof parsedName !== "string") return player.showNotify(...)`.

---

### AUTH-H06 — Discord OAuth URL has no client-side scheme/host validation
**Files:** `source/client/clientevents/Auth.event.ts:50–57`
**Severity:** HIGH (existing finding H03, confirmed with reduced confidence)

```typescript
mp.events.add("client::auth:discordOpen", (url: string) => {
    if (!url || typeof url !== "string") return;
    // ← no check: url.startsWith("https://discord.com/")
    discordOAuthBrowser = mp.browsers.new(url);
});
```

The URL originates from the server (`buildDiscordAuthorizeUrl` always builds a `discord.com` URL). However, there is no client-side guard. If the server is compromised, any URL can be opened in the player's CEF browser. Combined with H04 (allow-cef-debugging: true), an attacker who controls the server can inject arbitrary web content into the player's CEF.

**RAGE:MP wiki note (UNVERIFIED AGAINST LIVE DOCS):** `mp.browsers.new(url)` opens a Chromium-based browser overlay. The security of content depends on the URL loaded.

**Fix:** `if (!url.startsWith("https://discord.com/")) return;`

---

## 3. MEDIUM FINDINGS

### AUTH-M01 — No DB transaction on character creation or account creation
**Files:** `Character.event.ts:154–193`, `Auth.event.ts:106–160`
**Severity:** MEDIUM (existing finding H11, scope confirmed)

In `creator::create`:
```typescript
const result = await RAGERP.database.getRepository(CharacterEntity).save(characterData);  // step 1
if (!result) return;
player.character = result;
player.setVariable("loggedin", true);
await spawnWithCharacter(player, result);  // step 2 (multiple calls)
```

In `completeDiscordRegistration`:
```typescript
const saved = await repo.save(accountData);           // step 1
const loaded = await repo.findOne({ where: { id: saved.id }, relations: ["characters"] });  // step 2
await enterGameWithAccount(player, loaded);           // step 3
```

Neither operation is wrapped in a database transaction. If the Node.js process crashes between steps:
- Character creation: character row exists in DB but `player.setVariable("loggedin", true)` never fired — player may be stuck until manual fix
- Account creation: account row saved but `enterGameWithAccount` never called — player stuck at OAuth complete screen

**Fix:** Use TypeORM's `queryRunner.startTransaction()` / `commitTransaction()` / `rollbackTransaction()`.

---

### AUTH-M02 — loginPlayer: no server-side input length validation before bcrypt
**Files:** `Auth.event.ts:41–75`
**Severity:** MEDIUM (new finding)

```typescript
const { username, password } = RAGERP.utils.parseObject(data);
if (!username || !password) { return player.showNotify(...); }
// ← no length check on username or password
const passwordValid = await verifyPassword(password, accountData.password);
```

bcrypt has an internal 72-byte limit on password input (passwords longer than 72 bytes are silently truncated to 72 bytes). A malicious actor submitting a 10MB password string would: (a) consume CPU on the `bcrypt.compare` call (though bcrypt truncates to 72 bytes so actual cost is bounded), (b) potentially trigger excessive memory allocation in `RAGERP.utils.parseObject`. A username longer than the DB column (varchar(32)) would cause a TypeORM error that propagates as an unhandled rejection (no try/catch on this path).

**Fix:**
```typescript
if (String(username).length > 32 || String(password).length > 128) {
    return player.showNotify(..., "Invalid credentials.");
}
```

---

### AUTH-M03 — Ban expiry parseInt(NaN) may silently delete permanent bans
**Files:** `Player.event.ts:244`
**Severity:** MEDIUM (existing finding M09, confirmed)

```typescript
if (RAGERP.utils.hasDatePassedTimestamp(parseInt(banData.lifttime))) {
    await RAGERP.database.getRepository(BanEntity).delete({ id: banData.id });
}
```

If `banData.lifttime` is `null`, `undefined`, or a non-numeric string, `parseInt(...)` returns `NaN`. The behavior of `hasDatePassedTimestamp(NaN)` is unknown without reading that implementation. If it returns `true` for `NaN` (e.g., `Date.now() > NaN` evaluates to `false` in JS — wait: `NaN > number` is false, so `hasDatePassedTimestamp(NaN)` likely returns `false`).

Actually: `Date.now() > NaN` → `false`. So `hasDatePassedTimestamp(NaN)` likely returns `false`, meaning a null/malformed lifttime is treated as a ban that has NOT passed — which would cause the ban to stay in force but NEVER be auto-deleted. This means a temporary ban with a corrupt lifttime becomes a de-facto permanent ban until manually cleared.

**Risk re-assessment:** NaN input likely makes permanent-appearing bans rather than deleting them. Still a data integrity bug.

**Fix:** `const liftMs = parseInt(banData.lifttime ?? ""); if (!isNaN(liftMs) && RAGERP.utils.hasDatePassedTimestamp(liftMs)) { ... }`

---

### AUTH-M04 — Discord pending token exposed to CEF / client
**Files:** `DiscordOAuthServer.ts:249–253`, `DiscordUsernameForm.tsx:73`
**Severity:** MEDIUM (new finding)

```typescript
// Server → CEF:
RAGERP.cef.emit(target, "auth", "discordPending", { pendingToken, suggestion });

// CEF → Server:
EventManager.emitServer("auth", "completeDiscordRegistration", { pendingToken, username: raw });
```

The `pendingToken` (56-char hex) is sent to the CEF browser and reflected back. While the token is validated server-side (`takePendingRegistration` checks `p.playerId !== playerId`), the token transits through the CEF. With `allow-cef-debugging: true` (H04 in existing findings), a player could inspect their CEF context and extract the pending token. If they could use it from another connection as the same `playerId`, it would work — but since `playerId` is server-validated, cross-account theft is blocked.

The more significant concern: the token flow route is CEF → client `eventManager::emitServer` → `mp.events.callRemote("server::auth:completeDiscordRegistration", ...)`. With CEF debugging enabled, the token can be read and replayed before it expires (30-minute TTL). A player could theoretically submit multiple account registrations within the TTL window — but `takePendingRegistration` deletes the token on first use, so replay is blocked.

**Residual risk:** Token is visible in CEF devtools (CEF debugging enabled by default in conf.json). Low direct harm, but contributes to defense-in-depth failure given the larger CEF security posture.

---

### AUTH-M05 — selectcharacter page: character IDs visible in CEF; rely solely on server ownership check
**Files:** `SelectCharacter.tsx:12–13`, `Character.event.ts:132–144`
**Severity:** MEDIUM (new finding; amplifier for AUTH-C01)

```typescript
// SelectCharacter.tsx
const selectCharacter = useCallback((id: number) => {
    EventManager.emitServer("character", "select", id);
}, []);
```

The character ID from `store.characters` is sent to the server. Since the server has no ownership check (AUTH-C01), any character ID the player can obtain (e.g., by guessing sequential IDs, or via CEF devtools inspection) can be sent. This is the exploitation path for AUTH-C01.

---

## 4. SESSION / AUTH TRUST-BOUNDARY NOTES

### Event identity trust
In RAGE:MP, when a client calls `mp.events.callRemote("server::eventName", ...args)`, the server handler receives the **actual sending player** as the first parameter — this identity cannot be spoofed at the network level. (UNVERIFIED AGAINST LIVE DOCS — wiki returned 403; consistent with RAGE:MP architecture documentation from training data.)

This means: the `player` parameter in all `RAGERP.cef.register` handlers is reliably the caller. What **cannot** be trusted are the data arguments (`data`, `id`, `name`, etc.) — all are fully client-controlled.

### CEF event routing (Browser.class.ts)
```typescript
// Browser.class.ts:634–638
emitServer(receivedData: any): void {
    let data = Utils.tryParse(receivedData);
    let { event, args } = data;
    mp.events.callRemote(event, ...);  // ← event name is CEF-controlled
}
```

CEF (the React UI) calls `EventManager.emitServer(page, pointer, args)` which constructs `event = "server::page:pointer"` and calls `mp.events.callRemote`. Because CEF runs in Chromium on the player's machine, a modified client can call any `mp.events.callRemote("server::anyEvent", ...)` directly — not just the events the UI exposes. The auth handlers must not assume only legitimate CEF paths will trigger them.

### What the server can trust vs. must not trust
| Data | Source | Trustable? |
|---|---|---|
| `player` (first handler param) | RAGE:MP infrastructure | **Yes** — always the actual sender |
| `player.account` | Set server-side after verified auth | **Yes** — if null, player is not authenticated |
| `player.getVariable("loggedin")` | Set server-side after `spawnWithCharacter` | **Yes** |
| `player.getVariable("adminLevel")` | Set from `player.account.adminlevel` | **Yes** — when set from DB |
| `player.ping` | Server-side metric | **Yes** |
| Event `data` / `args` (all) | Client-sent | **No** — validate all inputs |
| `player.weapon` | GTA engine-synced | **Partially** — hash is readable, but client can be modded |
| `(player as any).currentCefPage` | Set from client `server::player:setCefPage` | **No** — client-reported, cosmetic only |

### No auth middleware / framework-level gate
`RAGERP.cef.register` (CEFEvent.class.ts) has **no built-in authentication or authorization check**. Every handler receives `player` regardless of auth state. Authentication must be verified manually in every handler that requires it. Currently only `creator::create` kicks unauthenticated players. At minimum, `character::select`, `character::create`, and `creator::navigation` are missing these gates.

### Session invalidation on disconnect
`onPlayerJoin` (Player.event.ts:237–270) correctly resets `player.account = null`, `player.character = null`, and `loggedin = false` before any auth event fires. This prevents session resurrection on reconnect. The disconnect handlers in `onPlayerQuit` save character state to DB and clean up in-memory structures.

**Gap:** There is no explicit `player.account = null` in `onPlayerQuit`. However, because `onPlayerJoin` always fires before any event can be triggered on reconnect, and RAGE:MP creates a new `PlayerMp` object on reconnect (UNVERIFIED AGAINST LIVE DOCS), this is likely safe.

### Discord OAuth state is correctly bound
`discordAuthState.ts` implementation is secure:
- State is `crypto.randomBytes(32).toString("hex")` — 64 hex chars, cryptographically secure ✓
- State is consumed on first use (`consumeOAuthState` deletes it) ✓
- State TTL: 15 minutes ✓
- `pendingToken` is 56-char hex, TTL 30 minutes, **bound to `playerId`** ✓ — `takePendingRegistration` checks `p.playerId !== playerId`
- `clearDiscordPendingForPlayer` called on `playerQuit` ✓

**No issue** with the state/token management itself. The vulnerabilities are in the surrounding flow (no already-authenticated check, no timeout on HTTPS).

---

## 5. RAGE:MP API / DOCUMENTATION NOTES

> **Wiki access:** `https://wiki.rage.mp/wiki/Main_Page` returned HTTP 403 during this audit. All API behavior noted below is UNVERIFIED AGAINST LIVE DOCS unless explicitly noted. Findings are based on RAGE:MP documentation available in training data (up to August 2025 cutoff).

| API | Code usage | Expected behavior | Status |
|---|---|---|---|
| `mp.events.callRemote(event, ...args)` | Client → server event dispatch | First handler param = sending player (cannot be spoofed) | **UNVERIFIED AGAINST LIVE DOCS** |
| `mp.browsers.new(url)` | `Auth.event.ts (client):56` | Opens Chromium overlay with given URL | **UNVERIFIED AGAINST LIVE DOCS** |
| `new mp.Event("server::page:pointer", handler)` | `CEFEvent.class.ts:51` | Registers server-side event listener | **UNVERIFIED AGAINST LIVE DOCS** |
| `player.call(eventName, argsArray)` | Throughout server | Server → client event dispatch | **UNVERIFIED AGAINST LIVE DOCS** |
| `player.rgscId` | `Auth.event.ts:136` | Social Club ID from RAGE:MP | **UNVERIFIED** — may be empty string or spoofable in non-strict server configs |
| `player.serial` | `Player.event.ts:240` | Hardware serial / HWID | **UNVERIFIED** — reliability varies; known to be spoofable on some RAGE:MP versions |
| `player.ip` | `Player.event.ts:240` | Client IP address | **UNVERIFIED** — may reflect proxy IP; not reliable for ban evasion prevention |
| `mp.players.exists(player)` | Throughout | Validity check for player object | **UNVERIFIED AGAINST LIVE DOCS** |
| `player.setVariable(key, value)` | Throughout | Synced variable visible to client via `getVariable` | **UNVERIFIED** — sync direction (server→client, client→server, bidirectional) needs verification |
| `player.account` (custom property) | Throughout | TypeScript prototype extension (not native RAGE:MP) | Application-defined; safe to trust server-side |
| `player.getAdminLevel()` | `Player.event.ts:359,362` | Custom extension method | Application-defined; source not read in this audit |

**Notes on `player.serial` / ban system:**
The ban check at `Player.event.ts:240` uses `serial: player.serial` as a HWID vector. RAGE:MP's `player.serial` accuracy depends on the client version and whether anti-cheat is enabled. Historically this value has been spoofable on older RAGE:MP builds. The existing finding H10 (no `rsgId` in ban record) compounds this. UNVERIFIED AGAINST LIVE DOCS — requires testing against current RAGE:MP client version.

---

## 6. RUNTIME TEST CHECKLIST — AUTH / ACCOUNT ONLY

### Pre-auth event injection
- [ ] Connect without completing auth. Call `mp.events.callRemote("server::character:select", 1)` — **expect: kicked or rejected, NOT character spawn**
- [ ] Connect without completing auth. Call `mp.events.callRemote("server::character:create")` — **expect: rejected (currently: creator UI opens, player teleported to preview dimension)**
- [ ] Connect without completing auth. Call `mp.events.callRemote("server::creator:navigation", '"general"')` — **expect: rejected (currently: camera change event fires on the player)**
- [ ] Connect without completing auth. Call `mp.events.callRemote("server::creator:create", '{}')` — **expect: player kicked with "An error has occurred!" (this IS currently guarded)**

### Password login brute-force
- [ ] Send `server::auth:loginPlayer` 20 times per second with wrong passwords for a known username — **expect: rate limit or lockout (currently: no rate limit)**
- [ ] Send login with correct credentials while already logged in (second call) — **expect: rejected (currently: session overwritten)**
- [ ] Send login with username = 200-character string — **expect: rejected at length validation (currently: TypeORM error / unhandled rejection)**

### Discord OAuth flow
- [ ] Start Discord OAuth while already authenticated via password — **expect: rejected (currently: OAuth flow starts, callback will overwrite session)**
- [ ] Complete Discord OAuth callback with a valid state but as a player who has already disconnected — **expect: graceful error ("Could not update session"), no crash (currently: `target` is null, handled correctly)**
- [ ] Complete Discord OAuth callback twice using the same state (replay) — **expect: second attempt rejected by `consumeOAuthState` (currently: correctly rejected — state is consumed on first use)**
- [ ] Trigger Discord OAuth and wait 16 minutes (past 15-minute state TTL) — **expect: "Session expired" response, player not logged in**
- [ ] Start Discord OAuth and trigger a server notification (e.g., welcome toast) before completing — **confirm: Discord OAuth spinner resets incorrectly** (existing L17 bug)

### Character ownership
- [ ] Authenticate as player A (account_id=1, character_id=1). Then call `server::character:select` with character_id=2 (belonging to account_id=2) — **expect: kicked or rejected (currently: player spawns as character 2)**
- [ ] Authenticate as player A. Call `server::character:select` with character_id=9999 (non-existent) — **expect: showNotify error (currently: shows notify error — correctly handled)**

### Session invalidation
- [ ] Authenticate, disconnect, reconnect within 60 seconds — confirm `player.account` is null on reconnect until re-auth completes
- [ ] Authenticate, then disconnect mid-character-creation (between DB save and spawnWithCharacter) — confirm character row exists in DB and is accessible on next login

### Ban system
- [ ] Create a ban record with `lifttime = null` in DB — connect with banned player — **expect: ban enforced (verify `hasDatePassedTimestamp(NaN)` behavior)**
- [ ] Create a ban record with `lifttime = "notanumber"` in DB — connect — **expect: same**
- [ ] Ban a player without `rsgId` in the record — player changes IP and HWID serial — **confirm: ban bypassable (existing H10 issue)**
```

---

## Implementation Steps

In order:
1. Write `AUDIT_AUTH_ACCOUNT.md` to worktree root — full content above
2. Write `AUDIT_DAMAGE_COMBAT.md` to worktree root — from Part A combat subsystem plan
3. Write `AUDIT_FINDINGS_STAGE1.md` to worktree root — organized 70-issue list with verified markers
4. Write `AUDIT_REPORT_STAGE1.md` to worktree root — executive summary + inventory + top-10 + test checklist

All four files written to:
`C:\Users\Matei\Downloads\arena-server-backup-master\.claude\worktrees\relaxed-rubin-fbda0d\`

No code files modified. All findings are READ-ONLY observations.
