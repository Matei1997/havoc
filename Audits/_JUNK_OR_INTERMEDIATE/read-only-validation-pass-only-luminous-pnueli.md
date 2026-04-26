# AUDIT VALIDATION PASS — Havoc Arena RAGE:MP Server
**Date:** 2026-04-25  
**Validator:** Claude Sonnet 4.6 (read-only code verification pass)  
**Input sources:** AUDIT_FINDINGS.md (2026-04-24), AUDIT_REPORT.md (2026-03-12)  
**Scope:** All 10 Critical + top 15 High findings + RAGE:MP-specific items  
**Method:** Direct file reads against actual code at path  
`/c/Users/Matei/Downloads/arena-server-backup-master/arena-server-backup-master/gamemode/`  

> **Wiki access:** wiki.rage.mp returned 403 during the original audit. Live wiki was NOT re-attempted here. All RAGE:MP API assessments rely on training-cutoff knowledge (August 2025). Items that hinge on live API behavior are marked **UNVERIFIED AGAINST LIVE DOCS**.

---

## OUTPUT FILE INTENT
This plan file IS the draft of `AUDIT_VALIDATION_PASS.md`.  
On approval, implementation = write this content to `AUDIT_VALIDATION_PASS.md` in the project root.

---

## CLASSIFICATION KEY
| Label | Meaning |
|---|---|
| DEFINITE BUG | Code is wrong vs. stated intent or common sense correctness |
| DEFINITE SECURITY RISK | Exploitable by a player or attacker; requires immediate fix |
| INTENDED BEHAVIOR | Code matches product intent; audit claim is incorrect or overstated |
| INTENTIONAL DEV/DEBUG BEHAVIOR | Acknowledged in code comments or config; must move to env-gate before prod |
| NEEDS PRODUCT DECISION | Code is internally consistent but the design choice has tradeoffs |
| NEEDS RUNTIME VERIFICATION | Cannot confirm or deny impact without a live two-player test |
| NEEDS DOC CONFIRMATION | Hinges on RAGE:MP API semantics; live wiki verification required |

---

## RECOMMENDED ACTION KEY
| Action | Meaning |
|---|---|
| FIX NOW | Clear bug or security risk; fix before any public session |
| KEEP AS-IS | Intentional or harmless; do not change |
| MOVE TO DEV-ONLY CONFIG | OK for dev; must be env-gated or disabled in production |
| REQUIRE PRODUCT DECISION | Cannot fix without a design choice from the project owner |
| REQUIRE RUNTIME TEST FIRST | Validate in live server before committing to a fix |

---

---

# PART A — CRITICAL FINDINGS (C01–C10)

---

## C01
**Current audit claim:** `mp.players.at(victimId)` is used instead of `mp.players.atRemoteId(victimId)` in the damage handler — damage is applied to the wrong player or `undefined`.

**Files involved:**
- `source/server/serverevents/DamageSync.event.ts` line 172
- `source/client/modules/DamageSync.module.ts` line 90

**Code verified:**
```ts
// Client (DamageSync.module.ts:90)
mp.events.callRemote("server:PlayerHit", target.remoteId, bone, weaponHash);

// Server (DamageSync.event.ts:172)
const victim = mp.players.at(victimId);
```

**Is this likely intended?**  
The client sends `target.remoteId`. In RAGE:MP, the client's `player.remoteId` maps directly to the server's `player.id`, which IS the pool index. Therefore `mp.players.at(victimId)` where `victimId = target.remoteId` should retrieve the correct player — the same one `atRemoteId()` would return. The null guard on line 173 (`if (!victim || !mp.players.exists(victim)) return;`) would catch any undefined result. The audit's "wrong player" claim assumes pool index ≠ remoteId, which may not hold in RAGE:MP.

**Is this dev/debug-only behavior?** No.

**Does proposed fix align with RAGE:MP docs?**  
UNVERIFIED AGAINST LIVE DOCS — wiki was 403. If `at()` and `atRemoteId()` use the same ID space (player.id = pool index = remoteId), there is NO bug. If they diverge, the audit is correct.

**Final classification:** NEEDS DOC CONFIRMATION  
**Recommended action:** REQUIRE RUNTIME TEST FIRST  
> Test: connect two clients, have player A shoot player B, confirm damage lands on B and not A or any third party. If correct, dismiss the finding. If wrong, use `atRemoteId()`.

---

## C02
**Current audit claim:** `setInterval(() => Camera.rotateEntity(x), 0)` fires at maximum JS event-loop speed, causing CPU spike and heading desync.

**Files involved:** `source/client/classes/Camera.class.ts` line 372

**Code verified:**
```ts
// Camera.class.ts lines 371-374
if (upOrDown === "down" && leftOrRight === "right") {
    if (!headingInterval) {
        headingInterval = setInterval(() => Camera.rotateEntity(x), 0);
    }
}
```

**Is this likely intended?** No. A 0ms interval on `setHeading()` every event-loop tick is not a valid rotation rate. The intent is smooth rotation while right-click is held; a 50–100ms interval is appropriate.

**Is this dev/debug-only behavior?** No — triggers on right-click hold in character creator / tune cam.

**Does proposed fix align with RAGE:MP docs?** Yes — `setInterval(fn, intervalMs)` is standard Node.js; changing 0 to 50 or 100 is straightforward.

**Final classification:** DEFINITE BUG  
**Recommended action:** FIX NOW  
> Change `setInterval(() => Camera.rotateEntity(x), 0)` to `setInterval(() => Camera.rotateEntity(x), 50)`.

