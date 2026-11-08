import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import type * as Three from 'three';
import { loadMotion } from '../../shared/motion';
import { bowlStartsMuted, loadBowlSound, type BowlVoice } from '../../shared/singing-bowl';

const HERO_IMAGE = '/assets/images/hero-kids-meditation.webp';

/**
 * Singing bowl measured on hero-kids-meditation.webp (uv, bottom-left origin;
 * the artwork is 1536 x 1024). Pointing at it warms the bronze up; pressing it
 * strikes a note.
 */
const BOWL_UV = { x: 0.527, y: 0.326 };
/** Distance (image heights) at which the bowl starts to glow. */
const BOWL_HOVER_RADIUS = 0.17;
/** Distance (image heights) a press counts as touching the girl's bowl. */
const BOWL_STRIKE_RADIUS = 0.3;
/** Seconds the tapped note takes to fade away. */
const STRIKE_DURATION = 1.8;

/**
 * The bowl rests in her open left hand, which cups it from below: the fingers
 * meet the bronze at (806, 766) and the palm runs under its foot. Everything
 * the bowl does when it is tapped starts right there, in her hand, because the
 * picture never brings it into contact with anything else — the mallet stays in
 * her other fist, a hand's width away.
 *
 * The two ellipses below trace the bowl's body and its opening on the artwork,
 * so light added to the scene can be kept on the bronze (uv, bottom-left
 * origin; radii in image heights, one unit being the picture's own height).
 */
const HAND_TOUCH = { x: 0.5247, y: 0.252 };
const BOWL_BODY = { x: 0.527, y: 0.316 };
const BOWL_BODY_RADIUS = { x: 0.105, y: 0.075 };
const BOWL_RIM = { x: 0.526, y: 0.364 };
const BOWL_RIM_RADIUS = { x: 0.104, y: 0.0305 };

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * The illustration is never warped: only the camera (slow drift, pointer
 * parallax, scroll zoom) and additive light (candles, lamps, bowl glow, dust)
 * move, so the artwork stays crisp.
 */
