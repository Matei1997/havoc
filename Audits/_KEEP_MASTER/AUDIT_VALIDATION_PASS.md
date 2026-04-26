# AUDIT VALIDATION PASS — Havoc Arena RAGE:MP Server
**Date:** 2026-04-25  
**Validator:** Claude Sonnet 4.6 (read-only code verification pass)  
**Input sources:** AUDIT_FINDINGS.md (2026-04-24), AUDIT_REPORT.md (2026-03-12)  
**Scope:** All 10 Critical + top 15 High findings + RAGE:MP-specific items  
**Method:** Direct file reads against actual code at path  
`gamemode/source/` and `gamemode/frontend/src/`

> **Wiki access:** wiki.rage.mp returned 403 during the original audit and was NOT re-attempted here. All RAGE:MP API assessments rely on training-cutoff knowledge (August 2025). Items that hinge on live API behaviour are marked **UNVERIFIED AGAINST LIVE DOCS**.

---

## CLASSIFICATION KEY
| Label | Meaning |
|---|---|
| DEFINITE BUG | Code is wrong vs. stated intent or common-sense correctness |
| DEFINITE SECURITY RISK | Exploitable by a player or attacker; fix before any public session |
| INTENDED BEHAVIOR | Code matches product intent; audit claim is incorrect or overstated |
| INTENTIONAL DEV/DEBUG BEHAVIOR | Acknowledged in code comments or config; must be env-gated before prod |
| NEEDS PRODUCT DECISION | Internally consistent code; tradeoff must be resolved by the project owner |
| NEEDS RUNTIME VERIFICATION | Cannot confirm or deny impact without a live two-player test |
| NEEDS DOC CONFIRMATION | Hinges on RAGE:MP API semantics; live wiki verification required |

## RECOMMENDED ACTION KEY
| Action | Meaning |
|---|---|
| FIX NOW | Clear bug or security risk; fix before any public session |
| KEEP AS-IS | Intentional or harmless; do not change |
| MOVE TO DEV-ONLY CONFIG | OK for development; must be disabled/env-gated in production |
| REQUIRE PRODUCT DECISION | Cannot fix without a design choice from the project owner |
| REQUIRE RUNTIME TEST FIRST | Validate in a live server session before committing to a fix |

---

---

# PART A — CRITICAL FINDINGS (C01–C10)

---

## C01
**Audit claim:** `mp.players.at(victimId)` used instead of `mp.players.atRemoteId(victimId)` — damage applied to the wrong player or `undefined`.

**Files:** `source/server/serverevents/DamageSync.event.ts:172`, `source/client/modules/DamageSync.module.ts:90`

**Code verified:**
```ts
// Client (DamageSync.module.ts:90)
mp.events.callRemote("server:PlayerHit", target.remoteId, bone, weaponHash);

// Server (DamageSync.event.ts:172)
const victim = mp.players.at(victimId);
if (!victim || !mp.players.exists(victim)) return;
```

**Is this likely intended?**  
The client sends `target.remoteId`. In RAGE:MP, the client's `player.remoteId` maps directly to the server's `player.id`, which IS the pool index. Therefore `mp.players.at(victimId)` should retrieve the correct player — the same one `atRemoteId()` would return. The null guard on line 173 catches any undefined result. The audit's "wrong player" claim assumes pool index ≠ remoteId, which may not hold in RAGE:MP.

**Is this dev/debug-only?** No.

**Does fix align with RAGE:MP docs?** UNVERIFIED AGAINST LIVE DOCS — wiki was 403. If `at()` and `atRemoteId()` use the same ID space, there is NO bug.

**Classification:** NEEDS DOC CONFIRMATION  
**Action:** REQUIRE RUNTIME TEST FIRST  
> Connect two clients, have A shoot B, confirm damage lands on B only. If correct, dismiss. If wrong, swap to `mp.players.atRemoteId(victimId)`.

---

## C02
**Audit claim:** `setInterval(() => Camera.rotateEntity(x), 0)` fires at maximum JS event-loop speed, causing CPU spike and heading desync.

**File:** `source/client/classes/Camera.class.ts:372`

**Code verified:**
```ts
if (upOrDown === "down" && leftOrRight === "right") {
    if (!headingInterval) {
        headingInterval = setInterval(() => Camera.rotateEntity(x), 0);  // 0ms
    }
}
```

**Is this likely intended?** No. A 0 ms interval on `setHeading()` every event-loop tick is not a valid rotation rate.

**Is this dev/debug-only?** No — triggers on right-click hold in character creator / tune cam.

**Does fix align with RAGE:MP docs?** Yes — standard Node.js `setInterval`.

**Classification:** DEFINITE BUG  
**Action:** FIX NOW  
> Change `setInterval(() => Camera.rotateEntity(x), 0)` → `setInterval(() => Camera.rotateEntity(x), 50)`.

---

