import * as THREE from 'three';
import { flashTexture, camoTexture } from './textures';

/* ---------------- shared materials ---------------- */
const steel = new THREE.MeshStandardMaterial({ color: 0x3a4148, metalness: 0.72, roughness: 0.38 });
const steelDark = new THREE.MeshStandardMaterial({ color: 0x22272d, metalness: 0.6, roughness: 0.46 });
const polymer = new THREE.MeshStandardMaterial({ color: 0x1c2126, metalness: 0.15, roughness: 0.8 });
const amberPart = new THREE.MeshStandardMaterial({
  color: 0xff9a3c, emissive: 0xff7a1a, emissiveIntensity: 0.85, metalness: 0.3, roughness: 0.4,
});
const sightGlow = new THREE.MeshStandardMaterial({
  color: 0xffd9a0, emissive: 0xffb356, emissiveIntensity: 2.2, metalness: 0, roughness: 0.4,
});
const redGlow = new THREE.MeshStandardMaterial({
  color: 0xff3b30, emissive: 0xff2015, emissiveIntensity: 1.5, metalness: 0, roughness: 0.4,
});

const flashTex = flashTexture();

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export interface WeaponModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  flash: THREE.Sprite;
}

function addFlash(parent: THREE.Object3D, scale: number): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: flashTex, color: 0xffd9a0, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, opacity: 0.95,
    }),
  );
  s.scale.set(scale, scale, 1);
  s.visible = false;
  parent.add(s);
  return s;
}

/* ============================================================
   KODIAK .45 — original heavy-frame sidearm
   True proportions at 1.6× first-person scale (real compact .45:
   ~19cm long, ~13.5cm tall, ~3cm wide). Forward = -Z.
   Bore axis at y=0; iron-sight line at y=+0.055 (engine ads.y = -0.055).
   ============================================================ */