const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform vec2 uImageResolution;
  uniform vec2 uPointer;
  uniform vec2 uBowlCenter;
  uniform float uBowlRadius;
  uniform float uTime;
  uniform float uScroll;
  uniform float uIntensity;
  // Interaction: a pointer tap makes the bowl ring (0 → 1 impulse and its age).
  uniform float uStrike;
  uniform float uStrikeAge;
  uniform float uHover;

  varying vec2 vUv;

  // Seconds between two strikes on the singing bowl.
  const float BEAT = 5.0;
  // Point of the cycle where the mallet lands on the bowl.
  const float IMPACT = 0.8;

  // Light sources measured on hero-kids-meditation.webp (uv, bottom-left origin).
  const vec2 CANDLE_A = vec2(0.267, 0.435);
  const vec2 CANDLE_B = vec2(0.301, 0.414);
  const vec2 LAMP_A = vec2(0.489, 0.684);
  const vec2 LAMP_B = vec2(0.271, 0.705);
  // Her hand under the bowl and the two ellipses that hold its bronze in place.
  // Radii are image heights, so they stay true at any aspect ratio.
  const vec2 HAND_TOUCH = vec2(0.5247, 0.252);
  const vec2 BOWL_BODY = vec2(0.527, 0.316);
  const vec2 BOWL_BODY_RADIUS = vec2(0.105, 0.075);
  const vec2 BOWL_RIM = vec2(0.526, 0.364);
  const vec2 BOWL_RIM_RADIUS = vec2(0.104, 0.0305);

  const vec3 WARM = vec3(1.0, 0.72, 0.38);

  float imageAspect() {
    return uImageResolution.x / uImageResolution.y;
  }

  // Isotropic space: one unit equals the image height, so glows stay circular.
  vec2 toImageSpace(vec2 uv) {
    return vec2(uv.x * imageAspect(), uv.y);
  }

  vec2 coverUv(vec2 uv) {
    float screenAspect = uResolution.x / uResolution.y;
    float aspect = imageAspect();
    vec2 ratio = vec2(1.0);

    if (screenAspect > aspect) {
      ratio.y = aspect / screenAspect;
    } else {
      ratio.x = screenAspect / aspect;
    }

    return (uv - 0.5) * ratio + 0.5;
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float glow(vec2 p, vec2 centerUv, float radius, float power) {
    float d = length(p - toImageSpace(centerUv)) / radius;
    return pow(max(1.0 - d, 0.0), power);
  }

  float ring(vec2 p, vec2 center, float radius, float width) {
    float offset = (length(p - center) - radius) / width;
    return exp(-offset * offset);
  }

  /**
   * Soft silhouette of the bronze: one inside the bowl, fading to zero right at
   * its outline, so any light drawn with it stops on the metal and never spills
   * onto her fingers or her sweater.
   */
  float bronze(vec2 p) {
    vec2 d = (p - toImageSpace(BOWL_BODY)) / BOWL_BODY_RADIUS;
    return 1.0 - smoothstep(0.7, 1.0, length(d));
  }

  /** The bowl's opening as a thin ellipse: the line the metal hums along. */
  float rimLine(vec2 p) {
    vec2 d = (p - toImageSpace(BOWL_RIM)) / BOWL_RIM_RADIUS;
    float offset = (length(d) - 1.0) * 9.0;
    return exp(-offset * offset);
  }

  // Cheap candle flicker: three incommensurate sines per light.
  float flicker(float t, float seed) {
    return 0.55 + 0.45 * (
      sin(t * 8.7 + seed) * 0.5 +
      sin(t * 13.1 + seed * 2.3) * 0.3 +
      sin(t * 21.7 + seed * 3.7) * 0.2
    );
  }

  // Fine dust drifting upwards, drawn in screen space so it never distorts.
  float dust(vec2 p, float scale, float speed, float seed) {
    vec2 grid = vec2(p.x * scale, p.y * scale + uTime * speed);
    vec2 cell = floor(grid);
    vec2 local = fract(grid) - 0.5;
    float seedValue = hash(cell + seed);
    vec2 jitter = (vec2(hash(cell + seed + 1.7), hash(cell + seed + 4.3)) - 0.5) * 0.55;
    float twinkle = 0.45 + 0.55 * sin(uTime * 1.4 + seedValue * 40.0);
    return smoothstep(0.075, 0.0, length(local - jitter)) * twinkle * step(0.7, seedValue);
  }

  void main() {
    // --- Camera: slow drift, pointer parallax and scroll dolly ---------------
    vec2 uv = vUv;
    float zoom = mix(1.16, 0.98, smoothstep(0.0, 1.0, uScroll));
    uv = (uv - 0.5) / zoom + 0.5;
    uv += uPointer * 0.012;
    uv += vec2(sin(uTime * 0.07), cos(uTime * 0.055)) * 0.004;
    uv.y += uScroll * 0.04;
    // A tap shivers through the room, so the artwork trembles with the note.
    uv += vec2(sin(uStrikeAge * 34.0), cos(uStrikeAge * 27.0)) * 0.0011 * uStrike;

    vec2 image = coverUv(uv);
    vec2 p = toImageSpace(image);

    // The bronze shivers where her fingers hold it: a hair's breadth of
    // displacement radiating from her hand, faded to nothing at the bowl's
    // outline so the artwork's edge never tears.
    float metal = bronze(p);
    // The note outlives the tap, so the rings and the hum ride a much slower
    // decay than the flash — and stop dead once the note itself is over.
    float ringing = pow(max(uStrike, 0.0), 0.35) * (1.0 - smoothstep(0.55, 1.0, uStrikeAge));
    vec2 fromHand = p - toImageSpace(HAND_TOUCH);
    float handDistance = max(length(fromHand), 0.0001);
    float shiver = sin(uStrikeAge * 70.0) * ringing * metal * 0.003;
    image += fromHand / handDistance * shiver;

    vec3 color = texture2D(uTexture, image).rgb;

    vec2 bowl = toImageSpace(uBowlCenter);
    float intensity = uIntensity;

    // --- Candles on the bench ---------------------------------------------
    color += WARM * glow(p, CANDLE_A, 0.2, 3.0) * flicker(uTime, 1.3) * 0.09 * intensity;
    color += WARM * glow(p, CANDLE_B, 0.16, 3.0) * flicker(uTime, 4.1) * 0.075 * intensity;

    // --- Pendant lamps breathe slowly -------------------------------------
    float lampPulse = 0.55 + 0.45 * sin(uTime * 0.42);
    color += WARM * glow(p, LAMP_A, 0.3, 2.2) * lampPulse * 0.07 * intensity;
    color += WARM * glow(p, LAMP_B, 0.26, 2.2) * (1.0 - lampPulse) * 0.05 * intensity;

    // --- Singing bowl: bloom and rings of light, no distortion -------------
    float cycle = fract(uTime / BEAT);
    float age = fract(cycle + (1.0 - IMPACT));
    float strike = exp(-age * 4.5) * intensity;
    float bowlDistance = length(p - bowl);

    color += WARM * strike * glow(p, uBowlCenter, 0.24, 2.8) * 0.24;

    float reach = 1.0 - smoothstep(0.0, uBowlRadius * 3.2, bowlDistance);
    float ringA = ring(p, bowl, age * uBowlRadius * 2.6, uBowlRadius * 0.4) * (1.0 - age);
    float ageB = fract(age + 0.5);
    float ringB = ring(p, bowl, ageB * uBowlRadius * 2.6, uBowlRadius * 0.4) * (1.0 - ageB);
    color += WARM * (ringA + ringB * 0.6) * reach * 0.26;

    // --- The bowl answers the hand that holds it ----------------------------
    // The picture keeps the mallet a hand's width from the rim, so nothing in it
    // ever touches the bronze. Her fingers do: they cup the bowl from below, and
    // that is where the note comes from — rings climbing the wall from under her
    // palm, a hum running through the metal and the rim catching the sound.
    //
    // Everything here is light on top of the painted bronze, never a repaint of
    // it: the lettering, the highlights and the reflections stay exactly as drawn.
    vec2 hand = toImageSpace(HAND_TOUCH);

    // The metal glows from her hand and the note travels through it: rings ride
    // the slower envelope so they are still climbing when the flash is gone.
    float ripple = 0.0;
    for (int i = 0; i < 3; i++) {
      float rippleAge = uStrikeAge * 2.4 - float(i) * 0.22;
      if (rippleAge > 0.0 && rippleAge < 1.0) {
        float front = rippleAge * 0.13;
        // Stretched sideways: a wave running around the bowl's wall, not a
        // perfect circle dropping into her lap.
        float wave = length((p - hand) / vec2(1.25, 1.0));
        float offset = (wave - front) / 0.007;
        // The smoothstep lets each ring swell out of her hand instead of popping.
        ripple += exp(-offset * offset) * (1.0 - rippleAge)
          * smoothstep(0.0, 0.12, rippleAge) / (1.0 + float(i));
      }
    }

    // Light lands on the bronze where it is still dark and leaves the painted
    // highlights alone, so the rings read instead of blowing the metal out.
    float headroom = 1.0 - smoothstep(0.5, 0.92, dot(color, vec3(0.299, 0.587, 0.114)));
    color += WARM * metal * headroom * (uStrike * 0.05 + ripple * ringing * 0.9);

    // Her fingertips flash where they hold it.
    color += vec3(1.0, 0.9, 0.72) * uStrike * glow(p, HAND_TOUCH, 0.05, 3.0) * 0.2;

    // The hum: fine filaments running through the bronze while it rings.
    float hum = 0.5 + 0.5 * sin(handDistance * 190.0 - uTime * 70.0);
    color += WARM * metal * headroom * ringing * pow(hum, 6.0) * 0.06;

    // The rim trembles along the whole opening, not just under her fingers.
    color += vec3(1.0, 0.94, 0.78) * rimLine(p) * ringing * (0.09 + 0.05 * sin(uTime * 52.0));

    // And a glint runs around the rim while the note travels through the metal.
    float glintAngle = uStrikeAge * 6.0 - 2.4;
    vec2 glintSpot = toImageSpace(BOWL_RIM)
      + vec2(cos(glintAngle) * BOWL_RIM_RADIUS.x, sin(glintAngle) * BOWL_RIM_RADIUS.y);
    float glint = exp(-pow(length(p - glintSpot) / 0.03, 2.0));
    color += vec3(1.0, 0.95, 0.82) * glint * ringing * 0.35;

    // And the sound leaves the bowl as two rings crossing the room.
    float tapRingA = ring(p, bowl, uStrikeAge * uBowlRadius * 3.6, uBowlRadius * 0.45) * (1.0 - uStrikeAge);
    float tapAgeB = max(uStrikeAge - 0.32, 0.0);
    float tapRingB = ring(p, bowl, tapAgeB * uBowlRadius * 3.6, uBowlRadius * 0.45) * (1.0 - tapAgeB);
    color += WARM * (tapRingA + tapRingB * 0.55) * ringing * 0.05;

    // Before the strike the rim glows faintly, inviting the touch.
    float invite = 0.06 + 0.04 * sin(uTime * 2.4);
    color += WARM * uHover * glow(p, uBowlCenter, 0.28, 2.4) * invite;

    // --- Dust in the air ---------------------------------------------------
    vec2 screen = vec2(vUv.x * imageAspect(), vUv.y);
    float motes = dust(screen, 9.0, 0.035, 0.0) + dust(screen, 15.0, 0.055, 11.0) * 0.7;
    color += WARM * motes * (0.1 + uScroll * 0.05) * intensity;

    // --- A soft band of daylight sweeping across the room ------------------
    float sweep = fract(uTime * 0.028 + uScroll * 0.45) * 1.9 - 0.45;
    float beamDistance = (p.x * 0.55 + p.y * 0.9) - sweep;
    float beam = exp(-beamDistance * beamDistance * 18.0);
    color += vec3(1.0, 0.96, 0.88) * beam * 0.05 * intensity;

    // --- Scroll grade: the room cools down as the hero dissolves -----------
    color = mix(color, color * vec3(0.97, 0.99, 1.07), uScroll * 0.7);
    color *= mix(1.0, 0.88, uScroll);

    // --- Gentle vignette keeps the pastel overlay and the copy readable ----
    float vignette = 1.0 - smoothstep(0.32, 1.0, length((vUv - 0.5) * vec2(1.05, 1.0)));
    color = mix(color * (0.92 - uScroll * 0.06), color, vignette);

    // Fine dithering: kills the banding the pastel gradients would show.
    color += (hash(gl_FragCoord.xy * 0.71 + fract(uTime) * 137.0) - 0.5) * 0.014;

    gl_FragColor = vec4(color, 1.0);
  }
`;

@Component({
  selector: 'app-hero-scene',
  imports: [NgOptimizedImage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <img class="hero-scene__fallback" [ngSrc]="heroImage" alt="" fill priority sizes="100vw" />
    <canvas #canvas class="hero-scene__canvas" aria-hidden="true"></canvas>
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      z-index: 0;
      display: block;
      overflow: hidden;
      pointer-events: none;
      background: #f7f3ef;
    }

    .hero-scene__fallback,
    .hero-scene__canvas {
      position: absolute;
      inset: 0;
      display: block;
      width: 100%;
      height: 100%;
    }

    .hero-scene__fallback {
      object-fit: cover;
      object-position: center;
    }

    .hero-scene__canvas {
      opacity: 0;
      transition: opacity 900ms ease;
    }

    :host(.is-ready) .hero-scene__canvas {
      opacity: 1;
    }
  `,
})
export class HeroSceneComponent {
  protected readonly heroImage = HERO_IMAGE;

