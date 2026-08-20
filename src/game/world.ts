import * as THREE from 'three';
import {
  floorTexture, wallTexture, crateTexture, concreteTexture,
  snowGroundTexture, chainLinkTexture, roofTexture,
} from './textures';
import { HALF_W, HALF_D, YARD_W, YARD_D, WORLD_N } from './types';

export interface Lamp { light: THREE.Light; base: number; seed: number; }

export interface WorldRefs {
  solidMeshes: THREE.Mesh[];
  colliderBoxes: THREE.Box3[];
  lamps: Lamp[];
}

/* ------------------------------ lighting ------------------------------ */

export function buildLights(scene: THREE.Scene) {
  // muted sky/ground ambient — the arctic night reads through shadow, not fill
  scene.add(new THREE.HemisphereLight(0x33435a, 0x0b0f15, 0.42));

  // moon: cold, low-contrast key with soft shadows over the whole compound
  const moon = new THREE.DirectionalLight(0x8fb0d8, 1.15);
  moon.position.set(30, 44, -26);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -58;
  moon.shadow.camera.right = 58;
  moon.shadow.camera.top = 50;
  moon.shadow.camera.bottom = -50;
  moon.shadow.camera.near = 6;
  moon.shadow.camera.far = 130;
  moon.shadow.bias = -0.00035;
  moon.shadow.normalBias = 0.035;
  (moon.shadow as unknown as { radius: number }).radius = 3;
  scene.add(moon);

  // faint blue bounce off the snowfield, lifting outdoor shadows just enough
  const bounce = new THREE.DirectionalLight(0x42546e, 0.28);
  bounce.position.set(-24, 10, 30);
  scene.add(bounce);
}

/* ------------------------------ the compound ------------------------------ */