export function buildPistol(): WeaponModel {
  const g = new THREE.Group();

  // ---- slide: 26cm long, 4.8 wide, 6.8 tall (real 16.3×3×4.3cm) ----
  g.add(box(0.048, 0.068, 0.26, steel, 0, 0, -0.035)); // spans z -0.165..+0.095
  g.add(box(0.042, 0.056, 0.06, steel, 0, -0.004, -0.175)); // stepped muzzle-end bushing
  g.add(box(0.048, 0.060, 0.008, steelDark, 0, -0.002, 0.094)); // slide rear cap
  // rear + front serrations
  for (let i = 0; i < 6; i++) g.add(box(0.052, 0.056, 0.005, steelDark, 0, -0.002, 0.032 + i * 0.012));
  for (let i = 0; i < 4; i++) g.add(box(0.050, 0.048, 0.005, steelDark, 0, -0.004, -0.104 - i * 0.012));
  // ejection port (right side) + extractor detail
  g.add(box(0.012, 0.026, 0.046, steelDark, 0.022, 0.004, -0.005));
  g.add(box(0.006, 0.008, 0.03, steelDark, 0.026, 0.022, 0.01));
  // barrel + recessed crown
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.05, 12), steelDark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0, -0.19);
  g.add(barrel);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.012, 0.022, 12), steel);
  crown.rotation.x = Math.PI / 2;
  crown.position.set(0, 0, -0.206);
  g.add(crown);

  // ---- frame, dust cover & accessory rail ----
  g.add(box(0.044, 0.046, 0.19, steelDark, 0, -0.057, -0.03)); // spans y -0.034..-0.080
  g.add(box(0.038, 0.016, 0.10, steel, 0, -0.034, -0.115));
  g.add(box(0.040, 0.006, 0.014, steelDark, 0, -0.026, -0.135)); // rail slot
  g.add(box(0.040, 0.006, 0.014, steelDark, 0, -0.026, -0.105));
  // takedown pin + slide stop (left side)
  g.add(box(0.050, 0.008, 0.008, steel, 0, -0.038, -0.06));
  g.add(box(0.006, 0.014, 0.034, steelDark, -0.024, -0.042, 0.0));

  // ---- trigger guard + amber trigger ----
  g.add(box(0.010, 0.052, 0.012, steelDark, 0, -0.102, -0.075)); // front strap
  g.add(box(0.010, 0.012, 0.052, steelDark, 0, -0.124, -0.045)); // bottom
  g.add(box(0.007, 0.030, 0.008, amberPart, 0, -0.094, -0.045));

  // ---- grip, angled like a real service pistol ----
  const grip = box(0.054, 0.135, 0.068, polymer, 0, -0.130, 0.045);
  grip.rotation.x = 0.30;
  g.add(grip);
  // grip side panels (textured) + finger-groove hint
  const panelL = box(0.006, 0.095, 0.052, steelDark, -0.029, -0.128, 0.044);
  panelL.rotation.x = 0.30;
  g.add(panelL);
  const panelR = box(0.006, 0.095, 0.052, steelDark, 0.029, -0.128, 0.044);
  panelR.rotation.x = 0.30;
  g.add(panelR);
  const baseplate = box(0.050, 0.014, 0.064, amberPart, 0, -0.194, 0.064);
  baseplate.rotation.x = 0.30;
  g.add(baseplate);

  // ---- hammer, beavertail, mainspring housing, thumb safety ----
  g.add(box(0.014, 0.024, 0.014, steel, 0, 0.028, 0.100));
  g.add(box(0.046, 0.016, 0.038, steelDark, 0, -0.035, 0.082));
  g.add(box(0.040, 0.030, 0.028, steelDark, 0, -0.055, 0.076));
  g.add(box(0.006, 0.012, 0.022, amberPart, -0.026, -0.030, 0.028));

  // ---- sights: rear notch + front fiber post, sight line at y=0.055 ----
  g.add(box(0.040, 0.010, 0.012, steelDark, 0, 0.039, 0.072));
  g.add(box(0.010, 0.014, 0.010, steelDark, -0.014, 0.048, 0.072));
  g.add(box(0.010, 0.014, 0.010, steelDark, 0.014, 0.048, 0.072));
  g.add(box(0.008, 0.020, 0.008, steelDark, 0, 0.045, -0.152));
  g.add(box(0.0045, 0.007, 0.0045, sightGlow, 0, 0.0515, -0.152));
  // amber slide accent lines
  g.add(box(0.004, 0.008, 0.10, amberPart, -0.0255, -0.012, -0.02));
  g.add(box(0.004, 0.008, 0.10, amberPart, 0.0255, -0.012, -0.02));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.22);
  muzzle.rotation.y = Math.PI; // gun is built facing -Z: make +Z point down the barrel
  g.add(muzzle);
  const flash = addFlash(muzzle, 0.24);

  return { group: g, muzzle, flash };
}

/* ============================================================
   PTARMIGAN M9 — original compact 9mm PDW / SMG, full-auto
   True proportions at 1.5× first-person scale (real compact PDW:
   ~47cm with stock out, ~24cm tall, ~5.5cm wide). Forward = -Z.
    Bore axis at y=+0.006; red-dot center at y=+0.088. The whole group is scaled
    1.2× for first-person presence (~89cm on screen, ~2.8× the pistol's ~32cm);
    engine anchors are compensated (ads.y = -0.106, ads.z = -0.48).   ============================================================ */
