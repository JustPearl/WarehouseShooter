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
   PTARMIGAN M9 — original 9mm AR-platform carbine, full-auto.
   Flat-sided upper/lower receivers with true AR proportions (19cm receiver,
   6.2cm wide, ~7.4cm tall), free-float handguard, short barrel, straight
   stick mag, skeleton stock, basic iron sights. Forward = -Z.
   Bore axis at y=0; iron sight line at y=+0.062. The whole group is scaled
   1.2× for first-person presence; engine anchors are compensated
   (ads.y = -0.074, ads.z = -0.48). Total length ~75cm ≈ 2.3× the sidearm.   ============================================================ */
export function buildSMG(): WeaponModel {
  const g = new THREE.Group();

  // ---- upper receiver: flat-sided AR upper, true 19cm length ----
  g.add(box(0.062, 0.040, 0.190, steel, 0, 0.006, 0.010)); // z -0.085..+0.105
  g.add(box(0.040, 0.012, 0.185, steelDark, 0, 0.032, 0.010)); // top picatinny rail
  for (let i = 0; i < 7; i++) g.add(box(0.040, 0.004, 0.006, steel, 0, 0.039, -0.052 + i * 0.021)); // rail teeth
  // ejection port + hinged dust cover on the right side (+X)
  g.add(box(0.004, 0.022, 0.044, steelDark, 0.032, 0.004, 0.000)); // port recess
  g.add(box(0.004, 0.026, 0.048, steel, 0.0345, 0.004, 0.001)); // dust cover
  g.add(box(0.012, 0.020, 0.016, steelDark, 0.033, 0.002, 0.042)); // brass deflector
  // forward assist + rear charging handle
  const fa = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.014, 8), steelDark);
  fa.rotation.z = Math.PI / 2;
  fa.position.set(0.036, -0.004, 0.058);
  fa.castShadow = true;
  g.add(fa);
  g.add(box(0.026, 0.007, 0.012, steelDark, -0.010, 0.040, 0.102));
  g.add(box(0.010, 0.015, 0.008, steelDark, -0.020, 0.036, 0.106));

  // ---- barrel nut + free-float handguard (17.5cm) with M-LOK slots ----
  g.add(box(0.056, 0.044, 0.022, steelDark, 0, 0.004, -0.096));
  // octagonal profile: roll the cross-section in the GEOMETRY (around the cylinder's own axis)
  // so the flats sit flat top/bottom/sides — a mesh rotation.z here would skew the whole axis
  const shroudGeo = new THREE.CylinderGeometry(0.027, 0.027, 0.175, 8);
  shroudGeo.rotateY(Math.PI / 8);
  const shroud = new THREE.Mesh(shroudGeo, steel);
  shroud.rotation.x = Math.PI / 2;
  shroud.position.set(0, 0.002, -0.195); // z -0.107..-0.282
  shroud.castShadow = true;
  g.add(shroud);
  for (const sx of [-0.024, 0.024]) for (let i = 0; i < 3; i++)
    g.add(box(0.006, 0.026, 0.016, steelDark, sx, 0.002, -0.150 - i * 0.045)); // side slots
  for (let i = 0; i < 3; i++) g.add(box(0.020, 0.006, 0.016, steelDark, 0, -0.024, -0.150 - i * 0.045)); // bottom slots

  // ---- short barrel + slotted birdcage flash hider ----
  const barrelTip = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.10, 10), steelDark);
  barrelTip.rotation.x = Math.PI / 2;
  barrelTip.position.set(0, 0.002, -0.332); // -0.282..-0.382
  barrelTip.castShadow = true;
  g.add(barrelTip);
  const hider = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.012, 0.045, 10), steelDark);
  hider.rotation.x = Math.PI / 2;
  hider.position.set(0, 0.002, -0.404);
  hider.castShadow = true;
  g.add(hider);
  for (let i = 0; i < 2; i++) g.add(box(0.028, 0.005, 0.008, steel, 0, 0.002, -0.394 - i * 0.016));

  // ---- basic iron sights: front post + rear aperture, sight line at y=+0.062 ----
  g.add(box(0.020, 0.036, 0.020, steelDark, 0, 0.028, -0.270)); // front base
  g.add(box(0.004, 0.028, 0.008, steelDark, -0.008, 0.050, -0.270)); // ear L
  g.add(box(0.004, 0.028, 0.008, steelDark, 0.008, 0.050, -0.270)); // ear R
  g.add(box(0.004, 0.024, 0.004, steel, 0, 0.050, -0.270)); // post
  g.add(box(0.005, 0.006, 0.005, sightGlow, 0, 0.060, -0.270)); // fiber tip
  g.add(box(0.016, 0.018, 0.020, steelDark, 0, 0.048, 0.075)); // rear riser
  const aperture = new THREE.Mesh(new THREE.TorusGeometry(0.0055, 0.0018, 8, 16), steel);
  aperture.position.set(0, 0.062, 0.075);
  aperture.castShadow = true;
  g.add(aperture);
  g.add(box(0.004, 0.020, 0.006, steelDark, -0.011, 0.060, 0.075)); // ear L
  g.add(box(0.004, 0.020, 0.006, steelDark, 0.011, 0.060, 0.075)); // ear R

  // ---- lower receiver: flat-sided AR lower with magwell flare + takedown pins ----
  g.add(box(0.060, 0.034, 0.140, steel, 0, -0.031, 0.020)); // z -0.050..+0.090
  g.add(box(0.064, 0.022, 0.064, steelDark, 0, -0.056, -0.028)); // magwell flare
  for (const pz of [-0.045, 0.075]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.070, 8), steelDark);
    pin.rotation.z = Math.PI / 2;
    pin.position.set(0, -0.018, pz);
    pin.castShadow = true;
    g.add(pin);
  }

  // ---- straight 30-round stick mag — drops perfectly vertical, zero cant ----
  const mag = box(0.026, 0.175, 0.060, polymer, 0, -0.152, -0.028);
  g.add(mag);
  g.add(box(0.004, 0.150, 0.012, steelDark, -0.012, -0.140, -0.028)); // witness rib L
  g.add(box(0.004, 0.150, 0.012, steelDark, 0.012, -0.140, -0.028)); // witness rib R
  g.add(box(0.028, 0.014, 0.062, amberPart, 0, -0.228, -0.028)); // base band
  g.add(box(0.030, 0.010, 0.064, steelDark, 0, -0.243, -0.028)); // baseplate

  // ---- trigger group: curved trigger, guard, safety lever ----
  g.add(box(0.010, 0.048, 0.012, steelDark, 0, -0.072, 0.028)); // guard front post
  g.add(box(0.010, 0.010, 0.060, steelDark, 0, -0.094, 0.055)); // guard bottom
  const trg = box(0.008, 0.026, 0.010, amberPart, 0, -0.068, 0.050);
  trg.rotation.x = 0.35;
  g.add(trg);
  g.add(box(0.008, 0.018, 0.010, amberPart, -0.033, -0.030, 0.048)); // safety lever

  // ---- A2-style pistol grip, raked back ----
  const pg = box(0.036, 0.105, 0.050, polymer, 0, -0.100, 0.088);
  pg.rotation.x = 0.26;
  g.add(pg);
  const pgTex = box(0.032, 0.010, 0.046, steelDark, 0, -0.062, 0.076);
  pgTex.rotation.x = 0.26;
  g.add(pgTex);
  const pgCap = box(0.038, 0.012, 0.052, amberPart, 0, -0.152, 0.102);
  pgCap.rotation.x = 0.26;
  g.add(pgCap);

  // ---- buffer tube + open-frame skeleton stock ----
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.140, 10), steelDark);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.012, 0.175); // z 0.105..0.245
  tube.castShadow = true;
  g.add(tube);
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.012, 6), steel);
  nut.rotation.x = Math.PI / 2;
  nut.position.set(0, 0.012, 0.112); // castle nut
  nut.castShadow = true;
  g.add(nut);
  // skeleton frame: front link + top/bottom struts, open middle, slim pad
  g.add(box(0.030, 0.070, 0.014, steelDark, 0, 0.012, 0.247)); // front link plate
  g.add(box(0.010, 0.012, 0.070, steelDark, 0, 0.045, 0.282)); // top strut
  g.add(box(0.010, 0.012, 0.070, steelDark, 0, -0.021, 0.282)); // bottom strut
  g.add(box(0.045, 0.085, 0.014, polymer, 0, 0.012, 0.318)); // buttpad frame
  g.add(box(0.049, 0.089, 0.008, amberPart, 0, 0.012, 0.327)); // rubber pad

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.002, -0.435);
  muzzle.rotation.y = Math.PI; // gun is built facing -Z: make +Z point down the barrel
  g.add(muzzle);
  const flash = addFlash(muzzle, 0.27);

  // presence pass: first-person long guns read best oversized. Push the whole carbine
  // to ~1.8× real scale so it dominates the frame against the sidearm —
  // engine ads/hip anchors are compensated for this scale.
  g.scale.setScalar(1.2);

  return { group: g, muzzle, flash };
}

