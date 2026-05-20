import * as THREE from "three";

/* ================================================================
   GPU Stable Fluids — Jos Stam's method
   6-step Navier-Stokes solver on 256×256 ping-pong FBOs.
   Produces a velocity field used as UV distortion by the
   postprocessing Effect.
   ================================================================ */

const SIM_RES = 256;

// ── shared fullscreen-quad vertex shader ──
const vertexShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}
`;

// ── 1. Curl (vorticity) ──
const curlFrag = /* glsl */ `
precision highp float;
uniform sampler2D uVelocity;
uniform vec2 texelSize;
varying vec2 vUv;

void main() {
    float L = texture2D(uVelocity, vUv - vec2(texelSize.x, 0.0)).y;
    float R = texture2D(uVelocity, vUv + vec2(texelSize.x, 0.0)).y;
    float T = texture2D(uVelocity, vUv + vec2(0.0, texelSize.y)).x;
    float B = texture2D(uVelocity, vUv - vec2(0.0, texelSize.y)).x;
    float vorticity = R - L - T + B;
    gl_FragColor = vec4(vorticity, 0.0, 0.0, 1.0);
}
`;

// ── 2. Velocity update (cursor force + vorticity confinement + burst) ──
const velocityFrag = /* glsl */ `
precision highp float;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 texelSize;
uniform vec2 pointerPos;
uniform vec2 pointerVec;
uniform float curlStrength;
uniform float dt;
uniform float aspectRatio;
// Burst shockwave uniforms
uniform float burstRadius;    // current ring radius (0 = off)
uniform float burstStrength;  // outward velocity strength
uniform float burstWidth;     // ring thickness
varying vec2 vUv;

void main() {
    vec2 vel = texture2D(uVelocity, vUv).xy;

    // Vorticity confinement
    float cL = texture2D(uCurl, vUv - vec2(texelSize.x, 0.0)).x;
    float cR = texture2D(uCurl, vUv + vec2(texelSize.x, 0.0)).x;
    float cT = texture2D(uCurl, vUv + vec2(0.0, texelSize.y)).x;
    float cB = texture2D(uCurl, vUv - vec2(0.0, texelSize.y)).x;
    float cC = texture2D(uCurl, vUv).x;

    vec2 force = 0.5 * vec2(abs(cT) - abs(cB), abs(cR) - abs(cL));
    force /= length(force) + 1e-5;
    force *= curlStrength * cC;
    vel += force * dt;

    // Cursor injection
    vec2 diff = vUv - pointerPos;
    // Correct for aspect ratio
    if (aspectRatio > 1.0) diff.x *= aspectRatio;
    else diff.y /= aspectRatio;

    float pointerLen = length(pointerVec);
    float influence = smoothstep(0.01 + 0.1 * min(0.5, pointerLen), 0.0, length(diff));
    vec2 velPower = pointerVec * 22.0;
    velPower = min(abs(velPower), vec2(2.0)) * sign(velPower);
    vel += influence * velPower;

    // Burst shockwave — radial outward velocity at ring position
    if (burstStrength > 0.0) {
        vec2 fromCenter = vUv - vec2(0.5);
        float dist = length(fromCenter);
        // Soft ring shape
        float ring = exp(-pow((dist - burstRadius) / burstWidth, 2.0));
        // Direction: outward from center
        vec2 outDir = normalize(fromCenter + vec2(1e-6));
        vel += outDir * ring * burstStrength * dt;
    }

    gl_FragColor = vec4(vel, 0.0, 1.0);
}
`;

// ── 3. Divergence ──
const divergenceFrag = /* glsl */ `
precision highp float;
uniform sampler2D uVelocity;
uniform vec2 texelSize;
varying vec2 vUv;