export function buildSMG(): WeaponModel {
  const g = new THREE.Group();

  // ---- receiver: 28cm long (real ~19cm), slim PDW profile ----
  g.add(box(0.058, 0.072, 0.28, steel, 0, 0, -0.01)); // spans z -0.15..+0.13
  g.add(box(0.054, 0.042, 0.17, steelDark, 0, -0.020, 0.015)); // lower receiver
  g.add(box(0.012, 0.024, 0.044, steelDark, 0.026, 0.006, 0.015)); // ejection port
  // top rail + reflex sight — dot centered at y=0.088
  g.add(box(0.040, 0.014, 0.26, steelDark, 0, 0.043, -0.02));
  g.add(box(0.034, 0.046, 0.052, polymer, 0, 0.080, -0.055));
  g.add(box(0.026, 0.034, 0.004, new THREE.MeshStandardMaterial({ color: 0x0d1114, metalness: 0.2, roughness: 0.2 }), 0, 0.084, -0.080));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 8, 8), sightGlow);
  dot.position.set(0, 0.088, -0.078);
  g.add(dot);
  // backup iron post over the shroud root
  g.add(box(0.006, 0.022, 0.006, steelDark, 0, 0.058, -0.140));

  // ---- barrel shroud with vent slots + hand stop ----
  const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.21, 12), steel);
  shroud.rotation.x = Math.PI / 2;
  shroud.position.set(0, 0.006, -0.265); // spans -0.16..-0.37
  shroud.castShadow = true;
  g.add(shroud);
  for (let i = 0; i < 3; i++) g.add(box(0.046, 0.010, 0.022, steelDark, 0, 0.006, -0.210 - i * 0.055));
  g.add(box(0.046, 0.018, 0.014, steelDark, 0, -0.020, -0.345)); // hand stop

  // ---- barrel + muzzle brake ----
  const barrelTip = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.06, 10), steelDark);
  barrelTip.rotation.x = Math.PI / 2;
  barrelTip.position.set(0, 0.006, -0.385);
  g.add(barrelTip);
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.045, 10), steelDark);
  brake.rotation.x = Math.PI / 2;
  brake.position.set(0, 0.006, -0.395);
  g.add(brake);

  // ---- magwell + 30-round stick mag (real ~20cm) with ribs & amber band ----
  g.add(box(0.060, 0.034, 0.070, steelDark, 0, -0.050, -0.038));
  const mag = box(0.052, 0.21, 0.060, polymer, 0, -0.135, -0.045);
  mag.rotation.x = -0.12;
  g.add(mag);
  const ribA = box(0.054, 0.006, 0.062, steelDark, 0, -0.115, -0.047);
  ribA.rotation.x = -0.12;
  g.add(ribA);
  const ribB = box(0.054, 0.006, 0.062, steelDark, 0, -0.165, -0.053);
  ribB.rotation.x = -0.12;
  g.add(ribB);
  const band = box(0.054, 0.016, 0.062, amberPart, 0, -0.235, -0.058);
  band.rotation.x = -0.12;
  g.add(band);

  // ---- angled foregrip with finger grooves ----
  const fg = box(0.030, 0.088, 0.040, polymer, 0, -0.072, -0.220);
  fg.rotation.x = 0.20;
  g.add(fg);
  const grA = box(0.032, 0.010, 0.042, steelDark, 0, -0.058, -0.212);
  grA.rotation.x = 0.20;
  g.add(grA);
  const grB = box(0.032, 0.010, 0.042, steelDark, 0, -0.086, -0.228);
  grB.rotation.x = 0.20;
  g.add(grB);

  // ---- pistol grip, trigger group, selector, charging handle ----
  const pg = box(0.052, 0.150, 0.060, polymer, 0, -0.115, 0.095);
  pg.rotation.x = 0.30;
  g.add(pg);
  const pgCap = box(0.048, 0.012, 0.056, amberPart, 0, -0.188, 0.118);
  pgCap.rotation.x = 0.30;
  g.add(pgCap);
  g.add(box(0.010, 0.050, 0.012, steelDark, 0, -0.075, 0.035)); // guard front
  g.add(box(0.010, 0.012, 0.060, steelDark, 0, -0.098, 0.065)); // guard bottom
  g.add(box(0.008, 0.026, 0.008, amberPart, 0, -0.068, 0.060)); // trigger
  g.add(box(0.008, 0.020, 0.010, amberPart, -0.033, -0.004, 0.055)); // selector
  g.add(box(0.010, 0.010, 0.046, amberPart, 0.036, 0.020, 0.030)); // charging handle

  // ---- folding stock: hinge, twin arms, buttpad (extends total to ~74cm) ----
  g.add(box(0.030, 0.050, 0.030, steelDark, 0, 0.008, 0.145)); // hinge block
  g.add(box(0.008, 0.008, 0.020, amberPart, -0.030, 0.008, 0.145)); // hinge pin
  g.add(box(0.013, 0.034, 0.15, steelDark, -0.024, 0.010, 0.22));
  g.add(box(0.013, 0.034, 0.15, steelDark, 0.024, 0.010, 0.22));
  g.add(box(0.062, 0.070, 0.024, polymer, 0, 0.006, 0.305));
  g.add(box(0.066, 0.074, 0.010, amberPart, 0, 0.006, 0.320));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.006, -0.42);
  muzzle.rotation.y = Math.PI; // gun is built facing -Z: make +Z point down the barrel
  g.add(muzzle);
  const flash = addFlash(muzzle, 0.27);

  // presence pass: first-person long guns read best oversized. Push the whole PDW
  // to ~1.8× real scale (~89cm on screen) so it dominates the frame against the
  // sidearm — engine ads/hip anchors are compensated for this scale.
  g.scale.setScalar(1.2);

  return { group: g, muzzle, flash };
}