---

## C03
**Current audit claim:** `setInterval(() => mp.game.ui.weaponWheelIgnoreSelection())` missing interval argument defaults to 0ms, fires at max speed.

**Files involved:** `source/client/prototype/Player.prototype.ts` line 97

**Code verified:**
```ts
// Player.prototype.ts lines 96-100
weaponWheel = setInterval(() => {
    mp.game.ui.weaponWheelIgnoreSelection();
});
```

**Is this likely intended?** No. A weapon wheel suppress-loop needs only ~100ms ticks; calling a native every event-loop iteration is unintended CPU waste. The missing delay argument is an omission.

**Is this dev/debug-only behavior?** No — activates whenever `setWeaponWheel(true)` is called for any player.

**Does proposed fix align with RAGE:MP docs?** Yes — standard `setInterval(fn, 100)`.

**Final classification:** DEFINITE BUG  
**Recommended action:** FIX NOW  
> Add interval: `setInterval(() => { mp.game.ui.weaponWheelIgnoreSelection(); }, 100)`.

---

## C04
**Current audit claim:** `DamageSync.event.ts` skips arena handler when state is `"warmup"` and falls through to the freeroam block, applying full uncapped damage to frozen warmup players.

**Files involved:** `source/server/serverevents/DamageSync.event.ts` lines 220–276

**Code verified:**
```ts
if (ffaMatch && ffaMatch.state === "active") {
    // FFA damage path
} else if (gunGameMatch && gunGameMatch.state === "active") {
    // GunGame damage path
} else if (hopoutsMatch && hopoutsMatch.state === "active") {
    // Hopouts damage path
} else {
    // Freeroam: full uncapped damage applied unconditionally
    let dmgLeft = finalDamage;
    victim.health = Math.max(0, victim.health - dmgLeft);
}
```

**Is this likely intended?** No. All three game-mode paths require `state === "active"`. During `state === "warmup"`, players are in a match but none of the active-state paths fire. The freeroam block runs, applying uncapped damage to frozen warmup players. The warmup godmode is completely unguarded.

**Is this dev/debug-only behavior?** No — affects every match start.

**Does proposed fix align with RAGE:MP docs?** Fix is pure server TypeScript logic, no RAGE:MP API dependency.

**Final classification:** DEFINITE BUG  
**Recommended action:** FIX NOW  
> Add a warmup-state early return before the mode checks: `if ((ffaMatch || gunGameMatch || hopoutsMatch) && (ffaMatch?.state === "warmup" || gunGameMatch?.state === "warmup" || hopoutsMatch?.state === "warmup")) return;`

---

## C05
**Current audit claim:** `character::select` CEF handler spawns character by raw DB `id` with no ownership check — any authenticated player can load any other player's character.

**Files involved:** `source/server/serverevents/Character.event.ts` lines 132–144

**Code verified:**
```ts
RAGERP.cef.register("character", "select", async (player: PlayerMp, data: string) => {
    let id: number;
    try { id = JSON.parse(data); } catch { ... }
    const character = await RAGERP.database.getRepository(CharacterEntity)
        .findOne({ where: { id } });           // ← no account FK check
    if (!character) return player.showNotify(...);
    await spawnWithCharacter(player, character);
});
```

**Is this likely intended?** No. The query finds a `CharacterEntity` by `id` alone, with no `account: { id: player.account.id }` constraint. Any authenticated player who knows or guesses a character ID can spawn as that character.

**Is this dev/debug-only behavior?** No — the select handler is live in production flow.

**Does proposed fix align with RAGE:MP docs?** Fix is pure TypeORM/TypeScript.

**Final classification:** DEFINITE SECURITY RISK  
**Recommended action:** FIX NOW  
> Add account ownership check: `.findOne({ where: { id, account: { id: player.account?.id } } })`. Also add `if (!player.account) return;` guard at the top.

---

## C06
**Current audit claim:** Real `.env` file with plaintext DB password (`Headshot123`) is present in the repository backup.

**Files involved:** `gamemode/.env`

**Code verified:**
```
DB_HOST=localhost
DB_USER=postgres
DB_PASS=Headshot123
DB_DATABASE=havoc_arena
DB_BETA=true
DB_BETA_PASSWORD=Headshot123
```

**Is this likely intended?** No. Credentials in VCS are unambiguously an error, even in a private backup. `gamemode/.gitignore` should exclude `.env`.

**Is this dev/debug-only behavior?** The credentials themselves are dev (localhost DB). The exposure is not dev-only.

**Does proposed fix align with RAGE:MP docs?** N/A.

**Final classification:** DEFINITE SECURITY RISK  
**Recommended action:** FIX NOW  
> 1. Rotate the database password immediately.  
> 2. Confirm `.env` is in `.gitignore` (it is present in `gamemode/.gitignore` per audit — verify it is correct).  
> 3. Audit git history for previous commits containing the credential; scrub if the repo is ever shared.

---

## C07
**Current audit claim:** Dead players (`alive = false`) can continue sending `server:PlayerHit` events — no alive/isDead check on the shooter in the damage handler.

**Files involved:** `source/server/serverevents/DamageSync.event.ts` lines 170–173

**Code verified:**
```ts
mp.events.add("server:PlayerHit", (shooter: PlayerMp, victimId, bone, weaponHash) => {
    if (!shooter || !mp.players.exists(shooter)) return;  // only existence check
    const victim = mp.players.at(victimId);
    if (!victim || !mp.players.exists(victim)) return;
    // ← no check: shooter.health <= 0 / shooter alive status
```

