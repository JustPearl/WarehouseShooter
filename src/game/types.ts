import * as THREE from 'three';
import type { WeaponModel, MercModel } from './models';

/* ============================== game <-> UI contract ============================== */

export type GamePhase = 'menu' | 'playing' | 'paused' | 'gameover';

export interface WeaponHud {
  name: string;
  short: string;
  mag: number;
  reserve: number;
  auto: boolean;
  atts: string[];
  mode: string; // 'SEMI' | 'AUTO' | 'BURST'
}

export interface HudState {
  phase: GamePhase;
  health: number;
  weaponIndex: number;
  weapons: WeaponHud[];
  wave: number;
  enemiesLeft: number;
  score: number;
  kills: number;
  reload: number; // -1 = not reloading, else 0..1
  gap: number; // crosshair gap px
  ads: boolean;
  sprint: boolean;
  regen: boolean; // out-of-combat vitals restore active
  atts: string[]; // equipped attachment ids on the active weapon
  streak: number; // current kill chain (0 = none)
  streakT: number; // 1..0 — time left in the chain window
}

/** kill-chain callouts: exact counts that trigger a banner + stinger */
export const STREAK_TIERS = [
  { n: 2, label: 'DOUBLE KILL', tier: 1 },
  { n: 3, label: 'TRIPLE KILL', tier: 2 },
  { n: 4, label: 'RAMPAGE', tier: 3 },
  { n: 5, label: 'FRENZY', tier: 4 },
  { n: 6, label: 'UNSTOPPABLE', tier: 5 },
  { n: 8, label: 'APEX PREDATOR', tier: 6 },
];

export interface EndStats {
  score: number;
  kills: number;
  headshots: number;
  wave: number;
  accuracy: number;
  time: number;
}

export type GameEvent =
  | { type: 'hit'; kill: boolean; head: boolean }
  | { type: 'damage' }
  | { type: 'wave'; n: number; count: number }
  | { type: 'waveclear'; n: number; bonus: number }
  | { type: 'kill'; weapon: string; head: boolean }
  | { type: 'pickup'; text: string }
  | { type: 'streak'; n: number; label: string }
  | { type: 'scorepop'; text: string; x: number; y: number; head: boolean }
  | { type: 'gameover'; stats: EndStats };

export interface Hooks {
  hud: (h: HudState) => void;
  event: (e: GameEvent) => void;
}

/* ============================== world constants ============================== */

export const EYE = 1.62;
export const HALF_W = 32; // warehouse interior half-extents
export const HALF_D = 22;
export const YARD_W = 47; // fenced snow yard half-extents (playable beyond the walls)
export const YARD_D = 37;
export const GRAV = 13;

/* ============================== recoil ============================== */

/**
 * Recoil model — a learnable, deterministic offset, not a random impulse:
 * each shot advances one step through patternPitch/patternYaw (looping). The
 * offset persists while the trigger is held and only relaxes after a short
 * lull, so sustained fire climbs exactly as much as you let it. Per-shot noise
 * is a small ±fraction — never a random walk. Random dispersion (spread, heat
 * bloom, movement) is handled separately and honestly shown by the crosshair.
 */
export interface RecoilModel {
  caliberImpulse: number; // cartridge impulse multiplier (.45 heavy push = 1.0, 9mm snappy = 0.58)
  weightKg: number; // loaded weight — heavier guns rattle the shooter less
  stock: boolean; // shoulder stock: tighter brace, faster settled picture
  action: 'slide' | 'blowback' | 'revolver'; // revolver: fixed barrel, the cylinder indexes between shots
  patternPitch: number[]; // vertical rise per shot index (fractions of the impulse)
  patternYaw: number[]; // horizontal step per shot index (signed fractions — the learnable weave)
  noise: number; // ± random fraction added to each step (keep small: realism = consistency)
  varRange: number; // ± magnitude jitter per shot (fraction, small)
  recovDelay: number; // seconds after the last shot before the offset starts to relax
  recovPitch: number; // vertical relax rate (1/s, exponential)
  recovYaw: number; // horizontal relax rate
  adsBrace: number; // pattern amplitude multiplier while shouldered
  rollAmp: number; // cosmetic viewmodel torque (never rolls the camera)
}

/* ============================== attachments ============================== */

/**
 * Attachment modifiers — each attachment is a bag of multipliers with honest
 * drawbacks (nothing is a pure buff). Neutral = every factor 1.
 */