/* ============================================================
   MERCENARY — articulated winter operator, faces +Z
   Skeleton: group -> pelvis -> spine -> head
                      |          \-> shoulders -> elbows
                      \-> hips -> knees
   ============================================================ */
export interface MercModel {
  group: THREE.Group;
  pelvis: THREE.Object3D;
  spine: THREE.Object3D;
  head: THREE.Object3D;
  shoulderL: THREE.Object3D;
  shoulderR: THREE.Object3D;
  elbowL: THREE.Object3D;
  elbowR: THREE.Object3D;
  hipL: THREE.Object3D;
  hipR: THREE.Object3D;
  kneeL: THREE.Object3D;
  kneeR: THREE.Object3D;
  headMesh: THREE.Mesh;
  bodyMeshes: THREE.Mesh[];
  rifle: THREE.Group;
  rifleZ: number;
  muzzle: THREE.Object3D;
  flash: THREE.Sprite;
  skin: number;
  bulk: number;
}

export interface SkinDef {
  name: string;
  coat: string;
  coatB: string;
  pants: string;
  hood: string;
  trim: string;
  visor: number;
  bulk: number;
  pauldrons: boolean;
  scarf: boolean;
}

export const MERC_SKINS: SkinDef[] = [
  { name: 'FROST',    coat: '#c9d4d9', coatB: '#94a7b0', pants: '#3a444b', hood: '#e4edf0', trim: '#5b6a72', visor: 0xff3b30, bulk: 1.0,  pauldrons: false, scarf: false },
  { name: 'RAIDER',   coat: '#7a3a28', coatB: '#552a1d', pants: '#2f3227', hood: '#3c2a20', trim: '#c98f4a', visor: 0xff6a2a, bulk: 1.05, pauldrons: false, scarf: true  },
  { name: 'GHOST',    coat: '#8b959c', coatB: '#656f78', pants: '#232a30', hood: '#2c343a', trim: '#aab8c0', visor: 0xff3b30, bulk: 0.97, pauldrons: false, scarf: false },
  { name: 'ENFORCER', coat: '#39414a', coatB: '#252c33', pants: '#1d2226', hood: '#252c33', trim: '#ffab3d', visor: 0xff8b2a, bulk: 1.14, pauldrons: true,  scarf: false },
];

