// Who receives this hot-reload: remote IDs in the array, e.g. [0, 1]. Use [] to run for everyone online.
// F11 client console + chat: we log with mp.console.logInfo (F11) and mp.gui.chat (game chat).
executeTo = [];

mp.console.logInfo("[hot-loader] client.js bundle started (if you see this, server eval reached the client).");

// --- CONFIG & VARIABLES ---
let dummy = null;
let modelLoadTimer = null;
let lastDummyShotAt = 0;
const pedHash = mp.game.joaat("a_m_y_beach_01");
/** Same throttle order as DamageSync.module (playerWeaponShot can spam). */
const DUMMY_SHOT_MS = 120;

function estimateHitDamage(weaponHash, headshot) {
    let base = 24;
    try {
        const g = mp.game.weapon.getWeapontypeGroup(weaponHash);
        const rifle = mp.game.weapon.getWeapontypeGroup(mp.game.joaat("weapon_assaultrifle"));
        const mg = mp.game.weapon.getWeapontypeGroup(mp.game.joaat("weapon_mg"));
        const shotgun = mp.game.weapon.getWeapontypeGroup(mp.game.joaat("weapon_pumpshotgun"));
        const sniper = mp.game.weapon.getWeapontypeGroup(mp.game.joaat("weapon_sniperrifle"));
        if (g === shotgun) base = 38;
        else if (g === sniper) base = 72;
        else if (g === mg) base = 28;
        else if (g === rifle) base = 26;
    } catch (e) {}
    if (headshot) base = Math.round(base * 1.55);
    return Math.max(1, base);
}

function isHeadHit(targetPosition, entity) {
    try {
        const head = entity.getBoneCoords(31086, 0, 0, 0);
        const d = mp.game.system.vdist(head.x, head.y, head.z, targetPosition.x, targetPosition.y, targetPosition.z);
        return d < 0.38;
    } catch (e) {
        return false;
    }
}

/** Same pipeline as Hitmarker.module → FreeroamHud / arena DamageNumbers (Fortnite-style CEF floats). */
function pushCefDamageNumber(damage, status, wx, wy, wz) {
    try {
        const worldPos = new mp.Vector3(wx, wy, wz + 0.85);
        const screen = mp.game.graphics.world3dToScreen2d(worldPos);
        let screenX = 0.5;
        let screenY = 0.42;
        if (screen && screen.x >= 0 && screen.x <= 1 && screen.y >= 0 && screen.y <= 1) {
            screenX = screen.x;
            screenY = screen.y;
        }
        mp.events.call("client::eventManager", "cef::arena:damageNumber", {
            damage: Math.round(damage),
            status: status === "headshot" || status === "armor" ? status : "health",
            screenX: screenX,
            screenY: screenY,
        });
    } catch (e) {
        /* CEF not ready or wrong page */
    }
}

function spawnTestPed() {
    if (dummy && mp.peds.exists(dummy)) dummy.destroy();

    const localPlayer = mp.players.local;
    if (!localPlayer || !mp.players.exists(localPlayer)) {
        mp.console.logError("[hot-loader] mp.players.local missing — not in game yet?");
        return;
    }

    const pos = localPlayer.position;
    const forward = localPlayer.getForwardVector();

    const spawnPos = new mp.Vector3(
        pos.x + forward.x * 3,
        pos.y + forward.y * 3,
        pos.z + 0.05
    );

    try {
        dummy = mp.peds.new(pedHash, spawnPos, localPlayer.getHeading() + 180, localPlayer.dimension);
    } catch (e) {
        mp.console.logError("[hot-loader] mp.peds.new threw: " + e);
        mp.gui.chat.push("~r~[hot-loader] mp.peds.new failed — see F11 console.");
        return;
    }

    if (!dummy || !mp.peds.exists(dummy)) {
        mp.console.logError("[hot-loader] mp.peds.new returned invalid ped (model still streaming?)");
        mp.gui.chat.push("~r~[hot-loader] Ped invalid after new — see F11.");
        return;
    }

    dummy.setBlockingOfNonTemporaryEvents(true);
    dummy.setCanRagdoll(false);

    mp.console.logInfo("[hot-loader] DUMMY SPAWNED dim=" + localPlayer.dimension + " pos=" + spawnPos.x.toFixed(2) + "," + spawnPos.y.toFixed(2) + "," + spawnPos.z.toFixed(2));
    mp.gui.chat.push("!{#00FF00}DUMMY SPAWNED! Save this file again to respawn.");
}