/* ============================================================
   SABLE .38 — compact snub-nose double-action revolver, ~22.5cm
   on screen with a true short 2-inch barrel. Faces -Z.
   Open-sided frame: nose, recoil shield, top strap, crane +
   floor and a solid lockwork body; the cylinder is fully
   visible in the window between them.
   Bore axis at y=+0.012; fixed sight line at y=+0.052
   (engine ads.y = -0.052); muzzle anchor z=-0.140; the grip
   rakes toward the shooter (butt to +Z).
   ============================================================ */
export function buildRevolver(): WeaponModel {
  const g = new THREE.Group();

  const wood = new THREE.MeshStandardMaterial({ color: 0x5c3a20, metalness: 0.05, roughness: 0.72 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x3e2714, metalness: 0.05, roughness: 0.85 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb98a3e, metalness: 0.85, roughness: 0.35 });
  const amberDot = new THREE.MeshStandardMaterial({ color: 0xff9a3c, emissive: 0xff7a1a, emissiveIntensity: 1.4 });
  const cyl = (r: number, len: number, mat: THREE.Material, x: number, y: number, z: number, seg = 14) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
    m.rotation.x = Math.PI / 2; // lay the axis along the bore (Z)
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  };

  // ---- a real revolver frame, open on both sides so the cylinder is fully
  //      visible: frame nose in front, recoil shield behind, top strap over,
  //      crane + floor under, solid lockwork body carrying the side plate ----
  const winY = 0.009; // vertical centre of the frame window
  // frame nose: the barrel + underlug pass through its machined bosses
  g.add(box(0.034, 0.068, 0.014, steel, 0, 0.006, -0.053)); // z -0.060..-0.046
  g.add(cyl(0.0145, 0.018, steelDark, 0, 0.012, -0.0615, 16)); // barrel boss on the nose face
  g.add(cyl(0.0100, 0.016, steelDark, 0, -0.010, -0.0605, 12)); // underlug boss
  // recoil shield: thin plate with the firing-pin + extractor-rod bosses
  g.add(box(0.034, 0.062, 0.008, steel, 0, 0.005, 0.018)); // z 0.014..0.022
  g.add(cyl(0.0045, 0.005, steelDark, 0, winY - 0.001, 0.0142, 10)); // firing-pin boss
  g.add(cyl(0.0035, 0.005, steelDark, 0, -0.006, 0.0142, 10)); // extractor-rod hole
  // top strap: nose to just past the cylinder, where the hammer channel begins
  g.add(box(0.030, 0.009, 0.072, steel, 0, 0.0405, -0.020)); // z -0.056..0.016
  for (let i = 0; i < 4; i++) g.add(box(0.030, 0.003, 0.004, steelDark, 0, 0.046, -0.012 - i * 0.009)); // glare serrations
  // frame floor under the cylinder, nose to recoil shield
  g.add(box(0.034, 0.012, 0.066, steel, 0, -0.025, -0.013)); // z -0.046..0.020
  // solid lockwork body behind the shield — carries the side plate, hammer, grip
  g.add(box(0.032, 0.050, 0.054, steel, 0, 0.000, 0.049)); // z 0.022..0.076
  // swing-out crane arm reaching into the front of the window + pivot screw
  g.add(box(0.022, 0.007, 0.007, steelDark, -0.013, 0.020, -0.042));
  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.008, 10), brass);
  pivot.rotation.z = Math.PI / 2;
  pivot.position.set(-0.0255, 0.020, -0.042);
  g.add(pivot);
  // side plate on the lockwork + its screws
  for (const sx of [0.017, -0.017]) g.add(box(0.002, 0.036, 0.044, steelDark, sx, 0.000, 0.049));
  for (const sx of [0.0185, -0.0185]) {
    for (const [sy, sz] of [[0.014, 0.036], [-0.010, 0.052], [0.012, 0.066]] as const) {
      const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 0.005, 8), brass);
      sc.rotation.z = Math.PI / 2;
      sc.position.set(sx, sy, sz);
      g.add(sc);
    }
  }
  // cylinder release latch on the left of the lockwork
  g.add(box(0.006, 0.013, 0.026, steelDark, -0.019, 0.022, 0.030));
  g.add(box(0.008, 0.004, 0.018, steel, -0.020, 0.022, 0.030));

  // ---- barrel: passes through the front plate and seats into the frame ----
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0125, 0.082, 14), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.012, -0.099); // z -0.140..-0.058
  barrel.castShadow = true;
  g.add(barrel);
  g.add(cyl(0.0115, 0.006, steelDark, 0, 0.012, -0.1375)); // recessed muzzle crown
  g.add(cyl(0.0135, 0.012, steelDark, 0, 0.012, -0.056, 12)); // forcing cone inside the front plate
  // ---- underlug + ejector rod, running back into the front plate ----
  g.add(cyl(0.008, 0.070, steel, 0, -0.010, -0.091)); // z -0.126..-0.056
  g.add(cyl(0.0032, 0.076, steelDark, 0, -0.010, -0.090, 10)); // rod
  g.add(cyl(0.0045, 0.007, steelDark, 0, -0.010, -0.125, 10)); // rod knurl
  g.add(cyl(0.0038, 0.012, steel, 0, -0.010, -0.130, 10)); // rod tip

  // ---- cylinder: five-shot, nested in the window with a machined gap all around ----
  g.add(cyl(0.0268, 0.056, steel, 0, winY - 0.001, -0.022, 20)); // z -0.050..+0.006
  for (let i = 0; i < 6; i++) { // flutes running front-to-back
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const fl = box(0.010, 0.005, 0.046, steelDark, Math.cos(a) * 0.0252, winY - 0.001 + Math.sin(a) * 0.0252, -0.022);
    fl.rotation.z = a + Math.PI / 2;
    g.add(fl);
  }
  // chamber mouths + extractor star on the cylinder's front face, visible through the nose
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    g.add(cyl(0.006, 0.006, steelDark, Math.cos(a) * 0.015, winY - 0.001 + Math.sin(a) * 0.015, -0.051, 10));
  }
  g.add(cyl(0.0065, 0.006, steelDark, 0, winY - 0.001, -0.051, 10));

  // ---- hammer with a checkered spur, riding the hammer housing ----
  g.add(box(0.012, 0.030, 0.014, steelDark, 0, 0.038, 0.042));
  const spur = box(0.013, 0.008, 0.026, steelDark, 0, 0.056, 0.050);
  spur.rotation.x = -0.5;
  g.add(spur);
  for (let i = 0; i < 3; i++) {
    const se = box(0.015, 0.003, 0.016, steel, 0, 0.058, 0.044 + i * 0.007);
    se.rotation.x = -0.5;
    g.add(se);
  }

  // ---- front sight: pinned ramp + blade with an amber fiber dot ----
  const ramp = box(0.012, 0.012, 0.016, steel, 0, 0.034, -0.118);
  ramp.rotation.x = 0.35;
  g.add(ramp);
  g.add(box(0.006, 0.016, 0.008, steelDark, 0, 0.046, -0.114));
  g.add(box(0.0038, 0.0038, 0.004, amberDot, 0, 0.051, -0.119));

  // ---- trigger guard + smooth double-action trigger ----
  const guardGrp = new THREE.Group();
  guardGrp.position.set(0, -0.020, 0.000);
  guardGrp.rotation.y = Math.PI / 2; // ring plane spans Y-Z (finger loops fore-aft)
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.020, 0.0045, 8, 20, Math.PI), steel);
  guard.rotation.z = Math.PI; // hang the loop below the frame floor
  guard.castShadow = true;
  guardGrp.add(guard);
  g.add(guardGrp);
  g.add(box(0.013, 0.026, 0.008, steel, 0, -0.023, -0.020)); // front strap off the floor
  const trig = box(0.005, 0.028, 0.012, steel, 0, -0.023, -0.004);
  trig.rotation.x = 0.35;
  g.add(trig);

  // ---- grip: steel grip frame welded to the receiver, walnut panels on it,
  //      raked toward the shooter (negative X rotation = butt to +Z) ----
  const grip = new THREE.Group();
  grip.position.set(0, -0.024, 0.044); // hangs off the hammer housing
  grip.rotation.x = -0.30;
  grip.add(box(0.026, 0.092, 0.030, steelDark, 0, -0.040, 0)); // steel grip frame
  grip.add(box(0.030, 0.084, 0.007, wood, 0, -0.042, 0.0155)); // left walnut panel
  grip.add(box(0.030, 0.084, 0.007, wood, 0, -0.042, -0.0155)); // right walnut panel
  for (let i = 0; i < 5; i++) { // checkering stripes on both panels
    grip.add(box(0.031, 0.003, 0.002, woodDark, 0, -0.016 - i * 0.014, 0.0195));
    grip.add(box(0.031, 0.003, 0.002, woodDark, 0, -0.016 - i * 0.014, -0.0195));
  }
  grip.add(box(0.028, 0.012, 0.032, woodDark, 0, -0.092, 0)); // round butt cap
  const med = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.003, 12), brass);
  med.rotation.z = Math.PI / 2;
  med.position.set(0.0175, -0.045, 0);
  grip.add(med);
  const med2 = med.clone();
  med2.position.x = -0.0175;
  grip.add(med2);
  g.add(grip);

  // ---- rear sight: square notch cut into the top strap ----
  g.add(box(0.007, 0.010, 0.010, steelDark, 0.009, 0.047, 0.006));
  g.add(box(0.007, 0.010, 0.010, steelDark, -0.009, 0.047, 0.006));

  // ---- muzzle anchor + flash (at the new short-barrel crown) ----
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, -0.140);
  muzzle.rotation.y = Math.PI; // gun is built facing -Z: make +Z point down the barrel
  g.add(muzzle);
  const flash = addFlash(muzzle, 0.22);

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