export function buildWorld(scene: THREE.Scene): WorldRefs {
  const solidMeshes: THREE.Mesh[] = [];
  const colliderBoxes: THREE.Box3[] = [];
  const lamps: Lamp[] = [];

  const addSolid = (mesh: THREE.Mesh, kind: 'wall' | 'cover' | 'floor', collide = true) => {
    mesh.userData.kind = kind;
    mesh.receiveShadow = true;
    mesh.castShadow = kind !== 'floor';
    if (!mesh.parent) scene.add(mesh);
    solidMeshes.push(mesh);
    if (collide && kind !== 'floor') {
      mesh.updateWorldMatrix(true, false);
      colliderBoxes.push(new THREE.Box3().setFromObject(mesh));
    }
  };

  // ---- interior: bare swept-concrete depot floor (no snow inside) ----
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.96, metalness: 0.02 });
  floorMat.map!.repeat.set(6, 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2 + 2, HALF_D * 2 + 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  addSolid(floor, 'floor', false);

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
  snowGroundMat.map!.repeat.set(16, 18);
  const yardGround = new THREE.Mesh(new THREE.PlaneGeometry(YARD_W * 2 + 8, YARD_D + WORLD_N + 8), snowGroundMat);
  yardGround.rotation.x = -Math.PI / 2;
  yardGround.position.set(0, -0.02, (YARD_D - WORLD_N) / 2);
  yardGround.receiveShadow = true;
  scene.add(yardGround);

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
    scene.add(grp);
  };
  // south + full east/west runs (sides now reach the new northern boundary)
  // symmetric perimeter — the freight yard sits inside the south strip
  fenceSide(YARD_W * 2, 0, -YARD_D, 0);
  fenceSide(YARD_W * 2, 0, YARD_D, 0);
  fenceSide(YARD_D * 2, -YARD_W, 0, Math.PI / 2);
  fenceSide(YARD_D * 2, YARD_W, 0, Math.PI / 2);
  // fence blocks movement but not bullets — colliders only, no hit meshes
  colliderBoxes.push(
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
    scene.add(drift);
  }

  const wallBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z);
    addSolid(m, 'wall');
  };
  // ---- the freight yard: three east-west tracks running ALONGSIDE the warehouse south wall ----
  const steelRail = new THREE.MeshStandardMaterial({ color: 0x575d63, roughness: 0.4, metalness: 0.8 });
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x2b241c, roughness: 0.95 });
  const trackZs = [26, 29.5, 33]; // parallel to the warehouse's long axis
  const railLen = 92; // x -46..46
  for (const tz of trackZs) {
    // ballast bed
    const bed = new THREE.Mesh(new THREE.BoxGeometry(railLen, 0.05, 3.1), new THREE.MeshStandardMaterial({ color: 0x33383d, roughness: 1 }));
    bed.position.set(0, 0.005, tz);
    bed.receiveShadow = true;
    scene.add(bed);
    // ties
    for (let x = -45; x <= 45; x += 1.5) {
      const tie = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 2.4), tieMat);
      tie.position.set(x, 0.05, tz);
      tie.receiveShadow = true;
      scene.add(tie);
    }
    // two rails
    for (const off of [-0.75, 0.75]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(railLen, 0.13, 0.14), steelRail);
      rail.position.set(0, 0.12, tz + off);
      rail.castShadow = true;
      scene.add(rail);
    }
  }

  // loading platform hugging the warehouse wall (gap left at the south loading bay, x -13..5)
  const platMat = new THREE.MeshStandardMaterial({ color: 0x5a6167, roughness: 0.85, metalness: 0.1 });
  const platEdge = new THREE.MeshStandardMaterial({ color: 0xb98a3c, roughness: 0.6, metalness: 0.2 });
  for (const [px, pw] of [[-22.5, 19], [18.5, 27]] as [number, number][]) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.5, 2.0), platMat);
    deck.position.set(px, 0.25, 23.4);
    deck.castShadow = true;
    deck.receiveShadow = true;
    scene.add(deck);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.5, 0.12), platEdge);
    edge.position.set(px, 0.25, 24.34);
    scene.add(edge);
    addSolid(deck, 'cover');
  }

  // --- freight cars: cover you can fight between ---
  const carTrim = new THREE.MeshStandardMaterial({ color: 0x33383d, roughness: 0.7, metalness: 0.4 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.5, metalness: 0.7 });
  const bogies = (parent: THREE.Group, halfSpan: number) => {
    for (const wz of [-halfSpan, halfSpan]) {
      const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 1.5), carTrim);
      bogie.position.set(0, 0.32, wz);
      parent.add(bogie);
      for (const wx of [-0.75, 0.75]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 12), wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, 0.3, wz + 0.55);
        parent.add(wheel);
      }
    }
  };
  const boxcar = (cx: number, cz: number, body: number) => {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: body, roughness: 0.85, metalness: 0.15 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(9, 2.8, 2.9), mat);
    b.position.y = 1.9;
    b.castShadow = true;
    b.receiveShadow = true;
    b.userData.kind = 'cover';
    g.add(b);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.16, 3.0), new THREE.MeshStandardMaterial({ color: 0xe8f2f6, roughness: 0.95 }));
    roof.position.y = 3.38;
    g.add(roof);
    for (const sx of [-1, 1]) {
      for (let rx = -3.6; rx <= 3.6; rx += 1.2) {
        const vr = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 0.08), carTrim);
        vr.position.set(rx, 1.9, sx * 1.48);
        g.add(vr);
      }
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.4, 0.08), carTrim);
    door.position.set(1.5, 1.9, 1.5);
    g.add(door);
    bogies(g, 3.1);
    g.position.set(cx, 0, cz);
    scene.add(g);
    colliderBoxes.push(new THREE.Box3(new THREE.Vector3(cx - 4.5, 0, cz - 1.45), new THREE.Vector3(cx + 4.5, 3.5, cz + 1.45)));
    solidMeshes.push(b);
  };
  const containerMat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.3 });
  const container = (cx: number, cy: number, cz: number, c: number, solid = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.3, 2.3), containerMat(c));
    m.position.set(cx, cy, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    if (solid) colliderBoxes.push(new THREE.Box3(new THREE.Vector3(cx - 2.8, cy - 1.15, cz - 1.15), new THREE.Vector3(cx + 2.8, cy + 1.15, cz + 1.15)));
    solidMeshes.push(m);
  };
  const flatcar = (cx: number, cz: number, stack: number[]) => {
    const g = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(9, 0.4, 2.9), carTrim);
    deck.position.y = 1.0;
    deck.castShadow = true;
    g.add(deck);
    bogies(g, 3.1);
    g.position.set(cx, 0, cz);
    scene.add(g);
    let topY = 1.2;
    for (const c of stack) {
      container(cx + (Math.random() - 0.5) * 0.6, topY + 1.15, cz, c);
      topY += 2.3;
    }
    colliderBoxes.push(new THREE.Box3(new THREE.Vector3(cx - 4.5, 0, cz - 1.45), new THREE.Vector3(cx + 4.5, 1.2, cz + 1.45)));
    solidMeshes.push(deck);
  };
  const tanker = (cx: number, cz: number) => {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8f9aa3, roughness: 0.45, metalness: 0.6 });
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 7.4, 18), mat);
    shell.rotation.z = Math.PI / 2;
    shell.position.y = 2.0;
    shell.castShadow = true;
    g.add(shell);
    for (const ex of [-3.7, 3.7]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.3, 18, 10), mat);
      cap.scale.set(0.22, 1, 1);
      cap.position.set(ex, 2.0, 0);
      g.add(cap);
    }
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.5, 12), carTrim);
    dome.position.set(1.8, 3.4, 0);
    g.add(dome);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.4, 2.4), carTrim);
    frame.position.y = 0.85;
    g.add(frame);
    bogies(g, 2.6);
    g.position.set(cx, 0, cz);
    scene.add(g);
    colliderBoxes.push(new THREE.Box3(new THREE.Vector3(cx - 3.9, 0, cz - 1.45), new THREE.Vector3(cx + 3.9, 3.4, cz + 1.45)));
    solidMeshes.push(shell);
  };
  // parked consists — staggered so there are always fightable gaps between them
  boxcar(-20, 26, 0x6e4a33);
  boxcar(7, 26, 0x4d5a43);
  flatcar(-8, 29.5, [0x8a5a2b, 0x703828]);
  tanker(17, 29.5);
  boxcar(-29, 33, 0x5a4a5e);
  flatcar(14, 33, [0x3d5a6e]);

  // gantry crane straddling the tracks, west side — the yard's landmark
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xb98a3c, roughness: 0.6, metalness: 0.35 });
  const craneDark = new THREE.MeshStandardMaterial({ color: 0x2e3338, roughness: 0.7, metalness: 0.4 });
  const crane = new THREE.Group();
  for (const lz of [25, 34]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6.4, 0.6), craneMat);
    leg.position.set(0, 3.2, lz - 29.5);
    leg.castShadow = true;
    crane.add(leg);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.0, 0.62), craneDark);
    stripe.position.set(0, 1.0, lz - 29.5);
    crane.add(stripe);
    colliderBoxes.push(new THREE.Box3(new THREE.Vector3(-36.3, 0, lz - 0.3), new THREE.Vector3(-35.7, 6.4, lz + 0.3)));
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 10.6), craneMat);
  beam.position.set(0, 6.6, 0);
  beam.castShadow = true;
  crane.add(beam);
  const trolley = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 1.4), craneDark);
  trolley.position.set(0, 6.0, 1.5);
  crane.add(trolley);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.4, 6), craneDark);
  cable.position.set(0, 4.1, 1.5);
  crane.add(cable);
  crane.position.set(-36, 0, 29.5);
  scene.add(crane);
  container(-36, 2.3, 31, 0x9a5c3c); // a load left hanging mid-yard

  // station shed at the east end, just north of track A
  const shedMat = new THREE.MeshStandardMaterial({ color: 0x4a525a, roughness: 0.8, metalness: 0.2 });
  const shed = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 6), shedMat);
  shed.position.set(41.5, 1.6, 26.5);
  shed.castShadow = true;
  shed.receiveShadow = true;
  scene.add(shed);
  const shedRoof = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.2, 6.8), new THREE.MeshStandardMaterial({ color: 0xe8f2f6, roughness: 0.95 }));
  shedRoof.position.set(41.5, 3.3, 26.5);
  scene.add(shedRoof);
  const shedDoor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 1.8), carTrim);
  shedDoor.position.set(37.95, 1.2, 26.5);
  scene.add(shedDoor);
  const shedWin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 1.4), new THREE.MeshStandardMaterial({ color: 0x2a1e0e, emissive: 0xffa94d, emissiveIntensity: 1.6 }));
  shedWin.position.set(37.96, 2.2, 29.0);
  scene.add(shedWin);
  colliderBoxes.push(new THREE.Box3(new THREE.Vector3(38, 0, 23.5), new THREE.Vector3(45, 3.2, 29.5)));
  solidMeshes.push(shed);

  // cargo stacks: containers west + crates/barrels along the fence lane
  container(-43, 1.2, 26, 0x3d5a6e);
  container(-43, 1.2, 29, 0x703828);
  for (const [bx, bz] of [[-18, 35.4], [4, 35.6], [24, 35.4]] as [number, number][]) {
    const stack = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.7, 1.5), crateMat);
    stack.position.set(bx, 0.85, bz);
    stack.rotation.y = (Math.random() - 0.5) * 0.3;
    stack.castShadow = true;
    scene.add(stack);
    addSolid(stack, 'cover');
  }

  // platform lamps — three amber pools along the loading dock
  for (const lx of [-22, 0, 22]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 5, 8), postMat);
    pole.position.set(lx, 2.5, 23.0);
    pole.castShadow = true;
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.3), craneDark);
    head.position.set(lx, 5.0, 23.2);
    scene.add(head);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffb066, emissiveIntensity: 2.4 }));
    bulb.position.set(lx, 4.85, 23.2);
    scene.add(bulb);
    const pl = new THREE.PointLight(0xffb066, 26, 15, 2);
    pl.position.set(lx, 4.8, 23.4);
    scene.add(pl);
    lamps.push({ light: pl, base: 26, seed: Math.random() * 90 });
  }

  // floodlight washing the yard from the shed roof
  const yardSpot = new THREE.SpotLight(0xcfe3f0, 420, 46, 0.66, 0.6, 1.6);
  yardSpot.position.set(41, 5.5, 27);
  yardSpot.target.position.set(10, 0, 31);
  scene.add(yardSpot.target);
  scene.add(yardSpot);
  lamps.push({ light: yardSpot, base: 420, seed: Math.random() * 90 });

  // signal mast with a dead red lamp at the west throat
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.4, 8), postMat);
  mast.position.set(-44.5, 2.2, 29.5);
  mast.castShadow = true;
  scene.add(mast);
  const sigHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.26), new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.5, metalness: 0.6 }));
  sigHead.position.set(-44.5, 4.3, 29.5);
  scene.add(sigHead);
  const sigLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x220606, emissive: 0xff2222, emissiveIntensity: 1.4 }),
  );
  sigLamp.position.set(-44.5, 4.45, 29.36);
  scene.add(sigLamp);

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
  addSolid(rubbleN, 'cover');
  const rubbleS = new THREE.Mesh(new THREE.BoxGeometry(8, 0.9, 1.4), concreteMat);
  rubbleS.position.set(-8, 0.45, HALF_D);
  addSolid(rubbleS, 'cover');
  const rubbleW = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 3.2), concreteMat);
  rubbleW.position.set(-HALF_W, 0.35, -3.3);
  addSolid(rubbleW, 'cover');
  // snow banks just outside the openings — the cold stays outdoors
  for (const [dx, dz, sx] of [[0, -HALF_D - 1.6, 4.4], [-6, HALF_D + 1.5, 3.4], [-HALF_W - 1.6, 3.4, 2.6]] as [number, number, number][]) {
    const bank = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), snowMat);
    bank.scale.set(sx / 1.6, 0.4, 1);
    bank.position.set(dx, 0.15, dz);
    scene.add(bank);
  }

  // steel columns
  for (const cx of [-21, -7, 7, 21]) {
    for (const cz of [-8, 8]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.55, 7, 0.55), beamMat);
      col.position.set(cx, 3.5, cz);
      addSolid(col, 'cover');
    }
  }
  // ---- complete roof: purlins + cross ties + full-span decking ----
  for (const cx of [-26, -13, 0, 13, 26]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, HALF_D * 2), beamMat);
    beam.position.set(cx, 6.85, 0);
    beam.castShadow = true;
    scene.add(beam);
  }
  for (const cz of [-15, 0, 15]) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2, 0.4, 0.35), beamMat);
    tie.position.set(0, 6.6, cz);
    tie.castShadow = true;
    scene.add(tie);
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
  scene.add(deck);
  solidMeshes.push(deck); // rounds fired skyward end at the ceiling
  // eave fascia for a clean silhouette from the yard
  const fasciaMat = new THREE.MeshStandardMaterial({ color: 0x232b31, roughness: 0.6, metalness: 0.5 });
  const mkFascia = (w: number, d: number, x: number, z: number) => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), fasciaMat);
    f.position.set(x, 7.0, z);
    f.castShadow = true;
    scene.add(f);
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
    scene.add(vent);
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
      addSolid(c, 'cover');
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
      addSolid(b, 'cover');
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
    addSolid(b, 'cover');
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
      addSolid(s, 'cover');
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
  scene.add(truck);
  addSolid(bed, 'cover');
  addSolid(cab, 'cover');

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
    addSolid(cont, 'cover');
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
  scene.add(truck2);
  addSolid(bed2, 'cover');
  addSolid(cab2, 'cover');
  // yard crate stacks & barrel clusters
  for (const [x, z, levels] of [[-36, 5, 2], [35, 25, 1], [-21, -30, 2], [24, -26, 1]] as [number, number, number][]) {
    for (let l = 0; l < levels; l++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), crateMat);
      c.position.set(x + (l > 0 ? 0.08 : 0), 0.65 + l * 1.3, z);
      c.rotation.y = 0.3 + l * 0.25;
      addSolid(c, 'cover');
    }
  }
  for (const [bx, bz] of [[-35, -23], [41, -4], [18, 32]] as [number, number][]) {
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12), barrelMats[i % 3]);
      b.position.set(bx + i * 0.95, i === 2 ? 0.43 : 0.53, bz + (i % 2) * 0.5);
      if (i === 2) b.rotation.z = Math.PI / 2;
      addSolid(b, 'cover');
    }
  }
  for (const [x, z, rot] of [[-37, 1, 1.57], [1, -27, 0.2], [-6, 27, 0.1], [30, 30, 0.8]] as [number, number, number][]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 0.55), concreteMat);
    b.position.set(x, 0.5, z);
    b.rotation.y = rot;
    addSolid(b, 'cover');
  }

  // ---- non-solid dressing: pallets, debris, pipes ----
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5d4a33, roughness: 0.95 });
  for (const [x, z, r] of [[4, 4, 0.4], [-9, -8, 1.2], [15, -14, 0.8], [-22, -14, 0.2], [11, 16, 1.5]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 1.3), woodMat);
    p.position.set(x, 0.06, z);
    p.rotation.y = r;
    p.receiveShadow = true;
    scene.add(p);
  }
  for (let i = 0; i < 22; i++) {
    const deb = new THREE.Mesh(
      new THREE.BoxGeometry(0.15 + Math.random() * 0.5, 0.06 + Math.random() * 0.12, 0.12 + Math.random() * 0.4),
      Math.random() > 0.5 ? woodMat : beamMat,
    );
    deb.position.set((Math.random() - 0.5) * 56, 0.05, (Math.random() - 0.5) * 38);
    deb.rotation.y = Math.random() * 3;
    scene.add(deb);
  }
  for (const side of [-1, 1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, HALF_D * 2 - 2, 8), rustMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(side * (HALF_W - 1.1), 5.4, 0);
    scene.add(pipe);
  }

  // ---- hanging tungsten work lamps: focused pools of light, one casts shadows ----
  const lampGeoHead = new THREE.BoxGeometry(0.5, 0.16, 0.3);
  const lampMatGlow = new THREE.MeshStandardMaterial({ color: 0x30241a, emissive: 0xffc28a, emissiveIntensity: 1.5, roughness: 0.6 });
  const cordMat = new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.9 });
  ([[-14, -4, 4.6], [12, 6, 4.9], [1, -13, 5.1]] as [number, number, number][]).forEach(([lx, lz, ly], idx) => {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 7 - ly, 6), cordMat);
    cord.position.set(lx, (7 + ly) / 2, lz);
    scene.add(cord);
    const head = new THREE.Mesh(lampGeoHead, lampMatGlow);
    head.position.set(lx, ly, lz);
    scene.add(head);
    const spot = new THREE.SpotLight(0xffc28a, 210, 26, 1.02, 0.62, 2);
    spot.position.set(lx, ly - 0.15, lz);
    spot.target.position.set(lx + 0.4, 0, lz + 0.3);
    scene.add(spot.target);
    if (idx === 0) {
      spot.castShadow = true;
      spot.shadow.mapSize.set(512, 512);
      spot.shadow.bias = -0.002;
    }
    scene.add(spot);
    lamps.push({ light: spot, base: 210, seed: lx * 7 + lz });
  });

  // ---- moonlight spilling in through the north breach ----
  const spill = new THREE.SpotLight(0x9fc4dd, 120, 46, 0.72, 0.75, 2);
  spill.position.set(2, 6.5, -HALF_D - 9);
  spill.target.position.set(0, 0, -9);
  scene.add(spill.target);
  scene.add(spill);

  // faint ambient lift between lamp pools (roof keeps the moon out)
  const fill = new THREE.PointLight(0x8fb4c8, 26, 40, 2);
  fill.position.set(0, 5.6, 0);
  scene.add(fill);

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
  scene.add(tower);
  const flood = new THREE.SpotLight(0xcfe0ee, 2600, 110, 0.6, 0.55, 2);
  flood.position.set(-40, 9.3, -30);
  flood.target.position.set(-8, 0, -2);
  scene.add(flood.target);
  scene.add(flood);
  lamps.push({ light: flood, base: 2600, seed: 91 });

  return { solidMeshes, colliderBoxes, lamps };
}

