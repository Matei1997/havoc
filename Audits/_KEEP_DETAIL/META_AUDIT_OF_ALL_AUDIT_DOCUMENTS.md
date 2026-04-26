# Meta-audit: every document in `Audits/` (line-level review)

**Date:** 2026-04-25  
**Method:** Every file in this folder was read in full for smaller documents, or read end-to-end in consecutive segments for the largest files (`AUDIT_VALIDATION_PASS.md`, `read-only-validation-pass-only-luminous-pnueli.md`, `read-only-synthesis-only-do-woolly-honey.md`, `read-only-audit-continuation-only-concurrent-quiche.md` — same methodology as the rest: no line ranges skipped within each file).  
**Purpose:** Audit the *audit pack* for internal consistency, false claims, duplicate scope, and alignment with `AUDIT_OF_AUDITS_WIKI_RECHECK.md` (live wiki cross-check).  
**Not in scope here:** Re-verifying every cited server source line against the current repo (that is implementation work, not document QA).

**Folder size:** 31 unique markdown files (33 paths if de-duplicated case variants are counted).

---

## 1. Complete file registry (all documents)

| # | File | ~Lines (PowerShell) | Role |
|---|------|------------------------|------|
| 1 | `AUDIT_FINDINGS.md` | 160 | Canonical ranked C01–L17 + wiki table |
| 2 | `AUDIT_FINDINGS_STAGE1.md` | 166 | Staged table; errata 2026-04-25 |
| 3 | `AUDIT_FINDINGS_FULL.md` | 323 | Merged F-Cxx / F-Hxx machine table + fix list |
| 4 | `AUDIT_REPORT_STAGE1.md` | 136 | Stage-1 report + index |
| 5 | `AUDIT_REPORT_FULL.md` | 538 | Full synthesis + §8 checklist |
| 6 | `AUDIT_OF_AUDITS_WIKI_RECHECK.md` | 200+ | Wiki recheck, §7–9 digest/pillars |
| 7 | `AUDIT_VALIDATION_PASS.md` | 602 | Code validation of critical/high |
| 8 | `read-only-validation-pass-only-luminous-pnueli.md` | 619 | Duplicate/variant of validation pass |
| 9 | `AUDIT_ADMIN_REPORTS.md` | 349 | Admin / reports / AC / POV |
| 10 | `AUDIT_AUTH_ACCOUNT.md` | 429 | Auth, session, CEF trust notes |
| 11 | `AUDIT_DAMAGE_COMBAT.md` | 286 | DamageSync pipeline, DC-* IDs |
| 12 | `AUDIT_HOPOUTS_ZONE_SPAWNS.md` | 374 | H1–H3, zone, reconnect |
| 13 | `AUDIT_FFA_GUNFAME_RANKED.MD` | 259 | FFA / GunGame / stats / rank *(filename typo: FAME)* |
| 14 | `AUDIT_FRONTEND_CEF_UI.md` | 394 | React CEF, Browser, UI scores |
| 15 | `AUDIT_LOADOUT_CLOTHING_VEHICLES.md` | 234 | Weapons, wardrobe, vehicles |
| 16 | `AUDIT_RAGEMP_BROWSER_CEF_GUI.md` | 101 | Browser/CEF call inventory |
| 17 | `AUDIT_RAGEMP_CAMERA_RENDER_RAYCAST.md` | 206 | Camera/raycast/graphics |
| 18 | `AUDIT_RAGEMP_HUD_RADAR_MINIMAP.md` | 308 | HUD/radar; refutes old minimap claim |
| 19 | `AUDIT_RAGEMP_PLAYER_ENTITY_DATA.md` | 197 | Player pool / C01 focus |
| 20 | `AUDIT_RAGEMP_VEHICLES_MODS_API.md` | 180 | Vehicle API pass |
| 21 | `AUDIT_RAGEMP_COMBAT_WEAPONS_API.md` | 168 | Weapon API + combat events |
| 22 | `read-only-rage-mp-api-inventory-calm-wren.md` | 194 | Events/networking; **emits CEF allowlist (critical)** |
| 23 | `read-only-rage-mp-api-verification-generic-robin.md` | 87 | Plan for RAGEMP audits |
| 24 | `read-only-synthesis-only-do-woolly-honey.md` | 461 | Synthesis plan for FULL report |
| 25 | `read-only-audit-continuation-only-concurrent-quiche.md` | 408 | Continuation notes |
| 26 | `read-only-subsystem-audit-only-clever-scroll.md` | 84 | Plan → `AUDIT_FRONTEND_CEF_UI.md` |
| 27 | `read-only-subsystem-audit-only-fuzzy-bee.md` | 259 | Notes → FFA doc |
| 28 | `read-only-subsystem-audit-only-memoized-planet.md` | 166 | Plan → hopouts |
| 29 | `read-only-subsystem-audit-only-enchanted-reef.md` | 243 | Plan → loadout |
| 30 | `read-only-subsystem-audit-only-wise-haven.md` | 48 | Plan → admin |
| 31 | `you-are-performing-an-distributed-sifakis.md` | 324 | Master plan / execution outline |

