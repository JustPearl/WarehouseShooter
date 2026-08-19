import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { sfx } from './audio';
import { floorTexture, wallTexture, crateTexture, concreteTexture, flashTexture, dotTexture, snowGroundTexture, chainLinkTexture, roofTexture } from './textures';
import { buildPistol, buildSMG, buildMercenary, MERC_SKINS } from './models';
import type { WeaponModel, MercModel } from './models';

/* ============================== types ============================== */

export type GamePhase = 'menu' | 'playing' | 'paused' | 'gameover';

export interface WeaponHud {
  name: string;
  short: string;
  mag: number;
  reserve: number;
  auto: boolean;
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
}

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
  | { type: 'gameover'; stats: EndStats };

interface Hooks {
  hud: (h: HudState) => void;
  event: (e: GameEvent) => void;
}

/* ============================== constants ============================== */

const EYE = 1.62;
const HALF_W = 32; // warehouse interior half-extents
const HALF_D = 22;
const YARD_W = 47; // fenced snow yard half-extents (playable beyond the walls)
const YARD_D = 37;
const GRAV = 13;

/**
 * Recoil model — a learnable, deterministic offset, not a random impulse:
 * each shot advances one step through patternPitch/patternYaw (looping). The
 * offset persists while the trigger is held and only relaxes after a short
 * lull, so sustained fire climbs exactly as much as you let it. Per-shot noise
 * is a small ±fraction — never a random walk. Random dispersion (spread, heat
 * bloom, movement) is handled separately and honestly shown by the crosshair.
 */
interface RecoilModel {
  caliberImpulse: number; // cartridge impulse multiplier (.45 heavy push = 1.0, 9mm snappy = 0.58)
  weightKg: number; // loaded weight — heavier guns rattle the shooter less
  stock: boolean; // shoulder stock: tighter brace, faster settled picture
  action: 'slide' | 'blowback'; // slide returns to battery with a snap; blowback bolt taps forward
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

interface WeaponCfg {
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

const WEAPON_CFGS: WeaponCfg[] = [
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
    // long-gun hold; red dot centered at local y=+0.088, ADS far enough back to clear the stock
    hip: new THREE.Vector3(0.26, -0.25, -0.54), ads: new THREE.Vector3(0, -0.088, -0.44), adsFov: 58,
    // 9mm PDW with a folding stock: rounds 1-3 are forgiving, the pattern ramps to a steady climb
    // over ~8 rounds, then plateaus while the yaw weaves a fixed, learnable S — pull down and it
    // stays on target; hold through the whole mag and it walks up a wall
    recoil: {
      caliberImpulse: 0.58, weightKg: 2.45, stock: true, action: 'blowback',
      patternPitch: [0.50, 0.56, 0.62, 0.70, 0.78, 0.88, 0.98, 1.06, 1.10, 1.08, 1.02, 0.97, 0.95, 0.95, 0.97, 0.99],
      patternYaw: [0.02, -0.06, 0.08, -0.10, 0.06, -0.04, 0.10, -0.16, 0.20, -0.14, 0.08, -0.05, 0.06, -0.08, 0.10, -0.12],
      noise: 0.08, varRange: 0.10,
      recovDelay: 0.09, recovPitch: 5.0, recovYaw: 7.5,
      adsBrace: 0.42, rollAmp: 0.15,
    },
  },
];

interface WeaponRt {
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

interface Enemy {
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
  role: 'rifle' | 'breacher' | 'marksman';
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

/** Procedural ragdoll: spring-damper joints flopping to limp rests + a sliding, tipping torso. */
interface RagJoint {
  o: THREE.Object3D;
  v: number; // angular velocity
  rest: number; // randomized limp rest angle
  min: number;
  max: number;
}
interface Ragdoll {
  vx: number;
  vz: number;
  spin: number;
  y: number; // pelvis height
  vy: number;
  landed: boolean;
  faceDown: boolean;
  tip: number;
  tipV: number;
  joints: RagJoint[];
}

interface Pickup {
  group: THREE.Group;
  kind: 'ammo' | 'health';
  t: number;
  life: number;
}

interface Tracer { mesh: THREE.Mesh; life: number; }
interface Particle { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; maxLife: number; grav: number; size: number; }

/* ============================== engine ============================== */

export class Engine {
  private canvas: HTMLCanvasElement;
  private hooks: Hooks;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private raf = 0;
  private last = 0;
  private disposed = false;

  private phase: GamePhase = 'menu';

  // player
  private pos = new THREE.Vector3(0, EYE, 12);
  private vel = new THREE.Vector3();
  private yaw = Math.PI;
  private pitch = 0;
  // recoil state: recTgt* is the persistent pattern offset (rises while firing, relaxes only on a
  // lull); rec* is the smoothed value the camera actually renders — fast attack, no teleport
  private recTgtP = 0;
  private recTgtY = 0;
  private recP = 0;
  private recY = 0;
  private simT = 0; // accumulated sim time in seconds (burst-gap detection)
  private lastDamageT = -99; // sim-time of last hit taken (drives out-of-combat regen)
  private shake = 0;
  private sensMul = 1; // mouse sensitivity multiplier (settings)
  private grounded = true;
  private bobPhase = 0;
  private prevBobStep = 0;
  private swayMX = 0;
  private swayX = 0;
  private swayY = 0;
  private health = 100;
  private ads = false;
  private mouseDown = false;
  private firePressed = false;
  private fovKick = 0;
  private runTime = 0;

  // weapons
  private gunRig!: THREE.Group;
  private weapons: WeaponRt[] = [];
  private weaponIndex = 0;
  private gunLight!: THREE.PointLight;

  // input
  private keys: Record<string, boolean> = {};
  private wheelT = 0;

  // world
  private solidMeshes: THREE.Mesh[] = [];
  private colliderBoxes: THREE.Box3[] = [];

  // navigation grid (coarse A* over the compound — enemies route around walls & cover)
  private static readonly CELL = 1.6;
  private pathCols = 0;
  private pathRows = 0;
  private pathBlocked!: Uint8Array;
  private pfG!: Float32Array;
  private pfF!: Float32Array;
  private pfFrom!: Int32Array;
  private pfClosed!: Uint8Array;
  private astarBudget = 0; // max A* queries per frame (keeps wave spikes cheap)
  private lamps: { light: THREE.Light; base: number; seed: number }[] = [];
  private snow!: THREE.Points;
  private snowVel!: Float32Array;
  private motes!: THREE.Points; // dust hanging in the warehouse air

  // entities & pools
  private enemies: Enemy[] = [];
  private enemyHits: THREE.Mesh[] = [];
  private enemyIdSeq = 1;
  private pickups: Pickup[] = [];
  private tracersP: Tracer[] = [];
  private tracersE: Tracer[] = [];
  private particles: Particle[] = [];
  private pCursor = 0;
  private decals: THREE.Mesh[] = [];
  private dCursor = 0;
  private flashTex = flashTexture();
  private tracerMatP = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  private tracerMatE = new THREE.MeshBasicMaterial({ color: 0xff6a5a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  private particleMats = {
    blood: new THREE.MeshBasicMaterial({ color: 0x8a1e1e }),
    spark: new THREE.MeshBasicMaterial({ color: 0xffc46b }),
    snow: new THREE.MeshBasicMaterial({ color: 0xeaf4f8 }),
    case: new THREE.MeshBasicMaterial({ color: 0xd8a24a }),
  };

  // waves & scoring
  private wave = 0;
  private spawnQueue = 0;
  private spawnT = 0;
  private maxAlive = 4;
  private waveState: 'inter' | 'combat' = 'inter';
  private interT = 2.2;
  private score = 0;
  private kills = 0;
  private headshots = 0;
  private shotsFired = 0;
  private shotsHit = 0;

  // misc
  private raycaster = new THREE.Raycaster();
  private menuAngle = 0;
  private hudAcc = 0;
  private hudDirty = true;
  private flashT = 0;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, hooks: Hooks) {
    this.canvas = canvas;
    this.hooks = hooks;
  }

  /* ------------------------------ boot ------------------------------ */

  boot() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04070c);
    this.scene.fog = new THREE.FogExp2(0x08111c, 0.017);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    (this.scene as unknown as { environmentIntensity: number }).environmentIntensity = 0.22;

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 220);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.buildLights();
    this.buildWorld();
    this.buildPathGrid();
    this.buildSnow();
    this.buildWeapons();
    this.buildPools();
    this.bindInput();