## C03
**Audit claim:** `setInterval(() => mp.game.ui.weaponWheelIgnoreSelection())` missing interval argument defaults to 0 ms, fires at max speed.

**File:** `source/client/prototype/Player.prototype.ts:97`

**Code verified:**
```ts
weaponWheel = setInterval(() => {
    mp.game.ui.weaponWheelIgnoreSelection();
    // ← no delay argument
});
```

**Is this likely intended?** No. A weapon-wheel suppress loop needs ~100 ms ticks; calling a native every event-loop iteration is unintended CPU waste.

**Is this dev/debug-only?** No — activates whenever `setWeaponWheel(true)` is called.

**Does fix align with RAGE:MP docs?** Yes.

**Classification:** DEFINITE BUG  
**Action:** FIX NOW  
> Add interval argument: `setInterval(() => { mp.game.ui.weaponWheelIgnoreSelection(); }, 100)`.

---

## C04
**Audit claim:** Warmup godmode bypass — `DamageSync.event.ts` skips the arena handler when `state="warmup"` and falls through to the freeroam block, applying full uncapped damage to frozen warmup players.

**File:** `source/server/serverevents/DamageSync.event.ts:220–276`

**Code verified:**
```ts
if (ffaMatch && ffaMatch.state === "active") {
    // FFA path
} else if (gunGameMatch && gunGameMatch.state === "active") {
    // GunGame path
} else if (hopoutsMatch && hopoutsMatch.state === "active") {
    // Hopouts path
} else {
    // Freeroam: full uncapped damage — NO warmup guard
    victim.health = Math.max(0, victim.health - dmgLeft);
}
```

**Is this likely intended?** No. All three game-mode paths require `state === "active"`. During `state === "warmup"` none fire; the freeroam block runs, dealing uncapped damage to frozen warmup players.

**Is this dev/debug-only?** No — affects every match start.

**Does fix align with RAGE:MP docs?** Fix is pure server TypeScript.

**Classification:** DEFINITE BUG  
**Action:** FIX NOW  
> Add early return before mode checks:
> ```ts
> const inAnyMatch = ffaMatch || gunGameMatch || hopoutsMatch;
> if (inAnyMatch && (ffaMatch?.state === "warmup" || gunGameMatch?.state === "warmup" || hopoutsMatch?.state === "warmup")) return;
> ```

---

## C05
**Audit claim:** `character::select` CEF handler spawns by raw DB `id` with no ownership check — any authenticated player can load any other player's character.

**File:** `source/server/serverevents/Character.event.ts:132–144`

**Code verified:**
```ts
RAGERP.cef.register("character", "select", async (player: PlayerMp, data: string) => {
    let id: number;
    try { id = JSON.parse(data); } catch { ... }
    const character = await RAGERP.database.getRepository(CharacterEntity)
        .findOne({ where: { id } });   // ← no account ownership check
    if (!character) return player.showNotify(...);
    await spawnWithCharacter(player, character);
});
```

**Is this likely intended?** No. Any authenticated player who knows or guesses a character ID can spawn as that character.

**Is this dev/debug-only?** No.

**Does fix align with RAGE:MP docs?** Fix is pure TypeORM.

**Classification:** DEFINITE SECURITY RISK  
**Action:** FIX NOW  
> Add guard and ownership constraint:
> ```ts
> if (!player.account) return;
> .findOne({ where: { id, account: { id: player.account.id } } })
> ```

---

## C06
**Audit claim:** Real `.env` file with plaintext DB password (`Headshot123`) is present in the repository backup.

**File:** `gamemode/.env`

**Code verified:**
```
DB_HOST=localhost
DB_USER=postgres
DB_PASS=Headshot123
DB_DATABASE=havoc_arena
DB_BETA=true
DB_BETA_PASSWORD=Headshot123
```

**Is this likely intended?** No. Credentials in VCS are unambiguously an error even in a private backup.

**Is this dev/debug-only?** The credentials are dev (localhost DB); the exposure is not.

**Does fix align with RAGE:MP docs?** N/A.

**Classification:** DEFINITE SECURITY RISK  
**Action:** FIX NOW  
> 1. Rotate the database password immediately.  
> 2. Verify `.env` is in `gamemode/.gitignore`.  
> 3. Audit git history for the committed credential and scrub if the repo is ever shared.

---

## C07
**Audit claim:** Dead players (`alive = false`) can continue sending `server:PlayerHit` — no alive check on the shooter.

**File:** `source/server/serverevents/DamageSync.event.ts:170–173`

**Code verified:**
```ts
mp.events.add("server:PlayerHit", (shooter: PlayerMp, victimId, ...) => {
    if (!shooter || !mp.players.exists(shooter)) return;  // existence only
    // ← no: shooter.health <= 0 check
```

**Is this likely intended?** No. `CombatIntegrity` validates fire rate and distance but not shooter alive state.