**Files read in segments only (content overlaps above):** `read-only-validation-*` (same class as #7), `read-only-synthesis-*` (planner, overlaps #5–6), `read-only-continuation-*` (extra findings), `read-only-subsystem-*` (short plans). Their *unique* value is scoping and cross-links, not new API law.

---

## 2. Cross-document conflicts (must reconcile before triage)

### 2.1 C01 / `mp.players.at(victimId)` — catastrophic vs. “maybe OK”

- **Documents asserting P0 / wrong player or broken combat:** `AUDIT_FINDINGS.md`, `AUDIT_REPORT_FULL.md` §4.1, `AUDIT_DAMAGE_COMBAT.md` (DC-C01), `AUDIT_RAGEMP_PLAYER_ENTITY_DATA.md`, `AUDIT_RAGEMP_COMBAT_WEAPONS_API.md`, `AUDIT_FFA_GUNFAME_RANKED.MD` (CRIT-01 narrative), `AUDIT_FINDINGS_FULL.md` (F-C01).
- **Document partially dissenting:** `AUDIT_VALIDATION_PASS.md` **C01** — argues `remoteId` may map to the same id space as `at()` on the server, labels **NEEDS DOC CONFIRMATION**, recommends a **two-client test** before changing code.
- **Wiki reconciliation:** `AUDIT_OF_AUDITS_WIKI_RECHECK.md` §3A — live wiki does **not** support the strongest “pool index ≠ remoteId always” story; **do not** treat C01 as a proven universal root-cause without runtime proof.

**Meta verdict:** The audit *pack* is **internally inconsistent** on C01. The validation pass is methodologically *better* on this one row than the early audits. **Implementation priority:** runtime test + logging, not blind `atRemoteId` substitution as rank-1 in every list.

### 2.2 H01 / `mp.gui.cursor.show` — “lockedAtCenter” vs. wiki vs. one doc saying CORRECT

- **Second parameter described as** `lockedAtCenter` **throughout:** `AUDIT_FINDINGS*.md`, `AUDIT_REPORT_FULL.md`, `AUDIT_FRONTEND_CEF_UI.md`, `AUDIT_RAGEMP_HUD_RADAR_MINIMAP.md`.
- **Live wiki:** parameters are **`freezeControls`** and **`visibility`** — see `AUDIT_OF_AUDITS_WIKI_RECHECK.md` §3B. Semantic docs in this folder **misname** the second argument.
- **Outlier:** `AUDIT_RAGEMP_BROWSER_CEF_GUI.md` states `mp.gui.cursor.show(v, v)` is **CORRECT** and matches “documented 2-arg signature” — that verdict **ignores** the same UX concern other files raise (twin booleans / freeze vs. visibility), and it **reinforces** the wrong label if read alone.

**Meta verdict:** Do not treat the Browser CEF inventory’s “VERIFIED correct” row as overriding XSS + injection issues elsewhere; **do** in-game test with correctly named parameters from the wiki.

### 2.3 Raycast overlay APIs (H07 / C02) — “undocumented” vs. documented

- `AUDIT_RAGEMP_CAMERA_RENDER_RAYCAST.md` and early `AUDIT_FINDINGS` call `setEntityOverlayPassEnabled` / `createEntityOverlayBatch` **undocumented** / experimental.
- `AUDIT_OF_AUDITS_WIKI_RECHECK.md` §3C: both are **documented** on wiki.rage.mp. Residual risk is **runtime / bad params / build**, not “no docs.”

### 2.4 `read-only-rage-mp-api-inventory-calm-wren.md` §2.2–2.3

- Claims `new mp.Event` and `mp.events.add({ ... })` are non-standard and may **silently** fail.
- **Wiki** documents both. This folder’s `AUDIT_OF_AUDITS_WIKI_RECHECK.md` §3E marks those subsections **wrong as stated**. The **CEF `emitServer` / `emitClient` allowlist gap (§2.1)** remains one of the strongest findings in the entire pack and is **independent** of that error.

### 2.5 H14 / client bone string — “critical exploit” vs. “intended architecture”

- `AUDIT_FINDINGS.md` / combat audits: **HIGH** — always-Head for 1.5×.
- `AUDIT_VALIDATION_PASS.md` **H14**: **INTENDED BEHAVIOR** (client hit detection), suggests statistical mitigation later.

**Meta verdict:** Not a API falsehood; a **product / anti-cheat policy** split. The merged table in `AUDIT_FINDINGS_FULL.md` should not treat this as a pure code bug only.

### 2.6 Ban / `parseInt` / `NaN` (M09 / AUTH-M03)

- `AUDIT_FINDINGS.md` (M09) suggests **`NaN` ban may be silently deleted** (wrong direction).
- `AUDIT_AUTH_ACCOUNT.md` and `AUDIT_FINDINGS_FULL.md` (F-M09) argue **`Date.now() > NaN` is false → ban never auto-expires** (silently **permanent**).

**Meta verdict:** The **FULL / AUTH** reading is the **coherent** JavaScript story. The early FINDINGS M09 line is **wrong** on the security outcome; prefer F-M09 / AUTH text.

### 2.7 `AUDIT_FINDINGS_FULL.md` §7 polish item 50

- Row says **`F-C14 (spawn limit)`** with vehicle spawn text. **F-C14** in Section 1 is the **weapon registry / `WEAPON_REGISTRY.enabled`** issue, not vehicle count. The **vehicle spawn** gap is **LCV / H20** family.

**Meta verdict:** **Labeling error** in the merged doc; fix the ID reference in a doc pass (no gameplay code change).

### 2.8 Filename / path hygiene

- **`AUDIT_FFA_GUNFAME_RANKED.MD`:** should be `GUNGAME` for searchability and consistency with references inside `AUDIT_REPORT_FULL` (some refs say `AUDIT_FFA_GUNGAME_RANKED.md`).
- **`read-only-synthesis-only-do-woolly-honey.md`:** output path points at a **`.claude/worktrees/...` machine path**; treat as **historical** — actual deliverables are at repo root `Audits/`.

### 2.9 `AUDIT_HOPOUTS` §5 re: `player.call` 23 args

- Notes possible arg-count limits. **`AUDIT_OF_AUDITS_WIKI_RECHECK.md` §3D:** wiki stresses **payload byte limit (8192)**, not a documented “23 args” cap. Reframe in future edits.

### 2.10 `AUDIT_RAGEMP_COMBAT_WEAPONS_API.md` §4.1

- States `player.health` range **0–100** in RAGE:MP. Arena code elsewhere uses **200** HP; treat as **needs live doc / in-game** confirmation — possible **normalization** vs. raw native confusion.

### 2.11 Duplicate validation content

- `AUDIT_VALIDATION_PASS.md` and `read-only-validation-pass-only-luminous-pnueli.md` are the **same class** of artifact. **Deduplicate** in human process; keep one canonical file to avoid **drift** when updating C01 / H01.

---

## 3. What is *solid* across the pack (high trust)

- **Secrets / `.env` / committed credentials:** multiple independent files agree — **C06 / ADMIN-C01**.
- **Character `character::select` / `character::create` gates:** **AUTH** + **FINDINGS** — **F-C05 / F-C11** consistent story.
- **Chat XSS (C09 / F-C09):** **FRONTEND** + **FINDINGS** — static React issue; not wiki-dependent.
- **Warmup fallthrough (C04 / F-C04):** **DAMAGE** + **REPORT** — same control-flow bug.
- **In-memory admin audit + reports:** **ADMIN** + **FULL** — **C10 / C12** family.
- **Stats load-modify-save (CRIT-02 / F-C13):** **FFA** + **FULL** — data integrity.
- **Hopouts H1 crash, H2/H3 round logic:** **HOPOUTS** — detailed, internally consistent.
- **CEF bridge allowlist (inventory file §2.1):** stand-alone **CRITICAL** trust-boundary; under-represented in executive summaries vs. C01.

---

## 4. Executive-summary inflation (wording to temper)

- **`AUDIT_REPORT_FULL.md` §1** — phrases like *“entire combat system is broken at the root”* and *“every hit targets the wrong player”* are **not** supported by the later **Validation Pass** + **wiki recheck** without a two-client test. Use: **“unverified ID resolution risk — test before shipping.”**
- **Stage-1** `CONFIRMED IN WIKI` for C01/H01: **errata** at top of `AUDIT_FINDINGS_STAGE1.md` **corrects** the table; body rows are still wrong — readers must read **errata first**.

---

## 5. Recommendations for maintaining this document set

1. **Single canonical row for C01 and H01** in a small `AUDIT_API_STATUS.md` (or expand §3 of the wiki recheck) — **one** test matrix, one verdict.
2. **Replace** all **“lockedAtCenter”** phrasing with **wiki names** (`freezeControls`, `visibility`) when editing docs; keep UX concern.
3. **Amend** `read-only-rage-mp-api-inventory-calm-wren.md` §2.2–2.3 with a strikethrough or pointer to `AUDIT_OF_AUDITS_WIKI_RECHECK.md` §3E.
4. **Fix** `AUDIT_FINDINGS_FULL.md` polish row **#50** ID mix-up (F-C14 vs vehicle spawn).
5. **Rename** `AUDIT_FFA_GUNFAME_RANKED.MD` → `AUDIT_FFA_GUNGAME_RANKED.MD` when convenient (and fix backlinks).
6. **Elevate** CEF `emitServer` allowlist in executive summaries — it is a **worse** trust failure than a mis-labeled cursor parameter if XSS or crafted CEF events are possible.
7. **Do not** delete “plan” / `read-only-*` files without review — they explain **provenance** of the larger reports.

---

## 6. Bottom line (for the owner who cannot read every file)

- The pack is **broadly valuable** for **security** (auth, secrets, XSS, CEF bridge, admin/report persistence), **stability** (timers, transactions, Discord timeout), and **gameplay** (warmup, hopouts timers, stats races).
- The pack has **repeated** **RAGE:MP API mistakes** (C01 severity, H01 parameter *names*, overlay “undocumented,” `mp.events.add` object form, `player.call` arg count). **`AUDIT_OF_AUDITS_WIKI_RECHECK.md` is the control document** for those rows.
- **No single narrative** in this folder is true on every line without the **errata + meta-audit** layer — that is expected when multiple agents and dates contributed.

---

## 7. Claim-level validation vs. repository code (this backup)

The meta-audit, wiki recheck, and cross-doc consistency checks are **not** a substitute for opening every cited `file:line` in the **TypeScript/frontend** tree. In this repo, the **full** `gamemode` (with `source/`, `frontend/`, `.env`, `conf.json`) often lives in the **nested** folder:

`arena-server-backup-master\arena-server-backup-master\gamemode\`

— not only at the outer unzip path. Searching the wrong level led to false “no `.ts` files” conclusions. Claim validation should use **`Audits/CLAIM_VALIDATION_CODE_STATUS.md` §0a–§3** (nested tree) or, if only bundles exist, webpack `index.js` / `app.js` as in §0.

---

*This meta-audit did not modify game source code. It documents the document set only. Per-claim code proof uses the nested `gamemode\` tree when present (see section 7 and `CLAIM_VALIDATION_CODE_STATUS.md`).*
