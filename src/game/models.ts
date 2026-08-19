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
  color: 0xff3b30, emissive: 0xff2015, emissiveIntensity: 2.6, metalness: 0, roughness: 0.4,
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
   Forward = -Z. Roughly real-world scale.
   ============================================================ */
export function buildPistol(): WeaponModel {
  const g = new THREE.Group();

  // slide with stepped front
  g.add(box(0.056, 0.062, 0.27, steel, 0, 0, -0.045));
  g.add(box(0.048, 0.05, 0.05, steel, 0, -0.002, -0.195));
  // slide serrations
  for (let i = 0; i < 5; i++) g.add(box(0.06, 0.05, 0.006, steelDark, 0, 0, 0.02 + i * 0.014));
  // barrel / muzzle crown
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.06, 10), steelDark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.004, -0.235);
  g.add(barrel);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.016, 0.02, 10), steel);
  crown.rotation.x = Math.PI / 2;
  crown.position.set(0, 0.004, -0.255);
  g.add(crown);
  // frame + rail
  g.add(box(0.05, 0.042, 0.2, steelDark, 0, -0.052, -0.03));
  g.add(box(0.042, 0.014, 0.12, steel, 0, -0.028, -0.11));
  // trigger guard + trigger
  g.add(box(0.012, 0.05, 0.014, steelDark, 0, -0.085, -0.055));
  g.add(box(0.04, 0.012, 0.014, steelDark, 0, -0.105, -0.035));
  g.add(box(0.008, 0.03, 0.008, amberPart, 0, -0.078, -0.035));
  // grip, angled
  const grip = box(0.052, 0.125, 0.05, polymer, 0, -0.135, 0.045);
  grip.rotation.x = 0.3;
  g.add(grip);
  g.add(box(0.056, 0.02, 0.054, amberPart, 0, -0.192, 0.062).rotateX(0.3));
  // hammer + beavertail
  g.add(box(0.02, 0.03, 0.02, steel, 0, 0.012, 0.09));
  g.add(box(0.05, 0.02, 0.045, steelDark, 0, -0.04, 0.085));
  // sights — front fiber post, rear notch
  const fs = box(0.009, 0.02, 0.009, steelDark, 0, 0.041, -0.185);
  g.add(fs);
  g.add(box(0.005, 0.008, 0.005, sightGlow, 0, 0.05, -0.185));
  g.add(box(0.016, 0.016, 0.012, steelDark, -0.02, 0.038, 0.06));
  g.add(box(0.016, 0.016, 0.012, steelDark, 0.02, 0.038, 0.06));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.004, -0.27);
  g.add(muzzle);
  const flash = addFlash(muzzle, 0.3);

  return { group: g, muzzle, flash };
}

/* ============================================================
   PTARMIGAN M9 — original compact 9mm PDW / SMG, full-auto
   Forward = -Z.
   ============================================================ */
export function buildSMG(): WeaponModel {
  const g = new THREE.Group();

  // receiver
  g.add(box(0.062, 0.078, 0.34, steel, 0, 0, -0.02));
  g.add(box(0.066, 0.05, 0.2, steelDark, 0, -0.012, -0.05));
  // top rail + reflex sight
  g.add(box(0.042, 0.016, 0.3, steelDark, 0, 0.047, -0.03));
  const sight = box(0.036, 0.05, 0.055, polymer, 0, 0.085, -0.06);
  g.add(sight);
  g.add(box(0.028, 0.034, 0.006, new THREE.MeshStandardMaterial({ color: 0x0d1114, metalness: 0.2, roughness: 0.2 }), 0, 0.085, -0.086));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 8, 8), sightGlow);
  dot.position.set(0, 0.085, -0.084);
  g.add(dot);
  // barrel shroud with vent ports
  const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.24, 12), steel);
  shroud.rotation.x = Math.PI / 2;
  shroud.position.set(0, 0.008, -0.3);
  shroud.castShadow = true;
  g.add(shroud);
  for (let i = 0; i < 3; i++) {
    g.add(box(0.05, 0.012, 0.02, steelDark, 0, 0.008, -0.24 - i * 0.055));
  }
  // muzzle brake
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.013, 0.05, 10), steelDark);
  brake.rotation.x = Math.PI / 2;
  brake.position.set(0, 0.008, -0.445);
  g.add(brake);
  // angled magazine with amber band
  const mag = box(0.036, 0.17, 0.06, polymer, 0, -0.115, -0.045);
  mag.rotation.x = -0.16;
  g.add(mag);
  const band = box(0.038, 0.02, 0.062, amberPart, 0, -0.075, -0.05);
  band.rotation.x = -0.16;
  g.add(band);
  // foregrip
  const fg = box(0.03, 0.075, 0.038, polymer, 0, -0.062, -0.185);
  fg.rotation.x = 0.24;
  g.add(fg);
  // pistol grip + trigger guard
  const pg = box(0.04, 0.105, 0.045, polymer, 0, -0.09, 0.1);
  pg.rotation.x = 0.32;
  g.add(pg);
  g.add(box(0.01, 0.045, 0.012, steelDark, 0, -0.062, 0.045));
  g.add(box(0.008, 0.026, 0.008, amberPart, 0, -0.055, 0.058));
  // folding stock
  g.add(box(0.014, 0.04, 0.16, steelDark, -0.026, 0.01, 0.22));
  g.add(box(0.014, 0.04, 0.16, steelDark, 0.026, 0.01, 0.22));
  g.add(box(0.07, 0.075, 0.03, polymer, 0, 0.005, 0.3));
  g.add(box(0.074, 0.075, 0.012, amberPart, 0, 0.005, 0.318));
  // charging handle
  g.add(box(0.012, 0.012, 0.05, amberPart, 0.042, 0.03, 0.02));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.008, -0.475);
  g.add(muzzle);
  const flash = addFlash(muzzle, 0.36);

  return { group: g, muzzle, flash };
}