**Is this dev/debug-only?** No.

**Does fix align with RAGE:MP docs?** UNVERIFIED AGAINST LIVE DOCS for exact `health` property semantics; guard is prudent regardless.

**Classification:** DEFINITE SECURITY RISK  
**Action:** FIX NOW  
> Add after the existence check: `if (shooter.health <= 0) return;`

---

## C08
**Audit claim:** Weapon hash not validated against a whitelist — unknown hashes receive fallback damage (28 base) and are not rejected.

**File:** `source/server/serverevents/DamageSync.event.ts:104–115`

**Code verified:**
```ts
const w = weaponDamage[weaponHash] ?? {
    base: DEFAULT_WEAPON_BASE,    // 28
    min: DEFAULT_WEAPON_MIN,      // 10
    effectiveRange: DEFAULT_EFFECTIVE_RANGE   // 35
};
```

**Is this likely intended?** Partially. The fallback is conservative (28 base, lower than most real weapons). Arena cap still applies. An attacker with a fake hash still deals damage, but at a bounded and non-advantageous rate.

**Is this dev/debug-only?** No.

**Does fix align with RAGE:MP docs?** Fix is pure server logic.

**Classification:** NEEDS PRODUCT DECISION  
**Action:** REQUIRE PRODUCT DECISION  
> Option A: Reject unknown hashes (safest; blocks unwhitelisted future weapons).  
> Option B: Keep fallback but log unknown hashes for review (current behavior + monitoring).  
> Option C: Expand `weaponDamage` to the full GTA weapon list to eliminate the gap.

---

## C09
**Audit claim:** Chat uses `dangerouslySetInnerHTML={{ __html: el.html }}` with no sanitization — full XSS vector; in RAGE:MP CEF, injected JS can call `mp.trigger()`.

**File:** `frontend/src/pages/hud/Chat/Chat.tsx:182`

**Code verified:**
```tsx
<span
    dangerouslySetInnerHTML={{ __html: timePrefix + el.html }}
/>
```

**Is this likely intended?** The raw HTML is likely intentional for color/formatting support. The lack of sanitization is not.

**Is this dev/debug-only?** No — all players see the chat.

**Does fix align with RAGE:MP docs?** Yes — CEF runs full Chromium; `mp.trigger()` is callable from injected JS.

**Classification:** DEFINITE SECURITY RISK  
**Action:** FIX NOW  
> Wrap with `DOMPurify.sanitize(el.html, { ALLOWED_TAGS: ["span","b","i"], ALLOWED_ATTR: ["style","class"] })` before render.

---

## C10
**Audit claim:** Admin audit log stored in-memory only (max 2000 entries), lost on every restart.

**File:** `source/server/admin/AdminAudit.service.ts`

**Code verified:**
```ts
/**
 * Phase 1: in-memory stub; later can persist to DB or file.
 */
const MAX_ENTRIES = 2000;
const entries: AuditEntry[] = [];
```

**Is this likely intended?** Yes. The developer's own comment explicitly acknowledges this as a temporary Phase 1 stub.

**Is this dev/debug-only?** Yes — acceptable for development, not acceptable once the server is live with real admins.

**Does fix align with RAGE:MP docs?** N/A.

**Classification:** INTENTIONAL DEV/DEBUG BEHAVIOR  
**Action:** KEEP AS-IS (for now)  
> The in-memory behavior is documented and intentional. Add DB persistence before opening to public players. Do not change prematurely.

---

---

# PART B — HIGH FINDINGS (H01–H15, H21)

---

## H01
**Audit claim:** `mp.gui.cursor.show(showCursor, showCursor)` — passing `lockedAtCenter = true` when showing the UI cursor breaks all click interaction.

**File:** `source/client/classes/Browser.class.ts:341, 353, 360, 367, 374, 378, 589`

**Code verified:**
```ts
const showCursor = showCursorBase && !(mainMenuClothingActive && mainMenuClothingRotateHeld);
mp.gui.cursor.show(showCursor, showCursor);  // both params always identical
```

**Is this likely intended?** Unknown. The pattern is consistent and deliberate across all cursor calls. However, if `lockedAtCenter = true` truly prevents clicking on CEF elements, the entire menu/lobby/auth UI would be unusable — contradicting the server being described as functional across multiple audit documents.

**Is this dev/debug-only?** No.

**Does fix align with RAGE:MP docs?** UNVERIFIED AGAINST LIVE DOCS — in some RAGE:MP builds `lockedAtCenter` may only affect game-input cursor lock, not CEF element interaction.

**Classification:** NEEDS RUNTIME VERIFICATION  
**Action:** REQUIRE RUNTIME TEST FIRST  
> Boot the server, open the main menu, attempt to click a button. If clicking works, dismiss (RAGE:MP CEF cursor handling differs from assumption). If broken, fix: `mp.gui.cursor.show(showCursor, false)` for all UI pages.

