# AUDIT REPORT STAGE 1 — Havoc Arena RAGE:MP Server

**Date:** 2026-04-24
**Auditor:** Claude Sonnet 4.6 (hostile read-only pass)
**Report type:** Stage 1 — Full codebase survey + focused subsystem audits
**RAGE:MP wiki:** https://wiki.rage.mp/wiki/Main_Page — returned HTTP 403 during audit. All RAGE:MP-specific API behavior is based on training data (August 2025 cutoff) and is marked **UNVERIFIED AGAINST LIVE DOCS** where relevant.

> **Errata (2026-04-25):** **`AUDIT_OF_AUDITS_WIKI_RECHECK.md`** re-checks RAGE:MP claims against the live wiki. The Stage-1 “replace `at` with `atRemoteId`” fix for C01 and the **“lockedAtCenter”** description for H01 need **reconciliation** with that document before you treat them as blockers.

---

## 1. Executive Summary

Havoc Arena is a TypeScript RAGE:MP competitive PvP server implementing four game modes (Hopouts/Arena, FFA, GunGame, Freeroam) with a React/MobX CEF UI, TypeORM/MySQL database, and Discord OAuth2 authentication. The codebase is architecturally coherent and reasonably well-structured for a custom RAGE:MP project.

**This server is NOT ready for public sessions.** The audit identified **72 issues** (10 Critical, 21 High, 22 Medium, 17 Low) across the full codebase plus two focused subsystem audits. The following critical issues prevent safe operation:

| # | ID | One-line summary |
|---|---|---|
| 1 | **C01** | `mp.players.at(remoteId)` — wrong API, damage hits the wrong player; entire combat system is broken |
| 2 | **C04** | Warmup godmode bypass — warmup players receive full uncapped freeroam damage |
| 3 | **C05** | Character hijacking — any player can spawn as any other player's character with no auth or ownership check |
| 4 | **C07** | Dead shooter — dead players can continue dealing damage |
| 5 | **C08** | Weapon hash not whitelisted — client can claim any weapon; balance bypass |
| 6 | **C06** | Plaintext DB password (`Headshot123`) committed to the repository backup |
| 7 | **C09** | Chat XSS — `dangerouslySetInnerHTML` with no sanitization in the chat panel |
| 8 | **C10** | Admin audit log lost on every restart — no persistent record of admin actions |
| 9 | **C02/C03** | Two CPU spin-locks from `setInterval(fn, 0)` — client performance destruction |
| 10 | **AUTH-H01** | No brute-force protection on password login |

**Overall verdict:** Exploitable at the game-logic level (wrong player targeted by damage, character hijacking), security level (credentials in repo, no auth gates), and performance level (CPU spin-locks). Address the 10 Critical items before any public or semi-public session.

---

## 2. Repo / System Inventory

### Architecture

```
┌────────────────────────────────────────────────────────────┐
│                   SERVER (TypeScript)                      │
│  Modes: hopouts · ffa · gungame · freeroam(stub)           │
│  Modules: combat · matchmake · party · stats · seasons     │
│  Events: 24 handlers  Database: TypeORM + MySQL            │
├────────────────────────────────────────────────────────────┤
│                   CLIENT (TypeScript)                      │
│  Classes: Browser · Camera · Hud · Spectate · Client       │
│  Modules: DamageSync · Recoil · Crouch · Hitmarker (28+)   │
│  Events: Auth · Player · Attachment (4 files)              │
├────────────────────────────────────────────────────────────┤
│                   CEF / React UI                           │
│  React 18 + MobX + Vite + SCSS Modules                     │
│  13 MobX stores · 10+ pages · EventManager bridge         │
└────────────────────────────────────────────────────────────┘
```

### Component Inventory