  /** The bowl's sound preference; the toggle itself lives in the landing hero. */
  readonly soundMuted = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly destroyRef = inject(DestroyRef);

  private disposeScene: (() => void) | undefined;
  private destroyed = false;
  private bowlLoading: Promise<BowlVoice | undefined> | undefined;

  /** 0 → 1 progress, written by the pinned hero timeline in the landing page. */
  private progress = 0;

  constructor() {
    afterNextRender(() => {
      this.soundMuted.set(bowlStartsMuted());
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

  /** Mutes the bowl (or brings it back); the click is also the unlock gesture. */
  toggleSound(): void {
    const muted = !this.soundMuted();
    this.soundMuted.set(muted);
    void this.bowl().then((bowl) => bowl?.setMuted(muted));
  }

  private bowl(): Promise<BowlVoice | undefined> {
    this.bowlLoading ??= loadBowlSound();
    return this.bowlLoading;
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
      // WebGL unavailable: the static fallback image stays visible.
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
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.Camera();

    const uniforms = {
      uTexture: { value: null as Three.Texture | null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uImageResolution: { value: new THREE.Vector2(1, 1) },
      uPointer: { value: new THREE.Vector2(0, 0) },
      // Singing bowl measured on hero-kids-meditation.webp (uv, bottom-left origin).
      uBowlCenter: { value: new THREE.Vector2(BOWL_UV.x, BOWL_UV.y) },
      uBowlRadius: { value: 0.095 },
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uIntensity: { value: 0 },
      uStrike: { value: 0 },
      uStrikeAge: { value: 1 },
      uHover: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);

    const texture = await new THREE.TextureLoader().loadAsync(HERO_IMAGE);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

    uniforms.uTexture.value = texture;
    uniforms.uImageResolution.value.set(texture.image.width, texture.image.height);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      uniforms.uResolution.value.set(width, height);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    // Mirrors coverUv() + toImageSpace() from the shader, so the DOM pointer and
    // the GLSL glow agree on where the bowl sits on screen at any scroll depth.
    const bowlDistance = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        return Number.POSITIVE_INFINITY;
      }

      const aspect =
        uniforms.uImageResolution.value.x / Math.max(1, uniforms.uImageResolution.value.y);
      const screenAspect = rect.width / rect.height;
      const scroll = Math.min(1, Math.max(0, this.progress));
      const eased = scroll * scroll * (3 - 2 * scroll);
      const zoom = 1.16 + (0.98 - 1.16) * eased;

      let uvX = (event.clientX - rect.left) / rect.width;
      let uvY = 1 - (event.clientY - rect.top) / rect.height;
      uvX = (uvX - 0.5) / zoom + 0.5;
      uvY = (uvY - 0.5) / zoom + 0.5;
      uvX += uniforms.uPointer.value.x * 0.012;
      uvY += uniforms.uPointer.value.y * 0.012;
      uvY += scroll * 0.04;

      const ratio = { x: 1, y: 1 };
      if (screenAspect > aspect) {
        ratio.y = aspect / screenAspect;
      } else {
        ratio.x = screenAspect / aspect;
      }

      const coveredX = (uvX - 0.5) * ratio.x + 0.5;
      const coveredY = (uvY - 0.5) * ratio.y + 0.5;
      return Math.hypot((coveredX - BOWL_UV.x) * aspect, coveredY - BOWL_UV.y);
    };

    const pointerTarget = { x: 0, y: 0 };
    let elapsed = 0;
    let hoverTarget = 0;
    let strikeAt = -STRIKE_DURATION;

    const onPointerMove = (event: PointerEvent) => {
      pointerTarget.x = event.clientX / window.innerWidth - 0.5;
      pointerTarget.y = 0.5 - event.clientY / window.innerHeight;
      hoverTarget = bowlDistance(event) < BOWL_HOVER_RADIUS ? 1 : 0;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    // Touching the girl's bowl makes it ring; anywhere else on the page does not.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('a, button, input, select, textarea')) {
        return;
      }
      if (bowlDistance(event) < BOWL_STRIKE_RADIUS) {
        strikeAt = elapsed;
        // The note starts with the touch: nothing in the picture has to reach
        // the bowl first.
        void this.bowl().then((bowl) => bowl?.strike());
      }
    };
    window.addEventListener('pointerdown', onPointerDown, { passive: true });

    // A cancelled gesture (finger lifted elsewhere, scroll takeover) drops the invite.
    const onGestureCancel = () => {
      hoverTarget = 0;
    };
    window.addEventListener('pointercancel', onGestureCancel, { passive: true });

    const timer = new THREE.Timer();
    const tick = () => {
      timer.update();
      elapsed += Math.min(timer.getDelta(), 0.1);
      uniforms.uTime.value = elapsed;
      uniforms.uScroll.value += (this.progress - uniforms.uScroll.value) * 0.12;
      uniforms.uPointer.value.x += (pointerTarget.x - uniforms.uPointer.value.x) * 0.05;
      uniforms.uPointer.value.y += (pointerTarget.y - uniforms.uPointer.value.y) * 0.05;
      uniforms.uHover.value += (hoverTarget - uniforms.uHover.value) * 0.08;

      // The note and the light start on the touch itself: her hand is the only
      // thing in the picture that actually meets the bowl.
      const sinceStrike = elapsed - strikeAt;
      uniforms.uStrikeAge.value = Math.min(1, Math.max(0, sinceStrike / STRIKE_DURATION));
      uniforms.uStrike.value = sinceStrike <= 0 ? 0 : Math.exp(-sinceStrike * 2.0);

      renderer.render(scene, camera);
    };

    renderer.render(scene, camera);
    host.classList.add('is-ready');

    // Render only while the hero is on screen and the tab is visible.
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
      duration: 2.4,
      delay: 0.1,
      ease: 'power2.out',
    });

    return () => {
      visibilityObserver.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointercancel', onGestureCancel);
      gsap.ticker.remove(tick);
      introTween.kill();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.dispose();
      host.classList.remove('is-ready');
    };
  }
}