---

## H02
**Audit claim:** CEF `execute()` script injection — event names are string-interpolated into `window.callHandler(...)` without escaping.

**File:** `source/client/classes/Browser.class.ts:413–419`

**Code verified:**
```ts
const event = eventName.split("cef::")[1];
const argsString = args.map((arg: string) => JSON.stringify(arg)).join(", ");
const script = `window.callHandler("${event}", ${argsString})`;  // event is raw
this.mainUI.execute(script);
```

**Is this likely intended?** No. The `event` variable is raw string-interpolated. A `"` or backtick in an event name breaks the script or injects code. `argsString` is `JSON.stringify`-escaped and safer, but `event` is not.

**Is this dev/debug-only?** No — all server→CEF events pass through this path.

**Does fix align with RAGE:MP docs?** Yes — `BrowserMp.execute()` takes a JS string; escaping the interpolation is correct.

**Classification:** DEFINITE SECURITY RISK  
**Action:** FIX NOW  
> Replace `` `"${event}"` `` with `JSON.stringify(event)` (which already includes the surrounding quotes):
> ```ts
> const script = `window.callHandler(${JSON.stringify(event)}, ${argsString})`;
> ```

---

## H03
**Audit claim:** Discord OAuth URL passed directly to `mp.browsers.new(url)` with no validation — server compromise or MITM can open any URL in the player's CEF browser.

**File:** `source/client/clientevents/Auth.event.ts:50–57`

**Code verified:**
```ts
mp.events.add("client::auth:discordOpen", (url: string) => {
    if (!url || typeof url !== "string") return;  // type check only
    discordOAuthBrowser = mp.browsers.new(url);
});
```

**Is this likely intended?** No. Any URL passes the current check. Requires server compromise or MITM to exploit; defense in depth calls for an allowlist.

**Is this dev/debug-only?** No.

**Does fix align with RAGE:MP docs?** `mp.browsers.new(url)` confirmed correct; the fix is purely a validation addition.

**Classification:** DEFINITE SECURITY RISK  
**Action:** FIX NOW  
> Add: `if (!url.startsWith("https://discord.com/")) return;` before `mp.browsers.new(url)`.

---

## H04
**Audit claim:** `allow-cef-debugging: true` in both `conf.json` files — players can open Chromium DevTools in-game.

**Files:** `gamemode/conf.json`, `ragemp-server/conf.json`

**Code verified:**
```json
{ "allow-cef-debugging": true, "fqdn": "eu.loclx.io" }
```
Both files are identical; `fqdn: "eu.loclx.io"` (a localtunnel dev domain) confirms these are development configs.

**Is this likely intended?** Yes, for development.

**Is this dev/debug-only?** Yes.

**Does fix align with RAGE:MP docs?** `allow-cef-debugging` is a documented RAGE:MP server config key.

**Classification:** INTENTIONAL DEV/DEBUG BEHAVIOR  
**Action:** MOVE TO DEV-ONLY CONFIG  
> Create a production config template with `"allow-cef-debugging": false` and a real `fqdn`. Dev configs override it locally.

---

## H05
**Audit claim:** `resolution.y` assigned to a variable named `width` — screen height is used as screen width, breaking rotation threshold on all non-square resolutions.

**File:** `source/client/classes/Camera.class.ts:218`

**Code verified:**
```ts
const resolution = mp.game.graphics.getScreenActiveResolution();
const width = resolution.y;  // ← height, not width
```

**Is this likely intended?** No. The variable is named `width` but holds screen height. On a 1920×1080 display the pivot shifts to the wrong position.

**Is this dev/debug-only?** No — affects all creator/tune cam rotations.

**Does fix align with RAGE:MP docs?** UNVERIFIED AGAINST LIVE DOCS for exact return-object shape (`{x,y}` vs `{width,height}`), but the variable name makes intent unambiguous.

**Classification:** DEFINITE BUG  
**Action:** FIX NOW  
> Change `const width = resolution.y;` → `const width = resolution.x;`.

---

## H06
**Audit claim:** `destroyCamera` never removes entries from `this.list` — `isActive()` returns stale truthy results for destroyed cameras.

**File:** `source/client/classes/Camera.class.ts:291–298`

**Code verified:**
```ts
destroyCamera(name: string) {
    const camera = this.list.find((element) => element.name === name);
    if (camera && mp.cameras.exists(camera.cam)) {
        camera.cam.setActive(false);
        camera.cam.destroy();
        mp.game.cam.renderScriptCams(false, false, 0, false, false, 0);
        // ← missing: this.list = this.list.filter(e => e.name !== name);
    }
}
```

**Is this likely intended?** No. The destroyed camera stays in `this.list`, so `isActive(name)` returns `true` forever.

**Is this dev/debug-only?** No — affects login camera and all game cameras.

**Does fix align with RAGE:MP docs?** Fix is pure TypeScript.