export interface WeaponMods {
  dmg: number;      // projectile damage
  vert: number;     // vertical recoil pattern scale
  horiz: number;    // horizontal recoil pattern scale
  spread: number;   // base dispersion
  bloom: number;    // heat bloom
  move: number;     // movement penalty
  reload: number;   // reload time scale
  fire: number;     // fire delay scale
  adsSpeed: number; // ADS raise speed
  adsErr: number;   // ADS camera-attack scale (<1 = snappier settle)
  adsBloom: number; // ADS dispersion scale
  recov: number;    // recoil recovery speed
  noise: number;    // shot-to-shot variance
  flash: number;    // muzzle flash scale
  magAdd: number;   // extra rounds per magazine
  laser: boolean;   // tightens the hip-fire cone only
  suppressed: boolean;
}

export const NEUTRAL: WeaponMods = {
  dmg: 1, vert: 1, horiz: 1, spread: 1, bloom: 1, move: 1, reload: 1, fire: 1,
  adsSpeed: 1, adsErr: 1, adsBloom: 1, recov: 1, noise: 1, flash: 1,
  magAdd: 0, laser: false, suppressed: false,
};

/** id -> modifiers. magAdd is resolved per-weapon where it differs. */
export const ATT_MODS: Record<string, Partial<WeaponMods>> = {
  supp:  { vert: 0.88, horiz: 0.95, dmg: 0.92, flash: 0.4, adsSpeed: 0.9, suppressed: true },
  comp:  { vert: 0.75, spread: 1.3, flash: 1.4 },
  xmag:  { reload: 1.25, move: 1.12 },
  laser: { bloom: 0.55, move: 0.5, vert: 1.05, horiz: 1.08, laser: true },
  vgrip: { vert: 0.78, move: 1.22, adsSpeed: 0.88 },
  rdot:  { adsErr: 0.7, adsBloom: 0.8, adsSpeed: 1.18, spread: 1.12 },
  match: { fire: 0.88, recov: 1.3, noise: 1.35 },
  lslide:{ adsErr: 0.85, vert: 0.92, adsSpeed: 0.88, move: 1.1 },
  grips: { vert: 0.82, noise: 0.8, adsSpeed: 0.9 },
};
export const ATT_MAGADD: Record<string, [number, number, number]> = { xmag: [4, 10, 2] }; // [pistol, smg, revolver]

/* ============================== weapons ============================== */

export interface WeaponCfg {
  id: string;
  name: string;
  short: string;
  auto: boolean;
  dmg: number;
  headMul: number;
  magSize: number;
  startReserve: number;
  fireDelay: number;
  reloadTime: number;
  kick: number; // cartridge base impulse (rad), scaled by recoil.caliberImpulse
  spread: number;
  bloom: number;
  moveSpread: number;
  hip: THREE.Vector3;
  ads: THREE.Vector3;
  adsFov: number;
  recoil: RecoilModel;
}

export const WEAPON_CFGS: WeaponCfg[] = [
  {
    id: 'pistol', name: 'KODIAK .45', short: 'KDK .45', auto: false,
    dmg: 34, headMul: 2.3, magSize: 8, startReserve: 56,
    fireDelay: 0.16, reloadTime: 1.15, kick: 0.058, spread: 0.0032, bloom: 0.005, moveSpread: 0.022,
    // true-scale sidearm: held closer; iron-sight line sits at local y=+0.055
    hip: new THREE.Vector3(0.22, -0.20, -0.40), ads: new THREE.Vector3(0, -0.055, -0.32), adsFov: 64,
    // stockless .45 in a free pistol grip: six heavy vertical shoves with a slight alternating
    // twist, then it settles fast — string shooting means rhythm, not spray
    recoil: {
      caliberImpulse: 1.0, weightKg: 1.05, stock: false, action: 'slide',
      patternPitch: [0.55, 0.64, 0.60, 0.70, 0.63, 0.74],
      patternYaw: [-0.10, 0.13, -0.08, 0.15, -0.11, 0.09],
      noise: 0.10, varRange: 0.14,
      recovDelay: 0.07, recovPitch: 8.5, recovYaw: 10,
      adsBrace: 0.55, rollAmp: 0.5,
    },
  },
  {
    id: 'smg', name: 'PTARMIGAN M9', short: 'PTM 9MM', auto: true,
    dmg: 13, headMul: 2.0, magSize: 30, startReserve: 150,
    fireDelay: 0.072, reloadTime: 1.75, kick: 0.0405, spread: 0.0095, bloom: 0.02, moveSpread: 0.03,
    // AR shoulder weld; the iron sight line lands at y=+0.074 after buildSMG's 1.2× scale
    // and the skeleton pad reaches +0.40 — ADS sits back at -0.48 to clear the near plane
    hip: new THREE.Vector3(0.27, -0.26, -0.56), ads: new THREE.Vector3(0, -0.074, -0.48), adsFov: 58,
    // 9mm AR carbine shouldered on a skeleton stock: rounds 1-3 are forgiving, the pattern ramps
    // to a steady climb over ~8 rounds, then plateaus while the yaw weaves a fixed, learnable S —
    // pull down and it stays on target; hold through the whole mag and it walks up a wall
    recoil: {
      caliberImpulse: 0.58, weightKg: 2.45, stock: true, action: 'blowback',
      patternPitch: [0.50, 0.56, 0.62, 0.70, 0.78, 0.88, 0.98, 1.06, 1.10, 1.08, 1.02, 0.97, 0.95, 0.95, 0.97, 0.99],
      patternYaw: [0.02, -0.06, 0.08, -0.10, 0.06, -0.04, 0.10, -0.16, 0.20, -0.14, 0.08, -0.05, 0.06, -0.08, 0.10, -0.12],
      noise: 0.08, varRange: 0.10,
      recovDelay: 0.09, recovPitch: 5.0, recovYaw: 7.5,
      adsBrace: 0.42, rollAmp: 0.15,
    },
  },
  {
    id: 'revolver', name: 'SABLE .38', short: 'SBL .38', auto: false,
    dmg: 44, headMul: 2.2, magSize: 5, startReserve: 40,
    fireDelay: 0.30, reloadTime: 2.3, kick: 0.052, spread: 0.004, bloom: 0.002, moveSpread: 0.02,
    // featherweight snub, held close; fixed sight line at local y=+0.052
    hip: new THREE.Vector3(0.21, -0.19, -0.38), ads: new THREE.Vector3(0, -0.052, -0.30), adsFov: 62,
    // five chambers, one turn of the cylinder: a rising staircase of heavy shoves that twists
    // with the cylinder's indexing. Fixed barrel + no slide to cycle means every pull is its
    // own event — the gun settles fast between shots, but the double-action pull is long
    recoil: {
      caliberImpulse: 0.92, weightKg: 0.75, stock: false, action: 'revolver',
      patternPitch: [0.62, 0.70, 0.66, 0.74, 0.80],
      patternYaw: [0.12, -0.10, 0.14, -0.12, 0.09],
      noise: 0.12, varRange: 0.16,
      recovDelay: 0.05, recovPitch: 9.5, recovYaw: 11,
      adsBrace: 0.5, rollAmp: 0.42,
    },
  },
];

