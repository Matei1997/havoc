# Audit of the Audits — Full `Audits/` Folder vs Live RAGE:MP Wiki

**Date:** 2026-04-25  
**Scope:** Every file under `Audits/` — methodology, RAGE:MP API claims, and “UNVERIFIED” labels re-checked against **live** [wiki.rage.mp](https://wiki.rage.mp/) (no repo code changes; this document only).  
**Companion:** `META_AUDIT_OF_ALL_AUDIT_DOCUMENTS.md` — full-folder *document* QA (contradictions, labeling errors, duplicate files), end-to-end read 2026-04-25.  
**Why:** Original passes often state `wiki.rage.mp` returned **HTTP 403** and therefore relied on training data. This addendum **does not re-audit gameplay/DB/React** line-by-line — it **adjudicates what the audit documents themselves claim about RAGE:MP**.

---

## 1. Wiki pages used as reference (representative)

| Topic | Wiki page |
|-------|-----------|
| Player pool lookup | [Pool::at](https://wiki.rage.mp/wiki/Pool::at), [Pool::atRemoteId](https://wiki.rage.mp/wiki/Pool::atRemoteId) |
| Shared id | [Entity::remoteId](https://wiki.rage.mp/wiki/Entity::remoteId), [Entity::id](https://wiki.rage.mp/wiki/Entity::id) |
| Cursor | [Cursor.show](https://wiki.rage.mp/wiki/Cursor.show) |
| Screen size | [Graphics::getScreenActiveResolution](https://wiki.rage.mp/wiki/Graphics::getScreenActiveResolution) |
| Ground Z | [Gameplay::getGroundZFor3dCoord](https://wiki.rage.mp/wiki/Gameplay::getGroundZFor3dCoord) |
| Overlays | [Graphics::setEntityOverlayPassEnabled](https://wiki.rage.mp/wiki/Graphics::setEntityOverlayPassEnabled), [Graphics::createEntityOverlayBatch](https://wiki.rage.mp/wiki/Graphics::createEntityOverlayBatch) |
| Raycast | [Raycasting::testCapsule](https://wiki.rage.mp/wiki/Raycasting::testCapsule), [Raycasting::testPointToPoint](https://wiki.rage.mp/wiki/Raycasting::testPointToPoint) |
| Browser / CEF | [Browser::execute](https://wiki.rage.mp/wiki/Browser::execute), [Browser::Browser](https://wiki.rage.mp/wiki/Browser::Browser) |
| Networking | [Events::callRemote](https://wiki.rage.mp/wiki/Events::callRemote), [Player::call](https://wiki.rage.mp/wiki/Player::call) |
| Events API | [Events::add](https://wiki.rage.mp/wiki/Events::add), [Events::Event](https://wiki.rage.mp/wiki/Events::Event) |
| Server variables | [Entity::setVariable](https://wiki.rage.mp/wiki/Entity::setVariable) |
| Player identity | [Player::serial](https://wiki.rage.mp/wiki/Player::serial), [Player::rgscId](https://wiki.rage.mp/wiki/Player::rgscId), [Player::socialClub](https://wiki.rage.mp/wiki/Player::socialClub) |
| Health | [Player::health](https://wiki.rage.mp/wiki/Player::health) |

---

## 2. Per-file inventory (all files in `Audits/`) + wiki impact

| # | File | Type | Wiki-related content? | Recheck note |
|---|------|------|------------------------|--------------|
| 1 | `AUDIT_FINDINGS.md` | Core findings list | **Yes** — C01 `at` vs `atRemoteId`, H01 `lockedAtCenter`, H07 “undocumented” APIs | C01 / H01 / H07: see §3. Non-wiki items (C04–C10, XSS, .env) unchanged. |
| 2 | `AUDIT_FINDINGS_STAGE1.md` | Staged findings | **Yes** — same families as #1 | Same as #1. |
| 3 | `AUDIT_FINDINGS_FULL.md` | Merged F-Cxx / F-Hxx table | **Yes** — F-C01, F-H01, F-H07, API table | F-C01 / F-H01 / overlay “undocumented” row: see §3. |
| 4 | `AUDIT_REPORT_STAGE1.md` | Narrative report | **Yes** — §3 API table + C01 narrative | **§4.1 “wrong player for every hit”** — **overstated** per wiki (§3A). |
| 5 | `AUDIT_REPORT_FULL.md` | Full synthesis | **Yes** — same as Stage1 + executive summary | Same; strongest correction: F-C01 + cursor parameter names. |
| 6 | `AUDIT_VALIDATION_PASS.md` | Code validation of Critical/High | **Yes** | C01 marked “needs doc” — **wiki now partially resolves** in favor of `at(id)` on server when `id` = shared remote id. H01 still needs **parameter rename** to wiki. |
| 7 | `read-only-validation-pass-only-luminous-pnueli.md` | Transcript/duplicate of validation pass | **Yes** (duplicate) | Treat as same as #6. |
| 8 | `AUDIT_DAMAGE_COMBAT.md` | Combat subsystem | **Yes** — damage pipeline, `at`/`remoteId` | C01 class claims: **downgrade** until runtime proof. Warmup / dead shooter / hash: **not wiki** — keep. |
| 9 | `AUDIT_AUTH_ACCOUNT.md` | Auth / account | **Some** — `player.serial` / Social Club, OAuth | Wiki documents **serial**, **rgscId**, **socialClub**; fixes should use **rgscId** for ID, not `socialClub` name. |
| 10 | `AUDIT_ADMIN_REPORTS.md` | Admin / reports | Mostly **no** RAGE API | In-memory, POV, conf: **product/security**, not wiki. |
| 11 | `AUDIT_HOPOUTS_ZONE_SPAWNS.md` | Hopouts / zone / spawns | **Minimal** RAGE API | Logic/timer/spawn: **code**. |
| 12 | `AUDIT_FFA_GUNFAME_RANKED.MD` | FFA / GunGame / ranked | **Minimal** | Stats races, XP: **not wiki**. |
| 13 | `AUDIT_FRONTEND_CEF_UI.md` | CEF / React | **Some** — `execute`, `dangerouslySetInnerHTML` | CEF = Chromium: **still valid**; [Browser::execute](https://wiki.rage.mp/wiki/Browser::execute) confirms arbitrary JS. |
| 14 | `AUDIT_LOADOUT_CLOTHING_VEHICLES.md` | Loadout / wardrobe / vehicles | **Minimal** | Validation server-side: **not wiki**. |
| 15 | `AUDIT_RAGEMP_BROWSER_CEF_GUI.md` | RAGE client: browser / GUI | **Yes** | Claims `mp.gui.cursor.show(v,v)` “correct” for both equal — **function names wrong** in companion docs; semantics = freezeControls+visibility. |
| 16 | `AUDIT_RAGEMP_CAMERA_RENDER_RAYCAST.md` | Camera / render / raycast | **Yes** | **Overlay APIs documented** on wiki — “undocumented” in this file is **false**. [Raycasting::testCapsule](https://wiki.rage.mp/wiki/Raycasting::testCapsule) has optional `flags` — omission is a **real** design concern, not “no docs”. |
| 17 | `AUDIT_RAGEMP_HUD_RADAR_MINIMAP.md` | HUD / minimap / radar | **Yes** | Uses **`lockedAtCenter`** throughout — **contradicts** [Cursor.show](https://wiki.rage.mp/wiki/Cursor.show) (`freezeControls`, `visibility`). |
| 18 | `AUDIT_RAGEMP_PLAYER_ENTITY_DATA.md` | Player/entity data | **Yes** | **Central F-C01 doc**; states `remoteId` is not pool index and mandates `atRemoteId` on server. **Conflicts** with [Entity::remoteId](https://wiki.rage.mp/wiki/Entity::remoteId) + [Pool::at](https://wiki.rage.mp/wiki/Pool::at) (server id semantics). **Needs rewrite.** |
| 19 | `read-only-synthesis-only-do-woolly-honey.md` | Plan: merge into REPORT_FULL / FINDINGS_FULL | **Yes** — includes API table | Per-row: same corrections as `AUDIT_REPORT_FULL` API table. |
| 20 | `read-only-rage-mp-api-inventory-calm-wren.md` | RAGE “events” family (filename in doc: `AUDIT_RAGEMP_EVENTS_NETWORKING.md`) | **Yes** | **§2.2** `new mp.Event` “not documented” — **FALSE**: [Events::Event](https://wiki.rage.mp/wiki/Events::Event). **§2.3** `mp.events.add({...})` “not documented” — **FALSE**: [Events::add](https://wiki.rage.mp/wiki/Events::add) shows object form. **Downgrade** those HIGH findings to **AUDIT ERROR**; security content (emitServer allowlist) still stands. |
| 21 | `read-only-rage-mp-api-verification-generic-robin.md` | Plan for Browser+Camera audits | **Yes** | States “no live wiki” — now superseded. Overlay “undocumented” in plan: **outdated**. |
| 22 | `read-only-audit-continuation-only-concurrent-quiche.md` | Continuation / extra findings | **Yes** | grep shows many RAGE strings — re-check any **at/atRemoteId** and **cursor** lines same as §3. |
| 23 | `read-only-subsystem-audit-only-clever-scroll.md` | Plan → `AUDIT_FRONTEND_CEF_UI.md` | **Yes** (H02) | Duplicates **“lockedAtCenter”** and even `show(showCursor, true)`; wiki says **`freezeControls` + `visibility`** — same correction as §3B. Other rows: XSS, `render`, EventManager — **not wiki**. |
| 24 | `read-only-subsystem-audit-only-fuzzy-bee.md` | Source notes → `AUDIT_FFA_GUNFAME_RANKED.MD` | **Minimal** | CRIT-01/02 are **game logic / DB**; one line uses `mp.players.at(shooter.id)` for a **same-player** lookup — [Pool::at](https://wiki.rage.mp/wiki/Pool::at) is the normal server pattern for **own** id. |
| 25 | `read-only-subsystem-audit-only-memoized-planet.md` | Plan → `AUDIT_HOPOUTS_ZONE_SPAWNS.md` | **Minimal** | Server logic, timers, `DamageSync` references — any damage ID issue inherits **§3A** only if it repeats C01. |
| 26 | `read-only-subsystem-audit-only-enchanted-reef.md` | Plan (loadout audit) | **No** RAGE API deep dive | **N/A** for wiki. |
| 27 | `read-only-subsystem-audit-only-wise-haven.md` | Plan (admin audit) | **No** | **N/A** for wiki. |
| 28 | `you-are-performing-an-distributed-sifakis.md` | Full-stack audit **plan** | States verify against wiki | **Meta OK**; execution was blocked by 403 in other files. |
| 29 | `AUDIT_RAGEMP_VEHICLES_MODS_API.md` | Vehicle create/mod/tuning from bundled server | **Yes** — `mp.vehicles.*`, `setMod*`, livery | Vehicle **pool** `at` / client `atRemoteId` / `atHandle` same **semantic family** as §3A; confirm against wiki for constructor `color` array and respray helper params (marked UNVERIFIED in that file). |
| 30 | `AUDIT_RAGEMP_COMBAT_WEAPONS_API.md` | Weapons / combat from bundled server | **Some** | Focuses on **custom** `giveWeaponEx`, prototype weapon components/tints, `giveWeapon` / `removeAllWeapons`; **not** a duplicate of player-pool C01. Tint range validation gap is **gameplay**. |
| 31 | `AUDIT_OF_AUDITS_WIKI_RECHECK.md` | This meta recheck + digest | **N/A** | Canonical place to reconcile wiki vs prior audits. |

**Note:** #22 `read-only-audit-continuation-only-concurrent-quiche.md` is a long continuation; any **C01 / cursor / overlay** line duplicates §3. Spot-check if you add new API claims there.

---

## 3. Global corrections (original audits → wiki)

### A. F-C01 / `mp.players.at(victimId)` vs `victimId` from `target.remoteId`

**What many files claim:** `Pool::at` uses “pool index”; `remoteId` is a different “network id”; server must use `atRemoteId`; else **every hit targets the wrong player**.

**What the wiki supports:**

- [Entity::remoteId](https://wiki.rage.mp/wiki/Entity::remoteId): ID is **shared** between server and client.
- [Pool::at](https://wiki.rage.mp/wiki/Pool::at) (server): retrieve entity **by that pool id** (described as server-side id in context).
- [Pool::atRemoteId](https://wiki.rage.mp/wiki/Pool::atRemoteId): use when the client has a **server-issued** id that may not match **client** `entity.id` — i.e. the **`remoteId` / server id** use case, **not** a separate proof that `at()` on the server is wrong for that numeric id.

**Conclusion:** The **catastrophic** framing (“combat system broken at root” / “wrong player every time”) is **not established by the wiki** and should be **downgraded** to **“disputed — verify with 2 clients + logging”** unless you have **runtime** evidence. The **recommended one-line fix** “always use `atRemoteId` on server” may be harmless but is **not** clearly **required** by public wiki text alone.

**Strongest source of this overstatement:** `AUDIT_RAGEMP_PLAYER_ENTITY_DATA.md`, `AUDIT_FINDINGS.md`, `AUDIT_REPORT_FULL.md` §4.1.

---

### B. F-H01 / `mp.gui.cursor.show(a, a)` — “lockedAtCenter”

**What many files claim:** Second parameter is `lockedAtCenter`; when `true`, cursor pinned to **center** of screen; UI unusable.

**What the wiki states:** [Cursor.show](https://wiki.rage.mp/wiki/Cursor.show) —

`mp.gui.cursor.show(freezeControls, visibility);`

- First: **freeze controls**  
- Second: **visibility** (not “center lock” in the documented signature)

**Conclusion:** The **mechanism** in the text is **mislabeled**. The real question is whether tying **both** to the same bool is wrong for CEF (e.g. need cursor visible **without** freezing movement, or the opposite) — a **UX/runtime** test, not the “center lock” story.

**Files most affected:** `AUDIT_FINDINGS.md` (H01), `AUDIT_RAGEMP_HUD_RADAR_MINIMAP.md` (H01 + summary table), `AUDIT_REPORT_FULL.md` §3 table + §4.6.

---

### C. “Entity overlay / Raycast C02 — undocumented APIs”

**What `AUDIT_RAGEMP_CAMERA_RENDER_RAYCAST.md` and H07 claim:** `setEntityOverlayPassEnabled` / `createEntityOverlayBatch` undocumented → crash risk = “no docs”.

**Wiki:** Both are **documented** with examples:  
[Graphics::setEntityOverlayPassEnabled](https://wiki.rage.mp/wiki/Graphics::setEntityOverlayPassEnabled), [Graphics::createEntityOverlayBatch](https://wiki.rage.mp/wiki/Graphics::createEntityOverlayBatch).

**Conclusion:** Replace **“undocumented”** with **“documented; still wrap for resilience / bad params / old build”** if you want defense in depth.

---

### D. `player.call` / “23 args” vs payload limit

**What `AUDIT_REPORT_FULL` §3 claims:** 23 args may be dropped — limit unknown.

**Wiki:** [Player::call](https://wiki.rage.mp/wiki/Player::call) — **`Note: payload is limited to 8192 bytes`** (no “max 23 args” in that page).

**Conclusion:** Reframe risk: **size / serialization** of payload, not arg **count** per se.

---

### E. `mp.events.add({ ... })` and `new mp.Event(...)`

**What `read-only-rage-mp-api-inventory-calm-wren.md` §2.2–2.3 claims:** non-standard / undocumented → silent failure.

**Wiki:** [Events::add](https://wiki.rage.mp/wiki/Events::add) documents **`mp.events.add(associativeArray)`**; [Events::Event](https://wiki.rage.mp/wiki/Events::Event) documents **`new mp.Event(name, handler)`**.

**Conclusion:** Those subsections are **incorrect as stated**. **Security** concerns elsewhere in that file (e.g. CEF `emitServer` allowlist) can remain; **remove** the “API non-standard” justification for those two patterns.

---

### F. `Entity::setVariable` “UNVERIFIED”

**Wiki:** [Entity::setVariable](https://wiki.rage.mp/wiki/Entity::setVariable) — **server-side**; visibility described as server-side in the page text.

**Conclusion:** The **trust model** “server sets variables; clients don’t use this API to set other players’ server vars the same way” is **documented**; any exploit path is **event/design**, not “wiki missing.”

---

### G. Bans: `rsgId` / `serial` / Social Club

**Wiki:** [Player::serial](https://wiki.rage.mp/wiki/Player::serial), [Player::rgscId](https://wiki.rage.mp/wiki/Player::rgscId) (ID), [Player::socialClub](https://wiki.rage.mp/wiki/Player::socialClub) (name).

**Conclusion:** Implementation should align **ban record** with **rgscId** for Rockstar **ID**, not the **name** in `socialClub`. “UNVERIFIED” should apply to **anti-spoof effectiveness**, not “property exists.”

---

### H. `Gameplay::getGroundZFor3dCoord` / H09

**Wiki:** Documents **false** + **0** when no surface; unreliable when area not streamed.

**Conclusion:** **Supports** the audit’s “add guards before teleport” direction.

---

### I. `Graphics::getScreenActiveResolution` / H05

**Wiki:** **`.x`** used as **width** in the official example.

**Conclusion:** **Supports** the bug class “used `.y` as width.”

---

### J. `mp.raycasting.testCapsule` + optional flags

**Wiki:** [Raycasting::testCapsule](https://wiki.rage.mp/wiki/Raycasting::testCapsule) — optional `ignoredEntity`, `flags`.

**Conclusion:** “Missing flags may change behavior” is **plausible and documented** — not “unverified because no wiki.”

---

## 4. What the wiki does **not** overturn

- **Logic / security / data:** Warmup fallthrough, character `select` by raw id, chat XSS, `.env` exposure, in-memory admin/report, stat races, hopouts timers, wardrobe bounds, **etc.** — still **valid concerns**; wiki is not the source of truth for those.  
- **JS timers:** `setInterval(..., 0)` / missing delay — real **ECMAScript** issues, not RAGE wiki.  
- **CEF = full browser** — [Browser::execute](https://wiki.rage.mp/wiki/Browser::execute) plus Chromium reality.

---

## 5. Recommended next edits (to the audit **documents**, not the game)

1. ~~Add errata pointers~~ **Done** — `AUDIT_REPORT_FULL.md`, `AUDIT_FINDINGS_FULL.md`, `AUDIT_REPORT_STAGE1.md`, and `AUDIT_FINDINGS_STAGE1.md` now link here.  
2. **Rewrite** F-C01 narrative in `AUDIT_REPORT_FULL.md`, `AUDIT_RAGEMP_PLAYER_ENTITY_DATA.md`, and `AUDIT_FINDINGS.md` to match §3A.  
3. **Global replace** the cursor parameter name **“lockedAtCenter”** with **wiki-accurate** `freezeControls` and `visibility` in all `Audits/*.md` where it appears; revisit UI-click claims after in-game test.  
4. **Strikethrough or amend** `read-only-rage-mp-api-inventory-calm-wren.md` §2.2–2.3 per §3E, or add an errata block pointing here.  
5. **Retag** items that said **“UNVERIFIED (wiki 403)”** for APIs now cited in §1.

---

## 6. Limitations

- Wiki **oldid** and your **RAGE:MP build** can differ; edge cases (e.g. `player.health` 0–100 vs arena 200) still need **in-game** confirmation.  
- **Coverage claim:** Every file in `Audits/` was **opened and read** (full read for files ≤~350 lines; segmented read + grep for longer files). No single finding in a 600-line file has every sub-bullet re-proven here — this addendum focuses **RAGE:MP API truth**, **cross-cutting priorities**, and **audit-of-audit errors**.

---

## 7. Rigorous per-file digest (complete `Audits/` folder)

*One-paragraph summary after full or segmented read. Use this as a map if you cannot read the originals.*

| File | Digest |
|------|--------|
| **AUDIT_FINDINGS.md** | Canonical ranked C01–C10, H01–H21, M01+ table. **C01/H01** wiki-fragile; rest (warmup, XSS, .env, godmode, timers, reconnect HP, EventManager) still high value. |
| **AUDIT_FINDINGS_STAGE1.md** | Earlier merge; **incorrect** “CONFIRMED IN WIKI” on C01/H01 — **errata** added at top. |
| **AUDIT_FINDINGS_FULL.md** | F-C01…F-Mxx machine table; **use for tracking IDs**; combine with §3 here for API truth. **Errata** added. |
| **AUDIT_REPORT_STAGE1.md** | First executive report + fix table; C01 as #1 blocker — **re-prioritize** after §3A. **Errata** added. |
| **AUDIT_REPORT_FULL.md** | Long narrative + §3 API table + UI scores. Strong on breadth; **§4.1 combat intro** overstates C01. **Errata** added. |
| **AUDIT_VALIDATION_PASS.md** | Read-only code validation; nuance on C01; still useful for **runtime** notes. |
| **read-only-validation-pass-only-luminous-pnueli.md** | Duplicate / export of validation pass; treat as same as **AUDIT_VALIDATION_PASS**. |
| **AUDIT_DAMAGE_COMBAT.md** | Excellent pipeline diagram; **DC-C01** repeats C01 error; **DC-C04/C07/C08** and bot path **solid** code findings. |
| **AUDIT_AUTH_ACCOUNT.md** | Deep auth flow ASCII; **AUTH-C01/C02**, OAuth no-timeout, session swap, brute force — **high trust** for security work. |
| **AUDIT_ADMIN_REPORTS.md** | .env, in-memory audit/reports, POV chunks, zone delete no audit, AC reset on quit, CEF debug — **production must-read**. |
| **AUDIT_HOPOUTS_ZONE_SPAWNS.md** | H1 crash, H2/H3 round bug, storm bank leak, global OOB clear — **gameplay integrity** gold. |
| **AUDIT_FFA_GUNFAME_RANKED.MD** | CRIT-01 weapon hash, CRIT-02 stat races, ranked idempotency, long runtime checklist — **stats/replay** focus. |
| **AUDIT_FRONTEND_CEF_UI.md** | XSS, render leaks, compass DOM, imgur URL, UI scores; **M02** corrected in-doc (PageContext not a bug). |
| **AUDIT_LOADOUT_CLOTHING_VEHICLES.md** | Weapon whitelist gap, tint, vehicle flood, wardrobe bounds, blocked drawables server — **exploit** surface. |
| **AUDIT_RAGEMP_BROWSER_CEF_GUI.md** | Call inventory; B01/B02 minor; claims “cursor(v,v) correct” — **reconcile** with [Cursor.show](https://wiki.rage.mp/wiki/Cursor.show) names. |
| **AUDIT_RAGEMP_CAMERA_RENDER_RAYCAST.md** | setInterval(0), overlay “undocumented” (**false** per wiki), list leak, resolution — **mix of valid + outdated**. |
| **AUDIT_RAGEMP_HUD_RADAR_MINIMAP.md** | Long; **lockedAtCenter** wrong; minimap native notes **UNVERIFIED** — fine for **client perf** follow-up. |
| **AUDIT_RAGEMP_PLAYER_ENTITY_DATA.md** | Aggressive C01 thesis + spectate id — **rewrite** with wiki; ped `atRemoteId` section still useful. |
| **read-only-synthesis-only-do-woolly-honey.md** | Meta plan for merging reports; API table repeats pre-wiki mistakes. |
| **read-only-rage-mp-api-inventory-calm-wren.md** | **CEF emitServer/emitClient allowlist = CRITICAL** (still valid). **§2.2–2.3 wrong** per [Events::add](https://wiki.rage.mp/wiki/Events::add)/[Events::Event](https://wiki.rage.mp/wiki/Events::Event). Voice `at(targetId)` pre-login — valid concern. |
| **read-only-rage-mp-api-verification-generic-robin.md** | Short plan; superseded by delivered `AUDIT_RAGEMP_*` files. |
| **read-only-audit-continuation-only-concurrent-quiche.md** | Long continuation; extra CEF/event risks — scan for **emit** and **debug** if extending scope. |
| **read-only-subsystem-audit-only-clever-scroll.md** | Plan → **AUDIT_FRONTEND_CEF_UI**; duplicates H02 cursor naming issue. |
| **read-only-subsystem-audit-only-fuzzy-bee.md** | Source notes → **AUDIT_FFA_GUNFAME_RANKED**; CRIT-01/02 header. |
| **read-only-subsystem-audit-only-memoized-planet.md** | Plan → **AUDIT_HOPOUTS_ZONE_SPAWNS**; mirrors H1–H3. |
| **read-only-subsystem-audit-only-enchanted-reef.md** | Plan → **AUDIT_LOADOUT_CLOTHING_VEHICLES**; scope list only. |
| **read-only-subsystem-audit-only-wise-haven.md** | Plan → **AUDIT_ADMIN_REPORTS**; critical/high bullet list. |
| **you-are-performing-an-distributed-sifakis.md** | Master execution plan (“verify every API against wiki”); **meta** — actual wiki pass is **this** file. |
| **AUDIT_RAGEMP_VEHICLES_MODS_API.md** | Line-referenced vehicle API pass: `mp.vehicles.new`, `exists`, `at` / client `atRemoteId`, mod/respray routing. **Stability/look** if wrong color API; re-verify **UNVERIFIED** bits on wiki. |
| **AUDIT_RAGEMP_COMBAT_WEAPONS_API.md** | `giveWeapon`/`removeAllWeapons`, custom `giveWeaponEx` (clip ignored), local component/tint Maps — **gameplay** (tint bounds), overlaps **DAMAGE** / **LOADOUT** themes, not C01. |
| **AUDIT_OF_AUDITS_WIKI_RECHECK.md** | The document you are reading: wiki adjudication, inventory, **§7–9** pillars. |

---

## 8. Consolidated priorities (fix bugs, security, stability, gameplay, look)

Use this as a **program roadmap** after reconciling **§3** (wiki) with your appetite for change.

### Security (ship blockers for any public or leaked build)

- **Secrets:** Rotate anything that touched committed `.env`; enforce git ignore + secret scan (**ADMIN**, **FINDINGS**, **AUTH**).  
- **Account / character:** `character::select` / `create` gates, OAuth session-swap, Discord HTTPS timeout, `loginPlayer` lockout + “already signed in” (**AUTH**, **FINDINGS**).  
- **CEF / chat:** Chat XSS, `Browser.execute` injection, unvalidated `mp.browsers.new` URL, `allow-cef-debugging` off in prod (**FRONTEND**, **FINDINGS**).  
- **CEF↔client bridge:** **No allowlist** on `emitServer` / `emitClient` — *read* `read-only-rage-mp-api-inventory-calm-wren.md` §2.1; this is a **worse** CEF RCE surface than a misnamed cursor API.  
- **Bans / admin:** Persist audit + reports; cap POV chunk **size**; `rgscId` from [Player::rgscId](https://wiki.rage.mp/wiki/Player::rgscId) for SC **ID**; fix nonce (**ADMIN**).

### Stability (crashes, leaks, data loss)

- **DB races:** `StatsManager` / `ProgressionManager` load-modify-save (**FFA**, **FINDINGS_FULL** F-C13).  
- **Transactions** on create/save/quit (**AUTH**, **H11**).  
- **Hopouts:** Preset null deref (H1), disconnect timer (H2/H3), `stormDamageBank` / `outOfBoundsStart` maps (**HOPOUTS**).  
- **Client:** `setInterval(0)` / missing interval, render handler churn, `App.tsx` cleanup (**FINDINGS**, **FRONTEND**, **CAMERA_RAYCAST**).  
- **Discord / OAuth hang:** `discordHttps` timeout (**AUTH**).

### Gameplay integrity (fair competitive)

- **Damage:** Warmup fallthrough, dead shooter, weapon hash policy, headshot trust / anomaly handling (**DAMAGE**, **FINDINGS**).  
- **Reconnect / disconnect:** Full HP, medkit refresh, death stat, 1v1 round bug (**FINDINGS**, **HOPOUTS**, **FFA**).  
- **Loadout / wardrobe:** Weapon registry, match save smuggling, drawable caps, server-side blocklist (**LOADOUT**).

### Look, feel, and client UX (polish, perf)

- **TacticalCompass** DOM count, **imgur** debug asset, hardcoded boot timers, admin panel size + silent sounds (**FRONTEND**).  
- **Chat** styling + rate limit; **Arena HUD** discoverability (FRONTEND §4).  
- Re-test **cursor** behavior in-game after you rename parameters mentally — do not “fix” the wrong thing (**§3B**).

---

## 9. Suggested order of operations (pragmatic)

1. **Secret rotation + conf** (CEF debug off prod path).  
2. **Auth + character** ownership and gates.  
3. **Chat XSS + execute escaping + Discord URL allowlist**.  
4. **CEF emit allowlist** (if you do only one CEF hardening, do this).  
5. **Damage** warmup + dead shooter + hash policy (product rules).  
6. **Stats** atomic updates / idempotency.  
7. **Hopouts** H1–H3.  
8. **Two-client** test on **C01** before changing victim lookup.  
9. **UI perf** (compass, render budget) and **wardrobe/weapon** server validation.

---

*Audit-of-audits updated 2026-04-25 with full-folder read. No game code was modified in this file.*