| Layer | Key files | Lines (approx.) |
|---|---|---|
| Server — Auth | `Auth.event.ts`, `AccountSession.ts`, `discordAuth/*` | ~550 |
| Server — Combat | `DamageSync.event.ts`, `CombatIntegrity.ts`, `SnapshotManager.ts`, `DeathRecapTracker.ts` | ~760 |
| Server — Modes | `ArenaMatch.manager.ts`, `FfaMatch.manager.ts`, `GunGameMatch.manager.ts` | ~3,000+ |
| Server — Player lifecycle | `Player.event.ts`, `Character.event.ts` | ~585 |
| Server — Admin | `Admin.event.ts`, `Admin.commands.ts`, `AdminAudit.service.ts` | ~800+ |
| Client — Browser/routing | `Browser.class.ts` | ~666 |
| Client — Combat | `DamageSync.module.ts` | ~119 |
| Client — Auth | `Auth.event.ts (client)`, `Player.event.ts (client)` | ~305 |
| CEF — Auth | `Authentication.tsx`, `AuthForm.tsx`, `DiscordUsernameForm.tsx` | ~606 |
| CEF — Stores | `Arena.store.ts`, `Player.store.ts`, + 11 more | ~2,000+ |
| Database entities | `Account.entity.ts`, `Character.entity.ts`, `Ban.entity.ts`, + others | ~250 |

### External Dependencies of Note

| Dependency | Usage | Risk |
|---|---|---|
| `bcryptjs` | Password hashing (12 rounds) | Correct usage; legacy SHA-256 fallback present |
| `TypeORM` | DB ORM (MySQL) | No transactions in critical paths |
| `Discord OAuth2` | Login flow | HTTP client has no timeout |
| `Node.js https` | Discord API calls | No timeout; no abort controller |
| `GSAP` | CEF UI animations | Tween leaks in admin panel |
| `MobX` | CEF state management | Direct mutation outside actions in chat store |
| `React 18` | CEF UI | Handler accumulation in App.tsx cleanup |

---

## 3. Highest Priority Fix List

Ordered by severity and blast radius. Items 1–10 are blockers for any public session.

| Rank | ID | File:Line | Fix summary |
|---|---|---|---|
| 1 | **C01** | `DamageSync.event.ts:172` | Replace `mp.players.at(victimId)` with `mp.players.atRemoteId(victimId)` |
| 2 | **C04** | `DamageSync.event.ts:260` | Before the `else` (freeroam) block: `if (ffaMatch \|\| gunGameMatch \|\| hopoutsMatch) return;` |
| 3 | **C05** | `Character.event.ts:132–144` | Add `if (!player.account) return player.kick(...)` + ownership check against `player.account.id` |
| 4 | **C02** | `Camera.class.ts:372` | Add interval argument (e.g., 16ms) to `setInterval` |
| 5 | **C03** | `Player.prototype.ts:97` | Add interval argument to `setInterval` |
| 6 | **C06** | `gamemode/.env` | Rotate DB credentials immediately; add `.env` to `.gitignore`; audit who has access to the backup |
| 7 | **C07** | `DamageSync.event.ts:170` | Add `if (shooter.getVariable("alive") === false) return;` |
| 8 | **C08** | `DamageSync.event.ts:104` | `if (!weaponDamage[weaponHash]) return;` — reject unknown hashes |
| 9 | **AUTH-C02** | `Character.event.ts:148` | Add `if (!player.account) return player.kick("Not authenticated.");` |
| 10 | **AUTH-H04** | `DiscordOAuthServer.ts:186`, `Auth.event.ts:78` | Add already-authenticated guard before Discord OAuth starts and before `enterGameWithAccount` |
| 11 | **AUTH-H01** | `Auth.event.ts:41` | Add per-player failed attempt counter; lock out after 5 failures for 60 s |
| 12 | **AUTH-H02** | `Auth.event.ts:41` | `if (player.account) return player.showNotify(..., "Already signed in.");` |
| 13 | **H13 = AUTH-C02** | *(see rank 9)* | Already covered above |
| 14 | **AUTH-H03 = H12** | `discordHttps.ts:8` | `req.setTimeout(10000, () => req.destroy(new Error("timeout")));` |
| 15 | **C09** | `Chat.tsx:182` | Replace `dangerouslySetInnerHTML` with DOMPurify sanitization |
| 16 | **C10** | `AdminAudit.service.ts` | Write audit log entries to a DB table, not in-memory array |
| 17 | **H01** | `Browser.class.ts` | Change `cursor.show(showCursor, showCursor)` to `cursor.show(showCursor, false)` |
| 18 | **H04** | `conf.json` (both) | Set `allow-cef-debugging: false` for production |
| 19 | **H14** | `DamageSync.event.ts:210` | Enforce headshot ratio cap server-side or remove multiplier from detected cheaters |
| 20 | **H11 = AUTH-M01** | `Character.event.ts`, `Auth.event.ts` | Wrap character and account creation in TypeORM transactions |