void main() {
    float L = texture2D(uVelocity, vUv - vec2(texelSize.x, 0.0)).x;
    float R = texture2D(uVelocity, vUv + vec2(texelSize.x, 0.0)).x;
    float T = texture2D(uVelocity, vUv + vec2(0.0, texelSize.y)).y;
    float B = texture2D(uVelocity, vUv - vec2(0.0, texelSize.y)).y;
    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

// ── 4. Pressure solve (Jacobi) ──
const pressureFrag = /* glsl */ `
precision highp float;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 texelSize;
varying vec2 vUv;

void main() {
    float L = texture2D(uPressure, vUv - vec2(texelSize.x, 0.0)).x;
    float R = texture2D(uPressure, vUv + vec2(texelSize.x, 0.0)).x;
    float T = texture2D(uPressure, vUv + vec2(0.0, texelSize.y)).x;
    float B = texture2D(uPressure, vUv - vec2(0.0, texelSize.y)).x;
    float div = texture2D(uDivergence, vUv).x;
    float pressure = (L + R + T + B - div) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`;

// ── 5. Gradient subtract ──
const gradientSubtractFrag = /* glsl */ `
precision highp float;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 texelSize;
varying vec2 vUv;

void main() {
    float pL = texture2D(uPressure, vUv - vec2(texelSize.x, 0.0)).x;
    float pR = texture2D(uPressure, vUv + vec2(texelSize.x, 0.0)).x;
    float pT = texture2D(uPressure, vUv + vec2(0.0, texelSize.y)).x;
    float pB = texture2D(uPressure, vUv - vec2(0.0, texelSize.y)).x;
    vec2 vel = texture2D(uVelocity, vUv).xy;
    vel -= 0.5 * vec2(pR - pL, pT - pB);
    gl_FragColor = vec4(vel, 0.0, 1.0);
}
`;

// ── 6. Advect (semi-Lagrangian with attenuation) ──
const advectFrag = /* glsl */ `
precision highp float;
uniform sampler2D uVelocity;
uniform vec2 texelSize;
uniform float velocityAttenuation;
varying vec2 vUv;

void main() {
    vec2 vel = texture2D(uVelocity, vUv).xy;
    // Backtrace in pixel space: subtract velocity (in pixels) from current pixel coord
    vec2 coord = vUv - vel * texelSize;
    vec2 result = texture2D(uVelocity, coord).xy * velocityAttenuation;
    gl_FragColor = vec4(result, 0.0, 1.0);
}
`;

function createFBO(): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(SIM_RES, SIM_RES, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        format: THREE.RGBAFormat,
    });
}

function createMaterial(
    frag: string,
    uniforms: Record<string, THREE.IUniform>
): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: frag,
        uniforms,
        depthTest: false,
        depthWrite: false,
    });
}

export class FluidSimulation {
    // Ping-pong pairs
    private velocityA = createFBO();
    private velocityB = createFBO();
    private pressureA = createFBO();
    private pressureB = createFBO();
    private curlFBO = createFBO();
    private divFBO = createFBO();

    // Fullscreen quad for GPU compute
    private scene = new THREE.Scene();
    private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    private quad: THREE.Mesh;

    private texelSize = new THREE.Vector2(1 / SIM_RES, 1 / SIM_RES);

    // Materials
    private curlMat: THREE.ShaderMaterial;
    private velocityMat: THREE.ShaderMaterial;
    private divergenceMat: THREE.ShaderMaterial;
    private pressureMat: THREE.ShaderMaterial;
    private gradSubMat: THREE.ShaderMaterial;
    private advectMat: THREE.ShaderMaterial;

    // Pointer state
    private _pointerPos = new THREE.Vector2(0.5, 0.5);
    private _pointerVec = new THREE.Vector2(0, 0);

    // Burst state — when triggered, injects radial velocity over N frames
    private _burstFramesLeft = 0;
    private _burstIntensity = 0;

    // Idle detection — skip GPU compute when nothing is happening
    private _lastPointerMoveTime = 0;
    private _idleThresholdMs = 2000; // 2 seconds of no input = idle

