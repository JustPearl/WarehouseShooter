import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { sfx } from './audio';
import { floorTexture, wallTexture, crateTexture, concreteTexture, flashTexture, dotTexture } from './textures';
import { buildPistol, buildSMG, buildMercenary } from './models';
import type { WeaponModel, MercModel } from './models';

/* ============================== types ============================== */

export type GamePhase = 'menu' | 'playing' | 'paused' | 'gameover';

export interface WeaponHud {
  name: string;
  short: string;
  mag: number;
  reserve: number;
  auto: boolean;
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
const HALF_W = 32;
const HALF_D = 22;
const GRAV = 13;

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
  kick: number;
  spread: number;
  bloom: number;
  moveSpread: number;
  hip: THREE.Vector3;
  ads: THREE.Vector3;
  adsFov: number;
}

const WEAPON_CFGS: WeaponCfg[] = [
  {
    id: 'pistol', name: 'KODIAK .45', short: 'KDK .45', auto: false,
    dmg: 34, headMul: 2.3, magSize: 8, startReserve: 56,
    fireDelay: 0.16, reloadTime: 1.15, kick: 0.058, spread: 0.0032, bloom: 0.005, moveSpread: 0.022,
    hip: new THREE.Vector3(0.24, -0.21, -0.44), ads: new THREE.Vector3(0, -0.048, -0.3), adsFov: 64,
  },
  {
    id: 'smg', name: 'PTARMIGAN M9', short: 'PTM 9MM', auto: true,
    dmg: 13, headMul: 2.0, magSize: 30, startReserve: 150,
    fireDelay: 0.072, reloadTime: 1.75, kick: 0.0235, spread: 0.0095, bloom: 0.02, moveSpread: 0.03,
    hip: new THREE.Vector3(0.26, -0.24, -0.52), ads: new THREE.Vector3(0, -0.083, -0.36), adsFov: 58,
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
  aimJitX: number; // pitch aim error baked into the gun's orientation (rad)
  aimJitY: number; // yaw aim error baked into the gun's orientation (rad)
  patternSign: number; // running sign of the horizontal recoil drift
  echoT: number; // delayed mechanical echo impulse (-1 idle)
  echoMag: number;
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
  private recPitch = 0;
  private recYaw = 0;
  private recRoll = 0;
  // low-passed views of the recoil targets: impulses ramp in over ~45ms instead of slamming in one frame
  private recPitchV = 0;
  private recYawV = 0;
  private recRollV = 0;
  private shake = 0;
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
  private lamps: { light: THREE.PointLight; base: number; seed: number }[] = [];
  private snow!: THREE.Points;
  private snowVel!: Float32Array;

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
    this.renderer.toneMappingExposure = 1.12;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c161f);
    this.scene.fog = new THREE.Fog(0x0c161f, 18, 95);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    (this.scene as unknown as { environmentIntensity: number }).environmentIntensity = 0.32;

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 220);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.buildLights();
    this.buildWorld();
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
    const hemi = new THREE.HemisphereLight(0x8fb4c8, 0x20262c, 0.8);
    this.scene.add(hemi);
    const moon = new THREE.DirectionalLight(0xbfdcf0, 1.7);
    moon.position.set(18, 34, -14);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -40;
    moon.shadow.camera.right = 40;
    moon.shadow.camera.top = 40;
    moon.shadow.camera.bottom = -40;
    moon.shadow.camera.near = 4;
    moon.shadow.camera.far = 90;
    moon.shadow.bias = -0.0006;
    this.scene.add(moon);
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
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xe4eff5, roughness: 1 });
    const barrelMats = [
      new THREE.MeshStandardMaterial({ color: 0x8a3b2a, roughness: 0.7, metalness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x3f5a4a, roughness: 0.7, metalness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: 0x54606a, roughness: 0.7, metalness: 0.4 }),
    ];
    const bagMat = new THREE.MeshStandardMaterial({ color: 0x8f8873, roughness: 1 });

    const wallBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, y, z);
      this.addSolid(m, 'wall');
    };
    // perimeter with two breached gaps (north middle, south-east)
    wallBox(26, 7, 0.6, -19, 3.5, -HALF_D);
    wallBox(26, 7, 0.6, 19, 3.5, -HALF_D);
    wallBox(0.6, 7, HALF_D * 2, -HALF_W, 3.5, 0);
    wallBox(0.6, 7, HALF_D * 2, HALF_W, 3.5, 0);
    wallBox(20, 7, 0.6, -22, 3.5, HALF_D);
    wallBox(28, 7, 0.6, 18, 3.5, HALF_D);
    // rubble in the gaps (low cover, shoot-over-able)
    const rubbleN = new THREE.Mesh(new THREE.BoxGeometry(12, 0.9, 1.4), concreteMat);
    rubbleN.position.set(0, 0.45, -HALF_D);
    this.addSolid(rubbleN, 'cover');
    const rubbleS = new THREE.Mesh(new THREE.BoxGeometry(8, 0.9, 1.4), concreteMat);
    rubbleS.position.set(-8, 0.45, HALF_D);
    this.addSolid(rubbleS, 'cover');
    // snow drifts through the gaps
    for (const [dx, dz] of [[-2, -20.5], [3, -19.5], [-9, 20.5], [-5, 21]]) {
      const drift = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8), snowMat);
      drift.scale.set(1.6, 0.35, 1);
      drift.position.set(dx, 0.2, dz);
      this.scene.add(drift);
    }
    // outside glow plane beyond north gap (blizzard light)
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 6),
      new THREE.MeshBasicMaterial({ color: 0x9fc8dc, transparent: true, opacity: 0.5, fog: false }),
    );
    glow.position.set(0, 2.6, -HALF_D - 2.5);
    this.scene.add(glow);

    // steel columns
    for (const cx of [-21, -7, 7, 21]) {
      for (const cz of [-8, 8]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.55, 7, 0.55), beamMat);
        col.position.set(cx, 3.5, cz);
        this.addSolid(col, 'cover');
      }
    }
    // roof beams + partial roof panels
    for (const cx of [-26, -13, 0, 13, 26]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, HALF_D * 2), beamMat);
      beam.position.set(cx, 6.85, 0);
      beam.castShadow = true;
      this.scene.add(beam);
    }
    const roofMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9, metalness: 0.3, side: THREE.DoubleSide, color: 0x8fa0aa });
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(20, HALF_D * 2), roofMat);
      panel.rotation.x = Math.PI / 2;
      panel.position.set(side * 20.5, 7.1, 0);
      this.scene.add(panel);
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

    // ---- hanging emergency lamps ----
    const lampGeoHead = new THREE.BoxGeometry(0.5, 0.16, 0.3);
    const lampMatGlow = new THREE.MeshStandardMaterial({ color: 0x30241a, emissive: 0xffa64d, emissiveIntensity: 2.4, roughness: 0.6 });
    const cordMat = new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.9 });
    for (const [lx, lz, ly] of [[-14, -4, 4.6], [12, 6, 4.9], [1, -13, 5.1]] as [number, number, number][]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 7 - ly, 6), cordMat);
      cord.position.set(lx, (7 + ly) / 2, lz);
      this.scene.add(cord);
      const head = new THREE.Mesh(lampGeoHead, lampMatGlow);
      head.position.set(lx, ly, lz);
      this.scene.add(head);
      const light = new THREE.PointLight(0xffa64d, 38, 22, 2);
      light.position.set(lx, ly - 0.2, lz);
      this.scene.add(light);
      this.lamps.push({ light, base: 38, seed: lx * 7 + lz });
    }
    const cold = new THREE.PointLight(0xa8d8f0, 26, 30, 2);
    cold.position.set(0, 3.6, -19);
    this.scene.add(cold);
  }

  private buildSnow() {
    const N = 1400;
    const posArr = new Float32Array(N * 3);
    this.snowVel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      posArr[i * 3] = (Math.random() - 0.5) * 50;
      posArr[i * 3 + 1] = Math.random() * 22;
      posArr[i * 3 + 2] = (Math.random() - 0.5) * 50;
      this.snowVel[i] = 1.6 + Math.random() * 2.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xe8f4fa, size: 0.09, map: dotTexture(), transparent: true, opacity: 0.85,
      depthWrite: false, sizeAttenuation: true,
    });
    this.snow = new THREE.Points(geo, mat);
    this.scene.add(this.snow);
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
        aimJitX: 0, aimJitY: 0, patternSign: 1, echoT: -1, echoMag: 0,
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
    const sens = 0.0021 * (this.ads ? 0.6 : 1);
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
    this.recPitch = this.recYaw = this.recRoll = 0;
    this.recPitchV = this.recYawV = this.recRollV = 0;
    this.shake = 0;
    this.health = 100;
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
      [-29, -17], [-29, 0], [-29, 16], [-20, -19], [-2, -19], [14, -19],
      [29, -16], [29, 2], [29, 17], [18, 19], [-6, 19], [-24, 18],
    ];
    let best = anchors[Math.floor(Math.random() * anchors.length)];
    for (let tries = 0; tries < 6; tries++) {
      const a = anchors[Math.floor(Math.random() * anchors.length)];
      const dx = a[0] - this.pos.x, dz = a[1] - this.pos.z;
      if (dx * dx + dz * dz > 18 * 18) { best = a; break; }
    }
    const id = this.enemyIdSeq++;
    const model = buildMercenary(id);
    model.group.position.set(best[0] + (Math.random() - 0.5) * 3, -1.5, best[1] + (Math.random() - 0.5) * 3);
    this.scene.add(model.group);

    // per-enemy cloned materials for hit-flash
    const flashMats: THREE.MeshStandardMaterial[] = [];
    const cloneMat = (m: THREE.Mesh) => {
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.emissive = new THREE.Color(0xaa2222);
      mat.emissiveIntensity = 0;
      m.material = mat;
      flashMats.push(mat);
    };
    cloneMat(model.torso);
    cloneMat(model.head);
    cloneMat(model.legL);
    cloneMat(model.legR);

    const reg = (mesh: THREE.Mesh, part: 'head' | 'body') => {
      mesh.userData.eid = id;
      mesh.userData.part = part;
      this.enemyHits.push(mesh);
    };
    reg(model.head, 'head');
    reg(model.torso, 'body');
    reg(model.legL, 'body');
    reg(model.legR, 'body');
    reg(model.armL, 'body');

    const e: Enemy = {
      id, model, hp: 45 + (this.wave - 1) * 10,
      state: 'rise', t: 0, strafeDir: Math.random() > 0.5 ? 1 : -1,
      strafeT: 1 + Math.random(), burst: 0, burstT: 0,
      shotT: 1.2 + Math.random() * 1.2,
      speed: Math.min(4.0, 2.3 + (this.wave - 1) * 0.15),
      prefDist: 10 + Math.random() * 6,
      walkPhase: Math.random() * 6,
      flashT: 0, flashMats, fallDir: (Math.random() - 0.5) * 0.6,
    };
    this.enemies.push(e);
    this.burst(model.group.position.clone().setY(0.1), 'snow', 10, 2.4, 3, 0.5);
  }

  private killEnemy(e: Enemy, head: boolean) {
    e.state = 'dying';
    e.t = 0;
    this.enemyHits = this.enemyHits.filter((m) => m.userData.eid !== e.id);
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

    // --- recoil: vertical climb, patterned horizontal drift, per-shot character ---
    const adsMul = this.ads ? 0.62 : 1;
    const mv = 0.8 + Math.random() * 0.52; // every shot kicks a little differently
    this.recPitch += w.cfg.kick * mv * (0.9 + Math.random() * 0.25) * adsMul;
    const hard = Math.random() < 0.14 ? 2.0 + Math.random() * 1.4 : 1; // occasional hard yank
    this.recYaw += w.patternSign * w.cfg.kick * 0.62 * hard * mv * adsMul;
    w.patternSign = Math.random() < 0.2 ? -1 : 1;
    const pull = hard > 1 ? (Math.random() < 0.5 ? -1 : 1) * (0.8 + (hard - 1) * 0.55) : 1;
    this.recRoll += (Math.random() - 0.5) * w.cfg.kick * 1.35 * mv * pull;
    this.shake = Math.min(1.0, this.shake + w.cfg.kick * (w.cfg.auto ? 7 : 11) * mv);
    this.fovKick = Math.min(1.8, this.fovKick + (w.cfg.auto ? 0.55 : 1.2) * mv);
    w.kickV = 0.85 + Math.random() * 0.35; // muzzle flip strength varies shot to shot
    w.kickVar = 0.85 + Math.random() * 0.4;
    // mechanical echo: a small secondary jolt as the action cycles, a few frames later
    w.echoT = 0.05 + Math.random() * 0.055;
    w.echoMag = w.cfg.kick * (0.22 + Math.random() * 0.4);

    // --- aim error lives IN the gun: recovery lag + heat bloom + movement (baked into barrel orientation) ---
    const speedXZ = Math.hypot(this.vel.x, this.vel.z);
    const bloom =
      (w.cfg.spread + w.heat * w.cfg.bloom + Math.min(0.03, speedXZ * 0.0035) * (w.cfg.moveSpread / 0.022)) *
      (this.ads ? 0.32 : 1) *
      (this.grounded ? 1 : 1.6);
    w.aimJitX = this.recPitch * 0.6 + (Math.random() - 0.5) * 2 * bloom * (0.5 + Math.random() * 0.8);
    w.aimJitY = this.recYaw * 0.5 + (Math.random() - 0.5) * 2 * bloom * (0.5 + Math.random() * 0.8);

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
    this.burst(point, 'blood', head ? 12 : 8, 2.6, 7, 0.5);
    const killed = e.hp <= 0;
    sfx.hit(head);
    this.hooks.event({ type: 'hit', kill: killed, head });
    if (killed) this.killEnemy(e, head);
  }

  private damagePlayer(d: number) {
    if (this.phase !== 'playing') return;
    this.health = Math.max(0, this.health - d);
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
    const target = this.pos.clone();
    target.y -= 0.25;
    const dist = muzzlePos.distanceTo(target);
    // aim error
    const errScale = dist * 0.055 * (1 + Math.random());
    target.x += (Math.random() - 0.5) * errScale;
    target.y += (Math.random() - 0.5) * errScale * 0.5;
    target.z += (Math.random() - 0.5) * errScale;

    e.model.flash.visible = true;
    setTimeout(() => { e.model.flash.visible = false; }, 55);
    sfx.enemyShoot(dist);
    this.tracer(this.tracersE, muzzlePos, target);

    // does cover intercept?
    const dirTo = this.tmpV2.copy(target).sub(muzzlePos).normalize();
    this.raycaster.set(muzzlePos, dirTo);
    this.raycaster.far = dist;
    const blockers = this.raycaster.intersectObjects(this.solidMeshes, false);
    if (blockers.length > 0 && blockers[0].distance < dist - 0.4) {
      const h = blockers[0];
      this.burst(h.point, 'spark', 5, 2.2, 6, 0.3);
      if (h.face) this.decal(h.point, h.face.normal.clone().transformDirection(h.object.matrixWorld));
      return; // saved by cover
    }
    // hit roll
    const speedXZ = Math.hypot(this.vel.x, this.vel.z);
    const p = Math.max(0.1, Math.min(0.6, 0.52 - dist * 0.011 - speedXZ * 0.04 + this.wave * 0.012));
    if (Math.random() < p) {
      this.damagePlayer(Math.round(5 + Math.random() * 4 + Math.min(9, this.wave)));
      this.burst(this.tmpV.copy(this.pos).setY(this.pos.y - 0.5), 'blood', 5, 2, 7, 0.4);
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
    this.pos.x = Math.max(-HALF_W + 0.9, Math.min(HALF_W - 0.9, this.pos.x));
    this.pos.z = Math.max(-HALF_D + 0.9, Math.min(HALF_D - 0.9, this.pos.z));

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

    // recoil recovery (deliberately slower than the impulse, so sustained fire climbs)
    const rec = Math.min(1, dt * 6.5);
    this.recPitch += (0 - this.recPitch) * rec;
    this.recYaw += (0 - this.recYaw) * Math.min(1, dt * 7.5);
    this.recRoll += (0 - this.recRoll) * Math.min(1, dt * 11);
    this.shake *= Math.exp(-9 * dt);
    this.fovKick *= Math.exp(-9 * dt);

    // smooth attack: impulses ramp into the view over ~45ms instead of snapping in one frame
    const att = Math.min(1, dt * 22);
    this.recPitchV += (this.recPitch - this.recPitchV) * att;
    this.recYawV += (this.recYaw - this.recYawV) * att;
    this.recRollV += (this.recRoll - this.recRollV) * att;

    // camera (low-frequency, small-amplitude punch — never a tremor)
    const shX = Math.sin(t * 53) * this.shake * 0.005;
    const shY = Math.cos(t * 47) * this.shake * 0.005;
    this.camera.position.set(this.pos.x + bobX * Math.cos(this.yaw), this.pos.y + bobY, this.pos.z - bobX * Math.sin(this.yaw));
    this.camera.rotation.set(this.pitch + this.recPitchV + shX, this.yaw + this.recYawV + shY, this.recRollV);

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
    g.position.y += (anchor.y + this.swayY * 0.5 + bobY * 0.6 - kv * 0.02 - re * 0.085 + reJerk - g.position.y) * lerpF;
    g.position.z += (anchor.z + kv * (w.cfg.auto ? 0.075 : 0.115) + re * 0.05 - g.position.z) * lerpF;
    // aim error is baked into the barrel: the gun visibly whips off-aim where the bullet actually goes
    g.rotation.x = kv * (w.cfg.auto ? 0.11 : 0.2) - w.aimJitX * adsK - re * 0.6;
    g.rotation.z = this.swayX * 1.6 + this.recRoll * 0.9 - re * 0.52;
    g.rotation.y = this.swayX * 1.1 + w.aimJitY * adsK + re * 0.24;
    w.kickV *= Math.exp(-10 * dt);
  }

  private updateWeapons(dt: number) {
    const w = this.curWeapon();
    w.cooldown -= dt;
    w.heat = Math.max(0, w.heat - dt * (w.cfg.auto ? 0.55 : 0.8));
    // mechanical echo: small secondary jolt shortly after the action cycles
    if (w.echoT >= 0) {
      w.echoT -= dt;
      if (w.echoT < 0) {
        this.recPitch += w.echoMag;
        w.aimJitX = Math.min(0.05, w.aimJitX + w.echoMag * 0.8);
        w.kickV = Math.min(1.2, w.kickV + 0.16);
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

    if (this.mouseDown && w.cfg.auto) this.tryFire();
    if (this.firePressed) {
      this.firePressed = false;
      if (!w.cfg.auto) this.tryFire();
      else this.tryFire();
    }
  }

  private updateEnemies(dt: number) {
    const playerXZ = this.tmpV.set(this.pos.x, 0, this.pos.z);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const gp = e.model.group.position;

      if (e.state === 'dying') {
        e.t += dt;
        e.model.group.rotation.x = -Math.min(1, e.t * 2.6) * (Math.PI / 2 - 0.06);
        e.model.group.rotation.z = e.fallDir * Math.min(1, e.t * 2.6);
        if (e.t > 1.6) gp.y -= dt * 0.55;
        if (e.t > 4 || gp.y < -1.4) {
          this.scene.remove(e.model.group);
          this.enemies.splice(i, 1);
        }
        continue;
      }

      if (e.state === 'rise') {
        e.t += dt * 1.6;
        gp.y = THREE.MathUtils.lerp(-1.5, 0, Math.min(1, e.t));
        if (e.t >= 1) { e.state = 'live'; gp.y = 0; }
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

      // movement: hold preferred range, strafe, flank if no LOS
      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      const approach = dist > e.prefDist + 1.5 ? 1 : dist < e.prefDist - 2 ? -0.7 : 0;
      const strafeW = los ? 0.65 : 1.25;
      let mx = nx * approach + -nz * e.strafeDir * strafeW;
      let mz = nz * approach + nx * e.strafeDir * strafeW;
      if (!los) { mx += nx * 0.7; mz += nz * 0.7; } // close in when blocked
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
      let nextX = gp.x + mx * dt;
      let nextZ = gp.z + mz * dt;
      for (const box of this.colliderBoxes) {
        if (gp.z > box.min.z - r && gp.z < box.max.z + r && nextX > box.min.x - r && nextX < box.max.x + r) {
          nextX = mx > 0 ? Math.min(nextX, box.min.x - r) : Math.max(nextX, box.max.x + r);
        }
        if (gp.x > box.min.x - r && gp.x < box.max.x + r && nextZ > box.min.z - r && nextZ < box.max.z + r) {
          nextZ = mz > 0 ? Math.min(nextZ, box.min.z - r) : Math.max(nextZ, box.max.z + r);
        }
      }
      gp.x = Math.max(-HALF_W + 1, Math.min(HALF_W - 1, nextX));
      gp.z = Math.max(-HALF_D + 1, Math.min(HALF_D - 1, nextZ));
      e.model.group.rotation.y = Math.atan2(dx, dz);

      // walk anim
      const moving = Math.hypot(mx, mz) > 0.4;
      e.walkPhase += (moving ? e.speed : 0) * dt * 2.6;
      const sw = Math.sin(e.walkPhase) * 0.65;
      e.model.legL.rotation.x = sw;
      e.model.legR.rotation.x = -sw;
      e.model.armL.rotation.x = -1.05 + Math.sin(e.walkPhase + Math.PI) * 0.12;

      // hit flash decay
      if (e.flashT > 0) {
        e.flashT -= dt;
        const k = Math.max(0, e.flashT / 0.1) * 1.1;
        for (const m of e.flashMats) m.emissiveIntensity = k;
      }

      // --- firing ---
      e.shotT -= dt;
      if (e.shotT <= 0 && e.burst <= 0) {
        if (los && dist > 3) {
          e.burst = 2 + Math.floor(Math.random() * 3) + Math.min(2, Math.floor(this.wave / 3));
          e.burstT = 0.12;
        }
        e.shotT = Math.max(0.95, 1.9 - this.wave * 0.07) + Math.random() * 0.9;
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
    // snow
    const attr = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const cx = this.camera.position.x;
    const cz = this.camera.position.z;
    for (let i = 0; i < this.snowVel.length; i++) {
      arr[i * 3 + 1] -= this.snowVel[i] * dt;
      arr[i * 3] += (1.1 + Math.sin(t * 0.6 + i) * 0.5) * dt;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = 20 + Math.random() * 2;
        arr[i * 3] = (Math.random() - 0.5) * 50;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 50;
      }
      if (arr[i * 3] > 25) arr[i * 3] = -25;
    }
    attr.needsUpdate = true;
    this.snow.position.set(cx, 0, cz);

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
      weapons: this.weapons.map((x) => ({ name: x.cfg.name, short: x.cfg.short, mag: x.mag, reserve: x.reserve, auto: x.cfg.auto })),
      wave: this.wave,
      enemiesLeft: this.spawnQueue + alive,
      score: this.score,
      kills: this.kills,
      reload: w.reloadT >= 0 ? w.reloadT / w.cfg.reloadTime : -1,
      gap: this.ads ? 3 : Math.round(6 + jit * 260),
      ads: this.ads,
      sprint: !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']),
    });
  }
}