function loadModelThenSpawn() {
    if (modelLoadTimer != null) {
        clearInterval(modelLoadTimer);
        modelLoadTimer = null;
    }
    if (!mp.game.streaming.isModelValid(pedHash)) {
        mp.console.logError("[hot-loader] isModelValid=false for hash " + pedHash);
        mp.gui.chat.push("~r~[hot-loader] Invalid ped model hash.");
        return;
    }
    if (mp.game.streaming.hasModelLoaded(pedHash)) {
        mp.console.logInfo("[hot-loader] model already loaded, spawning.");
        spawnTestPed();
        return;
    }
    mp.console.logInfo("[hot-loader] requesting ped model…");
    mp.game.streaming.requestModel(pedHash);
    const deadline = Date.now() + 5000;
    modelLoadTimer = setInterval(() => {
        if (mp.game.streaming.hasModelLoaded(pedHash)) {
            clearInterval(modelLoadTimer);
            modelLoadTimer = null;
            spawnTestPed();
        } else if (Date.now() > deadline) {
            clearInterval(modelLoadTimer);
            modelLoadTimer = null;
            mp.console.logError("[hot-loader] model load timeout (5s)");
            mp.gui.chat.push("~r~[hot-loader] Model load timeout — save client.js again.");
        }
    }, 10);
}

loadModelThenSpawn();

function shotHitsDummy(targetPosition, targetEntity) {
    if (!dummy || !mp.peds.exists(dummy)) return false;
    if (targetEntity && targetEntity.type === "ped" && targetEntity.handle === dummy.handle) return true;
    if (!targetPosition) return false;
    try {
        const torso = dummy.getBoneCoords(24818, 0, 0, 0);
        const d = mp.game.system.vdist(torso.x, torso.y, torso.z, targetPosition.x, targetPosition.y, targetPosition.z);
        return d < 1.85;
    } catch (e) {
        return false;
    }
}

// Local mp.peds.new targets often do NOT lose health from bullets the way players do; drive numbers from shots.
let weaponShotHook = new mp.Event("playerWeaponShot", (targetPosition, targetEntity) => {
    if (!shotHitsDummy(targetPosition, targetEntity)) return;

    const now = Date.now();
    if (now - lastDummyShotAt < DUMMY_SHOT_MS) return;
    lastDummyShotAt = now;

    const headshot = isHeadHit(targetPosition, dummy);
    const wHash = mp.players.local.weapon;
    const dmg = estimateHitDamage(wHash, headshot);

    const h = dummy.getHealth();
    const newH = Math.max(1, h - dmg);
    dummy.setHealth(newH);

    const headPos = dummy.getBoneCoords(31086, 0, 0, 0);
    pushCefDamageNumber(dmg, headshot ? "headshot" : "health", headPos.x, headPos.y, headPos.z);
});

// Heal dummy when nearly dead; damage feedback is CEF-only (same font as arena/freeroam HUD).
let renderLoop = new mp.Event("render", () => {
    if (dummy && mp.peds.exists(dummy)) {
        const currentHealth = dummy.getHealth();
        if (currentHealth < 15) {
            const maxH = typeof dummy.getMaxHealth === "function" ? dummy.getMaxHealth() : 200;
            dummy.setHealth(maxH);
        }
    }
});