**Is this likely intended?** No. Dead players should not be able to deal damage. `CombatIntegrity` validates fire-rate and distance but not shooter alive state.

**Is this dev/debug-only behavior?** No.

**Does proposed fix align with RAGE:MP docs?**  
UNVERIFIED AGAINST LIVE DOCS — checking `player.health <= 0` or a server-side `alive` variable should work. The player variable `alive` exists on match player records in ArenaMatch.manager.ts.

**Final classification:** DEFINITE SECURITY RISK  
**Recommended action:** FIX NOW  
> Add early return: `if (shooter.health <= 0) return;` after the existence check, OR check the match-player's `.alive` flag if one is set for the shooter. The `health <= 0` check is the simpler immediate guard.

---

## C08
**Current audit claim:** Weapon hash sent by client is not validated against a whitelist in the damage handler — unknown hashes receive fallback damage values and are not rejected.

**Files involved:** `source/server/serverevents/DamageSync.event.ts` line 104–115

**Code verified:**
```ts
function getWeaponDamage(weaponHash: string, distance: number): number {
    const w = weaponDamage[weaponHash] ?? {
        base: DEFAULT_WEAPON_BASE,   // 28
        min: DEFAULT_WEAPON_MIN,     // 10
        effectiveRange: DEFAULT_EFFECTIVE_RANGE  // 35
    };
    ...
}
```

**Is this likely intended?** Partially. The fallback (28 base damage) is conservative — it doesn't grant a cheat advantage since it's lower than most real weapons. However, an attacker who sends a fake weapon hash will still be able to deal damage. The arena damage multiplier and cap still apply on top of this, so the damage is bounded.

**Is this dev/debug-only behavior?** No.

**Does proposed fix align with RAGE:MP docs?** Fix is pure server logic.

**Final classification:** NEEDS PRODUCT DECISION  
**Recommended action:** REQUIRE PRODUCT DECISION  
> Option A: Reject unknown hashes (`return` early, no damage applied) — safer, may reject legitimate future weapons.  
> Option B: Keep fallback but log the unknown hash for review — current behavior with monitoring.  
> Option C: Add the full GTA weapon list to the whitelist — eliminates the gap.

---

## C09
**Current audit claim:** Chat uses `dangerouslySetInnerHTML={{ __html: el.html }}` with no sanitization — full XSS vector in the chat panel.

**Files involved:** `frontend/src/pages/hud/Chat/Chat.tsx` line 182

**Code verified:**
```tsx
<span
    className={style.message}
    style={{ fontSize: `${store.settings.fontsize}vh` }}
    dangerouslySetInnerHTML={{ __html: timePrefix + el.html }}
/>
```

**Is this likely intended?** The use of raw HTML for chat is likely intentional to support color codes and formatting. The sanitization is not intentional.

**Is this dev/debug-only behavior?** No — all players see the chat.

**Does proposed fix align with RAGE:MP docs?** Fix is React/browser-side. In RAGE:MP CEF, `mp.trigger()` IS callable from injected JavaScript, making this a direct path to executing arbitrary client events from chat messages. High severity.

**Final classification:** DEFINITE SECURITY RISK  
**Recommended action:** FIX NOW  
> Add `DOMPurify.sanitize()` around `el.html` before render. Configure DOMPurify to allow color/formatting spans but strip script, img onerror, and other event attributes.

---

## C10
**Current audit claim:** Admin audit log is stored in-memory only (max 2000 entries) and is lost on every server restart — admin actions are not persistently recorded.

**Files involved:** `source/server/admin/AdminAudit.service.ts`

**Code verified:**
```ts
/**
 * Phase 1: in-memory stub; later can persist to DB or file.
 */
const MAX_ENTRIES = 2000;
const entries: AuditEntry[] = [];
```

**Is this likely intended?** Yes. The developer's own comment reads "Phase 1: in-memory stub; later can persist to DB or file." The audit finding is accurate but the behavior is explicitly acknowledged and accepted in the current phase.

**Is this dev/debug-only behavior?** Yes — acceptable for a development phase, not acceptable for production with live admins.

**Does proposed fix align with RAGE:MP docs?** N/A.

**Final classification:** INTENTIONAL DEV/DEBUG BEHAVIOR  
**Recommended action:** KEEP AS-IS (for now) — but track DB persistence as a required pre-production task.  
> The comment already documents the intent. Do not "fix" the in-memory behavior before the server is live; do add the DB flush path before opening to public players where admin accountability matters.

---

---

# PART B — HIGH FINDINGS (H01–H15, H21)

---

## H01
**Current audit claim:** `mp.gui.cursor.show(showCursor, showCursor)` — passing `lockedAtCenter = true` when showing the cursor breaks all UI click interaction.

**Files involved:** `source/client/classes/Browser.class.ts` lines 341, 353, 360, 367, 374, 378, 589

**Code verified:**
```ts
const showCursor = showCursorBase && !(mainMenuClothingActive && mainMenuClothingRotateHeld);
mp.gui.cursor.show(showCursor, showCursor);  // both params same value
```

**Is this likely intended?** Unknown. The pattern is consistent and deliberate (all cursor show calls use the same variable for both params), but if `lockedAtCenter = true` truly prevents clicking on CEF elements, the entire menu/lobby/auth UI would be broken. The server is described as functional by multiple audit documents, which contradicts a total UI break.

