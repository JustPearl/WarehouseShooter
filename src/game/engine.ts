import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { sfx } from './audio';
import { dotTexture } from './textures';
import { buildPistol, buildSMG, buildMercenary, MERC_SKINS } from './models';
import { buildAttNodes } from './attachments';
import { FxPool } from './fx';
import { buildLights, buildWorld, PathGrid } from './world';
import type { Lamp } from './world';
import {
  EYE, HALF_W, HALF_D, YARD_W, YARD_D, GRAV,
  NEUTRAL, ATT_MODS, ATT_MAGADD, WEAPON_CFGS,
} from './types';
import type {
  GamePhase, Hooks, WeaponMods, WeaponRt, Enemy, RagJoint,
} from './types';

const UP_Y = new THREE.Vector3(0, 1, 0);

/* Types, constants and weapon configs live in ./types.ts */







interface Pickup {
  group: THREE.Group;
  kind: 'ammo' | 'health';
  t: number;
  life: number;
}

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

  // world (built by world.ts; engine keeps the collider/solid lists for raycasts)
  private solidMeshes: THREE.Mesh[] = [];
  private colliderBoxes: THREE.Box3[] = [];
  private path!: PathGrid; // coarse A* — enemies route around walls & cover
  private astarBudget = 0; // max A* queries per frame (keeps wave spikes cheap)
  private lamps: Lamp[] = [];
  private snow!: THREE.Points;
  private snowVel!: Float32Array;
  private motes!: THREE.Points; // dust hanging in the warehouse air

  // entities & pools
  private enemies: Enemy[] = [];
  private enemyHits: THREE.Mesh[] = [];
  private enemyIdSeq = 1;
  private pickups: Pickup[] = [];
  private fx!: FxPool; // pooled tracers / particles / decals

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
  private tmpV3 = new THREE.Vector3();

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

    buildLights(this.scene);
    const world = buildWorld(this.scene);
    this.solidMeshes = world.solidMeshes;
    this.colliderBoxes = world.colliderBoxes;
    this.lamps = world.lamps;
    this.path = new PathGrid(this.colliderBoxes);
    this.buildSnow();
    this.buildWeapons();
    this.fx = new FxPool(this.scene);
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

  /* lights + world geometry live in world.ts */



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
      const attNodes = buildAttNodes(model, i);
      const w: WeaponRt = {
        cfg, model, mag: cfg.magSize, reserve: cfg.startReserve,
        cooldown: 0, heat: 0, reloadT: -1, kickV: 0, kickVis: 0, kickVar: 1,
        aimJitX: 0, aimJitY: 0, echoT: -1, echoMag: 0,
        burstAcc: 0, lastFireT: -1,
        mode: 0, burstLeft: 0, meleeK: 0, meleeT: 0,
        mod: { ...NEUTRAL }, attNodes, flashBase: model.flash.scale.x,
      };
      this.weapons.push(w);
    });
    this.gunLight = new THREE.PointLight(0xffc47a, 0, 9, 2);
    this.gunLight.position.set(0.2, -0.1, -0.8);
    this.camera.add(this.gunLight);
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
      w.mag = w.cfg.magSize + w.mod.magAdd;
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

  /** Equip attachments live. ids are prefixed 'p:' (pistol) / 's:' (SMG). */
  applyLoadout(ids: string[]) {
    this.weapons.forEach((w, wi) => {
      const pfx = wi === 0 ? 'p' : 's';
      const mod: WeaponMods = { ...NEUTRAL };
      for (const raw of ids) {
        const [p, id] = raw.split(':');
        if (p !== pfx || !ATT_MODS[id]) continue;
        for (const k of Object.keys(ATT_MODS[id]) as (keyof WeaponMods)[]) {
          const v = ATT_MODS[id][k];
          if (typeof v === 'number') (mod[k] as number) *= v;
          else if (typeof v === 'boolean') (mod[k] as boolean) = (mod[k] as boolean) || v;
        }
        const add = ATT_MAGADD[id];
        if (add) mod.magAdd += add[wi];
      }
      w.mod = mod;
      const cap = w.cfg.magSize + mod.magAdd;
      if (w.mag > cap) w.mag = cap;
      for (const [aid, node] of Object.entries(w.attNodes)) node.visible = ids.includes(`${pfx}:${aid}`);
    });
    this.hudDirty = true;
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
    this.fx.clear();
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
    this.fx.burst(model.group.position.clone().setY(0.1), 'snow', 10, 2.4, 3, 0.5);
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
    if (w.reloadT >= 0 || w.mag >= w.cfg.magSize + w.mod.magAdd || w.reserve <= 0) return;
    w.reloadT = 0;
    sfx.reload(w.cfg.reloadTime * w.mod.reload);
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
    w.cooldown = w.cfg.fireDelay * w.mod.fire;
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
    const mv = 1 + (Math.random() - 0.5) * m.varRange * w.mod.noise; // ±5–7% magnitude life, nothing wild
    this.recTgtP += imp * m.patternPitch[n % m.patternPitch.length] * brace * mv * w.mod.vert;
    this.recTgtY +=
      imp * m.patternYaw[n % m.patternYaw.length] * brace * mv * w.mod.horiz +
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
    const hipLaser = w.mod.laser && !this.ads; // the laser only steadies the hip-fire cone
    const bloom =
      (w.cfg.spread * w.mod.spread +
        w.heat * w.cfg.bloom * w.mod.bloom * (hipLaser ? 0.55 : 1) +
        Math.min(0.03, speedXZ * 0.0035) * (w.cfg.moveSpread / 0.022) * w.mod.move * (hipLaser ? 0.5 : 1)) *
      (this.ads ? 0.24 * w.mod.adsBloom : 1) *
      (this.grounded ? 1 : 1.6);
    w.aimJitX = (Math.random() - 0.5) * 2 * bloom * (0.5 + Math.random() * 0.8);
    w.aimJitY = (Math.random() - 0.5) * 2 * bloom * (0.5 + Math.random() * 0.8);

    if (w.mod.suppressed) sfx.supShot(w.cfg.id as 'pistol' | 'smg');
    else sfx.shoot(w.cfg.id as 'pistol' | 'smg', this.ads);
    const flMat = w.model.flash.material as THREE.SpriteMaterial;
    const flBase = w.flashBase * w.mod.flash;
    w.model.flash.scale.set(flBase, flBase, 1);
    w.model.flash.visible = w.mod.flash > 0.05;
    flMat.rotation = Math.random() * Math.PI;
    this.flashT = 0.045;
    this.gunLight.intensity = 26 * w.mod.flash;

    // casing (ejects to the shooter's right — no per-shot allocations)
    this.tmpV3.set(0.15, -0.15, -0.2).applyAxisAngle(UP_Y, this.yaw).add(this.pos);
    this.fx.burst(this.tmpV3, 'case', 1, 1, 10, 0.7, this.yaw);

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
          this.damageEnemy(enemy, w.cfg.dmg * w.mod.dmg * (head ? w.cfg.headMul : 1), head, h.point);
        }
      } else {
        if (ud.kind === 'floor') {
          this.fx.burst(h.point, 'snow', 7, 1.6, 4, 0.45);
        } else {
          this.fx.burst(h.point, 'spark', 6, 2.4, 6, 0.35);
          if (h.face) {
            const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
            this.fx.decal(h.point, n);
          }
        }
        sfx.impact();
      }
    } else {
      end = muzzleP.clone().addScaledVector(dir, 120);
    }
    this.fx.tracerPlayer(muzzleP, end);
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
    this.fx.burst(point, 'blood', head ? 12 : 8, 2.6, 7, 0.5);
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
    this.fx.tracerEnemy(muzzlePos, target);

    // does cover intercept?
    const dirTo = this.tmpV2.copy(target).sub(muzzlePos).normalize();
    this.raycaster.set(muzzlePos, dirTo);
    this.raycaster.far = dist;
    const blockers = this.raycaster.intersectObjects(this.solidMeshes, false);
    if (blockers.length > 0 && blockers[0].distance < dist - 0.4) {
      const h = blockers[0];
      this.fx.burst(h.point, 'spark', 4, 2.2, 6, 0.3);
      if (h.face) this.fx.decal(h.point, h.face.normal.clone().transformDirection(h.object.matrixWorld));
      return; // saved by cover
    }
    const speedXZ = Math.hypot(this.vel.x, this.vel.z);
    const accMul = spreadMul > 1 ? 0.75 : spreadMul < 0.5 ? 1.15 : 1;
    const p = Math.max(0.08, Math.min(0.6, (0.52 - dist * 0.011 - speedXZ * 0.04 + this.wave * 0.012) * accMul));
    if (Math.random() < p) {
      this.damagePlayer(dmgRoll());
      this.fx.burst(this.tmpV.copy(this.pos).setY(this.pos.y - 0.5), 'blood', 4, 2, 7, 0.4);
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
      const recMul = (this.ads ? 1.6 : 1) * cw.mod.recov; // braced sights settle back faster
      this.recTgtP *= Math.exp(-rm.recovPitch * recMul * dt);
      this.recTgtY *= Math.exp(-rm.recovYaw * recMul * dt);
    }
    this.shake *= Math.exp(-9 * dt);
    this.fovKick *= Math.exp(-9 * dt);

    // the camera snaps to the recoil offset quickly (~40ms attack) — punchy, never teleported
    const att = Math.min(1, dt * 26 * (this.ads ? 1 / cw.mod.adsErr : 1));
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
    this.swayX += ((-this.swayMX * 0.00034) - this.swayX) * Math.min(1, dt * 14);
    this.swayMX *= Math.exp(-15 * dt);
    this.swayY += ((Math.abs(this.swayMX) * 0.0001) - this.swayY) * Math.min(1, dt * 14);
    const adsK = wantAds ? 0.34 : 1;
    const inert = wantAds ? 0.16 : 1; // braced in the shoulder: the gun tracks the eye almost rigidly
    const m = w.cfg.recoil; // stock/grip/action shape how the gun moves in the hands
    const anchor = wantAds ? w.cfg.ads : w.cfg.hip;
    const lerpF = Math.min(1, dt * (wantAds ? 26 * w.mod.adsSpeed : 13));
    const g = w.model.group;

    // simple reload animation: dip + roll toward the off-hand, sine envelope (no mag mesh animation)
    const rp = w.reloadT >= 0 ? Math.min(1, w.reloadT / w.cfg.reloadTime) : -1;
    const re = rp >= 0 ? Math.sin(Math.PI * rp) : 0;
    const reJerk = rp >= 0 && (rp < 0.12 || rp > 0.85) ? Math.sin(rp * 140) * 0.006 : 0;

    g.position.x += (anchor.x + (this.swayX + bobX * 0.42) * inert - re * 0.058 - g.position.x) * lerpF;
    // smoothed muzzle flip (ramps in, per-shot magnitude)
    w.kickVis += (w.kickV - w.kickVis) * Math.min(1, dt * 16);
    const kv = w.kickVis * w.kickVar;
    // a stock pivots the gun and absorbs flip; a stockless slide pistol whips up and jumps back.
    // braced in ADS the flip is heavily suppressed so the sight picture stays on target
    const flipMul = m.stock ? 0.75 : 1.15;
    const kvAds = wantAds ? 0.38 : 1;
    const mk = w.meleeK; // melee jab: drives the gun forward and dips the muzzle
    g.position.y += (anchor.y + (this.swayY * 0.5 + bobY * 0.5) * inert - kv * 0.02 * flipMul * kvAds - re * 0.085 + reJerk - mk * 0.04 - g.position.y) * lerpF;
    g.position.z += (anchor.z + kv * (m.stock ? 0.055 : 0.115) * kvAds + re * 0.05 - mk * 0.2 - g.position.z) * lerpF;
    // aim error is baked into the barrel: the gun visibly whips off-aim where the bullet actually goes
    g.rotation.x = kv * (m.stock ? 0.085 : 0.21) * (m.action === 'slide' ? 1.1 : 1) * kvAds - w.aimJitX * adsK - re * 0.6 - mk * 0.5;
    // torque twist is cosmetic — the camera itself never rolls from recoil
    g.rotation.z = this.swayX * 1.6 * inert + Math.sin(this.simT * 42) * kv * 0.025 * m.rollAmp - re * 0.52;
    g.rotation.y = this.swayX * 1.1 * inert + w.aimJitY * adsK + re * 0.24;
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
      if (w.reloadT >= w.cfg.reloadTime * w.mod.reload) {
        const take = Math.min(w.reserve, w.cfg.magSize + w.mod.magAdd - w.mag);
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
        const [sx, sz] = this.path.collideClamp(gp.x, gp.z, gp.x + r.vx * dt, gp.z + r.vz * dt, 0.4);
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
            this.fx.burst(gp.clone().setY(0.08), 'snow', 7, 1.8, 2.2, 0.4);
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
      const goalCell = this.path.cellIndex(this.pos.x, this.pos.z);
      e.pathT -= dt;
      const PC = this.path.cols;
      const stale = e.path.length === 0 || e.pathI >= e.path.length || e.pathT <= 0 ||
        (e.pathGoal >= 0 && Math.abs((e.pathGoal % PC) - (goalCell % PC)) +
          Math.abs(Math.floor(e.pathGoal / PC) - Math.floor(goalCell / PC)) > 3);
      if (stale && this.astarBudget > 0) {
        this.astarBudget--;
        e.path = this.path.findPath(gp.x, gp.z, this.pos.x, this.pos.z);
        e.pathI = e.path.length > 1 ? 1 : 0;
        e.pathGoal = goalCell;
        e.pathT = 0.5 + Math.random() * 0.35;
      }

      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      // desired travel direction: follow the route, blend to the direct line when close & visible
      let dirX = nx, dirZ = nz;
      if (e.path.length > 0 && e.pathI < e.path.length) {
        const wx = this.path.cellX(e.path[e.pathI]), wz = this.path.cellZ(e.path[e.pathI]);
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
      const [nx2, nz2] = this.path.collideClamp(gp.x, gp.z, gp.x + mx * dt, gp.z + mz * dt, r);
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
        const [hx2, hz2] = this.path.collideClamp(
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

    this.fx.update(dt);
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
        atts: Object.keys(x.attNodes).filter((a) => x.attNodes[a].visible),
      })),
      wave: this.wave,
      enemiesLeft: this.spawnQueue + alive,
      score: this.score,
      kills: this.kills,
      reload: w.reloadT >= 0 ? w.reloadT / (w.cfg.reloadTime * w.mod.reload) : -1,
      gap: this.ads ? 3 : Math.round(6 + jit * 260),
      ads: this.ads,
      atts: Object.keys(w.attNodes).filter((a) => w.attNodes[a].visible),
      sprint: !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']),
      regen: this.health < 100 && this.health > 0 && this.simT - this.lastDamageT > 5,
    });
  }
}