---

## 4. Runtime Test Checklist

### Auth & Login
- [ ] Connect; skip Discord OAuth; call `server::character:select` with ID `1` — **expect:** kicked/rejected, NOT character spawn
- [ ] Connect; complete auth; call `server::auth:loginPlayer` a second time with different credentials — **expect:** rejected
- [ ] Connect; do not complete auth; trigger `server::chat:sendMessage` — **expect:** rejected
- [ ] Send `server::auth:loginPlayer` 30 times per second with wrong passwords — **expect:** rate limited (currently: no limit)
- [ ] Disconnect mid-Discord-OAuth — **expect:** no hanging session state

### Damage & Combat
- [ ] Fire at an enemy during the 3-second warmup — **expect:** zero damage (**currently broken**: warmup fallthrough deals full damage)
- [ ] Kill a player; continue shooting their corpse — **expect:** damage events rejected server-side
- [ ] Use modified client to send `bone = "Head"` on every shot — confirm 1.5× multiplier fires in server logs
- [ ] Send `server:PlayerHit` with `victimId = 0` — confirm which player (if any) receives damage
- [ ] Rapid-fire `server:PlayerHit` events beyond weapon RPM — **expect:** fire rate limit kicks in

### Match Lifecycle
- [ ] Disconnect during active round; reconnect within 60 s — confirm health is NOT restored to full
- [ ] All players on one team disconnect — confirm round ends within 15 s
- [ ] Team A reaches win condition AND round timer expires simultaneously — confirm score increments **once** not twice
- [ ] Zone damage kills the last player on a team — confirm round end fires correctly

### Admin
- [ ] Non-admin sends `server::admin:espMode` with mode=1 — **expect:** rejected
- [ ] Non-admin sends `server::player:noclip` — **expect:** rejected
- [ ] Server restart — confirm ALL admin audit logs are gone (document as known risk until C10 is fixed)

### Weapons & Loadout
- [ ] Call `loadout::equipForEdit` with `weaponName = "weapon_railgun"` — **expect:** blocked (**currently:** not blocked)
- [ ] Save preset with invalid component hash — **expect:** rejected (**currently:** not rejected)
- [ ] Stream in player with weapon attachments — confirm attachments visible immediately on stream-in

### Clothing & Vehicles
- [ ] Submit clothing `drawable = 99999` for component 11 — **expect:** clamped or rejected (**currently:** not rejected)
- [ ] Call `tune::spawnVehicleFromWizard` 20 times rapidly — **expect:** limit enforced (**currently:** no limit)
- [ ] Disconnect with a freeroam vehicle spawned — confirm vehicle is cleaned up

### CEF / UI
- [ ] Open chat; paste `<img src=x onerror=alert(1)>` — **expect:** escaped, not executed (**currently:** XSS executes)
- [ ] Trigger `system:setPage arena_hud` before `arena:setMatch` is sent — confirm blank screen behavior
- [ ] Trigger a notification during Discord OAuth — confirm OAuth spinner does not reset incorrectly
- [ ] Check vote screen with empty `voteMaps` — confirm no blank/broken grid

---

## 5. Subsystem Audit Index

Detailed findings for individual subsystems are in the following companion files:

| File | Subsystem | Findings |
|---|---|---|
| `AUDIT_FINDINGS_STAGE1.md` | Full codebase — all 72 issues ranked by severity | C01–C10, H01–H21, M01–M22, L01–L17 |
| `AUDIT_DAMAGE_COMBAT.md` | Damage pipeline: DamageSync, CombatIntegrity, SnapshotManager, DeathRecapTracker | DC-C01, DC-C04, DC-C07, DC-C08, DC-H14, DC-M01–M03, DC-I01–I03 |
| `AUDIT_AUTH_ACCOUNT.md` | Auth/account/session: Auth.event.ts, Character.event.ts, discordAuth/*, CEF auth pages | AUTH-C01–C02, AUTH-H01–H06, AUTH-M01–M05 |