**Is this dev/debug-only behavior?** No.

**Does proposed fix align with RAGE:MP docs?**  
UNVERIFIED AGAINST LIVE DOCS — The audit states "Second param is `lockedAtCenter`". If this is correct, the fix (passing `false` as the second arg when showing cursor for UI interaction) is straightforward. However, in some RAGE:MP versions/builds `lockedAtCenter` may only lock the cursor for game input without affecting CEF element interaction.

**Final classification:** NEEDS RUNTIME VERIFICATION  
**Recommended action:** REQUIRE RUNTIME TEST FIRST  
> Boot the server, open the main menu, attempt to click a button. If clicking works normally, dismiss the finding (RAGE:MP's CEF cursor handling differs from the assumption). If clicking is broken, fix: `mp.gui.cursor.show(showCursor, false)` for all UI pages.

---

## H02
**Current audit claim:** CEF `execute()` script injection — event names and args are string-interpolated into `window.callHandler(...)` without escaping.

**Files involved:** `source/client/classes/Browser.class.ts` lines 413–419

**Code verified:**
```ts
const event = eventName.split("cef::")[1];
const argsString = args.map((arg: string) => JSON.stringify(arg)).join(", ");
const script = `
    window.callHandler("${event}", ${argsString})
`;
this.mainUI.execute(script);
```

**Is this likely intended?** No. The `event` variable is raw string-interpolated into the JS string literal. If an event name ever contains `"` or backtick, it breaks the script or injects code. `argsString` is `JSON.stringify`-escaped and safer, but not immune to all edge cases.

**Is this dev/debug-only behavior?** No — all server→CEF events go through this path.

**Does proposed fix align with RAGE:MP docs?** Yes — `BrowserMp.execute()` takes a JS string, so properly escaping the interpolation is the correct approach. UNVERIFIED AGAINST LIVE DOCS for exact API constraints.

**Final classification:** DEFINITE SECURITY RISK  
**Recommended action:** FIX NOW  
> Escape `event` before interpolation: `event.replace(/\\/g, "\\\\").replace(/"/g, '\\"')`. Or better: use `JSON.stringify(event)` and remove the surrounding quotes in the template literal.

---

## H03
**Current audit claim:** Discord OAuth URL from server is passed directly to `mp.browsers.new(url)` with no validation — compromised server or MITM can open any URL in the player's CEF browser.

**Files involved:** `source/client/clientevents/Auth.event.ts` lines 50–57

**Code verified:**
```ts
mp.events.add("client::auth:discordOpen", (url: string) => {
    if (!url || typeof url !== "string") return;  // only type check
    discordOAuthBrowser = mp.browsers.new(url);
});
```

**Is this likely intended?** No. The check only ensures the URL is a non-empty string. Any URL (phishing page, local file, data: URI) would be opened. This requires server compromise or network MITM to exploit — a legitimate player cannot inject this event. However, defense in depth calls for URL allowlisting.

**Is this dev/debug-only behavior?** No.

**Does proposed fix align with RAGE:MP docs?** `mp.browsers.new(url)` is confirmed correct per original audit's wiki table. The fix is adding a client-side URL validation before the call.

**Final classification:** DEFINITE SECURITY RISK  
**Recommended action:** FIX NOW  
> Add: `if (!url.startsWith("https://discord.com/")) return;` before `mp.browsers.new(url)`.

---

## H04
**Current audit claim:** `allow-cef-debugging: true` in both `conf.json` files — players can open Chromium DevTools in-game.

**Files involved:** `gamemode/conf.json`, `ragemp-server/conf.json`

**Code verified:**
```json
{ "allow-cef-debugging": true, "fqdn": "eu.loclx.io" }
```
Both files identical.

**Is this likely intended?** Yes, for development. The `fqdn: "eu.loclx.io"` (localtunnel dev domain) in the same files confirms these are dev configs. CEF debugging is required during development.

**Is this dev/debug-only behavior?** Yes.

**Does proposed fix align with RAGE:MP docs?** `allow-cef-debugging` is a RAGE:MP server config key. Setting it to `false` in production is the documented approach.

**Final classification:** INTENTIONAL DEV/DEBUG BEHAVIOR  
**Recommended action:** MOVE TO DEV-ONLY CONFIG  
> Create production-ready config template: `"allow-cef-debugging": false`. Document that dev config overrides this. The same change should remove `fqdn: "eu.loclx.io"` and set the real domain.

---

## H05
**Current audit claim:** `resolution.y` is assigned to a variable named `width` — screen height is used as screen width in the camera rotation direction threshold, breaking rotation on all non-square resolutions.

**Files involved:** `source/client/classes/Camera.class.ts` lines 217–219

**Code verified:**
```ts
//@ts-ignore
const resolution = mp.game.graphics.getScreenActiveResolution();
const width = resolution.y;  // ← should be resolution.x
const cursor = mp.gui.cursor.position;
_x = cursor[0];
if (_x < width / delCount + width / 2) { ... }
```

**Is this likely intended?** No. The variable is named `width` but assigned `resolution.y` (height). This makes the rotation threshold based on screen height instead of width. On a 1920×1080 display, `width=1080` instead of `width=1920`, meaning the rotation pivot is shifted significantly left.

**Is this dev/debug-only behavior?** No — affects all character creator / tune cam rotations on non-square screens (every standard monitor).

**Does proposed fix align with RAGE:MP docs?**  
UNVERIFIED AGAINST LIVE DOCS — `getScreenActiveResolution()` return format (`{x, y}` vs `{width, height}`) needs confirmation, but the variable name makes the intent clear: `width` should use the horizontal resolution component.

**Final classification:** DEFINITE BUG  
**Recommended action:** FIX NOW  
> Change `const width = resolution.y;` to `const width = resolution.x;`.

---

## H06
**Current audit claim:** `destroyCamera` never removes entries from `this.list` — `isActive()` returns stale truthy results for destroyed cameras.

**Files involved:** `source/client/classes/Camera.class.ts` lines 291–298

**Code verified:**
```ts
destroyCamera(name: string) {
    const camera = this.list.find((element) => element.name === name);
    if (camera && mp.cameras.exists(camera.cam)) {
        camera.cam.setActive(false);
        camera.cam.destroy();
        mp.game.cam.renderScriptCams(false, false, 0, false, false, 0);
        // ← no: this.list = this.list.filter(e => e.name !== name);
    }
}
```

**Is this likely intended?** No. The camera is destroyed but remains in `this.list`. `isActive(name)` calls `this.list.some(e => e.name === name)` — it will return `true` for a destroyed camera forever after.

**Is this dev/debug-only behavior?** No — affects login camera and all game cameras.

**Does proposed fix align with RAGE:MP docs?** Fix is pure TypeScript array management.

**Final classification:** DEFINITE BUG  
**Recommended action:** FIX NOW  
> Add after `camera.cam.destroy()`: `this.list = this.list.filter((e) => e.name !== name);`

---

## H07
**Current audit claim:** `Raycast.class.ts` constructor calls two undocumented/experimental RAGE:MP APIs with `@ts-ignore` and no try/catch — if the APIs don't exist, the entire client crashes on startup.

**Files involved:** `source/client/classes/Raycast.class.ts` lines 23–27

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

**Is this likely intended?** The `@ts-ignore` suppression and `logWarning` output suggest the developer knew these were experimental. No try/catch means if either API is absent in the deployed RAGE:MP build, `this.batch` is undefined, and any subsequent `this.batch.addThisFrame()` call in `render()` throws, crashing the render loop.

**Is this dev/debug-only behavior?** Uncertain — the EntityRaycast is used for the freeroam entity highlight system (tuner/object inspection). May be active for all logged-in players.

**Does proposed fix align with RAGE:MP docs?**  
UNVERIFIED AGAINST LIVE DOCS — these graphics overlay APIs are not in the standard RAGE:MP documented API set.

**Final classification:** DEFINITE BUG  
**Recommended action:** FIX NOW  
> Wrap constructor body in try/catch. If catch fires, set `this.batch = null` and log a warning. Guard all `this.batch` usage with `if (!this.batch) return;`.

---

## H08
**Current audit claim:** Raycast `setInterval(100ms)` is never cleared — interval runs for the entire session, forever calling game APIs every 100ms with no destroy path.

**Files involved:** `source/client/classes/Raycast.class.ts` line 21

**Code verified:**
```ts
this.rayCastInterval = setInterval(this.process.bind(this), 100);
// No destroy() or clearInterval() method exists in the class
```

**Is this likely intended?** No explicit cleanup path. However, `process()` guards itself: `if (!mp.players.local.getVariable("loggedin") || mp.players.local.isSittingInAnyVehicle()) { this.entity = null; return; }` — so the interval does no meaningful work unless logged in and on foot. The 100ms interval itself is not a CPU concern; the lack of cleanup is a code quality issue.

**Is this dev/debug-only behavior?** No — runs for the entire client session.

**Does proposed fix align with RAGE:MP docs?** Fix is standard Node.js `clearInterval`.

**Final classification:** DEFINITE BUG (low operational impact due to guards, but correctness issue)  
**Recommended action:** FIX NOW  
> Add a `destroy()` method: `destroy() { if (this.rayCastInterval) { clearInterval(this.rayCastInterval); this.rayCastInterval = null; } }`. Call it on disconnect/logout.

---

## H09
**Current audit claim:** `setOnGroundProperly`: `getGroundZFor3dCoord` can return `undefined` or `0` in interiors/unloaded terrain; no null check means player is teleported to Z=1 (underground).

**Files involved:** `source/client/prototype/Player.prototype.ts` lines 107–111

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
        posZ + 1,   // ← posZ is undefined/0 → teleport to Z=1
        false, false, false
    );
};
```

**Is this likely intended?** No. The native `getGroundZFor3dCoord` fails in unloaded terrain/interiors and returns 0 or undefined. Without a null check, `posZ + 1 = 1` (or `NaN + 1 = NaN`), teleporting the player underground.

**Is this dev/debug-only behavior?** No — used when placing players on ground after spawn.

**Does proposed fix align with RAGE:MP docs?**  
UNVERIFIED AGAINST LIVE DOCS — the return value behavior of `getGroundZFor3dCoord` is unloaded-terrain specific; fix is to guard the result.

**Final classification:** DEFINITE BUG  
**Recommended action:** FIX NOW  
> Add: `if (!posZ || posZ === 0) return;` before `setCoordsNoOffset`. Alternatively keep current Z and only update if posZ is a positive finite number.

---

## H10
**Current audit claim:** `/ban` command does not save `rsgId` to the ban record — the HWID ban vector is always empty.

**Files involved:** `source/server/commands/Admin.commands.ts` lines 670–678, `source/server/database/entity/Ban.entity.ts`

**Code verified:**
```ts
// BanEntity has field:
@Column({ type: "varchar", length: 255, nullable: true, default: null })
rsgId: string;   // ← column exists