**Classification:** DEFINITE BUG  
**Action:** FIX NOW  
> Add after `camera.cam.destroy()`: `this.list = this.list.filter((e) => e.name !== name);`

---

## H07
**Audit claim:** Raycast constructor calls two undocumented/experimental RAGE:MP APIs with `@ts-ignore` and no try/catch — if absent in the deployed build, client crashes on startup.

**File:** `source/client/classes/Raycast.class.ts:23–27`

**Code verified:**
```ts
constructor() {
    this.rayCastInterval = setInterval(this.process.bind(this), 100);
    this.renderEvent = new mp.Event("render", this.render.bind(this));
    //@ts-ignore
    mp.game.graphics.setEntityOverlayPassEnabled(true);
    //@ts-ignore
    this.batch = mp.game.graphics.createEntityOverlayBatch(overlayParams);
    mp.console.logWarning(`overlayhandle: ${this.batch.handle}`);
}
export const EntityRaycast = new _EntityRaycast();  // instantiated at module load
```

**Is this likely intended?** The `@ts-ignore` and `logWarning` show the developer knew these were experimental. No try/catch means if either API is absent, `this.batch` is undefined and the `render()` loop throws on `this.batch.addThisFrame()`.

**Is this dev/debug-only?** Uncertain — EntityRaycast is active for all logged-in players in freeroam.

**Does fix align with RAGE:MP docs?** UNVERIFIED AGAINST LIVE DOCS — these overlay APIs are not in the standard documented API set.

**Classification:** DEFINITE BUG  
**Action:** FIX NOW  
> Wrap constructor body in `try/catch`; on catch set `this.batch = null` and log. Guard all `this.batch` calls with `if (!this.batch) return;`.

---

## H08
**Audit claim:** Raycast `setInterval(100ms)` is never cleared — runs for the entire client session with no destroy path.

**File:** `source/client/classes/Raycast.class.ts:21`

**Code verified:**
```ts
this.rayCastInterval = setInterval(this.process.bind(this), 100);
// No destroy() method exists in the class
```

**Is this likely intended?** No explicit cleanup. However, `process()` guards with `if (!mp.players.local.getVariable("loggedin") || ...) return;`, so it does no meaningful work unless the player is on foot and logged in. The 100 ms rate is not a CPU concern; the missing cleanup is a correctness issue.

**Is this dev/debug-only?** No.

**Does fix align with RAGE:MP docs?** Standard Node.js `clearInterval`.

**Classification:** DEFINITE BUG (low operational impact; correctness issue)  
**Action:** FIX NOW  
> Add: `destroy() { if (this.rayCastInterval) { clearInterval(this.rayCastInterval); this.rayCastInterval = null; } }`

---

## H09
**Audit claim:** `setOnGroundProperly` — `getGroundZFor3dCoord` can return `undefined` or `0` in unloaded terrain; without a null check the player is teleported to Z=1 underground.

**File:** `source/client/prototype/Player.prototype.ts:107–111`

**Code verified:**
```ts
mp.Player.prototype.setOnGroundProperly = function () {
    //@ts-ignore
    let posZ = mp.game.gameplay.getGroundZFor3dCoord(
        mp.players.local.position.x,
        mp.players.local.position.y,
        mp.players.local.position.z,
        0.0, false
    );
    mp.players.local.setCoordsNoOffset(
        mp.players.local.position.x,
        mp.players.local.position.y,
        posZ + 1,   // ← posZ may be 0 or undefined
        false, false, false
    );
};
```

**Is this likely intended?** No. Without a guard, a 0 or undefined `posZ` teleports the player to Z=1 (underground).

**Is this dev/debug-only?** No — used during spawning.

**Does fix align with RAGE:MP docs?** UNVERIFIED AGAINST LIVE DOCS; the guard is prudent regardless.

**Classification:** DEFINITE BUG  
**Action:** FIX NOW  
> Add: `if (!posZ || posZ <= 0) return;` before `setCoordsNoOffset`.

---

## H10
**Audit claim:** `/ban` command does not save `rsgId` to the ban record — the Rockstar Social Club ban vector is always null.

**Files:** `source/server/commands/Admin.commands.ts:670–678`, `source/server/database/entity/Ban.entity.ts`

**Code verified:**
```ts
// BanEntity schema:
@Column({ type: "varchar", length: 255, nullable: true, default: null })
rsgId: string;   // column exists but is never populated

// /ban handler:
ban.serial = target.serial;   // ← hardware serial IS saved
ban.ip = target.ip;
ban.username = target.name;
// ban.rsgId = ???   ← never assigned
```

**Is this likely intended?** No. The column exists and was clearly planned. Note: the audit's claim that "the HWID ban vector is always empty" is overstated — `serial` (hardware fingerprint) IS saved. The missing piece is specifically the Social Club / RSG ID.

**Is this dev/debug-only?** No.