    this.gunRig.visible = false;
    this.last = performance.now();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt, now / 1000);
    };
    loop();
    this.pushHud();
  }

  /* ------------------------------ lights ------------------------------ */

  private buildLights() {
    // muted sky/ground ambient — the arctic night reads through shadow, not fill
    const hemi = new THREE.HemisphereLight(0x33435a, 0x0b0f15, 0.42);
    this.scene.add(hemi);

    // moon: cold, low-contrast key with soft shadows over the whole compound
    const moon = new THREE.DirectionalLight(0x8fb0d8, 1.15);
    moon.position.set(30, 44, -26);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -58;
    moon.shadow.camera.right = 58;
    moon.shadow.camera.top = 52;
    moon.shadow.camera.bottom = -52;
    moon.shadow.camera.near = 6;
    moon.shadow.camera.far = 130;
    moon.shadow.bias = -0.00035;
    moon.shadow.normalBias = 0.035;
    (moon.shadow as unknown as { radius: number }).radius = 3;
    this.scene.add(moon);

    // faint blue bounce off the snowfield, lifting outdoor shadows just enough
    const bounce = new THREE.DirectionalLight(0x42546e, 0.28);
    bounce.position.set(-24, 10, 30);
    this.scene.add(bounce);
  }

  /* ------------------------------ world ------------------------------ */

  private addSolid(mesh: THREE.Mesh, kind: 'wall' | 'cover' | 'floor', collide = true) {
    mesh.userData.kind = kind;
    mesh.receiveShadow = true;
    mesh.castShadow = kind !== 'floor';
    if (!mesh.parent) this.scene.add(mesh);
    this.solidMeshes.push(mesh);
    if (collide && kind !== 'floor') {
      mesh.updateWorldMatrix(true, false);
      this.colliderBoxes.push(new THREE.Box3().setFromObject(mesh));
    }
  }

  private buildWorld() {
    // ---- interior: bare swept-concrete depot floor (no snow inside) ----
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.96, metalness: 0.02 });
    floorMat.map!.repeat.set(6, 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2 + 2, HALF_D * 2 + 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.addSolid(floor, 'floor', false);

    const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.85, metalness: 0.3 });
    wallMat.map!.repeat.set(6, 1.2);
    const crateMat = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.9, metalness: 0.04 });
    const concreteMat = new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95 });
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x2c343a, roughness: 0.5, metalness: 0.65 });
    const rustMat = new THREE.MeshStandardMaterial({ color: 0x6e4a33, roughness: 0.85, metalness: 0.4 });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xe2ebf3, roughness: 1 });
    const barrelMats = [
      new THREE.MeshStandardMaterial({ color: 0x8a3b2a, roughness: 0.7, metalness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x3f5a4a, roughness: 0.7, metalness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x54606a, roughness: 0.7, metalness: 0.4 }),
    ];
    const bagMat = new THREE.MeshStandardMaterial({ color: 0x8f8873, roughness: 1 });

    // ---- outside: snowfield yard wrapped by a chain-link perimeter fence ----
    const snowGroundMat = new THREE.MeshStandardMaterial({ map: snowGroundTexture(), roughness: 0.98, metalness: 0 });
    snowGroundMat.map!.repeat.set(16, 12);
    const yardGround = new THREE.Mesh(new THREE.PlaneGeometry(YARD_W * 2 + 8, YARD_D * 2 + 8), snowGroundMat);
    yardGround.rotation.x = -Math.PI / 2;
    yardGround.position.y = -0.02;
    yardGround.receiveShadow = true;
    this.scene.add(yardGround);

    const chainMat = new THREE.MeshStandardMaterial({
      map: chainLinkTexture(), transparent: true, alphaTest: 0.42, side: THREE.DoubleSide,
      color: 0x8b99a2, roughness: 0.55, metalness: 0.75,
    });
    chainMat.map!.repeat.set(6, 1);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x39434b, roughness: 0.55, metalness: 0.7 });
    const fenceH = 3.4;
    const fenceSide = (len: number, x: number, z: number, rotY: number) => {
      const grp = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, fenceH), chainMat);
      mesh.position.y = fenceH / 2 + 0.18;
      grp.add(mesh);
      for (const ry of [0.24, fenceH + 0.12]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), postMat);
        rail.rotation.z = Math.PI / 2;
        rail.position.y = ry;
        grp.add(rail);
      }
      const nPosts = Math.ceil(len / 7.8);
      for (let i = 0; i <= nPosts; i++) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, fenceH + 0.34, 6), postMat);
        p.position.set(-len / 2 + (len / nPosts) * i, (fenceH + 0.34) / 2 - 0.05, 0);
        p.castShadow = true;
        grp.add(p);
      }
      grp.position.set(x, 0, z);
      grp.rotation.y = rotY;
      this.scene.add(grp);
    };
    fenceSide(YARD_W * 2, 0, -YARD_D, 0);
    fenceSide(YARD_W * 2, 0, YARD_D, 0);
    fenceSide(YARD_D * 2, -YARD_W, 0, Math.PI / 2);
    fenceSide(YARD_D * 2, YARD_W, 0, Math.PI / 2);
    // fence blocks movement but not bullets — colliders only, no hit meshes
    this.colliderBoxes.push(
      new THREE.Box3(new THREE.Vector3(-YARD_W, 0, -YARD_D - 0.15), new THREE.Vector3(YARD_W, fenceH, -YARD_D + 0.15)),
      new THREE.Box3(new THREE.Vector3(-YARD_W, 0, YARD_D - 0.15), new THREE.Vector3(YARD_W, fenceH, YARD_D + 0.15)),
      new THREE.Box3(new THREE.Vector3(-YARD_W - 0.15, 0, -YARD_D), new THREE.Vector3(-YARD_W + 0.15, fenceH, YARD_D)),
      new THREE.Box3(new THREE.Vector3(YARD_W - 0.15, 0, -YARD_D), new THREE.Vector3(YARD_W + 0.15, fenceH, YARD_D)),
    );
    // wind-piled drifts against the fence line
    const driftSpots: [number, number][] = [];
    for (let i = 0; i < 8; i++) driftSpots.push([-YARD_W + 2 + Math.random() * (YARD_W * 2 - 4), -YARD_D + 1.1 + Math.random() * 1.5]);
    for (let i = 0; i < 8; i++) driftSpots.push([-YARD_W + 2 + Math.random() * (YARD_W * 2 - 4), YARD_D - 1.1 - Math.random() * 1.5]);
    for (let i = 0; i < 5; i++) driftSpots.push([-YARD_W + 1.1 + Math.random() * 1.5, -YARD_D + 2 + Math.random() * (YARD_D * 2 - 4)]);
    for (let i = 0; i < 5; i++) driftSpots.push([YARD_W - 1.1 - Math.random() * 1.5, -YARD_D + 2 + Math.random() * (YARD_D * 2 - 4)]);
    for (const [dx, dz] of driftSpots) {
      const drift = new THREE.Mesh(new THREE.SphereGeometry(1.4 + Math.random() * 1.6, 10, 7), snowMat);
      drift.scale.set(1.7, 0.3 + Math.random() * 0.14, 1);
      drift.position.set(dx, 0.03, dz);
      drift.rotation.y = Math.random() * 3;
      this.scene.add(drift);
    }

    const wallBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, y, z);
      this.addSolid(m, 'wall');
    };
    // warehouse shell with three passable openings: north breach, south loading bay, west vehicle gate
    wallBox(26, 7, 0.6, -19, 3.5, -HALF_D);
    wallBox(26, 7, 0.6, 19, 3.5, -HALF_D);
    wallBox(0.6, 7, HALF_D * 2, HALF_W, 3.5, 0); // east: solid
    wallBox(20, 7, 0.6, -22, 3.5, HALF_D);
    wallBox(28, 7, 0.6, 18, 3.5, HALF_D);
    wallBox(16, 2.2, 0.7, -4, 5.9, HALF_D); // header above the south loading bay
    wallBox(0.6, 7, 17, -HALF_W, 3.5, -13.5);
    wallBox(0.6, 7, 17, -HALF_W, 3.5, 13.5);
    wallBox(0.7, 2.4, 10, -HALF_W, 5.8, 0); // header above the west vehicle gate
    // rubble in the openings (low cover, shoot-over-able)
    const rubbleN = new THREE.Mesh(new THREE.BoxGeometry(12, 0.9, 1.4), concreteMat);
    rubbleN.position.set(0, 0.45, -HALF_D);
    this.addSolid(rubbleN, 'cover');
    const rubbleS = new THREE.Mesh(new THREE.BoxGeometry(8, 0.9, 1.4), concreteMat);
    rubbleS.position.set(-8, 0.45, HALF_D);
    this.addSolid(rubbleS, 'cover');
    const rubbleW = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 3.2), concreteMat);
    rubbleW.position.set(-HALF_W, 0.35, -3.3);
    this.addSolid(rubbleW, 'cover');
    // snow banks just outside the openings — the cold stays outdoors
    for (const [dx, dz, sx] of [[0, -HALF_D - 1.6, 4.4], [-6, HALF_D + 1.5, 3.4], [-HALF_W - 1.6, 3.4, 2.6]] as [number, number, number][]) {
      const bank = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), snowMat);
      bank.scale.set(sx / 1.6, 0.4, 1);
      bank.position.set(dx, 0.15, dz);
      this.scene.add(bank);
    }

    // steel columns
    for (const cx of [-21, -7, 7, 21]) {
      for (const cz of [-8, 8]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.55, 7, 0.55), beamMat);
        col.position.set(cx, 3.5, cz);
        this.addSolid(col, 'cover');
      }
    }
    // ---- complete roof: purlins + cross ties + full-span decking ----
    for (const cx of [-26, -13, 0, 13, 26]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, HALF_D * 2), beamMat);
      beam.position.set(cx, 6.85, 0);
      beam.castShadow = true;
      this.scene.add(beam);
    }
    for (const cz of [-15, 0, 15]) {
      const tie = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, 0.4, 0.35), beamMat);
      tie.position.set(0, 6.6, cz);
      tie.castShadow = true;
      this.scene.add(tie);
    }
    const roofMat = new THREE.MeshStandardMaterial({
      map: roofTexture(), roughness: 0.82, metalness: 0.42, side: THREE.DoubleSide, color: 0xaab4bc,
    });
    roofMat.map!.repeat.set(9, 6.5);
    const deck = new THREE.Mesh(new THREE.PlaneGeometry((HALF_W + 1.2) * 2, (HALF_D + 1.2) * 2), roofMat);
    deck.rotation.x = Math.PI / 2;
    deck.position.set(0, 7.12, 0);
    deck.castShadow = true; // keeps moonlight out — the interior lives on lamps and breach-light
    deck.receiveShadow = true;
    deck.userData.kind = 'wall';
    this.scene.add(deck);
    this.solidMeshes.push(deck); // rounds fired skyward end at the ceiling
    // eave fascia for a clean silhouette from the yard
    const fasciaMat = new THREE.MeshStandardMaterial({ color: 0x232b31, roughness: 0.6, metalness: 0.5 });
    const mkFascia = (w: number, d: number, x: number, z: number) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), fasciaMat);
      f.position.set(x, 7.0, z);
      f.castShadow = true;
      this.scene.add(f);
    };
    mkFascia((HALF_W + 1.2) * 2, 0.3, 0, -(HALF_D + 1.2));
    mkFascia((HALF_W + 1.2) * 2, 0.3, 0, HALF_D + 1.2);
    mkFascia(0.3, (HALF_D + 1.2) * 2, -(HALF_W + 1.2), 0);
    mkFascia(0.3, (HALF_D + 1.2) * 2, HALF_W + 1.2, 0);
    // rooftop vents — silhouette interest above the yard line
    const ventMat = new THREE.MeshStandardMaterial({ color: 0x3c464e, roughness: 0.7, metalness: 0.45 });
    for (const [vx, vz, vs] of [[-14, -8, 1], [9, 6, 0.8], [18, -12, 0.65], [-6, 12, 0.9]] as [number, number, number][]) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(2.2 * vs, 1.1 * vs, 1.6 * vs), ventMat);
      vent.position.set(vx, 7.12 + 0.55 * vs, vz);
      vent.castShadow = true;
      this.scene.add(vent);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2.5 * vs, 0.14, 1.9 * vs), fasciaMat);
      cap.position.y = 0.62 * vs;
      vent.add(cap);
    }

    // ---- physical cover: crate stacks ----
    const crateSpots: [number, number, number, number][] = [
      [-12, -6, 2, 0.1], [-14.4, -4.6, 1, 0.7], [10, -9, 2, 0.2], [13, -8.2, 1, 1.1],
      [-4, -13, 1, 0.4], [5, -2, 2, 0.12], [-8.5, 3, 1, 0.9], [-6.2, 5.2, 1, 0.2],
      [9, 6, 2, 0.5], [14.2, 4.4, 1, 1.3], [-16, 10, 1, 0.1], [2, -16, 1, 0.8],
      [18, -2, 1, 0.35], [-20, -3, 2, 0.15], [0.5, 8, 1, 0.6], [22, 12, 1, 0.2],
    ];
    for (const [x, z, levels, rot] of crateSpots) {
      for (let l = 0; l < levels; l++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), crateMat);
        c.position.set(x + (l > 0 ? 0.08 : 0), 0.65 + l * 1.3, z);
        c.rotation.y = rot + (l > 0 ? 0.25 : 0);
        this.addSolid(c, 'cover');
      }
    }

    // ---- barrels ----
    const barrelClusters: [number, number][] = [[-3, -7], [16, 13], [-18, 6], [7, 14], [24, -8]];
    barrelClusters.forEach(([bx, bz], ci) => {
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12), barrelMats[(ci + i) % 3]);
        if (i === 2) {
          b.rotation.z = Math.PI / 2;
          b.position.set(bx + 1.1, 0.43, bz + 0.4);
        } else {
          b.position.set(bx + i * 0.95, 0.53, bz + (i % 2) * 0.5);
        }
        this.addSolid(b, 'cover');
      }
    });

    // ---- concrete barriers ----
    const barrierSpots: [number, number, number][] = [
      [0, -8, 0.3], [-10, -12, 0.1], [12, 0.5, 1.2], [-2, 12.5, 0.1], [20, 8, 0.6], [-24, 12, 1.4],
    ];
    for (const [x, z, rot] of barrierSpots) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 0.55), concreteMat);
      b.position.set(x, 0.5, z);
      b.rotation.y = rot;
      this.addSolid(b, 'cover');
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.22, 0.3), concreteMat);
      top.position.y = 0.6;
      top.castShadow = true;
      b.add(top); // visual child only (collider box already computed)
    }

    // ---- sandbag piles ----
    for (const [x, z] of [[-1, -3.2], [6.5, 10.5], [-13, 14]]) {
      for (let l = 0; l < 2; l++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 0.75), bagMat);
        s.position.set(x + (l % 2) * 0.12, 0.21 + l * 0.4, z);
        s.rotation.y = l * 0.14;
        this.addSolid(s, 'cover');
      }
    }

    // ---- wrecked supply truck (centerpiece cover) ----
    const truck = new THREE.Group();
    const bed = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.1, 2.2), rustMat);
    bed.position.set(0, 1.1, 0);
    bed.castShadow = true;
    truck.add(bed);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.7, 2.1), new THREE.MeshStandardMaterial({ color: 0x40525c, roughness: 0.6, metalness: 0.5 }));
    cab.position.set(2.9, 0.95, 0);
    cab.castShadow = true;
    truck.add(cab);
    for (const [wx, wz] of [[-1.4, 1.15], [-1.4, -1.15], [1.4, 1.15], [2.8, 1.1], [2.8, -1.1]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.4, 12), new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.95 }));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wx, 0.52, wz);
      truck.add(wheel);
    }
    truck.position.set(-15, 0, 8);
    truck.rotation.y = 0.5;
    this.scene.add(truck);
    this.addSolid(bed, 'cover');
    this.addSolid(cab, 'cover');

    // ---- yard: shipping containers, dead truck, crates and barriers in the snow ----
    const contMatA = new THREE.MeshStandardMaterial({ map: wallTexture(), color: 0x7c4a38, roughness: 0.82, metalness: 0.45 });
    contMatA.map!.repeat.set(4, 1.4);
    const contMatB = new THREE.MeshStandardMaterial({ map: wallTexture(), color: 0x46545e, roughness: 0.82, metalness: 0.45 });
    contMatB.map!.repeat.set(4, 1.4);
    const contSpots: [number, number, number, THREE.Material, boolean][] = [
      [-39, -13, 0.14, contMatA, false], [39, 9, -0.22, contMatB, false], [14, -30, 0.06, contMatB, true], [-38, 22, 0.4, contMatA, false],
    ];
    for (const [cx, cz, cr, cm, long] of contSpots) {
      const cont = new THREE.Mesh(new THREE.BoxGeometry(long ? 2.5 : 6.1, 2.6, long ? 6.1 : 2.5), cm);
      cont.position.set(cx, 1.3, cz);
      cont.rotation.y = cr;
      this.addSolid(cont, 'cover');
      // snow cap on the roof
      const cap = new THREE.Mesh(new THREE.BoxGeometry(long ? 2.3 : 5.9, 0.16, long ? 5.9 : 2.3), snowMat);
      cap.position.y = 1.38;
      cont.add(cap);
    }
    // second wrecked truck, half-buried in the east yard
    const truck2 = new THREE.Group();
    const bed2 = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.1, 2.2), rustMat);
    bed2.position.set(0, 1.05, 0);
    bed2.castShadow = true;
    truck2.add(bed2);
    const cab2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.7, 2.1), new THREE.MeshStandardMaterial({ color: 0x3c4a52, roughness: 0.65, metalness: 0.5 }));
    cab2.position.set(2.9, 0.9, 0);
    cab2.castShadow = true;
    truck2.add(cab2);
    const cap2 = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.16, 2.0), snowMat);
    cap2.position.set(0, 2.18, 0);
    truck2.add(cap2);
    truck2.position.set(38, -0.12, -18);
    truck2.rotation.y = 2.35;
    this.scene.add(truck2);
    this.addSolid(bed2, 'cover');
    this.addSolid(cab2, 'cover');
    // yard crate stacks & barrel clusters
    for (const [x, z, levels] of [[-36, 5, 2], [35, 25, 1], [-21, -30, 2], [24, -26, 1]] as [number, number, number][]) {
      for (let l = 0; l < levels; l++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), crateMat);
        c.position.set(x + (l > 0 ? 0.08 : 0), 0.65 + l * 1.3, z);
        c.rotation.y = 0.3 + l * 0.25;
        this.addSolid(c, 'cover');
      }
    }
    for (const [bx, bz] of [[-35, -23], [41, -4], [18, 32]] as [number, number][]) {
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12), barrelMats[i % 3]);
        b.position.set(bx + i * 0.95, i === 2 ? 0.43 : 0.53, bz + (i % 2) * 0.5);
        if (i === 2) b.rotation.z = Math.PI / 2;
        this.addSolid(b, 'cover');
      }
    }
    for (const [x, z, rot] of [[-37, 1, 1.57], [1, -27, 0.2], [-6, 27, 0.1], [30, 30, 0.8]] as [number, number, number][]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 0.55), concreteMat);
      b.position.set(x, 0.5, z);
      b.rotation.y = rot;
      this.addSolid(b, 'cover');
    }

    // ---- non-solid dressing: pallets, debris, pipes ----
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5d4a33, roughness: 0.95 });
    for (const [x, z, r] of [[4, 4, 0.4], [-9, -8, 1.2], [15, -14, 0.8], [-22, -14, 0.2], [11, 16, 1.5]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 1.3), woodMat);
      p.position.set(x, 0.06, z);
      p.rotation.y = r;
      p.receiveShadow = true;
      this.scene.add(p);
    }
    for (let i = 0; i < 22; i++) {
      const deb = new THREE.Mesh(
        new THREE.BoxGeometry(0.15 + Math.random() * 0.5, 0.06 + Math.random() * 0.12, 0.12 + Math.random() * 0.4),
        Math.random() > 0.5 ? woodMat : beamMat,
      );
      deb.position.set((Math.random() - 0.5) * 56, 0.05, (Math.random() - 0.5) * 38);
      deb.rotation.y = Math.random() * 3;
      this.scene.add(deb);
    }
    for (const side of [-1, 1]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, HALF_D * 2 - 2, 8), rustMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(side * (HALF_W - 1.1), 5.4, 0);
      this.scene.add(pipe);
    }

    // ---- hanging tungsten work lamps: focused pools of light, one casts shadows ----
    const lampGeoHead = new THREE.BoxGeometry(0.5, 0.16, 0.3);
    const lampMatGlow = new THREE.MeshStandardMaterial({ color: 0x30241a, emissive: 0xffc28a, emissiveIntensity: 1.5, roughness: 0.6 });
    const cordMat = new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.9 });
    ([[-14, -4, 4.6], [12, 6, 4.9], [1, -13, 5.1]] as [number, number, number][]).forEach(([lx, lz, ly], idx) => {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 7 - ly, 6), cordMat);
      cord.position.set(lx, (7 + ly) / 2, lz);
      this.scene.add(cord);
      const head = new THREE.Mesh(lampGeoHead, lampMatGlow);
      head.position.set(lx, ly, lz);
      this.scene.add(head);
      const spot = new THREE.SpotLight(0xffc28a, 210, 26, 1.02, 0.62, 2);
      spot.position.set(lx, ly - 0.15, lz);
      spot.target.position.set(lx + 0.4, 0, lz + 0.3);
      this.scene.add(spot.target);
      if (idx === 0) {
        spot.castShadow = true;
        spot.shadow.mapSize.set(512, 512);
        spot.shadow.bias = -0.002;
      }
      this.scene.add(spot);
      this.lamps.push({ light: spot, base: 210, seed: lx * 7 + lz });
    });

    // ---- moonlight spilling in through the north breach ----
    const spill = new THREE.SpotLight(0x9fc4dd, 120, 46, 0.72, 0.75, 2);
    spill.position.set(2, 6.5, -HALF_D - 9);
    spill.target.position.set(0, 0, -9);
    this.scene.add(spill.target);
    this.scene.add(spill);

    // faint ambient lift between lamp pools (roof keeps the moon out)
    const fill = new THREE.PointLight(0x8fb4c8, 26, 40, 2);
    fill.position.set(0, 5.6, 0);
    this.scene.add(fill);

    // ---- yard floodlight tower: cold wash over the snowfield ----
    const tower = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 9.6, 8), postMat);
    pole.position.y = 4.8;
    pole.castShadow = true;
    tower.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.12), postMat);
    arm.position.set(0.7, 9.45, 0);
    tower.add(arm);
    const floodHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 0.3, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2a3238, emissive: 0xd7e6f2, emissiveIntensity: 1.3, roughness: 0.5 }),
    );
    floodHead.position.set(1.35, 9.35, 0);
    tower.add(floodHead);
    tower.position.set(-41, 0, -31);
    tower.rotation.y = 0.6;
    this.scene.add(tower);
    const flood = new THREE.SpotLight(0xcfe0ee, 2600, 110, 0.6, 0.55, 2);
    flood.position.set(-40, 9.3, -30);
    flood.target.position.set(-8, 0, -2);
    this.scene.add(flood.target);
    this.scene.add(flood);
    this.lamps.push({ light: flood, base: 2600, seed: 91 });
  }

  private buildSnow() {
    // the blizzard lives in the yard — not a flake falls inside the warehouse
    const N = 3000;
    const posArr = new Float32Array(N * 3);
    this.snowVel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      posArr[i * 3] = (Math.random() - 0.5) * YARD_W * 2;
      posArr[i * 3 + 1] = Math.random() * 18;
      posArr[i * 3 + 2] = (Math.random() - 0.5) * YARD_D * 2;
      this.snowVel[i] = 1.8 + Math.random() * 2.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xe8f4fa, size: 0.1, map: dotTexture(), transparent: true, opacity: 0.8,
      depthWrite: false, sizeAttenuation: true,
    });
    this.snow = new THREE.Points(geo, mat);
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);

    // dust motes drifting in the depot air
    const M = 260;
    const mArr = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) {
      mArr[i * 3] = (Math.random() - 0.5) * 16;
      mArr[i * 3 + 1] = Math.random() * 6;
      mArr[i * 3 + 2] = (Math.random() - 0.5) * 16;
    }
    const mGeo = new THREE.BufferGeometry();
    mGeo.setAttribute('position', new THREE.BufferAttribute(mArr, 3));
    const mMat = new THREE.PointsMaterial({
      color: 0xbfd4e0, size: 0.035, map: dotTexture(), transparent: true, opacity: 0.32,
      depthWrite: false, sizeAttenuation: true,
    });
    this.motes = new THREE.Points(mGeo, mMat);
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
  }

  private buildWeapons() {
    this.gunRig = new THREE.Group();
    this.camera.add(this.gunRig);
    const builders = [buildPistol, buildSMG];
    WEAPON_CFGS.forEach((cfg, i) => {
      const model = builders[i]();
      model.group.position.copy(cfg.hip);
      model.group.visible = i === 0;
      this.gunRig.add(model.group);
      this.weapons.push({
        cfg, model, mag: cfg.magSize, reserve: cfg.startReserve,
        cooldown: 0, heat: 0, reloadT: -1, kickV: 0, kickVis: 0, kickVar: 1,
        aimJitX: 0, aimJitY: 0, echoT: -1, echoMag: 0,
        burstAcc: 0, lastFireT: -1,
        mode: 0, burstLeft: 0, meleeK: 0, meleeT: 0,
      });
    });
    this.gunLight = new THREE.PointLight(0xffc47a, 0, 9, 2);
    this.gunLight.position.set(0.2, -0.1, -0.8);
    this.camera.add(this.gunLight);
  }

  private buildPools() {
    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 16; i++) {
      const mp = new THREE.Mesh(tracerGeo, this.tracerMatP);
      const me = new THREE.Mesh(tracerGeo, this.tracerMatE);
      mp.visible = me.visible = false;
      this.scene.add(mp, me);
      this.tracersP.push({ mesh: mp, life: 0 });
      this.tracersE.push({ mesh: me, life: 0 });
    }
    const pGeo = new THREE.BoxGeometry(1, 1, 1);
    const kinds = ['blood', 'spark', 'snow', 'case'] as const;
    for (let i = 0; i < 190; i++) {
      const mesh = new THREE.Mesh(pGeo, this.particleMats[kinds[i % 4]]);
      mesh.visible = false;
      this.scene.add(mesh);
      this.particles.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 1, grav: 9, size: 0.05 });
    }
    const decalGeo = new THREE.CircleGeometry(0.045, 8);
    const decalMat = new THREE.MeshBasicMaterial({ color: 0x10141a, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -3 });
    for (let i = 0; i < 70; i++) {
      const d = new THREE.Mesh(decalGeo, decalMat);
      d.visible = false;
      this.scene.add(d);
      this.decals.push(d);
    }
  }

  /* ------------------------------ input ------------------------------ */

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space') e.preventDefault();
    this.keys[e.code] = true;
    if (this.phase !== 'playing') return;
    if (e.code === 'KeyR') this.startReload();
    if (e.code === 'Digit1') this.switchTo(0);
    if (e.code === 'Digit2') this.switchTo(1);
    if (e.code === 'KeyV') this.toggleFireMode();
    if (e.code === 'KeyF') this.melee();
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys[e.code] = false; };
  private onMouseDown = (e: MouseEvent) => {
    if (this.phase !== 'playing') return;
    if (e.button === 0) { this.mouseDown = true; this.firePressed = true; }
    if (e.button === 2) this.ads = true;
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
    if (e.button === 2) this.ads = false;
  };
  private onMouseMove = (e: MouseEvent) => {
    if (this.phase !== 'playing' || document.pointerLockElement !== this.canvas) return;
    const sens = 0.0021 * this.sensMul * (this.ads ? 0.6 : 1);
    this.yaw -= e.movementX * sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * sens));
    this.swayMX += e.movementX;
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.phase !== 'playing') return;
    const now = performance.now();
    if (now - this.wheelT < 220) return;
    this.wheelT = now;
    this.switchTo(this.weaponIndex === 0 ? 1 : 0);
  };
  private onLockChange = () => {
    const locked = document.pointerLockElement === this.canvas;
    if (!locked && this.phase === 'playing') {
      this.phase = 'paused';
      this.mouseDown = false;
      this.ads = false;
      this.pushHud();
    } else if (locked && this.phase === 'paused') {
      this.phase = 'playing';
      this.last = performance.now();
      this.pushHud();
    }
  };
  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
  private onLockError = () => {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.pushHud();
    }
  };
  private onCtx = (e: Event) => e.preventDefault();
  private onVis = () => {
    if (document.hidden && this.phase === 'playing') {
      document.exitPointerLock();
      this.phase = 'paused';
      this.pushHud();
    }
  };

  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('pointerlockerror', this.onLockError);
    document.addEventListener('visibilitychange', this.onVis);
    window.addEventListener('resize', this.onResize);
    this.canvas.addEventListener('contextmenu', this.onCtx);
  }

  /* ------------------------------ public control ------------------------------ */

  startGame() {
    sfx.init();
    this.clearEntities();
    this.pos.set(0, EYE, 13);
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI;
    this.pitch = 0;
    this.recTgtP = this.recTgtY = this.recP = this.recY = 0;
    this.shake = 0;
    this.health = 100;
    this.lastDamageT = -99;
    this.score = 0;
    this.kills = 0;
    this.headshots = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.runTime = 0;
    this.wave = 0;
    this.waveState = 'inter';
    this.interT = 2.2;
    this.weaponIndex = 0;
    this.weapons.forEach((w, i) => {
      w.mag = w.cfg.magSize;
      w.reserve = w.cfg.startReserve;
      w.cooldown = 0;
      w.heat = 0;
      w.reloadT = -1;
      w.aimJitX = 0;
      w.aimJitY = 0;
      w.echoT = -1;
      w.kickVis = 0;
      w.kickVar = 1;
      w.burstAcc = 0;
      w.lastFireT = -1;
      w.mode = 0;
      w.burstLeft = 0;
      w.meleeK = 0;
      w.meleeT = 0;
      w.model.group.visible = i === 0;
    });
    this.gunRig.visible = true;
    this.phase = 'playing';
    this.last = performance.now();
    this.canvas.requestPointerLock();
    this.pushHud();
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.canvas.requestPointerLock();
  }

  setSensitivity(mult: number) {
    this.sensMul = Math.max(0.2, Math.min(3, mult));
  }

  toMenu() {
    this.clearEntities();
    this.gunRig.visible = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.phase = 'menu';
    this.pushHud();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('pointerlockerror', this.onLockError);
    document.removeEventListener('visibilitychange', this.onVis);
    window.removeEventListener('resize', this.onResize);
    this.canvas.removeEventListener('contextmenu', this.onCtx);
    this.renderer.dispose();
  }

  /* ------------------------------ entities ------------------------------ */

  private clearEntities() {
    for (const e of this.enemies) this.scene.remove(e.model.group);
    this.enemies = [];
    this.enemyHits = [];
    for (const p of this.pickups) this.scene.remove(p.group);
    this.pickups = [];
    for (const t of [...this.tracersP, ...this.tracersE]) { t.mesh.visible = false; t.life = 0; }
    for (const p of this.particles) { p.mesh.visible = false; p.life = 0; }
    for (const d of this.decals) d.visible = false;
    this.spawnQueue = 0;
  }

  private spawnEnemy() {
    const anchors: [number, number][] = [
      [-43, -33], [-20, -33], [0, -33], [20, -33], [43, -33],
      [-43, 0], [43, 0],
      [-43, 33], [-20, 33], [0, 33], [20, 33], [43, 33],
    ];
    let best = anchors[Math.floor(Math.random() * anchors.length)];
    for (let tries = 0; tries < 6; tries++) {
      const a = anchors[Math.floor(Math.random() * anchors.length)];
      const dx = a[0] - this.pos.x, dz = a[1] - this.pos.z;
      if (dx * dx + dz * dz > 18 * 18) { best = a; break; }
    }
    const id = this.enemyIdSeq++;
    const skin = Math.floor(Math.random() * MERC_SKINS.length);
    const model = buildMercenary(skin);
    model.group.position.set(best[0] + (Math.random() - 0.5) * 3, -1.5, best[1] + (Math.random() - 0.5) * 3);
    this.scene.add(model.group);

    // ---- combat archetype: rifle (default), breacher (shotgun rusher), marksman (long-range) ----
    const rollR = Math.random();
    const breacherW = Math.min(0.34, 0.14 + this.wave * 0.02);
    const marksmanW = Math.min(0.26, 0.1 + this.wave * 0.018);
    const role: Enemy['role'] = rollR < breacherW ? 'breacher' : rollR < breacherW + marksmanW ? 'marksman' : 'rifle';
    // role beacon lamp on the left shoulder so you can read the threat at a glance
    const lampCol = role === 'breacher' ? 0xff8b2a : role === 'marksman' ? 0x55d7ff : 0x3a4750;
    const lamp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.05, 8),
      new THREE.MeshStandardMaterial({ color: 0x111417, emissive: lampCol, emissiveIntensity: role === 'rifle' ? 0.5 : 2.2, roughness: 0.4 }),
    );
    lamp.rotation.z = Math.PI / 2;
    lamp.position.set(0.02, 0.02, 0.1);
    model.shoulderL.add(lamp);

    // per-enemy cloned materials for hit-flash
    const flashMats: THREE.MeshStandardMaterial[] = [];
    const cloneMat = (m: THREE.Mesh) => {
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.emissive = new THREE.Color(0xaa2222);
      mat.emissiveIntensity = 0;
      m.material = mat;
      flashMats.push(mat);
    };
    cloneMat(model.headMesh);
    for (const m of model.bodyMeshes) cloneMat(m);

    const reg = (mesh: THREE.Mesh, part: 'head' | 'body') => {
      mesh.userData.eid = id;
      mesh.userData.part = part;
      this.enemyHits.push(mesh);
    };
    reg(model.headMesh, 'head');
    for (const m of model.bodyMeshes) reg(m, 'body');

    const baseSpeed = Math.min(4.0, 2.3 + (this.wave - 1) * 0.15) * (2 - model.bulk);
    const e: Enemy = {
      id, model,
      hp: Math.round((45 + (this.wave - 1) * 10) * model.bulk * (role === 'breacher' ? 1.35 : role === 'marksman' ? 0.85 : 1)),
      state: 'rise', t: 0, strafeDir: Math.random() > 0.5 ? 1 : -1,
      strafeT: 1 + Math.random(), burst: 0, burstT: 0,
      shotT: role === 'marksman' ? 1.6 + Math.random() : 1.2 + Math.random() * 1.2,
      speed: baseSpeed * (role === 'breacher' ? 1.45 : role === 'marksman' ? 0.72 : 1),
      prefDist: role === 'breacher' ? 3.5 + Math.random() * 2 : role === 'marksman' ? 19 + Math.random() * 7 : 10 + Math.random() * 6,
      walkPhase: Math.random() * 6,
      flashT: 0, flashMats, fallDir: (Math.random() - 0.5) * 0.6,
      skin, seed: Math.random() * 100, fireKick: 0, hurtT: 0, hurtX: 0, hurtZ: 0,
      role,
      rag: null,
      path: [], pathI: 0, pathT: 0, pathGoal: -1,
      stuckT: 0, lastPX: 0, lastPZ: 0,
    };
    e.lastPX = model.group.position.x;
    e.lastPZ = model.group.position.z;
    this.enemies.push(e);
    this.burst(model.group.position.clone().setY(0.1), 'snow', 10, 2.4, 3, 0.5);
  }

  private killEnemy(e: Enemy, head: boolean, kx: number, kz: number) {
    e.state = 'dying';
    e.t = 0;
    e.flashT = 0;
    for (const mt of e.flashMats) mt.emissiveIntensity = 0; // no glowing corpses
    this.enemyHits = this.enemyHits.filter((m) => m.userData.eid !== e.id);

    // --- ragdoll: shot momentum + limp joints ---
    const m = e.model;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const kick = Math.hypot(kx, kz) || 1;
    const j = (o: THREE.Object3D, vSpread: number, rest: number, min: number, max: number): RagJoint => ({
      o, v: rnd(-vSpread, vSpread), rest: rest + rnd(-0.35, 0.35), min, max,
    });
    e.rag = {
      vx: (kx / kick) * rnd(1.6, 3.0), vz: (kz / kick) * rnd(1.6, 3.0),
      spin: e.fallDir * rnd(0.6, 1.6),
      y: m.pelvis.position.y, vy: rnd(0.6, 1.6), landed: false,
      faceDown: Math.random() < 0.25,
      tip: m.pelvis.rotation.x, tipV: 0,
      joints: [
        j(m.hipL, 5, 0.55, -0.35, 2.0), j(m.hipR, 5, 0.4, -0.35, 2.0),
        j(m.kneeL, 6, -0.55, -2.0, 0.35), j(m.kneeR, 6, -0.4, -2.0, 0.35),
        j(m.shoulderL, 7, -0.5, -2.4, 1.3), j(m.shoulderR, 7, -0.6, -2.4, 1.3),
        j(m.elbowL, 6, -0.7, -2.0, 0.5), j(m.elbowR, 6, -0.5, -2.0, 0.5),
        j(m.spine, 3, rnd(-0.3, 0.3), -0.7, 1.0),
        j(m.head, 8, 0.55, -0.8, 1.0),
      ],
    };
    this.kills++;
    if (head) this.headshots++;
    const gained = 100 + this.wave * 10 + (head ? 75 : 0);
    this.score += gained;
    sfx.kill();
    this.hooks.event({ type: 'kill', weapon: this.curWeapon().cfg.short, head });
    // drops
    const roll = Math.random();
    if (roll < 0.13 && this.health < 75) this.dropPickup(e.model.group.position, 'health');
    else if (roll < 0.3) this.dropPickup(e.model.group.position, 'ammo');
    this.hudDirty = true;
  }

  private dropPickup(at: THREE.Vector3, kind: 'ammo' | 'health') {
    const g = new THREE.Group();
    if (kind === 'ammo') {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.26, 0.3),
        new THREE.MeshStandardMaterial({ color: 0x2c3338, roughness: 0.6, metalness: 0.4 }),
      );
      g.add(b);
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.44, 0.08, 0.32),
        new THREE.MeshStandardMaterial({ color: 0xff9a3c, emissive: 0xff8a20, emissiveIntensity: 1.4 }),
      );
      g.add(stripe);
    } else {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.26, 0.4),
        new THREE.MeshStandardMaterial({ color: 0xdfe8ea, roughness: 0.7 }),
      );
      g.add(b);
      const crossMat = new THREE.MeshStandardMaterial({ color: 0xd92b1f, emissive: 0xb01508, emissiveIntensity: 1.1 });
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.42), crossMat);
      c1.position.y = 0.14;
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.22), crossMat);
      c2.position.y = 0.14;
      g.add(c1, c2);
    }
    g.position.set(at.x, 0.35, at.z);
    this.scene.add(g);
    this.pickups.push({ group: g, kind, t: Math.random() * 6, life: 25 });
  }

  /* ------------------------------ fx pools ------------------------------ */

  private tracer(pool: Tracer[], from: THREE.Vector3, to: THREE.Vector3) {
    let t = pool.find((x) => x.life <= 0);
    if (!t) t = pool[0];
    const mid = this.tmpV.copy(from).add(to).multiplyScalar(0.5);
    t.mesh.position.copy(mid);
    t.mesh.lookAt(to);
    const len = from.distanceTo(to);
    t.mesh.scale.set(0.022, 0.022, Math.max(0.1, len));
    t.mesh.visible = true;
    t.life = 0.07;
  }

  private burst(at: THREE.Vector3, kind: 'blood' | 'spark' | 'snow' | 'case', count: number, speed: number, grav: number, life: number) {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.pCursor];
      this.pCursor = (this.pCursor + 1) % this.particles.length;
      p.mesh.visible = true;
      p.mesh.position.copy(at);
      p.life = p.maxLife = life * (0.6 + Math.random() * 0.8);
      p.grav = grav;
      p.size = kind === 'case' ? 0.035 : 0.045 + Math.random() * 0.04;
      p.mesh.scale.setScalar(p.size);
      if (kind === 'case') {
        p.vel.set(0.9 + Math.random(), 1.6 + Math.random() * 1.4, (Math.random() - 0.5) * 1.4);
        // eject to the right of the camera
        p.vel.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      } else {
        p.vel.set(
          (Math.random() - 0.5) * speed * 2,
          Math.random() * speed,
          (Math.random() - 0.5) * speed * 2,
        );
      }
    }
  }

  private decal(point: THREE.Vector3, normal: THREE.Vector3) {
    const d = this.decals[this.dCursor];
    this.dCursor = (this.dCursor + 1) % this.decals.length;
    d.visible = true;
    d.position.copy(point).addScaledVector(normal, 0.013);
    d.lookAt(this.tmpV2.copy(point).add(normal));
  }

  /* ------------------------------ combat ------------------------------ */

  private curWeapon(): WeaponRt { return this.weapons[this.weaponIndex]; }

  private switchTo(i: number) {
    if (i === this.weaponIndex || i < 0 || i >= this.weapons.length) return;
    this.weapons[this.weaponIndex].model.group.visible = false;
    const w = this.weapons[i];
    w.reloadT = -1;
    w.aimJitX = 0;
    w.aimJitY = 0;
    w.echoT = -1;
    w.burstAcc = 0;
    w.lastFireT = -1;
    w.model.group.visible = true;
    this.weaponIndex = i;
    w.kickV = 0.8;
    sfx.switchWeapon();
    this.hudDirty = true;
  }

  private startReload() {
    const w = this.curWeapon();
    if (w.reloadT >= 0 || w.mag >= w.cfg.magSize || w.reserve <= 0) return;
    w.reloadT = 0;
    sfx.reload(w.cfg.reloadTime);
    this.hudDirty = true;
  }

  private toggleFireMode() {
    const w = this.curWeapon();
    if (!w.cfg.auto) return; // semi-only weapons have nothing to toggle
    w.mode = w.mode === 0 ? 1 : 0;
    w.burstLeft = 0;
    sfx.fireMode(w.mode === 1);
    this.hooks.event({ type: 'pickup', text: w.mode === 1 ? `${w.cfg.short} — 3-RD BURST` : `${w.cfg.short} — FULL AUTO` });
    this.hudDirty = true;
  }

  /** Quick stock-strike: staggers and damages anything in a short cone ahead. */
  private melee() {
    const w = this.curWeapon();
    if (w.meleeT > 0 || w.reloadT >= 0) return;
    w.meleeT = 0.55;
    w.meleeK = 1;
    w.kickV = 0.9;

    const fwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    fwd.y = 0;
    fwd.normalize();
    let connected = false;
    for (const e of this.enemies) {
      if (e.state !== 'live') continue;
      const gp = e.model.group.position;
      const dx = gp.x - this.pos.x, dz = gp.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.4) continue;
      const dot = (dx / (d || 1)) * fwd.x + (dz / (d || 1)) * fwd.z;
      if (dot < 0.55) continue; // must be roughly in front
      connected = true;
      this.damageEnemy(e, 60, false, gp.clone().setY(1.1));
      // knock them back harder than a bullet would
      e.hurtT = 1.4;
      e.hurtX = (dx / (d || 1)) * 2.4;
      e.hurtZ = (dz / (d || 1)) * 2.4;
    }
    sfx.melee(connected);
    this.shake = Math.min(1.0, this.shake + 0.16);
  }

  private tryFire() {
    const w = this.curWeapon();
    if (w.cooldown > 0 || w.reloadT >= 0) return;
    if (w.mag <= 0) {
      sfx.empty();
      this.startReload();
      w.cooldown = 0.25;
      return;
    }
    w.mag--;
    w.cooldown = w.cfg.fireDelay;
    w.heat = Math.min(1, w.heat + (w.cfg.auto ? 0.11 : 0.2));
    this.shotsFired++;

    // --- recoil: one deterministic step of the pattern, + tiny noise ---
    const m = w.cfg.recoil;
    const imp = w.cfg.kick * m.caliberImpulse;
    const brace = this.ads ? m.adsBrace : 1;

    // a lull longer than the recovery delay means the pattern restarts at shot 1
    if (this.simT - w.lastFireT > m.recovDelay + 0.05) w.burstAcc = 0;
    w.lastFireT = this.simT;
    const n = w.burstAcc++;
    const mv = 1 + (Math.random() - 0.5) * m.varRange; // ±5–7% magnitude life, nothing wild
    this.recTgtP += imp * m.patternPitch[n % m.patternPitch.length] * brace * mv;
    this.recTgtY +=
      imp * m.patternYaw[n % m.patternYaw.length] * brace * mv +
      imp * m.noise * (Math.random() - 0.5) * brace; // small yaw scatter around the line

    const weightShake = 1.12 / Math.sqrt(m.weightKg); // heavier guns rattle the shooter less
    this.shake = Math.min(1.0, this.shake + imp * (m.stock ? 7.5 : 11) * weightShake * brace);
    this.fovKick = Math.min(1.8, this.fovKick + imp * (m.stock ? 23.5 : 20.7) * brace);
    w.kickV = 0.9 + Math.random() * 0.2; // muzzle flip — mostly consistent, a hint of life
    w.kickVar = 0.92 + Math.random() * 0.16;
    // action-cycle echo: deterministic timing, purely visual — the slide snaps / bolt slaps,
    // but it never nudges a bullet already in flight logic
    w.echoT = m.action === 'slide' ? 0.075 : 0.045;
    w.echoMag = m.action === 'slide' ? -(imp * 0.28 * brace) : imp * 0.16 * brace;

    // --- random dispersion (the part the crosshair honestly reports): spread + heat + movement ---
    const speedXZ = Math.hypot(this.vel.x, this.vel.z);
    const bloom =
      (w.cfg.spread + w.heat * w.cfg.bloom + Math.min(0.03, speedXZ * 0.0035) * (w.cfg.moveSpread / 0.022)) *
      (this.ads ? 0.24 : 1) *
      (this.grounded ? 1 : 1.6);
    w.aimJitX = (Math.random() - 0.5) * 2 * bloom * (0.5 + Math.random() * 0.8);
    w.aimJitY = (Math.random() - 0.5) * 2 * bloom * (0.5 + Math.random() * 0.8);

    sfx.shoot(w.cfg.id as 'pistol' | 'smg', this.ads);
    w.model.flash.visible = true;
    (w.model.flash.material as THREE.SpriteMaterial).rotation = Math.random() * Math.PI;
    this.flashT = 0.045;
    this.gunLight.intensity = 26;

    // casing
    this.burst(this.tmpV2.copy(this.pos).add(new THREE.Vector3(0.15, -0.15, -0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw)), 'case', 1, 1, 10, 0.7);

    // --- hitscan: straight line out of the muzzle, exactly where the barrel points ---
    const muzzleP = w.model.muzzle.getWorldPosition(this.tmpV).clone();
    const dir = new THREE.Vector3();
    w.model.muzzle.getWorldDirection(dir);
    dir.normalize();
    this.raycaster.set(muzzleP, dir);
    this.raycaster.far = 150;
    const targets = this.solidMeshes.concat(this.enemyHits);
    const hits = this.raycaster.intersectObjects(targets, false);

    let end: THREE.Vector3;
    if (hits.length > 0) {
      const h = hits[0];
      end = h.point;
      const ud = h.object.userData as { eid?: number; part?: string; kind?: string };
      if (ud.eid !== undefined) {
        const enemy = this.enemies.find((e) => e.id === ud.eid && e.state !== 'dying');
        if (enemy) {
          this.shotsHit++;
          const head = ud.part === 'head';
          this.damageEnemy(enemy, w.cfg.dmg * (head ? w.cfg.headMul : 1), head, h.point);
        }
      } else {
        if (ud.kind === 'floor') {
          this.burst(h.point, 'snow', 7, 1.6, 4, 0.45);
        } else {
          this.burst(h.point, 'spark', 6, 2.4, 6, 0.35);
          if (h.face) {
            const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
            this.decal(h.point, n);
          }
        }
        sfx.impact();
      }
    } else {
      end = muzzleP.clone().addScaledVector(dir, 120);
    }
    this.tracer(this.tracersP, muzzleP, end);
    this.hudDirty = true;
  }

  private damageEnemy(e: Enemy, dmg: number, head: boolean, point: THREE.Vector3) {
    if (e.state === 'dying') return;
    e.hp -= dmg;
    e.flashT = 0.1;
    // hit reaction: flinch and stagger away from the shooter
    e.hurtT = 1;
    const hx = e.model.group.position.x - this.pos.x;
    const hz = e.model.group.position.z - this.pos.z;
    const hl = Math.hypot(hx, hz) || 1;
    e.hurtX = (hx / hl) * (0.7 + Math.random() * 0.5);
    e.hurtZ = (hz / hl) * (0.7 + Math.random() * 0.5);
    this.burst(point, 'blood', head ? 12 : 8, 2.6, 7, 0.5);
    const killed = e.hp <= 0;
    sfx.hit(head);
    this.hooks.event({ type: 'hit', kill: killed, head });
    if (killed) this.killEnemy(e, head, hx / hl, hz / hl);
  }

  private damagePlayer(d: number) {
    if (this.phase !== 'playing') return;
    this.health = Math.max(0, this.health - d);
    this.lastDamageT = this.simT; // regen clock resets on every hit
    this.shake = Math.min(1.0, this.shake + 0.28);
    sfx.hurt();
    this.hooks.event({ type: 'damage' });
    this.hudDirty = true;
    if (this.health <= 0) this.gameOver();
  }

  private gameOver() {
    this.phase = 'gameover';
    this.gunRig.visible = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    sfx.death();
    this.hooks.event({
      type: 'gameover',
      stats: {
        score: this.score, kills: this.kills, headshots: this.headshots, wave: this.wave,
        accuracy: this.shotsFired > 0 ? this.shotsHit / this.shotsFired : 0,
        time: this.runTime,
      },
    });
    this.pushHud();
  }

  /* ------------------------------ enemy fire ------------------------------ */

  private enemyFire(e: Enemy) {
    const muzzlePos = e.model.muzzle.getWorldPosition(new THREE.Vector3());
    const base = this.pos.clone();
    base.y -= 0.25;
    const dist = muzzlePos.distanceTo(base);

    e.model.flash.visible = true;
    setTimeout(() => { e.model.flash.visible = false; }, 55);

    if (e.role === 'breacher') {
      sfx.enemyShotgun(dist);
      e.fireKick = 1.3;
      for (let k = 0; k < 6; k++) {
        this.enemyShot(muzzlePos, base, dist, 0.17, () => Math.round(3 + Math.random() * 4 + Math.min(6, this.wave)));
      }
    } else if (e.role === 'marksman') {
      sfx.enemyMarksman(dist);
      e.fireKick = 1.1;
      this.enemyShot(muzzlePos, base, dist, 0.012, () => Math.round(10 + Math.random() * 6 + Math.min(12, this.wave)));
    } else {
      sfx.enemyShoot(dist);
      e.fireKick = 1;
      this.enemyShot(muzzlePos, base, dist, 1.0, () => Math.round(5 + Math.random() * 4 + Math.min(9, this.wave)));
    }
  }

  /** One hitscan pellet: spread tracer, cover interception, and a hit roll. */
  private enemyShot(muzzlePos: THREE.Vector3, base: THREE.Vector3, dist: number, spreadMul: number, dmgRoll: () => number) {
    const target = base.clone();
    const errScale = dist * 0.055 * (1 + Math.random()) * spreadMul;
    target.x += (Math.random() - 0.5) * errScale;
    target.y += (Math.random() - 0.5) * errScale * 0.5;
    target.z += (Math.random() - 0.5) * errScale;
    this.tracer(this.tracersE, muzzlePos, target);

    // does cover intercept?
    const dirTo = this.tmpV2.copy(target).sub(muzzlePos).normalize();
    this.raycaster.set(muzzlePos, dirTo);
    this.raycaster.far = dist;
    const blockers = this.raycaster.intersectObjects(this.solidMeshes, false);
    if (blockers.length > 0 && blockers[0].distance < dist - 0.4) {
      const h = blockers[0];
      this.burst(h.point, 'spark', 4, 2.2, 6, 0.3);
      if (h.face) this.decal(h.point, h.face.normal.clone().transformDirection(h.object.matrixWorld));
      return; // saved by cover
    }
    const speedXZ = Math.hypot(this.vel.x, this.vel.z);
    const accMul = spreadMul > 1 ? 0.75 : spreadMul < 0.5 ? 1.15 : 1;
    const p = Math.max(0.08, Math.min(0.6, (0.52 - dist * 0.011 - speedXZ * 0.04 + this.wave * 0.012) * accMul));
    if (Math.random() < p) {
      this.damagePlayer(dmgRoll());
      this.burst(this.tmpV.copy(this.pos).setY(this.pos.y - 0.5), 'blood', 4, 2, 7, 0.4);
    }
  }

  private enemyLos(e: Enemy): boolean {
    const from = e.model.head.getWorldPosition(this.tmpV);
    const to = this.pos;
    const dist = from.distanceTo(to);
    const dir = this.tmpV2.copy(to).sub(from).normalize();
    this.raycaster.set(from, dir);
    this.raycaster.far = dist - 0.3;
    return this.raycaster.intersectObjects(this.solidMeshes, false).length === 0;
  }

  /* ------------------------------ update ------------------------------ */

  private tick(dt: number, t: number) {
    if (this.phase === 'playing') {
      this.simT += dt;
      this.astarBudget = 3; // a few path queries per frame keeps wave-start spikes smooth
      this.updatePlayer(dt, t);
      this.updateWeapons(dt);
      this.updateEnemies(dt);
      this.updateWaves(dt);
      this.updatePickups(dt);
      this.runTime += dt;
    } else if (this.phase === 'menu') {
      this.menuAngle += dt * 0.07;
      this.camera.position.set(Math.sin(this.menuAngle) * 21, 5.4 + Math.sin(t * 0.25) * 1.2, Math.cos(this.menuAngle) * 15);
      this.camera.lookAt(0, 1.8, 0);
    }
    this.updateAmbient(dt, t);
    this.renderer.render(this.scene, this.camera);

    this.hudAcc += dt;
    if (this.hudAcc > 0.08 || this.hudDirty) {
      this.hudAcc = 0;
      this.pushHud();
    }
  }

  private updatePlayer(dt: number, t: number) {
    // out-of-combat regen: 5s after the last hit, vitals restore at 26/s
    if (this.health > 0 && this.health < 100 && this.simT - this.lastDamageT > 5) {
      this.health = Math.min(100, this.health + 26 * dt);
      this.hudDirty = true;
    }

    const sprint = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);
    const wantAds = this.ads && this.curWeapon().reloadT < 0;
    const speedBase = (sprint && !wantAds ? 6.3 : 4.3) * (wantAds ? 0.55 : 1);

    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    if (this.keys['KeyW']) wish.add(fwd);
    if (this.keys['KeyS']) wish.sub(fwd);
    if (this.keys['KeyD']) wish.add(right);
    if (this.keys['KeyA']) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speedBase);

    const accel = this.grounded ? 11 : 2.5;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, accel * dt);

    if (this.keys['Space'] && this.grounded) {
      this.vel.y = 4.9;
      this.grounded = false;
    }
    this.vel.y -= GRAV * dt;

    // integrate + collide (axis separated)
    const r = 0.45;
    const tryAxis = (axis: 'x' | 'z', delta: number) => {
      let next = this.pos[axis] + delta;
      for (const box of this.colliderBoxes) {
        const inZ = axis === 'x'
          ? this.pos.z > box.min.z - r && this.pos.z < box.max.z + r
          : next > box.min.z - r && next < box.max.z + r;
        const inX = axis === 'x'
          ? next > box.min.x - r && next < box.max.x + r
          : this.pos.x > box.min.x - r && this.pos.x < box.max.x + r;
        const inY = this.pos.y - EYE < box.max.y && this.pos.y > box.min.y;
        if (inX && inZ && inY) {
          if (axis === 'x') next = delta > 0 ? Math.min(next, box.min.x - r) : Math.max(next, box.max.x + r);
          else next = delta > 0 ? Math.min(next, box.min.z - r) : Math.max(next, box.max.z + r);
        }
      }
      this.pos[axis] = next;
    };
    tryAxis('x', this.vel.x * dt);
    tryAxis('z', this.vel.z * dt);
    this.pos.x = Math.max(-YARD_W + 0.9, Math.min(YARD_W - 0.9, this.pos.x));
    this.pos.z = Math.max(-YARD_D + 0.9, Math.min(YARD_D - 0.9, this.pos.z));

    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= EYE) {
      if (!this.grounded && this.vel.y < -4) this.shake = Math.min(1, this.shake + 0.12);
      this.pos.y = EYE;
      this.vel.y = 0;
      this.grounded = true;
    }

    // head bob + footsteps
    const speedXZ = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && speedXZ > 1.2) {
      this.bobPhase += speedXZ * dt * 1.35;
      const step = Math.floor(this.bobPhase / Math.PI);
      if (step !== this.prevBobStep) {
        this.prevBobStep = step;
        sfx.step();
      }
    }
    const bobAmp = Math.min(1, speedXZ / 5) * (this.grounded ? 1 : 0);
    const bobY = Math.sin(this.bobPhase * 2) * 0.028 * bobAmp;
    const bobX = Math.cos(this.bobPhase) * 0.016 * bobAmp;

    // recoil relaxes ONLY during a lull after the last shot — never while the trigger is held,
    // so sustained fire climbs exactly as much as you let it (that is the skill)
    const cw = this.curWeapon();
    const rm = cw.cfg.recoil;
    const idleFor = this.simT - cw.lastFireT;
    if (idleFor > rm.recovDelay) {
      const recMul = this.ads ? 1.6 : 1; // braced sights settle back faster
      this.recTgtP *= Math.exp(-rm.recovPitch * recMul * dt);
      this.recTgtY *= Math.exp(-rm.recovYaw * recMul * dt);
    }
    this.shake *= Math.exp(-9 * dt);
    this.fovKick *= Math.exp(-9 * dt);

    // the camera snaps to the recoil offset quickly (~40ms attack) — punchy, never teleported
    const att = Math.min(1, dt * 26);
    this.recP += (this.recTgtP - this.recP) * att;
    this.recY += (this.recTgtY - this.recY) * att;

    // camera (low-frequency, small-amplitude punch — never a tremor; no roll from recoil)
    const shX = Math.sin(t * 53) * this.shake * 0.005;
    const shY = Math.cos(t * 47) * this.shake * 0.005;
    const shZ = Math.sin(t * 49) * this.shake * 0.0035;
    this.camera.position.set(this.pos.x + bobX * Math.cos(this.yaw), this.pos.y + bobY, this.pos.z - bobX * Math.sin(this.yaw));
    this.camera.rotation.set(this.pitch + this.recP + shX, this.yaw + this.recY + shY, shZ);

    // fov
    const w = this.curWeapon();
    const fovT = (wantAds ? w.cfg.adsFov : 75) + this.fovKick;
    this.camera.fov += (fovT - this.camera.fov) * Math.min(1, dt * 14);
    this.camera.updateProjectionMatrix();

    // weapon rig placement (sway + bob + kick)
    this.swayX += ((-this.swayMX * 0.0004) - this.swayX) * Math.min(1, dt * 10);
    this.swayMX *= Math.exp(-12 * dt);
    this.swayY += ((Math.abs(this.swayMX) * 0.00012) - this.swayY) * Math.min(1, dt * 10);
    const adsK = wantAds ? 0.34 : 1;
    const m = w.cfg.recoil; // stock/grip/action shape how the gun moves in the hands
    const anchor = wantAds ? w.cfg.ads : w.cfg.hip;
    const lerpF = Math.min(1, dt * (wantAds ? 13 : 10));
    const g = w.model.group;

    // simple reload animation: dip + roll toward the off-hand, sine envelope (no mag mesh animation)
    const rp = w.reloadT >= 0 ? Math.min(1, w.reloadT / w.cfg.reloadTime) : -1;
    const re = rp >= 0 ? Math.sin(Math.PI * rp) : 0;
    const reJerk = rp >= 0 && (rp < 0.12 || rp > 0.85) ? Math.sin(rp * 140) * 0.006 : 0;

    g.position.x += (anchor.x + this.swayX + bobX * 0.5 - re * 0.058 - g.position.x) * lerpF;
    // smoothed muzzle flip (ramps in, per-shot magnitude)
    w.kickVis += (w.kickV - w.kickVis) * Math.min(1, dt * 16);
    const kv = w.kickVis * w.kickVar;
    // a stock pivots the gun and absorbs flip; a stockless slide pistol whips up and jumps back.
    // braced in ADS the flip is heavily suppressed so the sight picture stays on target
    const flipMul = m.stock ? 0.75 : 1.15;
    const kvAds = wantAds ? 0.38 : 1;
    const mk = w.meleeK; // melee jab: drives the gun forward and dips the muzzle
    g.position.y += (anchor.y + this.swayY * 0.5 + bobY * 0.6 - kv * 0.02 * flipMul * kvAds - re * 0.085 + reJerk - mk * 0.04 - g.position.y) * lerpF;
    g.position.z += (anchor.z + kv * (m.stock ? 0.055 : 0.115) * kvAds + re * 0.05 - mk * 0.2 - g.position.z) * lerpF;
    // aim error is baked into the barrel: the gun visibly whips off-aim where the bullet actually goes
    g.rotation.x = kv * (m.stock ? 0.085 : 0.21) * (m.action === 'slide' ? 1.1 : 1) * kvAds - w.aimJitX * adsK - re * 0.6 - mk * 0.5;
    // torque twist is cosmetic — the camera itself never rolls from recoil
    g.rotation.z = this.swayX * 1.6 + Math.sin(this.simT * 42) * kv * 0.025 * m.rollAmp - re * 0.52;
    g.rotation.y = this.swayX * 1.1 + w.aimJitY * adsK + re * 0.24;
    w.kickV *= Math.exp(-10 * dt);
  }

  private updateWeapons(dt: number) {
    const w = this.curWeapon();
    w.cooldown -= dt;
    w.heat = Math.max(0, w.heat - dt * (w.cfg.auto ? 0.55 : 0.8));
    // a braced sight picture settles between shots — aim error decays much faster in ADS
    const jitDecay = this.ads ? 8.5 : 2.4;
    w.aimJitX *= Math.exp(-jitDecay * dt);
    w.aimJitY *= Math.exp(-jitDecay * dt);
    // mechanical echo: small secondary jolt shortly after the action cycles
    if (w.echoT >= 0) {
      w.echoT -= dt;
      if (w.echoT < 0) {
        // purely mechanical dressing: the muzzle snaps as the action cycles — ballistics untouched
        w.kickV = Math.max(-0.6, Math.min(1.2, w.kickV + (w.echoMag > 0 ? 0.14 : -0.2)));
        this.shake = Math.min(1.0, this.shake + Math.abs(w.echoMag) * 1.6);
      }
    }
    if (w.reloadT >= 0) {
      w.reloadT += dt;
      this.hudDirty = true;
      if (w.reloadT >= w.cfg.reloadTime) {
        const take = Math.min(w.reserve, w.cfg.magSize - w.mag);
        w.mag += take;
        w.reserve -= take;
        w.reloadT = -1;
        w.kickV = 0.7;
        this.hudDirty = true;
      }
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) w.model.flash.visible = false;
    }
    this.gunLight.intensity *= Math.exp(-28 * dt);

    w.meleeT = Math.max(0, w.meleeT - dt);
    w.meleeK = Math.max(0, w.meleeK - dt * 3.2);

    if (!w.cfg.auto) {
      if (this.firePressed) { this.firePressed = false; this.tryFire(); }
    } else if (w.mode === 0) {
      // full-auto: hold to pour it on
      if (this.mouseDown || this.firePressed) this.tryFire();
      this.firePressed = false;
    } else {
      // 3-round burst: one trigger pull queues a burst, then a beat before the next
      if (this.firePressed) {
        this.firePressed = false;
        if (w.burstLeft <= 0 && w.cooldown <= 0) w.burstLeft = 3;
      }
      if (w.burstLeft > 0 && w.cooldown <= 0) {
        this.tryFire();
        w.burstLeft--;
        if (w.burstLeft === 0) w.cooldown = Math.max(w.cooldown, 0.30);
      }
    }
  }

  /** Slide from (ox,oz) to (nx,nz) without penetrating any solid collider. */
  private collideClamp(ox: number, oz: number, nx: number, nz: number, r: number): [number, number] {
    const dx = nx - ox, dz = nz - oz;
    for (const box of this.colliderBoxes) {
      if (oz > box.min.z - r && oz < box.max.z + r && nx > box.min.x - r && nx < box.max.x + r) {
        nx = dx > 0 ? Math.min(nx, box.min.x - r) : Math.max(nx, box.max.x + r);
      }
      if (ox > box.min.x - r && ox < box.max.x + r && nz > box.min.z - r && nz < box.max.z + r) {
        nz = dz > 0 ? Math.min(nz, box.min.z - r) : Math.max(nz, box.max.z + r);
      }
    }
    return [nx, nz];
  }

  /* ------------------------------ pathfinding ------------------------------ */

  private buildPathGrid() {
    this.pathCols = Math.ceil((YARD_W * 2) / Engine.CELL);
    this.pathRows = Math.ceil((YARD_D * 2) / Engine.CELL);
    const n = this.pathCols * this.pathRows;
    this.pathBlocked = new Uint8Array(n);
    const inf = 0.55; // inflate solids so bodies don't scrape corners
    for (const b of this.colliderBoxes) {
      const x0 = Math.max(0, Math.floor((b.min.x - inf + YARD_W) / Engine.CELL));
      const x1 = Math.min(this.pathCols - 1, Math.floor((b.max.x + inf + YARD_W) / Engine.CELL));
      const z0 = Math.max(0, Math.floor((b.min.z - inf + YARD_D) / Engine.CELL));
      const z1 = Math.min(this.pathRows - 1, Math.floor((b.max.z + inf + YARD_D) / Engine.CELL));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.pathBlocked[z * this.pathCols + x] = 1;
    }
    this.pfG = new Float32Array(n);
    this.pfF = new Float32Array(n);
    this.pfFrom = new Int32Array(n);
    this.pfClosed = new Uint8Array(n);
  }

  private cellIndex(x: number, z: number): number {
    const cx = Math.max(0, Math.min(this.pathCols - 1, Math.floor((x + YARD_W) / Engine.CELL)));
    const cz = Math.max(0, Math.min(this.pathRows - 1, Math.floor((z + YARD_D) / Engine.CELL)));
    return cz * this.pathCols + cx;
  }
  private cellX(i: number) { return ((i % this.pathCols) + 0.5) * Engine.CELL - YARD_W; }
  private cellZ(i: number) { return (Math.floor(i / this.pathCols) + 0.5) * Engine.CELL - YARD_D; }

  /** nearest walkable cell (expanding ring search) — spawn/player cells may sit on an edge */
  private nearestOpen(i: number): number {
    if (i < 0) return -1;
    if (!this.pathBlocked[i]) return i;
    const C = this.pathCols, R = this.pathRows;
    const cx = i % C, cz = Math.floor(i / C);
    for (let r = 1; r <= 4; r++) {
      for (let z = -r; z <= r; z++) {
        for (let x = -r; x <= r; x++) {
          if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue;
          const nx = cx + x, nz = cz + z;
          if (nx < 0 || nz < 0 || nx >= C || nz >= R) continue;
          const ni = nz * C + nx;
          if (!this.pathBlocked[ni]) return ni;
        }
      }
    }
    return -1;
  }

  private pfHeur(a: number, b: number) {
    const C = this.pathCols;
    const dx = Math.abs((a % C) - (b % C));
    const dz = Math.abs(Math.floor(a / C) - Math.floor(b / C));
    return dx + dz - 0.58 * Math.min(dx, dz); // octile distance
  }

  /** A* over the nav grid, 8-way, no corner cutting. Returns waypoint cell indices (start→goal). */
  private findPath(sx: number, sz: number, tx: number, tz: number): number[] {
    if (!this.pathBlocked) return [];
    const C = this.pathCols, R = this.pathRows;
    const start = this.nearestOpen(this.cellIndex(sx, sz));
    const goal = this.nearestOpen(this.cellIndex(tx, tz));
    if (start < 0 || goal < 0) return [];
    if (start === goal) return [goal];
    const g = this.pfG, f = this.pfF, from = this.pfFrom, closed = this.pfClosed;
    g.fill(Infinity);
    closed.fill(0);
    from.fill(-1);
    const open: number[] = [start];
    g[start] = 0;
    f[start] = this.pfHeur(start, goal);
    const DX = [1, -1, 0, 0, 1, 1, -1, -1];
    const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
    const COST = [1, 1, 1, 1, 1.42, 1.42, 1.42, 1.42];
    let guard = 0;
    while (open.length > 0 && guard++ < 5000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) {
        const path: number[] = [];
        let c = cur;
        while (c !== -1) { path.push(c); c = from[c]; }
        return path.reverse();
      }
      closed[cur] = 1;
      const cx = cur % C, cz = Math.floor(cur / C);
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d], nz = cz + DZ[d];
        if (nx < 0 || nz < 0 || nx >= C || nz >= R) continue;
        const ni = nz * C + nx;
        if (this.pathBlocked[ni] || closed[ni]) continue;
        if (d >= 4 && (this.pathBlocked[cz * C + nx] || this.pathBlocked[nz * C + cx])) continue;
        const ng = g[cur] + COST[d];
        if (ng < g[ni]) {
          g[ni] = ng;
          from[ni] = cur;
          f[ni] = ng + this.pfHeur(ni, goal);
          if (!open.includes(ni)) open.push(ni);
        }
      }
    }
    return [];
  }

  private updateEnemies(dt: number) {
    const playerXZ = this.tmpV.set(this.pos.x, 0, this.pos.z);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const gp = e.model.group.position;

      if (e.state === 'dying') {
        e.t += dt;
        const m = e.model;
        const r = e.rag;
        if (!r) { this.scene.remove(m.group); this.enemies.splice(i, 1); continue; }

        // body slides away from the shooter, scraping off speed on the ground
        const [sx, sz] = this.collideClamp(gp.x, gp.z, gp.x + r.vx * dt, gp.z + r.vz * dt, 0.4);
        gp.x = Math.max(-YARD_W + 1, Math.min(YARD_W - 1, sx));
        gp.z = Math.max(-YARD_D + 1, Math.min(YARD_D - 1, sz));
        const fr = Math.exp(-3.2 * dt);
        r.vx *= fr; r.vz *= fr;
        m.group.rotation.y += r.spin * dt;
        r.spin *= Math.exp(-2.4 * dt);

        // pelvis drops under gravity, hits the deck, bounces once
        r.vy -= 11 * dt;
        r.y += r.vy * dt;
        if (r.y <= 0.26) {
          r.y = 0.26;
          if (!r.landed) {
            r.landed = true;
            this.burst(gp.clone().setY(0.08), 'snow', 7, 1.8, 2.2, 0.4);
          } else if (r.vy < -1.2) {
            r.vy = -r.vy * 0.28;
          } else {
            r.vy = 0;
          }
        }
        m.pelvis.position.y = r.y;

        // torso tips over (mostly flat on the back, sometimes face-down)
        const tipRest = r.faceDown ? 1.28 : -1.3;
        r.tipV += (tipRest - r.tip) * 7.5 * dt;
        r.tipV *= Math.exp(-2.1 * dt);
        r.tip += r.tipV * dt;
        m.pelvis.rotation.x = r.tip;
        m.pelvis.rotation.z = 0;

        // joints: kicked by the shot, then damped springs flop to limp rests
        for (const jnt of r.joints) {
          jnt.v += (jnt.rest - jnt.o.rotation.x) * 9 * dt;
          jnt.v *= Math.exp(-2.7 * dt);
          jnt.o.rotation.x = Math.max(jnt.min, Math.min(jnt.max, jnt.o.rotation.x + jnt.v * dt));
        }
        m.head.rotation.y *= Math.exp(-3 * dt); // neck goes slack
        m.rifle.visible = e.t < 0.35; // gun is flung clear

        if (e.t > 5) gp.y -= dt * 0.5; // the storm slowly claims the body
        if (e.t > 7.5 || gp.y < -1.4) {
          this.scene.remove(m.group);
          this.enemies.splice(i, 1);
        }
        continue;
      }

      if (e.state === 'rise') {
        e.t += dt * 1.6;
        const t = Math.min(1, e.t);
        gp.y = THREE.MathUtils.lerp(-1.5, 0, t);
        const m = e.model;
        const c = 1 - t; // crouch: hauling themselves out of the snow
        m.pelvis.rotation.x = -c * 0.75;
        m.spine.rotation.x = c * 0.45;
        m.kneeL.rotation.x = c * 0.85;
        m.kneeR.rotation.x = c * 0.85;
        m.shoulderL.rotation.x = -1.1 - c * 0.3;
        m.shoulderR.rotation.x = -1.35 - c * 0.25;
        m.head.rotation.x = c * 0.6; // eyes down while climbing out
        if (e.t >= 1) {
          e.state = 'live'; gp.y = 0;
          m.pelvis.rotation.x = 0; m.spine.rotation.x = 0;
          m.kneeL.rotation.x = 0; m.kneeR.rotation.x = 0;
          m.head.rotation.x = 0;
        }
        continue;
      }

      // --- live AI ---
      const dx = this.pos.x - gp.x;
      const dz = this.pos.z - gp.z;
      const dist = Math.hypot(dx, dz);
      const los = dist < 46 && this.enemyLos(e);

      // strafe timer
      e.strafeT -= dt;
      if (e.strafeT <= 0) {
        e.strafeT = 1 + Math.random() * 1.6;
        e.strafeDir *= -1;
      }

      // --- pathfinding: route around walls/cover instead of grinding into them ---
      const goalCell = this.cellIndex(this.pos.x, this.pos.z);
      e.pathT -= dt;
      const stale = e.path.length === 0 || e.pathI >= e.path.length || e.pathT <= 0 ||
        (e.pathGoal >= 0 && Math.abs((e.pathGoal % this.pathCols) - (goalCell % this.pathCols)) +
          Math.abs(Math.floor(e.pathGoal / this.pathCols) - Math.floor(goalCell / this.pathCols)) > 3);
      if (stale && this.astarBudget > 0) {
        this.astarBudget--;
        e.path = this.findPath(gp.x, gp.z, this.pos.x, this.pos.z);
        e.pathI = e.path.length > 1 ? 1 : 0;
        e.pathGoal = goalCell;
        e.pathT = 0.5 + Math.random() * 0.35;
      }

      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      // desired travel direction: follow the route, blend to the direct line when close & visible
      let dirX = nx, dirZ = nz;
      if (e.path.length > 0 && e.pathI < e.path.length) {
        const wx = this.cellX(e.path[e.pathI]), wz = this.cellZ(e.path[e.pathI]);
        const wdx = wx - gp.x, wdz = wz - gp.z;
        const wd = Math.hypot(wdx, wdz);
        if (wd < 1.15) e.pathI++;
        else { dirX = wdx / wd; dirZ = wdz / wd; }
      }
      if (los && dist < 9) {
        const b = 0.72;
        dirX = dirX * (1 - b) + nx * b;
        dirZ = dirZ * (1 - b) + nz * b;
        const dl = Math.hypot(dirX, dirZ) || 1;
        dirX /= dl; dirZ /= dl;
      }

      const approach = dist > e.prefDist + 1.5 ? 1 : dist < e.prefDist - 2 ? -0.7 : 0.15;
      const strafeW = los ? 0.6 : 1.0;
      let mx = dirX * approach + -nz * e.strafeDir * strafeW;
      let mz = dirZ * approach + nx * e.strafeDir * strafeW;
      const ml = Math.hypot(mx, mz) || 1;
      mx = (mx / ml) * e.speed;
      mz = (mz / ml) * e.speed;

      // separation
      for (const o of this.enemies) {
        if (o === e || o.state === 'dying') continue;
        const sx = gp.x - o.model.group.position.x;
        const sz = gp.z - o.model.group.position.z;
        const sd = Math.hypot(sx, sz);
        if (sd < 1.5 && sd > 0.001) {
          mx += (sx / sd) * 1.6;
          mz += (sz / sd) * 1.6;
        }
      }

      // integrate with collisions
      const r = 0.42;
      const [nx2, nz2] = this.collideClamp(gp.x, gp.z, gp.x + mx * dt, gp.z + mz * dt, r);
      gp.x = Math.max(-YARD_W + 1, Math.min(YARD_W - 1, nx2));
      gp.z = Math.max(-YARD_D + 1, Math.min(YARD_D - 1, nz2));
      e.model.group.rotation.y = Math.atan2(dx, dz);

      // stuck watchdog: if barely moving while it wants to, drop the route and repath next frame
      e.stuckT += dt;
      if (e.stuckT > 0.7) {
        const moved = Math.hypot(gp.x - e.lastPX, gp.z - e.lastPZ);
        if (moved < 0.4) { e.pathT = 0; e.path = []; }
        e.lastPX = gp.x; e.lastPZ = gp.z; e.stuckT = 0;
      }

      // --- skeletal animation ---
      const m = e.model;
      const moving = Math.hypot(mx, mz) > 0.4;
      e.walkPhase += (moving ? e.speed : 0.6) * dt * 2.7;
      const sw = Math.sin(e.walkPhase);
      const stride = moving ? 1 : 0;
      m.hipL.rotation.x = sw * 0.62 * stride;
      m.hipR.rotation.x = -sw * 0.62 * stride;
      m.kneeL.rotation.x = Math.max(0, -Math.sin(e.walkPhase - 0.6)) * 0.85 * stride + 0.06;
      m.kneeR.rotation.x = Math.max(0, Math.sin(e.walkPhase - 0.6)) * 0.85 * stride + 0.06;
      gp.y = Math.abs(Math.cos(e.walkPhase)) * 0.05 * stride; // body bounce
      m.pelvis.rotation.y = sw * 0.14 * stride; // hip twist
      m.pelvis.rotation.z = Math.sin(this.simT * 1.2 + e.seed) * 0.035; // weight shift
      m.spine.rotation.y = -sw * 0.1 * stride;
      m.spine.rotation.x = Math.sin(this.simT * 2.1 + e.seed) * 0.025; // breathing

      // aim: head tracks with lazy saccades, rifle held high-ready
      m.head.rotation.y = Math.sin(this.simT * 0.9 + e.seed * 3) * 0.24 + e.strafeDir * 0.09;
      m.head.rotation.x = Math.sin(this.simT * 1.4 + e.seed) * 0.05 + e.fireKick * 0.07;
      m.shoulderR.rotation.x = -1.35 - e.fireKick * 0.24; // shoulder absorbs each shot
      m.shoulderR.rotation.y = -0.12 + Math.sin(e.walkPhase * 0.5) * 0.03 * stride;
      m.elbowR.rotation.x = -0.5 - e.fireKick * 0.1;
      m.shoulderL.rotation.x = -1.1 + Math.sin(e.walkPhase + Math.PI) * 0.06 * stride;
      m.rifle.position.z = m.rifleZ - e.fireKick * 0.07; // rifle punches back
      m.rifle.rotation.x = -e.fireKick * 0.09;
      e.fireKick = Math.max(0, e.fireKick - dt * 9);

      // hit reaction: spine snaps back, head whips, body staggers away from the shooter
      if (e.hurtT > 0) {
        e.hurtT -= dt * 3.2;
        m.spine.rotation.x += e.hurtT * 0.38;
        m.head.rotation.x -= e.hurtT * 0.3;
        // stagger shoves must respect cover too — no clipping into crates
        const [hx2, hz2] = this.collideClamp(
          gp.x, gp.z,
          gp.x + e.hurtX * e.hurtT * dt * 2.4,
          gp.z + e.hurtZ * e.hurtT * dt * 2.4,
          0.42,
        );
        gp.x = Math.max(-YARD_W + 1, Math.min(YARD_W - 1, hx2));
        gp.z = Math.max(-YARD_D + 1, Math.min(YARD_D - 1, hz2));
      }

      // hit flash decay
      if (e.flashT > 0) {
        e.flashT -= dt;
        const k = Math.max(0, e.flashT / 0.1) * 1.1;
        for (const m of e.flashMats) m.emissiveIntensity = k;
      }

      // --- firing (role-driven cadence) ---
      e.shotT -= dt;
      if (e.shotT <= 0 && e.burst <= 0) {
        if (los) {
          if (e.role === 'breacher') {
            if (dist < 9.5) { e.burst = 1; e.burstT = 0.1; }
            e.shotT = 0.85 + Math.random() * 0.5;
          } else if (e.role === 'marksman') {
            if (dist > 3) { e.burst = 1; e.burstT = 0.3; }
            e.shotT = Math.max(1.6, 2.6 - this.wave * 0.06) + Math.random() * 0.8;
          } else {
            if (dist > 3) {
              e.burst = 2 + Math.floor(Math.random() * 3) + Math.min(2, Math.floor(this.wave / 3));
              e.burstT = 0.12;
            }
            e.shotT = Math.max(0.95, 1.9 - this.wave * 0.07) + Math.random() * 0.9;
          }
        } else {
          e.shotT = 0.5;
        }
      }
      if (e.burst > 0) {
        e.burstT -= dt;
        if (e.burstT <= 0) {
          e.burstT = 0.13;
          e.burst--;
          this.enemyFire(e);
        }
      }
    }
    void playerXZ;
  }

  private updateWaves(dt: number) {
    if (this.waveState === 'inter') {
      this.interT -= dt;
      if (this.interT <= 0) {
        this.wave++;
        this.spawnQueue = Math.min(3 + this.wave * 2, 24);
        this.maxAlive = Math.min(3 + this.wave, 8);
        this.spawnT = 0.3;
        this.waveState = 'combat';
        sfx.waveHorn();
        this.hooks.event({ type: 'wave', n: this.wave, count: this.spawnQueue });
        this.hudDirty = true;
      }
      return;
    }
    const alive = this.enemies.filter((e) => e.state !== 'dying').length;
    if (this.spawnQueue > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && alive < this.maxAlive) {
        this.spawnEnemy();
        this.spawnQueue--;
        this.spawnT = Math.max(0.55, 1.5 - this.wave * 0.06);
      }
    } else if (alive === 0) {
      const bonus = 200 + this.wave * 100;
      this.score += bonus;
      this.health = Math.min(100, this.health + 30);
      this.weapons[0].reserve += 24;
      this.weapons[1].reserve += 90;
      this.waveState = 'inter';
      this.interT = 4;
      sfx.waveClear();
      this.hooks.event({ type: 'waveclear', n: this.wave, bonus });
      this.hudDirty = true;
    }
  }

  private updatePickups(dt: number) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      p.life -= dt;
      p.group.position.y = 0.35 + Math.sin(p.t * 2.4) * 0.08;
      p.group.rotation.y += dt * 1.4;
      if (p.life < 4) p.group.visible = Math.floor(p.t * 5) % 2 === 0;
      const d = Math.hypot(p.group.position.x - this.pos.x, p.group.position.z - this.pos.z);
      if (d < 1.4) {
        if (p.kind === 'ammo') {
          this.weapons[0].reserve += 16;
          this.weapons[1].reserve += 60;
          this.hooks.event({ type: 'pickup', text: 'AMMO CACHE +16 / +60' });
        } else {
          this.health = Math.min(100, this.health + 25);
          this.hooks.event({ type: 'pickup', text: 'MEDKIT +25 HP' });
        }
        sfx.pickup();
        this.scene.remove(p.group);
        this.pickups.splice(i, 1);
        this.hudDirty = true;
        continue;
      }
      if (p.life <= 0) {
        this.scene.remove(p.group);
        this.pickups.splice(i, 1);
      }
    }
  }

  private updateAmbient(dt: number, t: number) {
    // snow — fixed to the yard, wraps at the fence line
    const attr = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < this.snowVel.length; i++) {
      arr[i * 3 + 1] -= this.snowVel[i] * dt;
      arr[i * 3] += (1.1 + Math.sin(t * 0.6 + i) * 0.5) * dt;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = 15 + Math.random() * 3;
        arr[i * 3] = (Math.random() - 0.5) * YARD_W * 2;
        arr[i * 3 + 2] = (Math.random() - 0.5) * YARD_D * 2;
      }
      if (arr[i * 3] > YARD_W) arr[i * 3] = -YARD_W;
      if (arr[i * 3 + 2] > YARD_D) arr[i * 3 + 2] = -YARD_D;
      else if (arr[i * 3 + 2] < -YARD_D) arr[i * 3 + 2] = YARD_D;
    }
    attr.needsUpdate = true;

    // dust motes follow the camera through the depot air
    const mAttr = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const mArr = mAttr.array as Float32Array;
    for (let i = 0; i < mArr.length / 3; i++) {
      mArr[i * 3] += Math.sin(t * 0.25 + i * 1.7) * dt * 0.12;
      mArr[i * 3 + 1] += Math.cos(t * 0.18 + i) * dt * 0.05;
      mArr[i * 3 + 2] += Math.cos(t * 0.22 + i * 2.3) * dt * 0.12;
      for (let a = 0; a < 3; a++) {
        const lim = a === 1 ? 6 : 8;
        if (mArr[i * 3 + a] > lim) mArr[i * 3 + a] = -lim;
        if (mArr[i * 3 + a] < -lim) mArr[i * 3 + a] = lim;
      }
    }
    mAttr.needsUpdate = true;
    this.motes.position.set(this.camera.position.x, 0, this.camera.position.z);

    // lamp flicker
    for (const l of this.lamps) {
      const f = Math.sin(t * 13 + l.seed) * Math.sin(t * 7.3 + l.seed * 2);
      const dip = f > 0.985 ? 0.25 : 1;
      l.light.intensity = l.base * (0.8 + 0.2 * Math.abs(f)) * dip;
    }

    // tracers
    for (const tr of [...this.tracersP, ...this.tracersE]) {
      if (tr.life > 0) {
        tr.life -= dt;
        const k = Math.max(0.05, tr.life / 0.07);
        tr.mesh.scale.x = 0.022 * k;
        tr.mesh.scale.y = 0.022 * k;
        if (tr.life <= 0) tr.mesh.visible = false;
      }
    }
    // particles
    for (const p of this.particles) {
      if (p.life > 0) {
        p.life -= dt;
        p.vel.y -= p.grav * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        if (p.mesh.position.y < 0.02) {
          p.mesh.position.y = 0.02;
          p.vel.y *= -0.3;
          p.vel.x *= 0.7;
          p.vel.z *= 0.7;
        }
        p.mesh.scale.setScalar(Math.max(0.001, p.size * (p.life / p.maxLife)));
        if (p.life <= 0) p.mesh.visible = false;
      }
    }
  }

  /* ------------------------------ hud ------------------------------ */

  private pushHud() {
    this.hudDirty = false;
    const w = this.curWeapon();
    const jit = Math.hypot(w.aimJitX, w.aimJitY);
    const alive = this.enemies.filter((e) => e.state !== 'dying').length;
    this.hooks.hud({
      phase: this.phase,
      health: Math.ceil(this.health),
      weaponIndex: this.weaponIndex,
      weapons: this.weapons.map((x) => ({
        name: x.cfg.name, short: x.cfg.short, mag: x.mag, reserve: x.reserve, auto: x.cfg.auto,
        mode: x.cfg.auto ? (x.mode === 0 ? 'AUTO' : 'BURST') : 'SEMI',
      })),
      wave: this.wave,
      enemiesLeft: this.spawnQueue + alive,
      score: this.score,
      kills: this.kills,
      reload: w.reloadT >= 0 ? w.reloadT / w.cfg.reloadTime : -1,
      gap: this.ads ? 3 : Math.round(6 + jit * 260),
      ads: this.ads,
      sprint: !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']),
      regen: this.health < 100 && this.health > 0 && this.simT - this.lastDamageT > 5,
    });
  }
}
