import * as THREE from 'three';
import { flashTexture } from './textures';

export type ParticleKind = 'blood' | 'spark' | 'snow' | 'case';

interface Tracer { mesh: THREE.Mesh; life: number; }
interface Particle { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; maxLife: number; grav: number; size: number; }

const UP = new THREE.Vector3(0, 1, 0);
const TRACER_LIFE = 0.07;

/**
 * Pooled, allocation-free FX: player/enemy tracers, impact particles,
 * ejected casings and bullet-hole decals. Everything is pre-built once.
 */
export class FxPool {
  readonly flashTex = flashTexture();
  private tracersP: Tracer[] = [];
  private tracersE: Tracer[] = [];
  private tracersAll: Tracer[] = [];
  private particles: Particle[] = [];
  private pCursor = 0;
  private decals: THREE.Mesh[] = [];
  private dCursor = 0;
  private tmp = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    const matP = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const matE = new THREE.MeshBasicMaterial({ color: 0xff6a5a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 16; i++) {
      const mp = new THREE.Mesh(tracerGeo, matP);
      const me = new THREE.Mesh(tracerGeo, matE);
      mp.visible = me.visible = false;
      scene.add(mp, me);
      this.tracersP.push({ mesh: mp, life: 0 });
      this.tracersE.push({ mesh: me, life: 0 });
    }
    this.tracersAll = [...this.tracersP, ...this.tracersE];

    const pGeo = new THREE.BoxGeometry(1, 1, 1);
    const mats = [
      new THREE.MeshBasicMaterial({ color: 0x8a1e1e }), // blood
      new THREE.MeshBasicMaterial({ color: 0xffc46b }), // spark
      new THREE.MeshBasicMaterial({ color: 0xeaf4f8 }), // snow puff
      new THREE.MeshBasicMaterial({ color: 0xd8a24a }), // brass casing
    ];
    for (let i = 0; i < 190; i++) {
      const mesh = new THREE.Mesh(pGeo, mats[i % 4]);
      mesh.visible = false;
      scene.add(mesh);
      this.particles.push({ mesh, vel: new THREE.Vector3(), life: 0, maxLife: 1, grav: 9, size: 0.05 });
    }

    const decalGeo = new THREE.CircleGeometry(0.045, 8);
    const decalMat = new THREE.MeshBasicMaterial({ color: 0x10141a, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -3 });
    for (let i = 0; i < 70; i++) {
      const d = new THREE.Mesh(decalGeo, decalMat);
      d.visible = false;
      scene.add(d);
      this.decals.push(d);
    }
  }

  private tracer(pool: Tracer[], from: THREE.Vector3, to: THREE.Vector3) {
    let t = pool.find((x) => x.life <= 0);
    if (!t) t = pool[0];
    t.mesh.position.copy(this.tmp.copy(from).add(to).multiplyScalar(0.5));
    t.mesh.lookAt(to);
    t.mesh.scale.set(0.022, 0.022, Math.max(0.1, from.distanceTo(to)));
    t.mesh.visible = true;
    t.life = TRACER_LIFE;
  }

  tracerPlayer(from: THREE.Vector3, to: THREE.Vector3) { this.tracer(this.tracersP, from, to); }
  tracerEnemy(from: THREE.Vector3, to: THREE.Vector3) { this.tracer(this.tracersE, from, to); }

  /** Spawn impact/eject particles. `yaw` orients casing ejection to the shooter's right. */
  burst(at: THREE.Vector3, kind: ParticleKind, count: number, speed: number, grav: number, life: number, yaw = 0) {
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
        p.vel.applyAxisAngle(UP, yaw); // eject to the right of the shooter
      } else {
        p.vel.set(
          (Math.random() - 0.5) * speed * 2,
          Math.random() * speed,
          (Math.random() - 0.5) * speed * 2,
        );
      }
    }
  }

  decal(point: THREE.Vector3, normal: THREE.Vector3) {
    const d = this.decals[this.dCursor];
    this.dCursor = (this.dCursor + 1) % this.decals.length;
    d.visible = true;
    d.position.copy(point).addScaledVector(normal, 0.013);
    d.lookAt(this.tmp.copy(point).add(normal));
  }

  clear() {
    for (const t of this.tracersAll) { t.mesh.visible = false; t.life = 0; }
    for (const p of this.particles) { p.mesh.visible = false; p.life = 0; }
    for (const d of this.decals) d.visible = false;
  }

  update(dt: number) {
    for (const tr of this.tracersAll) {
      if (tr.life > 0) {
        tr.life -= dt;
        const k = Math.max(0.05, tr.life / TRACER_LIFE);
        tr.mesh.scale.x = 0.022 * k;
        tr.mesh.scale.y = 0.022 * k;
        if (tr.life <= 0) tr.mesh.visible = false;
      }
    }
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
}