/* ============================== runtime state ============================== */

export interface WeaponRt {
  cfg: WeaponCfg;
  model: WeaponModel;
  mag: number;
  reserve: number;
  cooldown: number;
  heat: number;
  reloadT: number; // -1 idle
  kickV: number;
  kickVis: number; // low-passed kickV -> muzzle flip ramps in instead of slamming
  kickVar: number; // per-shot flip magnitude (0.85..1.25)
  mod: WeaponMods; // live attachment modifiers
  attNodes: Record<string, THREE.Object3D>; // visual attachment meshes, toggled by loadout
  flashBase: number; // unscaled muzzle-flash sprite size
  aimJitX: number; // random dispersion baked into the gun's orientation (rad) — honest spread
  aimJitY: number; // random dispersion (yaw)
  echoT: number; // delayed mechanical echo — visual only (-1 idle)
  echoMag: number;
  burstAcc: number; // shot index into the recoil pattern (resets after a lull)
  lastFireT: number; // sim time of last shot (pattern reset + recovery gating)
  mode: number; // 0 = full-auto, 1 = 3-round burst (auto weapons only)
  burstLeft: number; // rounds remaining in the current burst
  meleeK: number; // melee lunge animation 0..1
  meleeT: number; // melee cooldown timer
}

export type EnemyRole = 'rifle' | 'breacher' | 'marksman';

export interface RagJoint {
  o: THREE.Object3D;
  v: number; // angular velocity
  rest: number; // limp rest angle
  min: number;
  max: number;
}

export interface Ragdoll {
  vx: number; vz: number; // linear momentum on the snow
  spin: number;
  y: number; vy: number; // pelvis drop + bounce
  landed: boolean;
  faceDown: boolean;
  tip: number; tipV: number; // torso tip-over
  joints: RagJoint[];
}

export interface Enemy {
  id: number;
  model: MercModel;
  hp: number;
  state: 'rise' | 'live' | 'dying';
  t: number;
  strafeDir: number;
  strafeT: number;
  burst: number;
  burstT: number;
  shotT: number;
  speed: number;
  prefDist: number;
  walkPhase: number;
  flashT: number;
  flashMats: THREE.MeshStandardMaterial[];
  fallDir: number;
  skin: number;
  seed: number;
  fireKick: number;
  hurtT: number;
  hurtX: number;
  hurtZ: number;
  role: EnemyRole;
  rag: Ragdoll | null;
  // pathfinding state (grid A* — routes around walls and cover instead of grinding into them)
  path: number[]; // waypoint cell indices
  pathI: number; // current waypoint cursor
  pathT: number; // repath timer (staggered per enemy)
  pathGoal: number; // player cell the path was built for
  stuckT: number;
  lastPX: number;
  lastPZ: number;
}