/* ------------------------------ navigation grid ------------------------------ */

/**
 * Coarse A* over the compound: enemies route around walls and cover instead of
 * grinding into them. All scratch state is pre-allocated typed arrays.
 */
export class PathGrid {
  static readonly CELL = 1.6;
  readonly cols: number;
  private rows: number;
  private blocked!: Uint8Array;
  private g!: Float32Array;
  private f!: Float32Array;
  private from!: Int32Array;
  private closed!: Uint8Array;

  constructor(private colliderBoxes: THREE.Box3[]) {
    this.cols = Math.ceil((YARD_W * 2) / PathGrid.CELL);
    this.rows = Math.ceil((YARD_D + WORLD_N) / PathGrid.CELL); // z runs -WORLD_N..+YARD_D
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n);
    const inf = 0.55; // inflate solids so bodies don't scrape corners
    for (const b of colliderBoxes) {
      const x0 = Math.max(0, Math.floor((b.min.x - inf + YARD_W) / PathGrid.CELL));
      const x1 = Math.min(this.cols - 1, Math.floor((b.max.x + inf + YARD_W) / PathGrid.CELL));
      const z0 = Math.max(0, Math.floor((b.min.z - inf + WORLD_N) / PathGrid.CELL));
      const z1 = Math.min(this.rows - 1, Math.floor((b.max.z + inf + WORLD_N) / PathGrid.CELL));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.blocked[z * this.cols + x] = 1;
    }
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.from = new Int32Array(n);
    this.closed = new Uint8Array(n);
  }

  cellIndex(x: number, z: number): number {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.floor((x + YARD_W) / PathGrid.CELL)));
    const cz = Math.max(0, Math.min(this.rows - 1, Math.floor((z + WORLD_N) / PathGrid.CELL)));
    return cz * this.cols + cx;
  }
  cellX(i: number) { return ((i % this.cols) + 0.5) * PathGrid.CELL - YARD_W; }
  cellZ(i: number) { return (Math.floor(i / this.cols) + 0.5) * PathGrid.CELL - WORLD_N; }

  /** nearest walkable cell (expanding ring search) — spawn/player cells may sit on an edge */
  private nearestOpen(i: number): number {
    if (i < 0) return -1;
    if (!this.blocked[i]) return i;
    const C = this.cols, R = this.rows;
    const cx = i % C, cz = Math.floor(i / C);
    for (let r = 1; r <= 4; r++) {
      for (let z = -r; z <= r; z++) {
        for (let x = -r; x <= r; x++) {
          if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue;
          const nx = cx + x, nz = cz + z;
          if (nx < 0 || nz < 0 || nx >= C || nz >= R) continue;
          const ni = nz * C + nx;
          if (!this.blocked[ni]) return ni;
        }
      }
    }
    return -1;
  }

  private heur(a: number, b: number) {
    const C = this.cols;
    const dx = Math.abs((a % C) - (b % C));
    const dz = Math.abs(Math.floor(a / C) - Math.floor(b / C));
    return dx + dz - 0.58 * Math.min(dx, dz); // octile distance
  }

  /** A* over the nav grid, 8-way, no corner cutting. Returns waypoint cell indices (start→goal). */
  findPath(sx: number, sz: number, tx: number, tz: number): number[] {
    const C = this.cols, R = this.rows;
    const start = this.nearestOpen(this.cellIndex(sx, sz));
    const goal = this.nearestOpen(this.cellIndex(tx, tz));
    if (start < 0 || goal < 0) return [];
    if (start === goal) return [goal];
    const g = this.g, f = this.f, from = this.from, closed = this.closed, blocked = this.blocked;
    g.fill(Infinity);
    closed.fill(0);
    from.fill(-1);
    const open: number[] = [start];
    g[start] = 0;
    f[start] = this.heur(start, goal);
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
        if (blocked[ni] || closed[ni]) continue;
        if (d >= 4 && (blocked[cz * C + nx] || blocked[nz * C + cx])) continue;
        const ng = g[cur] + COST[d];
        if (ng < g[ni]) {
          g[ni] = ng;
          from[ni] = cur;
          f[ni] = ng + this.heur(ni, goal);
          if (!open.includes(ni)) open.push(ni);
        }
      }
    }
    return [];
  }

  /** Slide from (ox,oz) to (nx,nz) without penetrating any solid collider. */
  collideClamp(ox: number, oz: number, nx: number, nz: number, r: number): [number, number] {
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
}