interface SkinMats {
  coat: THREE.Material; coatB: THREE.Material; pants: THREE.Material; hood: THREE.Material;
  vest: THREE.Material; trim: THREE.Material; glove: THREE.Material; boot: THREE.Material;
  mask: THREE.Material; visor: THREE.Material; strobe: THREE.Material;
}
const skinMatCache = new Map<number, SkinMats>();
function getSkinMats(i: number): SkinMats {
  let m = skinMatCache.get(i);
  if (m) return m;
  const sk = MERC_SKINS[i % MERC_SKINS.length];
  m = {
    coat: new THREE.MeshStandardMaterial({ map: camoTexture(sk.coat), roughness: 0.88, metalness: 0.04 }),
    coatB: new THREE.MeshStandardMaterial({ map: camoTexture(sk.coatB), roughness: 0.88, metalness: 0.04 }),
    pants: new THREE.MeshStandardMaterial({ color: sk.pants, roughness: 0.92 }),
    hood: new THREE.MeshStandardMaterial({ color: sk.hood, roughness: 0.95 }),
    vest: new THREE.MeshStandardMaterial({ color: 0x1d2328, roughness: 0.7, metalness: 0.28 }),
    trim: new THREE.MeshStandardMaterial({ color: sk.trim, roughness: 0.45, metalness: 0.55 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x191d20, roughness: 0.9 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.85 }),
    mask: new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.9 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x14060a, emissive: sk.visor, emissiveIntensity: 1.6, roughness: 0.25 }),
    strobe: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2222, emissiveIntensity: 1.1 }),
  };
  skinMatCache.set(i, m);
  return m;
}

