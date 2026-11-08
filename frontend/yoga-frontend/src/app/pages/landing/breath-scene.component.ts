import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  viewChild,
} from '@angular/core';
import type * as Three from 'three';
import { loadMotion } from '../../shared/motion';

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uScroll;
  uniform vec2 uPointer;
  uniform float uSize;
  uniform float uPixelRatio;

  // aDirection: unit vector on the sphere, aRadius: distance from the centre,
  // aSeed: stable random value per particle, aKind: 0 = sphere, 1 = halo ring.
  attribute vec3 aDirection;
  attribute float aRadius;
  attribute float aSeed;
  attribute float aKind;

  varying float vAlpha;
  varying float vSeed;

  void main() {
    // Every particle breathes on its own phase, so the cloud never pulses in
    // lockstep.
    float breath = 0.5 + 0.5 * sin(uTime * 0.6 + aSeed * 6.2831853);
    float swell = mix(0.05, 0.2, breath) * (1.0 - aKind * 0.65);

    // Scrolling opens the cloud: the sphere expands and the halo drifts out.
    float radius = aRadius * (1.0 + swell + uScroll * 0.42);

    vec3 offset = aDirection * radius;

    // Slow orbital drift around the vertical axis; the halo turns faster.
    float spin = uTime * (0.05 + aKind * 0.09) + uScroll * (1.0 + aKind * 0.7);
    float s = sin(spin);
    float c = cos(spin);
    offset.xz = mat2(c, -s, s, c) * offset.xz;

    // Pointer parallax: the further back a particle sits, the more it travels.
    float depth = 0.35 + aSeed * 0.65;
    offset.x += uPointer.x * 0.5 * depth;
    offset.y += uPointer.y * 0.5 * depth;

    vec4 viewPosition = modelViewMatrix * vec4(offset, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    float size = uSize * (0.45 + aSeed * 1.1) * (1.0 - aKind * 0.25);
    gl_PointSize = size * uPixelRatio * (4.0 / max(0.001, -viewPosition.z));

    float twinkle = 0.6 + 0.4 * sin(uTime * 1.5 + aSeed * 42.0);
    vAlpha = (0.3 + 0.7 * breath) * twinkle * (0.55 + uScroll * 0.45);
    vSeed = aSeed + aKind * 0.5;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uIntensity;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;

  varying float vAlpha;
  varying float vSeed;

  void main() {
    // Round, soft-edged sprite generated on the fly: no texture upload needed.
    vec2 offset = gl_PointCoord - 0.5;
    float distance = length(offset);
    if (distance > 0.5) {
      discard;
    }

    float glow = smoothstep(0.5, 0.0, distance);
    glow *= glow;

    vec3 color = mix(uColorA, uColorB, fract(vSeed * 7.13));
    color = mix(color, uColorC, smoothstep(0.55, 1.0, fract(vSeed * 3.71)) * 0.65);

    gl_FragColor = vec4(color, glow * vAlpha * uIntensity);
  }
`;

/**
 * A breathing sphere of light particles rendered with Three.js and driven by
 * ScrollTrigger through `setScrollProgress()`.
 *
 * The host is pinned by the landing page, so `progress` runs from 0 (section
 * reaches the top of the viewport) to 1 (pin released).
 */
@Component({
  selector: 'app-breath-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="breath">
      <canvas #canvas class="breath__canvas" aria-hidden="true"></canvas>
      <div class="breath__content">
        <ng-content />
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      background:
        /* The dust only ever adds light, so a near-white sky swallows it: the
           lilac sky below is what the particles shine against. */
        radial-gradient(
          ellipse at 50% 45%,
          rgba(255, 231, 246, 0.6) 0%,
          rgba(209, 202, 244, 0.34) 44%,
          rgba(120, 110, 168, 0.26) 100%
        ),
        linear-gradient(180deg, #e2d5f2 0%, #cbdcef 58%, #e9dac3 100%);
    }

    /* The pause sits between cream sections: both edges melt back into the page
       instead of cutting it into a hard stripe. */
    :host::before,
    :host::after {
      content: '';
      position: absolute;
      z-index: 1;
      left: 0;
      right: 0;
      height: 7vh;
      pointer-events: none;
    }

    :host::before {
      top: 0;
      background: linear-gradient(180deg, #f7f3ef 0%, rgba(247, 243, 239, 0) 100%);
    }

    :host::after {
      bottom: 0;
      height: 10vh;
      /* Matches the page background right below the pause, so the release of the
         pin never shows a seam. */
      background: linear-gradient(0deg, #fbf8f5 0%, rgba(251, 248, 245, 0) 100%);
    }

    .breath {
      position: relative;
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: 4rem 1.5rem;
      box-sizing: border-box;
      overflow: hidden;
    }

    .breath__canvas {
      position: absolute;
      inset: 0;
      display: block;
      width: 100%;
      height: 100%;
      pointer-events: none;
      opacity: 0;
      transition: opacity 1.2s ease;
    }

    :host(.is-ready) .breath__canvas {
      opacity: 1;
    }

    .breath__content {
      position: relative;
      z-index: 1;
      width: 100%;
      display: flex;
      justify-content: center;
    }

    @media (prefers-reduced-motion: reduce) {
      .breath__canvas {
        display: none;
      }
    }
  `,
})
export class BreathSceneComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);

  /** 0 → 1 scroll progress, written by the pinned timeline in the landing page. */
  private progress = 0;

  private disposeScene: (() => void) | undefined;
  private destroyed = false;

  constructor() {
    afterNextRender(() => {
      void this.initScene();
    });

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.disposeScene?.();
    });
  }

  setScrollProgress(progress: number): void {
    this.progress = Math.min(1, Math.max(0, progress));
  }

  private async initScene(): Promise<void> {
    if (
      typeof window === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    try {
      const dispose = await this.createScene();
      if (this.destroyed) {
        dispose();
        return;
      }
      this.disposeScene = dispose;
    } catch {
      // No WebGL: the gradient background and the copy remain readable.
      this.disposeScene = undefined;
    }
  }
  private async createScene(): Promise<() => void> {
    const THREE = await import('three');
    const { gsap } = await loadMotion();

    const host = this.host.nativeElement;
    const canvas = this.canvasRef().nativeElement;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearAlpha(0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
    camera.position.set(0, 0, 4.8);

    const uniforms = {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uSize: { value: 6.6 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uIntensity: { value: 0 },
      // Saturated rather than pastel: the additive blend has to lift the sky the
      // particles sit on, and a washed-out pink barely registers even on lilac.
      uColorA: { value: new THREE.Color('#ff74cf') },
      uColorB: { value: new THREE.Color('#56a8ff') },
      uColorC: { value: new THREE.Color('#ffbb5c') },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const count = window.innerWidth < 720 ? 2200 : 4600;
    const geometry = this.createCloudGeometry(THREE, count);

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      uniforms.uPixelRatio.value = renderer.getPixelRatio();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    const pointerTarget = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent) => {
      pointerTarget.x = event.clientX / window.innerWidth - 0.5;
      pointerTarget.y = 0.5 - event.clientY / window.innerHeight;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const timer = new THREE.Timer();
    let elapsed = 0;
    const tick = () => {
      timer.update();
      elapsed += Math.min(timer.getDelta(), 0.1);
      uniforms.uTime.value = elapsed;
      uniforms.uScroll.value += (this.progress - uniforms.uScroll.value) * 0.12;
      uniforms.uPointer.value.x += (pointerTarget.x - uniforms.uPointer.value.x) * 0.045;
      uniforms.uPointer.value.y += (pointerTarget.y - uniforms.uPointer.value.y) * 0.045;
      renderer.render(scene, camera);
    };

    // Render only while the section is on screen and the tab is visible.
    let running = false;
    const setRunning = (value: boolean) => {
      if (value === running) {
        return;
      }
      running = value;
      if (running) {
        gsap.ticker.add(tick);
      } else {
        gsap.ticker.remove(tick);
      }
    };

    renderer.render(scene, camera);
    host.classList.add('is-ready');
    setRunning(!document.hidden);

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        setRunning((entry?.isIntersecting ?? false) && !document.hidden);
      },
      { threshold: 0.01 },
    );
    visibilityObserver.observe(host);

    const onVisibilityChange = () => {
      setRunning(!document.hidden);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const introTween = gsap.to(uniforms.uIntensity, {
      value: 1,
      duration: 2.2,
      delay: 0.15,
      ease: 'power2.out',
    });

    return () => {
      visibilityObserver.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pointermove', onPointerMove);
      gsap.ticker.remove(tick);
      introTween.kill();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      host.classList.remove('is-ready');
    };
  }

  /**
   * Builds the particle cloud: a Fibonacci sphere shell with a little inner
   * dust, plus a flattened halo ring that carries the eye around the orb.
   */
  private createCloudGeometry(THREE: typeof import('three'), count: number): Three.BufferGeometry {
    const positions = new Float32Array(count * 3);
    const directions = new Float32Array(count * 3);
    const radii = new Float32Array(count);
    const seeds = new Float32Array(count);
    const kinds = new Float32Array(count);

    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    for (let index = 0; index < count; index += 1) {
      const seed = Math.random();
      seeds[index] = seed;

      let x: number;
      let y: number;
      let z: number;
      let radius: number;

      if (seed > 0.74) {
        // Halo: a thin ring of light orbiting the sphere.
        const angle = Math.random() * Math.PI * 2;
        radius = 1.32 + Math.random() * 0.62;
        x = Math.cos(angle);
        y = (Math.random() - 0.5) * 0.16;
        z = Math.sin(angle);
        const length = Math.hypot(x, y, z) || 1;
        x /= length;
        y /= length;
        z /= length;
        kinds[index] = 1;
      } else {
        // Fibonacci sphere: even coverage without clumping at the poles.
        const y0 = 1 - (index / Math.max(1, count - 1)) * 2;
        const ringRadius = Math.sqrt(Math.max(0, 1 - y0 * y0));
        const theta = goldenAngle * index;
        x = Math.cos(theta) * ringRadius;
        y = y0;
        z = Math.sin(theta) * ringRadius;
        // A share of the shell sits inside the sphere as ambient dust.
        radius = seed < 0.18 ? 0.2 + Math.random() * 0.7 : 0.94 + Math.random() * 0.14;
        kinds[index] = 0;
      }

      directions[index * 3] = x;
      directions[index * 3 + 1] = y;
      directions[index * 3 + 2] = z;
      radii[index] = radius;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aDirection', new THREE.BufferAttribute(directions, 3));
    geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));

    return geometry;
  }
}