// /ban command:
const ban = new BanEntity();
ban.serial = target.serial;   // HWID fingerprint IS saved
ban.ip = target.ip;
ban.username = target.name;
// ban.rsgId = ???   ← never set; no player.rsgId call
```

**Is this likely intended?** No. The `rsgId` column exists in the schema (it was planned). The `/ban` handler saves `serial` (hardware fingerprint) but never populates `rsgId` (Rockstar Social Club ID), leaving that ban vector permanently null. Note: `serial` IS being saved, so HWID banning works — the audit's claim that "the HWID ban vector is always empty" is partially overstated. The missing piece is specifically the Rockstar ID.

**Is this dev/debug-only behavior?** No.

**Does proposed fix align with RAGE:MP docs?**  
UNVERIFIED AGAINST LIVE DOCS — `player.socialClub` or equivalent property needs confirmation for the correct RAGE:MP API to get the RSG ID.

**Final classification:** DEFINITE BUG (narrower than audit claim — serial IS saved; rsgId is not)  
**Recommended action:** FIX NOW  
> Add `ban.rsgId = target.socialClub ?? "";` (verify the correct RAGE:MP property name for Social Club ID against live docs).

---

## H11
**Current audit claim:** No database transactions on character creation, account creation, or on-quit save — partial writes on crash result in corrupt or missing character data.

**Files involved:** `source/server/serverevents/Character.event.ts`, `Auth.event.ts`, `Player.event.ts`

**Code verified:**
```ts
// Character.event.ts lines 185-192 (create flow):
const result = await RAGERP.database.getRepository(CharacterEntity).save(characterData);
// Auth.event.ts: bare repository.findOne / repository.update calls
// No queryRunner.startTransaction() found anywhere in these files
```

**Is this likely intended?** No. Character creation involves multiple operations (account lookup, character save, clothing apply, session state). If the server crashes between steps, the database can be left in a partial state. For a single-table write (character.save) the risk is low; for multi-step flows (e.g. account + character + session in a single logical operation) the risk is meaningful.

**Is this dev/debug-only behavior?** No.

**Does proposed fix align with RAGE:MP docs?** Fix is TypeORM — use `queryRunner.startTransaction()` / `commit()` / `rollback()`.

**Final classification:** DEFINITE BUG  
**Recommended action:** FIX NOW (medium priority — wrap multi-step create flows first; single-table saves are lower risk)

---

## H12
**Current audit claim:** No timeout on Discord HTTPS outbound requests — unresponsive Discord API hangs player session handler indefinitely.

**Files involved:** `source/server/modules/discordAuth/discordHttps.ts` lines 8–39

**Code verified:**
```ts
const opt: https.RequestOptions = {
    hostname: u.hostname,
    path: u.pathname + u.search,
    method,
    headers: headers || {}
    // ← no: timeout property
};
const req = https.request(opt, (res) => { ... });
req.on("error", reject);
// ← no: req.setTimeout(...)
```

**Is this likely intended?** No. `https.request` in Node.js has no default timeout. A hanging Discord API call will block the async `auth::discordStart` handler for the player indefinitely, preventing them from logging in and leaking a promise.

**Is this dev/debug-only behavior?** No.

**Does proposed fix align with RAGE:MP docs?** Fix is standard Node.js `req.setTimeout(ms, () => req.destroy())`.

**Final classification:** DEFINITE BUG  
**Recommended action:** FIX NOW  
> Add to `requestJson`: `req.setTimeout(10000, () => { req.destroy(new Error("Discord request timeout")); });`

---

## H13
**Current audit claim:** `character::create` handler has no auth gate — a player can call it without a valid `player.account`.

**Files involved:** `source/server/serverevents/Character.event.ts` lines 148–150, 154–155

**Code verified:**
```ts
// character::create — starts creator UI
RAGERP.cef.register("character", "create", async (player: PlayerMp) => {
    startCreatorFlow(player);   // ← no player.account check
});