// shared translated box geometries (pivots at joints, boxes hang from them)
const geoCache = new Map<string, THREE.BufferGeometry>();
function partGeo(w: number, h: number, d: number, oy: number, oz: number): THREE.BufferGeometry {
  const key = `${w}|${h}|${d}|${oy}|${oz}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, oy, oz);
    geoCache.set(key, g);
  }
  return g;
}
function part(w: number, h: number, d: number, mat: THREE.Material, oy = 0, oz = 0): THREE.Mesh {
  const m = new THREE.Mesh(partGeo(w, h, d, oy, oz), mat);
  m.castShadow = true;
  return m;
}

export function buildMercenary(skinIdx: number): MercModel {
  const sk = MERC_SKINS[skinIdx % MERC_SKINS.length];
  const M = getSkinMats(skinIdx % MERC_SKINS.length);
  const b = sk.bulk;
  const g = new THREE.Group();
  const bodyMeshes: THREE.Mesh[] = [];
  const put = (parent: THREE.Object3D, m: THREE.Mesh, x = 0, y = 0, z = 0) => {
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  /* --- pelvis + legs --- */
  const pelvis = new THREE.Object3D();
  pelvis.position.y = 0.94;
  g.add(pelvis);
  bodyMeshes.push(put(pelvis, part(0.36 * b, 0.2, 0.24, M.coatB, 0.02)));
  put(pelvis, part(0.38 * b, 0.05, 0.26, M.trim, 0.12)); // belt
  const mkLeg = (side: number) => {
    const hip = new THREE.Object3D();
    hip.position.set(0.11 * side, -0.06, 0);
    pelvis.add(hip);
    const thigh = part(0.15, 0.44, 0.18, M.pants, -0.22);
    hip.add(thigh); bodyMeshes.push(thigh);
    const knee = new THREE.Object3D();
    knee.position.y = -0.44;
    hip.add(knee);
    const shin = part(0.13, 0.42, 0.16, M.pants, -0.2);
    knee.add(shin); bodyMeshes.push(shin);
    put(knee, part(0.15, 0.09, 0.28, M.boot, -0.045, 0.05)); // boot
    put(knee, part(0.14, 0.06, 0.17, M.trim, -0.14));        // shin strap
    return { hip, knee };
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  /* --- spine + torso + gear --- */
  const spine = new THREE.Object3D();
  spine.position.y = 0.1;
  pelvis.add(spine);
  const torsoMesh = part(0.48 * b, 0.54, 0.28, M.coat, 0.27);
  spine.add(torsoMesh); bodyMeshes.push(torsoMesh);
  put(spine, part(0.52 * b, 0.34, 0.34, M.vest, 0.3, 0.01));        // plate carrier
  put(spine, part(0.1, 0.1, 0.06, M.vest, 0.2, 0.19), -0.13 * b);   // pouches
  put(spine, part(0.1, 0.1, 0.06, M.vest, 0.2, 0.19), 0.13 * b);
  put(spine, part(0.3, 0.03, 0.02, M.strobe, 0.43, 0.17));          // IR strobe strip
  put(spine, part(0.3, 0.09, 0.24, M.coatB, 0.56));                 // collar
  if (sk.scarf) put(spine, part(0.26, 0.1, 0.26, M.trim, 0.58));    // neck gaiter

  /* --- arms --- */
  const mkArm = (side: number) => {
    const sh = new THREE.Object3D();
    sh.position.set(0.3 * side * b, 0.5, 0);
    spine.add(sh);
    const up = part(0.13, 0.3, 0.14, M.coat, -0.15);
    sh.add(up); bodyMeshes.push(up);
    if (sk.pauldrons) put(sh, part(0.2, 0.11, 0.21, M.vest, -0.02), 0.05 * side); // shoulder plate
    else put(sh, part(0.15, 0.07, 0.16, M.coatB, -0.02));                          // soft pad
    const el = new THREE.Object3D();
    el.position.y = -0.3;
    sh.add(el);
    const fo = part(0.11, 0.26, 0.12, M.coat, -0.13);
    el.add(fo); bodyMeshes.push(fo);
    put(el, part(0.09, 0.09, 0.11, M.glove, -0.28)); // glove
    return { sh, el };
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);

  /* --- head --- */
  const headJ = new THREE.Object3D();
  headJ.position.set(0, 0.6, 0);
  spine.add(headJ);
  const headMesh = part(0.21, 0.24, 0.22, M.mask, 0.12, 0.01);
  headJ.add(headMesh);
  put(headJ, part(0.25, 0.14, 0.27, M.hood, 0.19, -0.03));      // hood
  put(headJ, part(0.22, 0.12, 0.06, M.hood, 0.09, -0.13));      // balaclava back
  put(headJ, part(0.18, 0.055, 0.02, M.visor, 0.13, 0.115));    // glowing visor
  put(headJ, part(0.1, 0.05, 0.03, M.trim, 0.05, 0.12));        // visor mount

  /* --- rifle (muzzle +Z), mounted to the chest so both arms can hold it --- */
  const rifle = new THREE.Group();
  rifle.position.set(0.07, 0.42, 0.14);
  spine.add(rifle);
  const rifleZ = rifle.position.z;
  rifle.add(box(0.05, 0.07, 0.34, steelDark, 0, 0, 0.1));
  rifle.add(box(0.04, 0.05, 0.14, steel, 0, -0.01, 0.32));
  const rbarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8), steel);
  rbarrel.rotation.x = Math.PI / 2;
  rbarrel.position.set(0, 0.01, 0.44);
  rifle.add(rbarrel);
  const rmag = box(0.03, 0.12, 0.05, polymer, 0, -0.09, 0.06);
  rmag.rotation.x = 0.2;
  rifle.add(rmag);
  rifle.add(box(0.03, 0.06, 0.05, polymer, 0, -0.02, -0.1)); // stock
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, 0.56);
  rifle.add(muzzle);
  const flash = addFlash(muzzle, 0.42);

  /* --- base combat pose: two-handed high-ready --- */
  armR.sh.rotation.set(-1.35, -0.12, 0);
  armR.el.rotation.x = -0.5;
  armL.sh.rotation.set(-1.1, 0.5, 0.25);
  armL.el.rotation.x = -1.05;

  g.scale.setScalar(0.97 + Math.random() * 0.07);

  return {
    group: g, pelvis, spine, head: headJ,
    shoulderL: armL.sh, shoulderR: armR.sh, elbowL: armL.el, elbowR: armR.el,
    hipL: legL.hip, hipR: legR.hip, kneeL: legL.knee, kneeR: legR.knee,
    headMesh, bodyMeshes, rifle, rifleZ, muzzle, flash,
    skin: skinIdx % MERC_SKINS.length, bulk: b,
  };
}