    constructor() {
        const geo = new THREE.PlaneGeometry(2, 2);

        this.curlMat = createMaterial(curlFrag, {
            uVelocity: { value: null },
            texelSize: { value: this.texelSize },
        });
        this.velocityMat = createMaterial(velocityFrag, {
            uVelocity: { value: null },
            uCurl: { value: null },
            texelSize: { value: this.texelSize },
            pointerPos: { value: this._pointerPos },
            pointerVec: { value: this._pointerVec },
            curlStrength: { value: 0.02 },
            dt: { value: 0.016 },
            aspectRatio: { value: 1 },
            burstRadius: { value: 0 },
            burstStrength: { value: 0 },
            burstWidth: { value: 0.06 },
        });
        this.divergenceMat = createMaterial(divergenceFrag, {
            uVelocity: { value: null },
            texelSize: { value: this.texelSize },
        });
        this.pressureMat = createMaterial(pressureFrag, {
            uPressure: { value: null },
            uDivergence: { value: null },
            texelSize: { value: this.texelSize },
        });
        this.gradSubMat = createMaterial(gradientSubtractFrag, {
            uPressure: { value: null },
            uVelocity: { value: null },
            texelSize: { value: this.texelSize },
        });
        this.advectMat = createMaterial(advectFrag, {
            uVelocity: { value: null },
            texelSize: { value: this.texelSize },
            velocityAttenuation: { value: 0.975 },
        });

        this.quad = new THREE.Mesh(geo, this.curlMat);
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);
    }

    setPointer(x: number, y: number, vx: number, vy: number) {
        this._pointerPos.set(x, y);
        // Power curve for organic feel
        const pvx = Math.sign(vx) * Math.pow(Math.abs(vx), 1.6);
        const pvy = Math.sign(vy) * Math.pow(Math.abs(vy), 1.6);
        // Accumulate onto existing (decayed) pointer velocity
        this._pointerVec.x += pvx;
        this._pointerVec.y += pvy;
        // Clamp to [-1, 1]
        this._pointerVec.x = Math.max(-1, Math.min(1, this._pointerVec.x));
        this._pointerVec.y = Math.max(-1, Math.min(1, this._pointerVec.y));
        // Track last move time for idle detection
        this._lastPointerMoveTime = performance.now();
    }

    /**
     * Trigger a radial fluid shockwave from center.
     * The GPU shader handles the ring injection — we just
     * set burstFramesLeft and the compute() method drives
     * the expanding ring radius and decaying strength.
     */
    burst(intensity = 1.0, frames = 60) {
        this._burstFramesLeft = frames;
        this._burstIntensity = intensity;
    }

    private renderPass(
        renderer: THREE.WebGLRenderer,
        material: THREE.ShaderMaterial,
        target: THREE.WebGLRenderTarget
    ) {
        this.quad.material = material;
        renderer.setRenderTarget(target);
        renderer.render(this.scene, this.camera);
    }

    private swapVelocity() {
        const tmp = this.velocityA;
        this.velocityA = this.velocityB;
        this.velocityB = tmp;
    }

    private swapPressure() {
        const tmp = this.pressureA;
        this.pressureA = this.pressureB;
        this.pressureB = tmp;
    }

    compute(renderer: THREE.WebGLRenderer, dt: number) {
        // P3: Skip GPU compute when idle — saves significant GPU bandwidth
        const isIdle =
            performance.now() - this._lastPointerMoveTime > this._idleThresholdMs &&
            this._burstFramesLeft <= 0;
        if (isIdle) return;

        const prevRT = renderer.getRenderTarget();
        const clampedDt = Math.min(dt, 0.05);

        // Drive burst uniforms
        if (this._burstFramesLeft > 0) {
            const totalFrames = 60;
            const progress = 1 - this._burstFramesLeft / totalFrames;
            // Ring expands from center outward
            this.velocityMat.uniforms.burstRadius.value = progress * 0.7;
            // Strength decays over time
            this.velocityMat.uniforms.burstStrength.value =
                this._burstIntensity * 80 * (1 - progress * 0.8);
            // Ring width widens slightly as it expands
            this.velocityMat.uniforms.burstWidth.value = 0.04 + progress * 0.06;
            this._burstFramesLeft--;
        } else {
            this.velocityMat.uniforms.burstStrength.value = 0;
        }

        // 1. Curl
        this.curlMat.uniforms.uVelocity.value = this.velocityA.texture;
        this.renderPass(renderer, this.curlMat, this.curlFBO);

        // 2. Velocity (inject cursor + vorticity + burst)
        this.velocityMat.uniforms.uVelocity.value = this.velocityA.texture;
        this.velocityMat.uniforms.uCurl.value = this.curlFBO.texture;
        this.velocityMat.uniforms.dt.value = clampedDt;
        this.velocityMat.uniforms.aspectRatio.value =
            renderer.domElement.width / renderer.domElement.height;
        this.renderPass(renderer, this.velocityMat, this.velocityB);
        this.swapVelocity();

        // 3. Divergence
        this.divergenceMat.uniforms.uVelocity.value = this.velocityA.texture;
        this.renderPass(renderer, this.divergenceMat, this.divFBO);

        // 4. Pressure solve (4 Jacobi iterations)
        // Clear pressure
        this.pressureMat.uniforms.uDivergence.value = this.divFBO.texture;
        for (let i = 0; i < 4; i++) {
            this.pressureMat.uniforms.uPressure.value = this.pressureA.texture;
            this.renderPass(renderer, this.pressureMat, this.pressureB);
            this.swapPressure();
        }

        // 5. Gradient subtract
        this.gradSubMat.uniforms.uPressure.value = this.pressureA.texture;
        this.gradSubMat.uniforms.uVelocity.value = this.velocityA.texture;
        this.renderPass(renderer, this.gradSubMat, this.velocityB);
        this.swapVelocity();

        // 6. Advect
        this.advectMat.uniforms.uVelocity.value = this.velocityA.texture;
        this.renderPass(renderer, this.advectMat, this.velocityB);
        this.swapVelocity();

        // Decay pointer velocity for next frame (prevents runaway accumulation)
        this._pointerVec.multiplyScalar(0.5);

        renderer.setRenderTarget(prevRT);
    }

    get texture(): THREE.Texture {
        return this.velocityA.texture;
    }

    dispose() {
        this.velocityA.dispose();
        this.velocityB.dispose();
        this.pressureA.dispose();
        this.pressureB.dispose();
        this.curlFBO.dispose();
        this.divFBO.dispose();
        this.curlMat.dispose();
        this.velocityMat.dispose();
        this.divergenceMat.dispose();
        this.pressureMat.dispose();
        this.gradSubMat.dispose();
        this.advectMat.dispose();
        this.quad.geometry.dispose();
    }
}
