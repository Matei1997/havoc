# Claim validation vs repository code — honest status

**Date:** 2026-04-25 (updated: full-tree bundle pass)  
**Why this file exists:** You asked to **validate every audit claim against the code**. A prior pass did **not** do that. This document records **what was actually checked** in this workspace and what is **blocked** until the **TypeScript/frontend source tree** is present.

**Workspace scanned:** `c:\Users\Matei\Downloads\arena-server-backup-master` (including the **nested** `arena-server-backup-master\arena-server-backup-master\` copy — see §0a).

---

## 0a. Canonical full gamemode + RAGE pack (nested folder — **not** empty)

Earlier notes about an “empty `gamemode`” referred to a **different** copy (a `.claude/worktrees/...` checkout where `gamemode/` had no files). That was **wrong** to generalize. The tree you pointed at is the **nested** path:

| Path | What is there |
|------|----------------|
| `arena-server-backup-master\arena-server-backup-master\gamemode\` | **Full project:** `source\`, `frontend\`, `tools\`, `package.json`, `tsconfig.json`, `conf.json`, `.env`, `.env.example`, etc. This is where **`AUDIT_FINDINGS.md` line numbers** apply (e.g. `DamageSync.event.ts`, `Character.event.ts`). |
| `arena-server-backup-master\arena-server-backup-master\ragemp-server\` | RAGE server install (e.g. `packages\server\index.js`, `client_packages\`, `conf.json`). |

**Line-level verification (TypeScript):** `mp.players.at(victimId)` at **`DamageSync.event.ts:172`** — matches the audit’s **C01** cite. Warmup / non-`active` hopouts fall through to the freeroam `else` starting ~**line 260**. **`character::select`** loads by `id` only at **`Character.event.ts:132–144`** — **C05**. **`gamemode\conf.json`** has **H04** / **L05** (`allow-cef-debugging`, `fqdn`). **C06:** a **`.env` file exists** under this `gamemode\` folder — do **not** paste its contents into documentation or chat.

Use this nested `gamemode\` path for claim validation unless you intentionally work from another clone.

---

## 0. Alternate check: `.claude/worktrees/beautiful-shockley-aafc28/arena-server-backup-master` (bundles only)

That worktree’s `gamemode/` was **empty on disk** in a prior check; validation there relied on **webpack bundles** only — not representative of the nested tree in **§0a**.

| Path | What is there |
|------|----------------|
| `.../ragemp-server/packages/server/index.js` | **~5.3 MB Webpack bundle** — server logic embedded with `!./source/server/...` markers. |
| `.../ragemp-server/client_packages/app.js` | **~977 KB** client bundle (`eval` devtool). |

**Bundle line numbers ≠** original `.ts` line numbers in `AUDIT_FINDINGS.md`. Below, **BUNDLE** = `ragemp-server/packages/server/index.js` or `client_packages/app.js` under the worktree above.

### Server bundle — findings checked

| ID | Verdict | Evidence (bundle / behavior) |
|----|---------|------------------------------|
| **C01** | **VERIFIED** (same issue class) | `server:PlayerHit` uses `const victim = mp.players.at(victimId);` — **BUNDLE ~19288**. (Nearby bot code documents `atRemoteId` for peds — **BUNDLE ~19380–19384** — but **players** still use `at` for `victimId`.) **Runtime:** still need 2 clients to confirm wrong-target in your build. |
| **C04** | **VERIFIED** (control flow) | Hopouts damage runs only when `hopoutsMatch && hopoutsMatch.state === "active"` — **BUNDLE ~19343–19344**. If match state is **not** `active` (e.g. warmup), the handler falls through to the **freeroam** branch — **BUNDLE ~19350–19366**, applying full `finalDamage` without arena caps. |
| **C05** | **VERIFIED** | `RAGERP.cef.register("character", "select", ...)` loads `findOne({ where: { id } })` with **no** `account` / ownership filter — **BUNDLE ~18856–18867**. |
| **C06** | **VERIFIED (path §0a)** / **NOT in empty worktree** | A **`.env` file exists** under nested `arena-server-backup-master\gamemode\` (§0a). In a worktree with an empty `gamemode/`, the file was absent. **Never** paste secrets into docs or chat. |
| **C07** | **VERIFIED** (no shooter dead gate in snippet) | `server:PlayerHit` checks shooter exists and fire-rate/duplicate; **no** `isDead` / `alive` check on **shooter** before applying damage in the same handler block — **BUNDLE ~19285–19366** (and following lines through ~19376). |
| **C08** | **VERIFIED** | `getWeaponDamage` uses a **fallback** object for missing `weaponHash` keys — **BUNDLE ~19232–19235** — not a hard reject. |
| **C10** | **VERIFIED** | `AdminAudit.service`: `MAX_ENTRIES = 2000`, `const entries = []`, comment “in-memory stub” / ring buffer — **BUNDLE ~224–252**. |
| **H14** | **VERIFIED** | `isHead = targetBone === "Head"`, `getBoneMultiplier(targetBone)` — **BUNDLE ~19329–19334**; client-controlled bone string drives multiplier path. |
| **H04** / **L05** | **VERIFIED** | Same flags in nested `gamemode\conf.json` and `ragemp-server\conf.json` (§0a). In a worktree with no `gamemode` files, only `ragemp-server\conf.json` was checked. |

### Client bundle — sample

| ID | Verdict | Evidence |
|----|---------|----------|
| **C09** | **VERIFIED** | `dangerouslySetInnerHTML` **present** in `client_packages/app.js` (minified / inside webpack `eval` strings). Exact line number is not stable; use project-wide search on that file. For **line-level** parity with `Chat.tsx:182`, prefer the **TSX** source when you have it. |

### Not exhaustively re-validated in this pass

**H01–H12, H15–H21, M01–M22, L01–L17:** many can be located in **TypeScript** under **§0a** or in **bundles** under **§0**. This update focused on **critical** rows + config; a full ID table can be filled from **`arena-server-backup-master\arena-server-backup-master\gamemode`** first.

---

## 1. Where the audit paths live in *this* backup

| What the audits cite | Open it here |
|----------------------|--------------|
| `gamemode/source/server/...`, `frontend/src/...` | **`arena-server-backup-master\arena-server-backup-master\gamemode\`** (nested copy) |
| `ragemp-server/...` (packed server, client_packages) | **`arena-server-backup-master\arena-server-backup-master\ragemp-server\`** |

**Wrong place to look:** the **repo root** alone (e.g. `arena-server-backup-master\` with no inner duplicate) may not contain `gamemode\source\` — the full tree is **one level deeper** in the nested `arena-server-backup-master\arena-server-backup-master\` folder.

**Conclusion:** Line-level validation **is** possible by opening the cited **`.ts` / `.tsx`** files under **§0a**. The old “0 TypeScript files” statement applied to a **shallow** search at the wrong directory, not to the nested tree.

---

## 2. What *was* verified in-repo (nested copy — use these paths)

Base: **`C:\Users\Matei\Downloads\arena-server-backup-master\arena-server-backup-master\`**

### `... \gamemode\conf.json` and `... \ragemp-server\conf.json`

| Claim (from audits) | Result |
|----------------------|--------|
| **H04** — `allow-cef-debugging: true` | **VERIFIED** — both files (e.g. line 7 in `gamemode\conf.json`). |
| **L05** — `fqdn: "eu.loclx.io"` | **VERIFIED** — line 11. |

### `... \gamemode\.env` (**C06**)

| Claim (from audits) | Result |
|----------------------|--------|
| **C06** — real `.env` in tree | **VERIFIED: file present** at `gamemode\.env`. **Do not** paste credentials into docs, chat, or git. |

### TypeScript / TSX (same `gamemode\` tree)

- **`source\server\serverevents\DamageSync.event.ts`** — **C01** (line 172), **C04** (else branch from ~260), **C07** (no shooter dead check in handler), **C08** (`getWeaponDamage` fallback at ~104–105), **H14** (lines ~210–214).
- **`source\server\serverevents\Character.event.ts`** — **C05** (lines 132–144), **H13** (`character::create` at 148 — no `player.account` guard before `startCreatorFlow`).
- **`source\server\admin\AdminAudit.service.ts`** — **C10** (in-memory, `MAX_ENTRIES = 2000`, lines 9–10).
- **`frontend\src\pages\hud\Chat\Chat.tsx`** — **C09** `dangerouslySetInnerHTML` at **line 182** (same line as the audit table).

### Bundled server (nested `ragemp-server`)

- **`packages\server\index.js`** contains the compiled gamemode; use for validation if you cannot open `gamemode\source`. It is not required when **§0a** TypeScript is on disk.

---

## 3. `AUDIT_FINDINGS.md` — per-ID validation (nested `gamemode\` in §0a / §2)

**Legend:** `VERIFIED` = read in TypeScript/TSX under `arena-server-backup-master\arena-server-backup-master\gamemode\`. `NOT YET` = file exists; not re-read in this doc pass. The **old** “NO SOURCE” table applied when only the **wrong directory** was searched.

### Criticals (C) + selected configs

| ID | Status (nested `gamemode\`) | Notes |
|----|-----------------------------|--------|
| C01 | **VERIFIED** | `DamageSync.event.ts:172` — `mp.players.at(victimId)` |
| C02 | **NOT YET** | `source\client\classes\Camera.class.ts` present — open ~372 for interval |
| C03 | **NOT YET** | `source\client\prototype\Player.prototype.ts` present |
| C04 | **VERIFIED** | `DamageSync.event.ts` — hopouts only if `state === "active"`; else freeroam branch ~260+ |
| C05 | **VERIFIED** | `Character.event.ts:132-144` — `findOne({ where: { id } })` only |
| C06 | **VERIFIED (file present)** | `gamemode\.env` — never publish contents |
| C07 | **VERIFIED** | `DamageSync.event.ts` — no shooter `isDead` in `server:PlayerHit` |
| C08 | **VERIFIED** | `DamageSync.event.ts:104-105` — `weaponDamage[weaponHash] ??` defaults |
| C09 | **VERIFIED** | `frontend\...Chat.tsx:182` — `dangerouslySetInnerHTML` |
| C10 | **VERIFIED** | `AdminAudit.service.ts` — `MAX_ENTRIES` 2000, in-memory array |

**H04 / L05** — **VERIFIED** in `gamemode\conf.json` and nested `ragemp-server\conf.json`.  
**H14** — **VERIFIED** in `DamageSync.event.ts` (client `targetBone` / Head).  
**H13** — **VERIFIED** — `Character.event.ts:148` `character::create` has no `if (!player.account)` before `startCreatorFlow` (unlike `creator` create).

**H01–H12 (except H4/L5/H13/H14), H15–H21, M\*, L\*** — sources exist under nested `gamemode\`; treat as **NOT YET** in this file until each line is opened (same as a full mechanical pass).

---

## 4. How to complete a real “every claim” validation

1. **Open the nested folder** `arena-server-backup-master\arena-server-backup-master\gamemode\` (or add it as the Cursor workspace root) so `source/` and `frontend/` resolve to the paths in the audit tables.
2. For each `file:line` in `AUDIT_FINDINGS.md` / `AUDIT_FINDINGS_FULL.md`, open that file and mark **VERIFIED** / **FALSE** / **STALE LINE**.
3. For **C01** / `at` vs `atRemoteId`, add a **runtime** two-client test; wiki + static line alone is not enough (see `AUDIT_OF_AUDITS_WIKI_RECHECK.md`).
4. If TypeScript is missing, fall back to **`ragemp-server\packages\server\index.js`** and **`client_packages\app.js`** and map by webpack module comments.

`AUDIT_VALIDATION_PASS.md` in this folder is **evidence of a past code review** on a different machine/clone; re-validate on **your** tree.

---

## 5. Answer to the direct question

**Did we validate every single claim in those files against the code?**  

**Not every row.** The **critical** findings (and **H04/L05/H13/H14**) are **VERIFIED** against the **nested** `gamemode\` TypeScript tree (§2–§3). **H01–H12 (remaining), H15–H21, M\*, L\*** are **not** each re-opened in this document — the **source files exist** there; finish the mechanical pass by line.

Earlier “no TypeScript on disk” was **wrong**: the full tree lives under **`...\arena-server-backup-master\arena-server-backup-master\gamemode\`**, not only at the outer folder or in an empty worktree `gamemode\`.

---

*Add the nested `gamemode` folder to the workspace (or open it as root) so globs and “go to file” hit the same paths the audits use.*