**Does fix align with RAGE:MP docs?** UNVERIFIED AGAINST LIVE DOCS — the exact RAGE:MP property name (`player.socialClub`?) for the RSG ID needs live doc confirmation.

**Classification:** DEFINITE BUG (narrower than stated — serial IS saved; rsgId is not)  
**Action:** FIX NOW  
> Add `ban.rsgId = (target as any).socialClub ?? "";` (verify correct property name against live RAGE:MP docs before committing).

---

## H11
**Audit claim:** No database transactions on character creation, account creation, or on-quit save — partial writes on crash leave corrupt or missing data.

**Files:** `source/server/serverevents/Character.event.ts`, `Auth.event.ts`, `Player.event.ts`

**Code verified:**
```ts
// Character.event.ts (create flow):
const result = await RAGERP.database.getRepository(CharacterEntity).save(characterData);
// No queryRunner.startTransaction() found anywhere in these files
```

**Is this likely intended?** No. Multi-step flows (account lookup → character save → clothing apply → session init) have no rollback path on mid-operation crash.

**Is this dev/debug-only?** No.

**Does fix align with RAGE:MP docs?** Fix is TypeORM — `queryRunner.startTransaction()` / `commit()` / `rollback()`.

**Classification:** DEFINITE BUG  
**Action:** FIX NOW (medium priority — wrap multi-step create flows first; single-table saves are lower risk)

---

## H12
**Audit claim:** No timeout on Discord HTTPS outbound requests — unresponsive Discord API hangs the player session handler indefinitely.

**File:** `source/server/modules/discordAuth/discordHttps.ts:8–39`

**Code verified:**
```ts
const opt: https.RequestOptions = {
    hostname: u.hostname,
    path: u.pathname + u.search,
    method,
    headers: headers || {}
    // ← no timeout
};
const req = https.request(opt, ...);
req.on("error", reject);
// ← no req.setTimeout(...)
```

**Is this likely intended?** No. Node.js `https.request` has no default timeout. A stalled Discord API call blocks the async auth handler for the player indefinitely.

**Is this dev/debug-only?** No.

**Does fix align with RAGE:MP docs?** Standard Node.js.

**Classification:** DEFINITE BUG  
**Action:** FIX NOW  
> Add after `const req = https.request(...)`: `req.setTimeout(10000, () => { req.destroy(new Error("Discord request timeout")); });`

---

## H13
**Audit claim:** `character::create` handler has no auth gate — a player can enter the creator flow without a valid `player.account`.

**File:** `source/server/serverevents/Character.event.ts:148–155`

**Code verified:**
```ts
// character::create — starts creator UI (no auth check)
RAGERP.cef.register("character", "create", async (player: PlayerMp) => {
    startCreatorFlow(player);   // ← no player.account guard
});

// creator::create — actual character save (IS gated)
RAGERP.cef.register("creator", "create", async (player, data) => {
    if (!player.account) return player.kick("An error has occurred!");
    ...
});
```

**Is this likely intended?** Partially. An unauthenticated player can see the creator UI but cannot save a character (creation is gated). The risk is the creator UI leaking to unauthenticated state, not actual account or character creation.

**Is this dev/debug-only?** No.

**Does fix align with RAGE:MP docs?** Pure server-side check.

**Classification:** NEEDS PRODUCT DECISION (low severity — creation is gated; only UI leak)  
**Action:** FIX NOW (defense in depth)  
> Add at top of `character::create` handler: `if (!player.account) return;`

---

## H14
**Audit claim:** Client-controlled `bone` string — a cheater always sends `"Head"` to guarantee 1.5× headshot multiplier.

**Files:** `source/server/serverevents/DamageSync.event.ts:210`, `source/client/modules/DamageSync.module.ts:88`

**Code verified:**
```ts
// Client: bone determined by geometric nearest-bone calculation
mp.events.callRemote("server:PlayerHit", target.remoteId, bone, weaponHash);

// Server: multiplier applied from client-reported bone
const boneMult = getBoneMultiplier(targetBone);  // Head = 1.5×
```

The AUDIT_REPORT.md Section 4.2 explicitly states: *"Client-side damage detection feeds server — By Design. This is standard for RageMP but means client-side hit detection is trusted for bone selection."*

**Is this likely intended?** Yes. Client-side hit detection is the standard RAGE:MP architecture. The server cannot independently raytrace hits. `CombatIntegrity` validates fire rate, distance, and duplicate hits — everything server-verifiable without client trust.

**Is this dev/debug-only?** No.

**Does fix align with RAGE:MP docs?** UNVERIFIED AGAINST LIVE DOCS — server-side bone verification is an architectural enhancement, not a bug fix.

**Classification:** INTENDED BEHAVIOR  
**Action:** KEEP AS-IS  
> The bone trust is inherent to the client-hit-detection model for RAGE:MP. A statistical anomaly detector (flag accounts with >80% reported headshot rate) is the appropriate long-term mitigation.