// creator::create — actual character save
RAGERP.cef.register("creator", "create", async (player, data) => {
    if (!player.account) return player.kick("An error has occurred!");  // ← IS gated
    ...
});
```

**Is this likely intended?** Partially. Starting the creator UI flow (`character::create`) has no auth gate. The actual character creation (`creator::create`) IS gated with a kick if no account exists. An unauthenticated player who triggers `character::create` sees the creator UI but cannot save a character. The risk is the creator UI leaking to unauthenticated state, not actual account creation.

**Is this dev/debug-only behavior?** No.

**Does proposed fix align with RAGE:MP docs?** Fix is a server-side check.

**Final classification:** NEEDS PRODUCT DECISION (low severity — creation is gated; only UI leak)  
**Recommended action:** FIX NOW (for defense in depth)  
> Add at top of `character::create` handler: `if (!player.account) return;`

---

## H14
**Current audit claim:** Client-controlled `bone` string in damage events — cheater always sends `"Head"` to guarantee 1.5× headshot multiplier.

**Files involved:** `source/server/serverevents/DamageSync.event.ts` line 210, `source/client/modules/DamageSync.module.ts` line 88

**Code verified:**
```ts
// Client sends bone from geometric nearest-bone calculation
mp.events.callRemote("server:PlayerHit", target.remoteId, bone, weaponHash);

