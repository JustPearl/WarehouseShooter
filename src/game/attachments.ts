import * as THREE from 'three';
import type { WeaponModel } from './models';

/* ---------- visual attachment meshes (hidden until equipped) ---------- */

const attSteel = new THREE.MeshStandardMaterial({ color: 0x2c3238, metalness: 0.7, roughness: 0.42 });
const attDark = new THREE.MeshStandardMaterial({ color: 0x1a1f24, metalness: 0.4, roughness: 0.7 });
const attPoly = new THREE.MeshStandardMaterial({ color: 0x1c2126, metalness: 0.15, roughness: 0.8 });
const attAmber = new THREE.MeshStandardMaterial({ color: 0xff9a3c, emissive: 0xff7a1a, emissiveIntensity: 0.7 });
const attBeamMat = new THREE.MeshBasicMaterial({
  color: 0x8dffb0, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false,
});

function attBox(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  m.castShadow = true;
  return m;
}

function attCyl(r: number, len: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function laserBeam(y: number): THREE.Mesh {
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.0016, 2.2), attBeamMat);
  b.position.set(0, y, -1.24);
  return b;
}

/** Build every attachment mesh for a weapon, hidden; toggled by Engine.applyLoadout. */
export function buildAttNodes(model: WeaponModel, wi: number): Record<string, THREE.Object3D> {
  const g = model.group;
  const out: Record<string, THREE.Object3D> = {};
  const put = (id: string, ...ms: THREE.Object3D[]) => {
    const grp = new THREE.Group();
    ms.forEach((m) => grp.add(m));
    grp.visible = false;
    g.add(grp);
    out[id] = grp;
  };
  if (wi === 0) {
    // KODIAK .45 (muzzle at z=-0.22, bore y=0)
    const suppG = new THREE.Group();
    suppG.add(attCyl(0.0185, 0.10, attDark, 0, 0, -0.255));
    suppG.add(attCyl(0.0195, 0.012, attSteel, 0, 0, -0.21));
    put('supp', suppG);
    const compG = new THREE.Group();
    compG.add(attCyl(0.016, 0.055, attSteel, 0, 0, -0.235));
    compG.add(attBox(0.034, 0.014, 0.01, attDark, 0, 0.011, -0.235));
    compG.add(attBox(0.034, 0.014, 0.01, attDark, 0, 0.011, -0.255));
    put('comp', compG);
    put('xmag', attBox(0.052, 0.05, 0.05, attPoly, 0, -0.222, 0.072, 0.3), attBox(0.054, 0.012, 0.052, attAmber, 0, -0.248, 0.08, 0.3));
    put('laser', attBox(0.02, 0.026, 0.055, attDark, 0, -0.055, -0.115), attBox(0.008, 0.008, 0.008, attAmber, 0, -0.055, -0.145), laserBeam(-0.055));
    put('match', attBox(0.009, 0.036, 0.01, attAmber, 0, -0.076, -0.041));
    put('lslide', attBox(0.056, 0.058, 0.078, attSteel, 0, 0.001, -0.205), attCyl(0.012, 0.05, attDark, 0, 0.004, -0.25));
  } else if (wi === 1) {
    // PTARMIGAN M9 (bore y=+0.002, handguard z -0.107..-0.282, muzzle z=-0.42)
    const suppG = new THREE.Group();
    suppG.add(attCyl(0.021, 0.13, attDark, 0, 0.002, -0.42));
    suppG.add(attCyl(0.022, 0.014, attSteel, 0, 0.002, -0.36));
    put('supp', suppG);
    const compG = new THREE.Group();
    compG.add(attCyl(0.0175, 0.06, attSteel, 0, 0.002, -0.40));
    compG.add(attBox(0.038, 0.014, 0.012, attDark, 0, 0.015, -0.39));
    compG.add(attBox(0.038, 0.014, 0.012, attDark, 0, 0.015, -0.415));
    put('comp', compG);
    put('xmag', attBox(0.052, 0.09, 0.06, attPoly, 0, -0.288, -0.058, -0.12), attBox(0.054, 0.014, 0.062, attAmber, 0, -0.33, -0.063, -0.12));
    put('laser', attBox(0.022, 0.028, 0.06, attDark, 0, -0.035, -0.22), attBox(0.008, 0.008, 0.008, attAmber, 0, -0.035, -0.252), laserBeam(-0.035));
    put('vgrip', attBox(0.03, 0.095, 0.042, attPoly, 0, -0.068, -0.19, 0.15), attBox(0.032, 0.012, 0.044, attDark, 0, -0.104, -0.185, 0.15));
    const rdotG = new THREE.Group();
    rdotG.add(attBox(0.03, 0.034, 0.05, attPoly, 0, 0.068, -0.015));
    rdotG.add(attBox(0.024, 0.026, 0.004, new THREE.MeshStandardMaterial({ color: 0x0d1114, metalness: 0.2, roughness: 0.2 }), 0, 0.07, -0.04));
    const rdot = new THREE.Mesh(new THREE.SphereGeometry(0.003, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2015, emissiveIntensity: 2.2 }));
    rdot.position.set(0, 0.07, -0.038);
    rdotG.add(rdot);
    put('rdot', rdotG);
  } else if (wi === 2) {
    // SABLE .38 (bore y=+0.012, snub crown z=-0.134, muzzle anchor z=-0.140,
    // cylinder z=-0.022, underlug z -0.055..-0.123, grip raked from z=+0.058)
    const suppG = new THREE.Group();
    suppG.add(attCyl(0.0155, 0.075, attDark, 0, 0.012, -0.177));
    suppG.add(attCyl(0.0165, 0.010, attSteel, 0, 0.012, -0.145));
    put('supp', suppG);
    // 7-shot cylinder conversion: a taller cylinder with an amber charge band
    const xmagG = new THREE.Group();
    xmagG.add(attCyl(0.0335, 0.060, attSteel, 0, 0.012, -0.022));
    xmagG.add(attBox(0.060, 0.010, 0.060, attAmber, 0, 0.012, -0.022));
    put('xmag', xmagG);
    put('laser', attBox(0.017, 0.020, 0.046, attDark, 0, -0.032, -0.088), attBox(0.007, 0.007, 0.007, attAmber, 0, -0.032, -0.114), laserBeam(-0.032));
    // target grips: smoother dark walnut with a palm swell
    put('grips', attBox(0.044, 0.102, 0.052, attPoly, 0, -0.098, 0.067, -0.34), attBox(0.046, 0.013, 0.054, attSteel, 0, -0.052, 0.052, -0.34));
  } else {
    // RAVEN 12 (pre-scale coords; group is scaled 1.15× — bore y=+0.010, muzzle z=-0.415,
    // tube y=-0.018, forend z≈-0.14, receiver top y=+0.034)
    // tactical choke: a ported cylinder over the muzzle crown
    const chokeG = new THREE.Group();
    chokeG.add(attCyl(0.0175, 0.055, attSteel, 0, 0.010, -0.428));
    chokeG.add(attBox(0.038, 0.012, 0.010, attDark, 0, 0.020, -0.418));
    chokeG.add(attBox(0.038, 0.012, 0.010, attDark, 0, 0.020, -0.438));
    put('choke', chokeG);
    // tube extension: two extra shells out past the mag cap + amber band
    const tubeG = new THREE.Group();
    tubeG.add(attCyl(0.014, 0.06, attSteel, 0, -0.018, -0.392));
    tubeG.add(attCyl(0.016, 0.012, attDark, 0, -0.018, -0.42));
    tubeG.add(attBox(0.030, 0.008, 0.024, attAmber, 0, -0.036, -0.404));
    put('tube', tubeG);
    // angled vertical foregrip under the tube
    put('fgrip', attBox(0.026, 0.085, 0.036, attPoly, 0, -0.076, -0.235, 0.12), attBox(0.028, 0.010, 0.038, attDark, 0, -0.112, -0.230, 0.12));
    // laser clamped under the barrel clamp
    put('laser', attBox(0.020, 0.024, 0.055, attDark, 0, -0.048, -0.31), attBox(0.008, 0.008, 0.008, attAmber, 0, -0.048, -0.34), laserBeam(-0.048));
    // mini reflex on the receiver rail
    const rdotG = new THREE.Group();
    rdotG.add(attBox(0.028, 0.030, 0.046, attPoly, 0, 0.055, 0.03));
    rdotG.add(attBox(0.022, 0.024, 0.004, new THREE.MeshStandardMaterial({ color: 0x0d1114, metalness: 0.2, roughness: 0.2 }), 0, 0.057, 0.008));
    const rdot = new THREE.Mesh(new THREE.SphereGeometry(0.003, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff2015, emissiveIntensity: 2.2 }));
    rdot.position.set(0, 0.057, 0.010);
    rdotG.add(rdot);
    put('rdot', rdotG);
  }
  return out;
}