/* ============================================================
   MERCENARY — winter operator, faces +Z
   ============================================================ */
export interface MercModel {
  group: THREE.Group;
  head: THREE.Mesh;
  torso: THREE.Mesh;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  muzzle: THREE.Object3D;
  flash: THREE.Sprite;
}

const coatMats = ['#33403a', '#3a4149', '#2e3a44', '#41403a'].map((c) => {
  const m = new THREE.MeshStandardMaterial({ map: camoTexture(c), roughness: 0.85, metalness: 0.05 });
  return m;
});
const vestMat = new THREE.MeshStandardMaterial({ color: 0x1d2328, roughness: 0.7, metalness: 0.25 });
const pantsMat = new THREE.MeshStandardMaterial({ color: 0x232a2e, roughness: 0.9 });
const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.8 });
const hoodMats = [
  new THREE.MeshStandardMaterial({ color: 0xdfe8ea, roughness: 0.9 }),
  new THREE.MeshStandardMaterial({ color: 0x2c3438, roughness: 0.9 }),
];

function limb(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, -h / 2, 0); // pivot at top
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function buildMercenary(seed: number): MercModel {
  const g = new THREE.Group();
  const coat = coatMats[seed % coatMats.length];
  const hood = hoodMats[seed % hoodMats.length];

  // legs
  const legL = limb(0.15, 0.55, 0.19, pantsMat, -0.11, 0.85, 0);
  const legR = limb(0.15, 0.55, 0.19, pantsMat, 0.11, 0.85, 0);
  g.add(legL, legR);
  // boots
  const bootL = box(0.16, 0.1, 0.26, polymer, -0.11, 0.05, 0.03);
  const bootR = box(0.16, 0.1, 0.26, polymer, 0.11, 0.05, 0.03);
  g.add(bootL, bootR);
  // torso + vest + pouches
  const torso = box(0.5, 0.58, 0.3, coat, 0, 1.16, 0);
  g.add(torso);
  g.add(box(0.54, 0.36, 0.36, vestMat, 0, 1.2, 0));
  g.add(box(0.1, 0.1, 0.05, vestMat, -0.14, 1.16, 0.2));
  g.add(box(0.1, 0.1, 0.05, vestMat, 0.14, 1.16, 0.2));
  g.add(box(0.3, 0.03, 0.02, redGlow, 0, 1.34, 0.19)); // IR strobe strip
  // shoulders
  g.add(box(0.16, 0.12, 0.24, vestMat, -0.31, 1.42, 0));
  g.add(box(0.16, 0.12, 0.24, vestMat, 0.31, 1.42, 0));
  // arms — right arm holds rifle forward, left supports
  const armR = limb(0.12, 0.5, 0.14, coat, 0.31, 1.38, 0);
  armR.rotation.x = -1.25;
  g.add(armR);
  const armL = limb(0.12, 0.5, 0.14, coat, -0.31, 1.38, 0);
  armL.rotation.x = -1.05;
  armL.rotation.y = 0.5;
  g.add(armL);
  // rifle (muzzle +Z)
  const rifle = new THREE.Group();
  rifle.position.set(0.14, 1.28, 0.12);
  rifle.add(box(0.05, 0.07, 0.34, steelDark, 0, 0, 0.1));
  rifle.add(box(0.04, 0.05, 0.12, steel, 0, -0.01, 0.32));
  const rbarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8), steel);
  rbarrel.rotation.x = Math.PI / 2;
  rbarrel.position.set(0, 0.01, 0.44);
  rifle.add(rbarrel);
  const rmag = box(0.03, 0.12, 0.05, polymer, 0, -0.09, 0.06);
  rmag.rotation.x = 0.2;
  rifle.add(rmag);
  rifle.add(box(0.03, 0.06, 0.04, polymer, 0, -0.06, -0.08));
  g.add(rifle);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, 0.56);
  rifle.add(muzzle);
  const flash = addFlash(muzzle, 0.42);

  // head: balaclava + hood + glowing visor
  const head = box(0.22, 0.25, 0.23, skinMat, 0, 1.6, 0.01);
  g.add(head);
  g.add(box(0.235, 0.12, 0.24, hood, 0, 1.68, 0));
  g.add(box(0.225, 0.1, 0.05, new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.9 }), 0, 1.63, -0.1));
  const visor = box(0.19, 0.055, 0.02, redGlow, 0, 1.615, 0.125);
  g.add(visor);

  const s = 0.96 + (seed % 5) * 0.03;
  g.scale.setScalar(s);

  return { group: g, head, torso, legL, legR, armL, muzzle, flash };
}