---

## H15
**Audit claim:** Players who disconnect and reconnect during a round have health fully restored — `spawnPlayerAtArena` always sets health=200, armour=100.

**File:** `source/server/modes/hopouts/ArenaMatch.manager.ts:1102–1107, 1478–1490`

**Code verified:**
```ts
function spawnPlayerAtArena(player, spawn, dimension) {
    player.health = 200;
    player.armour = 100;
    ...
}
// Reconnect path (line 1478):
spawnPlayerAtArena(player, spawn, match.dimension);  // full HP always restored
```

**Is this likely intended?** No. A player disconnecting mid-fight at low HP and reconnecting within 60 s gets full health — an intentional-disconnect exploit.

**Is this dev/debug-only?** No.

**Does fix align with RAGE:MP docs?** Fix is server-side state preservation.

**Classification:** DEFINITE BUG  
**Action:** FIX NOW  
> In `handleMatchDisconnect`, store `matchPlayer.savedHealth = player.health; matchPlayer.savedArmour = player.armour;`. In `restoreReconnectingPlayer`, after `spawnPlayerAtArena`, override: `player.health = reconnectSlot.savedHealth; player.armour = reconnectSlot.savedArmour;`.

---

## H21
**Audit claim:** `App.tsx` cleanup calls `stopAddingHandler()` which only logs — does NOT remove handlers; `system:setPage` and `notify:show` accumulate on every remount.

**Files:** `frontend/src/App.tsx:55–67`, `frontend/src/utils/EventManager.util.ts:121–130`

**Code verified:**
```ts
// App.tsx useEffect cleanup:
return () => {
    EventManager.stopAddingHandler("notify");   // ← logs only; does nothing
    EventManager.stopAddingHandler("system");   // ← logs only; does nothing
};

// EventManager.util.ts stopAddingHandler():
public stopAddingHandler(target: string): void {
    if (isDev) this.eventsInMemory.filter(...).forEach((event) => console.log(...));
    if (isDev) { console.log(`${target} events loaded`); }
}  // eventsInMemory unchanged — no handler removal
```

The correct method `removeTargetHandlers(target)` exists and DOES remove handlers, but is never called in cleanup.

**Is this likely intended?** No. `stopAddingHandler` is a dev-only logging helper misused as a cleanup function. Each React remount adds duplicate handlers.

**Is this dev/debug-only?** No — React remounts in normal operation.

**Does fix align with RAGE:MP docs?** Fix is React/EventManager only.

**Classification:** DEFINITE BUG  
**Action:** FIX NOW  
> Change cleanup:
> ```ts
> return () => {
>     EventManager.removeTargetHandlers("notify");
>     EventManager.removeTargetHandlers("system");
> };
> ```

---

---

# PART C — RAGE:MP API VERIFICATION TABLE

| Finding | API Used in Code | Expected / Correct API | Live Wiki Verified? | Status |
|---|---|---|---|---|
| C01 | `mp.players.at(remoteId)` | `mp.players.atRemoteId(remoteId)` | NO — wiki 403 | UNVERIFIED — likely correct if remoteId = pool index |
| C02/C03 | `setInterval(fn, 0)` / `setInterval(fn)` | `setInterval(fn, intervalMs)` | YES — Node.js standard | CONFIRMED BUG |
| H01 | `mp.gui.cursor.show(bool, bool)` | `show(visible, lockedAtCenter)` | NO — wiki 403 | UNVERIFIED — runtime test required |
| H02 | `browser.execute(jsString)` | raw JS string execution | YES — confirmed by original audit | CONFIRMED — event name injection risk |
| H03 | `mp.browsers.new(url)` | `(string): BrowserMp` | YES — confirmed by original audit | CORRECT CALL — URL validation missing |
| H05 | `getScreenActiveResolution().y` as width | `.x` = width, `.y` = height | NO — wiki 403 | UNVERIFIED — variable name mismatch is clear |
| H07 | `mp.game.graphics.setEntityOverlayPassEnabled` | not in documented API | NO — wiki 403 | UNVERIFIED — experimental API |
| H07 | `mp.game.graphics.createEntityOverlayBatch` | not in documented API | NO — wiki 403 | UNVERIFIED — experimental API |
| H09 | `getGroundZFor3dCoord` return value | can be 0 or undefined | NO — wiki 403 | UNVERIFIED — null guard is prudent regardless |
| H10 | `player.serial` for HWID | hardware fingerprint | PLAUSIBLE — serial IS being saved | `player.socialClub` (rsgId) property name needs wiki confirmation |
| H14 | Client-reported bone name | server trust of client | N/A | INTENDED BEHAVIOR — explicitly documented in AUDIT_REPORT.md §4.2 |
| C09 | `dangerouslySetInnerHTML` in CEF | JS execution in Chromium | YES — CEF = full Chromium | CONFIRMED SECURITY RISK |