// Server applies multiplier from client-reported bone
const isHead = targetBone === "Head";
const boneMult = getBoneMultiplier(targetBone);  // Head = 1.5×
const finalDamage = Math.round(weaponDmg * boneMult * 10) / 10;
```

The AUDIT_REPORT.md Section 4.2 explicitly documents this: *"Client-side damage detection feeds server — By Design. This is standard for RageMP but means client-side hit detection is trusted for bone selection."*

**Is this likely intended?** Yes. Client-side hit detection is the standard RAGE:MP architecture. Server cannot independently raytrace hits; it relies on the client's reported bone. The `CombatIntegrity` module validates fire rate, distance, and duplicate hits — everything that can be validated server-side without client trust.

**Is this dev/debug-only behavior?** No.

**Does proposed fix align with RAGE:MP docs?**  
UNVERIFIED AGAINST LIVE DOCS — Server-side bone validation would require additional position data and is a design enhancement, not a bug fix.

**Final classification:** INTENDED BEHAVIOR  
**Recommended action:** KEEP AS-IS  
> The bone trust is inherent to the client-hit-detection model. A statistical headshot-rate anomaly detector (flag accounts with >80% headshot rate) is the appropriate mitigation, not a code fix. This is a design tradeoff, not a bug.

---

## H15
**Current audit claim:** Players who mass-disconnect and reconnect during a round have their health fully restored — `spawnPlayerAtArena` sets health=200, armor=100 for reconnecting players.

**Files involved:** `source/server/modes/hopouts/ArenaMatch.manager.ts` lines 1102–1107, 1474–1490

**Code verified:**
```ts
function spawnPlayerAtArena(player, spawn, dimension) {
    ...
    player.health = 200;
    player.armour = 100;
    ...
}

// Reconnect path (line 1478):
spawnPlayerAtArena(player, spawn, match.dimension);  // always called, always restores full HP
```

**Is this likely intended?** No. A player who disconnects mid-fight at low HP and reconnects within 60 seconds gets full health. This is an intentional-disconnect exploit for HP restoration.

**Is this dev/debug-only behavior?** No.

**Does proposed fix align with RAGE:MP docs?** Fix is server-side — store pre-disconnect HP in the reconnect slot and restore that value instead of 200/100.

**Final classification:** DEFINITE BUG  
**Recommended action:** FIX NOW  
> In `handleMatchDisconnect`, record `matchPlayer.savedHealth = player.health` and `matchPlayer.savedArmour = player.armour`. In `restoreReconnectingPlayer`, call `spawnPlayerAtArena` and then override: `player.health = reconnectSlot.savedHealth; player.armour = reconnectSlot.savedArmour;`.

---

## H21
**Current audit claim:** `App.tsx` cleanup calls `stopAddingHandler()` which only logs — does NOT remove handlers; `system:setPage` and `notify:show` handlers accumulate on every component remount.

**Files involved:** `frontend/src/App.tsx` lines 55–67, `frontend/src/utils/EventManager.util.ts` lines 121–130

**Code verified:**
```ts
// App.tsx useEffect cleanup:
return () => {
    EventManager.stopAddingHandler("notify");   // ← only logs
    EventManager.stopAddingHandler("system");   // ← only logs
};