---

---

# PART D — CONSOLIDATED FIX PRIORITY LIST

| Priority | ID | Classification | Action | File:Line | Specific Change |
|---|---|---|---|---|---|
| 1 | C06 | DEFINITE SECURITY RISK | FIX NOW | `gamemode/.env` | Rotate DB credentials; verify .gitignore |
| 2 | C05 | DEFINITE SECURITY RISK | FIX NOW | `Character.event.ts:140` | Add account ownership WHERE clause + auth guard |
| 3 | C07 | DEFINITE SECURITY RISK | FIX NOW | `DamageSync.event.ts:173` | Add `if (shooter.health <= 0) return;` |
| 4 | C09 | DEFINITE SECURITY RISK | FIX NOW | `Chat.tsx:182` | Wrap `el.html` with DOMPurify.sanitize() |
| 5 | H02 | DEFINITE SECURITY RISK | FIX NOW | `Browser.class.ts:417` | Use `JSON.stringify(event)` instead of raw interpolation |
| 6 | H03 | DEFINITE SECURITY RISK | FIX NOW | `Auth.event.ts:56` | Add `startsWith("https://discord.com/")` check |
| 7 | C04 | DEFINITE BUG | FIX NOW | `DamageSync.event.ts:220` | Block damage when any match is in warmup state |
| 8 | C02 | DEFINITE BUG | FIX NOW | `Camera.class.ts:372` | Change 0 ms interval → 50 ms |
| 9 | C03 | DEFINITE BUG | FIX NOW | `Player.prototype.ts:97` | Add 100 ms interval argument to setInterval |
| 10 | H15 | DEFINITE BUG | FIX NOW | `ArenaMatch.manager.ts:1478` | Save and restore pre-disconnect HP/armour |
| 11 | H21 | DEFINITE BUG | FIX NOW | `App.tsx:64` | Use `removeTargetHandlers` not `stopAddingHandler` |
| 12 | H05 | DEFINITE BUG | FIX NOW | `Camera.class.ts:218` | `resolution.y` → `resolution.x` |
| 13 | H06 | DEFINITE BUG | FIX NOW | `Camera.class.ts:296` | Add list splice after destroyCamera |
| 14 | H09 | DEFINITE BUG | FIX NOW | `Player.prototype.ts:110` | Guard posZ ≤ 0 before setCoordsNoOffset |
| 15 | H10 | DEFINITE BUG | FIX NOW | `Admin.commands.ts:675` | Populate `ban.rsgId` from player social club property |
| 16 | H12 | DEFINITE BUG | FIX NOW | `discordHttps.ts:22` | Add 10 s request timeout |
| 17 | H07 | DEFINITE BUG | FIX NOW | `Raycast.class.ts:23` | Wrap experimental API calls in try/catch; guard `this.batch` |
| 18 | H08 | DEFINITE BUG | FIX NOW | `Raycast.class.ts` | Add `destroy()` method with `clearInterval` |
| 19 | H11 | DEFINITE BUG | FIX NOW | `Character.event.ts`, `Auth.event.ts` | Wrap multi-step saves in TypeORM transactions |
| 20 | H13 | NEEDS PRODUCT DECISION | FIX NOW (defense) | `Character.event.ts:148` | Add `if (!player.account) return;` to creator flow start |
| 21 | H04 | INTENTIONAL DEV/DEBUG | MOVE TO DEV-ONLY CONFIG | Both `conf.json` | Set `"allow-cef-debugging": false` in production template |
| 22 | C10 | INTENTIONAL DEV/DEBUG | KEEP AS-IS | `AdminAudit.service.ts` | DB persistence is planned; implement before public launch |
| 23 | C01 | NEEDS DOC CONFIRMATION | REQUIRE RUNTIME TEST | `DamageSync.event.ts:172` | Verify correct player receives damage in two-player test |
| 24 | H01 | NEEDS RUNTIME VERIFICATION | REQUIRE RUNTIME TEST | `Browser.class.ts:341` | Verify UI clicks work before changing cursor params |
| 25 | C08 | NEEDS PRODUCT DECISION | REQUIRE PRODUCT DECISION | `DamageSync.event.ts:104` | Choose: reject / fallback+log / full whitelist for unknown hashes |
| 26 | H14 | INTENDED BEHAVIOR | KEEP AS-IS | `DamageSync.module.ts:88` | Client bone detection is by-design in RAGE:MP; add stat anomaly detection later |

---

## OUT-OF-SCOPE (Medium/Low findings)
The 11 Medium and 17 Low findings from AUDIT_FINDINGS.md were not re-validated in this pass per scope (Critical + top 15 High only). They are carried forward from AUDIT_FINDINGS.md without classification change and should be addressed in a follow-up pass.

---

*Validation pass complete. No code was modified during this pass.*