// EventManager.util.ts stopAddingHandler():
public stopAddingHandler(target: string): void {
    if (isDev) this.eventsInMemory.filter(...).forEach((event) => console.log(...));
    if (isDev) { console.log(`${target} events loaded`); }
    if (target === "app") { console.log("All events loaded"); }
}  // ← no handler removal; eventsInMemory unchanged
```

**Is this likely intended?** No. `stopAddingHandler` is a dev-only logging helper, not a cleanup function. The `removeTargetHandlers(target)` method exists on EventManager and DOES remove handlers, but is not called in the cleanup. Each React remount of `App.tsx` adds a new `setPage` and `notify:show` handler without removing the old ones.

**Is this dev/debug-only behavior?** No — React components remount in normal operation (page transitions, hot reload, strict mode double-invocation).

**Does proposed fix align with RAGE:MP docs?** Fix is React/EventManager only.

**Final classification:** DEFINITE BUG  
**Recommended action:** FIX NOW  
> Change cleanup to: `return () => { EventManager.removeTargetHandlers("notify"); EventManager.removeTargetHandlers("system"); };`

---

---

# PART C — RAGE:MP API VERIFICATION TABLE

| Finding | API Used | Expected API | Verified? | Status |
|---|---|---|---|---|
| C01 | `mp.players.at(remoteId)` | `mp.players.atRemoteId(remoteId)` | NO — wiki 403 | UNVERIFIED — likely correct if id=pool index |
| C02/C03 | `setInterval(fn, 0)` / `setInterval(fn)` | `setInterval(fn, intervalMs)` | YES — Node.js standard | CONFIRMED BUG |
| H01 | `mp.gui.cursor.show(bool, bool)` | `show(visible, lockedAtCenter)` | NO — wiki 403 | UNVERIFIED — runtime test needed |
| H02 | `browser.execute(jsString)` | takes raw JS string | YES — confirmed by original audit | CONFIRMED — injection risk via interpolation |
| H03 | `mp.browsers.new(url)` | `(string): BrowserMp` | YES — confirmed by original audit | CORRECT CALL — validation of `url` is missing |
| H05 | `getScreenActiveResolution().y` | `.x` = width, `.y` = height | NO — wiki 403 | UNVERIFIED — variable name mismatch is clear |
| H07 | `mp.game.graphics.setEntityOverlayPassEnabled` | not in documented API | NO — wiki 403 | UNVERIFIED — experimental API |
| H07 | `mp.game.graphics.createEntityOverlayBatch` | not in documented API | NO — wiki 403 | UNVERIFIED — experimental API |
| H09 | `getGroundZFor3dCoord` return value | can return 0/undefined | NO — wiki 403 | UNVERIFIED — null guard is prudent regardless |
| H10 | `player.serial` | HWID fingerprint | PLAUSIBLE — serial ban IS saving | `player.socialClub` or `rsgId` property needs wiki check |
| H14 | Client bone detection | Server-authoritative | N/A | INTENDED BEHAVIOR — documented in AUDIT_REPORT.md |
| C09 | `dangerouslySetInnerHTML` | Browser JS execution | YES — CEF runs full Chromium | CONFIRMED SECURITY RISK |

---

---

# PART D — CONSOLIDATED FIX PRIORITY LIST

| Priority | ID | Classification | Action | File | Note |
|---|---|---|---|---|---|
| 1 | C06 | DEFINITE SECURITY RISK | FIX NOW | `gamemode/.env` | Rotate credentials first |
| 2 | C05 | DEFINITE SECURITY RISK | FIX NOW | `Character.event.ts:140` | Add account ownership WHERE clause |
| 3 | C07 | DEFINITE SECURITY RISK | FIX NOW | `DamageSync.event.ts:173` | Add `shooter.health <= 0` guard |
| 4 | C09 | DEFINITE SECURITY RISK | FIX NOW | `Chat.tsx:182` | Add DOMPurify sanitization |
| 5 | H02 | DEFINITE SECURITY RISK | FIX NOW | `Browser.class.ts:417` | Escape event name before interpolation |
| 6 | H03 | DEFINITE SECURITY RISK | FIX NOW | `Auth.event.ts:56` | Add `startsWith("https://discord.com/")` check |
| 7 | C04 | DEFINITE BUG | FIX NOW | `DamageSync.event.ts:260` | Block damage when match state = warmup |
| 8 | C02 | DEFINITE BUG | FIX NOW | `Camera.class.ts:372` | Change 0ms interval to 50ms |
| 9 | C03 | DEFINITE BUG | FIX NOW | `Player.prototype.ts:97` | Add 100ms interval argument |
| 10 | H15 | DEFINITE BUG | FIX NOW | `ArenaMatch.manager.ts:1478` | Save and restore pre-disconnect HP |
| 11 | H21 | DEFINITE BUG | FIX NOW | `App.tsx:64` | Use `removeTargetHandlers` not `stopAddingHandler` |
| 12 | H05 | DEFINITE BUG | FIX NOW | `Camera.class.ts:218` | `resolution.y` → `resolution.x` |
| 13 | H06 | DEFINITE BUG | FIX NOW | `Camera.class.ts:296` | Add list splice on destroyCamera |
| 14 | H09 | DEFINITE BUG | FIX NOW | `Player.prototype.ts:110` | Guard posZ before setCoordsNoOffset |
| 15 | H10 | DEFINITE BUG | FIX NOW | `Admin.commands.ts:675` | Populate `ban.rsgId` |
| 16 | H12 | DEFINITE BUG | FIX NOW | `discordHttps.ts:22` | Add 10s request timeout |
| 17 | H07 | DEFINITE BUG | FIX NOW | `Raycast.class.ts:23` | Wrap experimental APIs in try/catch |
| 18 | H08 | DEFINITE BUG | FIX NOW | `Raycast.class.ts` | Add destroy() with clearInterval |
| 19 | H11 | DEFINITE BUG | FIX NOW | `Character.event.ts`, `Auth.event.ts` | Wrap multi-step saves in transactions |
| 20 | H13 | NEEDS PRODUCT DECISION | FIX NOW (defense) | `Character.event.ts:148` | Add auth gate to creator flow start |
| 21 | H04 | INTENTIONAL DEV/DEBUG | MOVE TO DEV-ONLY CONFIG | Both `conf.json` | `"allow-cef-debugging": false` in prod |
| 22 | C10 | INTENTIONAL DEV/DEBUG | KEEP AS-IS | `AdminAudit.service.ts` | DB persistence is planned; do before public launch |
| 23 | C01 | NEEDS DOC CONFIRMATION | REQUIRE RUNTIME TEST | `DamageSync.event.ts:172` | Verify correct player gets damage |
| 24 | H01 | NEEDS RUNTIME VERIFICATION | REQUIRE RUNTIME TEST | `Browser.class.ts:341` | Check if UI clicks work with lockedAtCenter=true |
| 25 | C08 | NEEDS PRODUCT DECISION | REQUIRE PRODUCT DECISION | `DamageSync.event.ts:104` | Reject vs. allow unknown weapon hashes |
| 26 | H14 | INTENDED BEHAVIOR | KEEP AS-IS | `DamageSync.module.ts:88` | Client bone detection is by-design in RAGE:MP |

---

## FINDINGS NOT IN SCOPE (Medium/Low)
The 11 Medium and 17 Low findings from the original audit were not re-validated in this pass per the scope agreement (Critical + top 15 High only). They are carried forward from AUDIT_FINDINGS.md without classification change.

---

*Validation pass complete. No code was modified. Output ready to be written to `AUDIT_VALIDATION_PASS.md`.*
