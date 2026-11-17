/* =========================================================
   Awan partikel GPU + simulasi fluida untuk latar belakang.
   - Posisi partikel disimpan di tekstur float dan dihitung di GPU
     (satu pass per frame, ping-pong).
   - Partikel ditarik ke permukaan bentuk cincin terpelintir (SDF),
     diaduk curl noise, dan didorong aliran fluida dari kursor.
   - Kalau WebGL2 / tekstur float tidak tersedia, latar tetap hitam
     dan aplikasi tetap jalan normal.
   ========================================================= */
(function () {
  'use strict';

  const canvas = document.getElementById('bg');
  if (!canvas || !window.THREE) return;

  try { mulai(); } catch (e) {
    console.warn('Latar partikel dimatikan:', e);
  }

  function mulai() {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) throw new Error('butuh WebGL2');
    const ext = renderer.extensions;
    const floatRT = ext.has('EXT_color_buffer_float');
    if (!floatRT && !ext.has('EXT_color_buffer_half_float')) throw new Error('render target float tidak didukung');

    const mobile = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(DPR);
    renderer.setSize(innerWidth, innerHeight);
    renderer.setClearColor(0x000000, 1);

    /* ---------- alat bantu pass layar penuh ---------- */
    const quadScene = new THREE.Scene();
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    quadScene.add(quad);
    function pass(material, target) {
      quad.material = material;
      renderer.setRenderTarget(target);
      renderer.render(quadScene, quadCam);
    }
    function rt(w, h, type, filter) {
      return new THREE.WebGLRenderTarget(w, h, {
        type, format: THREE.RGBAFormat, minFilter: filter, magFilter: filter,
        wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false, stencilBuffer: false,
      });
    }
    function ganda(w, h, type, filter) {
      let a = rt(w, h, type, filter), b = rt(w, h, type, filter);
      return { get read() { return a; }, get write() { return b; }, swap() { const t = a; a = b; b = t; } };
    }
    const shader = (fragmentShader, uniforms, vertexShader = VERT_QUAD) =>
      new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false });

    const VERT_QUAD = /* glsl */`
      varying vec2 vUv, vL, vR, vT, vB;
      uniform vec2 texelSize;
      void main() {
        vUv = position.xy * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0); vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y); vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`;

    /* =====================================================
       1. SIMULASI FLUIDA (diaduk kursor)
       ===================================================== */
    const SIM = 256, DYE = 512;
    const FL = {
      velDiss: 0.98, denDiss: 0.97, presDiss: 0.95, presIter: 5, curl: 30, dt: 1 / 60,
    };
    const HF = THREE.HalfFloatType, LIN = THREE.LinearFilter;
    const velocity = ganda(SIM, SIM, HF, LIN);
    const density = ganda(DYE, DYE, HF, LIN);
    const pressure = ganda(SIM, SIM, HF, LIN);
    const divergenceRT = rt(SIM, SIM, HF, LIN);
    const curlRT = rt(SIM, SIM, HF, LIN);
    const simTexel = new THREE.Vector2(1 / SIM, 1 / SIM);
    const dyeTexel = new THREE.Vector2(1 / DYE, 1 / DYE);

    const splatMat = shader(/* glsl */`
      varying vec2 vUv;
      uniform sampler2D uTarget; uniform float aspect, radius;
      uniform vec3 color; uniform vec2 pA, pB;
      float seg(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a, ba = b - a;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
        return length(pa - ba * h);
      }
      void main() {
        vec2 p = vUv, a = pA, b = pB;
        p.x *= aspect; a.x *= aspect; b.x *= aspect;
        float d = seg(p, a, b) / max(radius, 1e-4);
        vec3 s = exp(-d * d * 4.0) * color;
        gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + s, 1.0);
      }`, { uTarget: { value: null }, aspect: { value: 1 }, radius: { value: 0.1 }, color: { value: new THREE.Vector3() }, pA: { value: new THREE.Vector2() }, pB: { value: new THREE.Vector2() }, texelSize: { value: simTexel } });

    const curlMat = shader(/* glsl */`
      varying vec2 vUv, vL, vR, vT, vB;
      uniform sampler2D uVelocity;
      void main() {
        float L = texture2D(uVelocity, vL).y, R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x, B = texture2D(uVelocity, vB).x;
        gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
      }`, { uVelocity: { value: null }, texelSize: { value: simTexel } });

    const vortMat = shader(/* glsl */`
      varying vec2 vUv, vL, vR, vT, vB;
      uniform sampler2D uVelocity, uCurl; uniform float curl, dt;
      void main() {
        float L = texture2D(uCurl, vL).x, R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x, B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C; force.y *= -1.0;
        vec2 vel = texture2D(uVelocity, vUv).xy + force * dt;
        gl_FragColor = vec4(clamp(vel, -1000.0, 1000.0), 0.0, 1.0);
      }`, { uVelocity: { value: null }, uCurl: { value: null }, curl: { value: FL.curl }, dt: { value: FL.dt }, texelSize: { value: simTexel } });

    const divMat = shader(/* glsl */`
      varying vec2 vUv, vL, vR, vT, vB;
      uniform sampler2D uVelocity;
      void main() {
        float L = texture2D(uVelocity, vL).x, R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y, B = texture2D(uVelocity, vB).y;
        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) L = -C.x; if (vR.x > 1.0) R = -C.x;
        if (vT.y > 1.0) T = -C.y; if (vB.y < 0.0) B = -C.y;
        gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
      }`, { uVelocity: { value: null }, texelSize: { value: simTexel } });

    const clearMat = shader(/* glsl */`
      varying vec2 vUv;
      uniform sampler2D uTexture; uniform float value;
      void main() { gl_FragColor = value * texture2D(uTexture, vUv); }`,
      { uTexture: { value: null }, value: { value: FL.presDiss }, texelSize: { value: simTexel } });

    const presMat = shader(/* glsl */`
      varying vec2 vUv, vL, vR, vT, vB;
      uniform sampler2D uPressure, uDivergence;
      void main() {
        float L = texture2D(uPressure, vL).x, R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x, B = texture2D(uPressure, vB).x;
        float div = texture2D(uDivergence, vUv).x;
        gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
      }`, { uPressure: { value: null }, uDivergence: { value: null }, texelSize: { value: simTexel } });

    const gradMat = shader(/* glsl */`
      varying vec2 vUv, vL, vR, vT, vB;
      uniform sampler2D uPressure, uVelocity;
      void main() {
        float L = texture2D(uPressure, vL).x, R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x, B = texture2D(uPressure, vB).x;
        vec2 vel = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }`, { uPressure: { value: null }, uVelocity: { value: null }, texelSize: { value: simTexel } });

    const advMat = shader(/* glsl */`
      varying vec2 vUv;
      uniform sampler2D uVelocity, uSource; uniform vec2 velTexel; uniform float dt, dissipation;
      void main() {
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * velTexel;
        gl_FragColor = vec4(dissipation * texture2D(uSource, coord).xyz, 1.0);
      }`, { uVelocity: { value: null }, uSource: { value: null }, velTexel: { value: simTexel }, dt: { value: FL.dt }, dissipation: { value: 1 }, texelSize: { value: simTexel } });

    function splat(target, texel, a, b, color, radius) {
      splatMat.uniforms.uTarget.value = target.read.texture;
      splatMat.uniforms.texelSize.value = texel;
      splatMat.uniforms.aspect.value = innerWidth / innerHeight;
      splatMat.uniforms.pA.value.copy(a);
      splatMat.uniforms.pB.value.copy(b);
      splatMat.uniforms.color.value.copy(color);
      splatMat.uniforms.radius.value = radius;
      pass(splatMat, target.write);
      target.swap();
    }

    function langkahFluida() {
      curlMat.uniforms.uVelocity.value = velocity.read.texture;
      pass(curlMat, curlRT);

      vortMat.uniforms.uVelocity.value = velocity.read.texture;
      vortMat.uniforms.uCurl.value = curlRT.texture;
      pass(vortMat, velocity.write); velocity.swap();

      divMat.uniforms.uVelocity.value = velocity.read.texture;
      pass(divMat, divergenceRT);

      clearMat.uniforms.uTexture.value = pressure.read.texture;
      pass(clearMat, pressure.write); pressure.swap();

      presMat.uniforms.uDivergence.value = divergenceRT.texture;
      for (let i = 0; i < FL.presIter; i++) {
        presMat.uniforms.uPressure.value = pressure.read.texture;
        pass(presMat, pressure.write); pressure.swap();
      }

      gradMat.uniforms.uPressure.value = pressure.read.texture;
      gradMat.uniforms.uVelocity.value = velocity.read.texture;
      pass(gradMat, velocity.write); velocity.swap();

      advMat.uniforms.uVelocity.value = velocity.read.texture;
      advMat.uniforms.uSource.value = velocity.read.texture;
      advMat.uniforms.dissipation.value = FL.velDiss;
      pass(advMat, velocity.write); velocity.swap();

      advMat.uniforms.uVelocity.value = velocity.read.texture;
      advMat.uniforms.uSource.value = density.read.texture;
      advMat.uniforms.dissipation.value = FL.denDiss;
      pass(advMat, density.write); density.swap();
    }

    /* =====================================================
       2. KAMERA & KELOMPOK PARTIKEL
       ===================================================== */
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 1000);
    const camBase = new THREE.Vector3(-1.17, 0, 6);
    // Layar tegak (HP): kamera mundur supaya cincin tetap muat di layar yang sempit
    const aturJarak = () => {
      const aspek = innerWidth / innerHeight;
      camBase.set(aspek < 1 ? -0.4 : -1.17, 0, aspek < 1 ? 6 + (1 / aspek - 1) * 4 : 6);
    };
    aturJarak();
    camera.position.copy(camBase);
    camera.lookAt(0, 0, 0);
    const group = new THREE.Group();
    const deg = THREE.MathUtils.degToRad;
    group.position.set(0.343, 0.16, -1);
    group.rotation.set(deg(-28.4), deg(390), deg(4.92));
    group.scale.set(5, 5, 6);
    scene.add(group);

    /* =====================================================
       3. SIMULASI POSISI PARTIKEL
       ===================================================== */
    const SIZE = mobile ? 100 : 374;   // jumlah partikel = SIZE² ≈ 140 ribu; dikurangi dari 512² (≈262 ribu) supaya cincinnya tidak terlalu tebal
    const N = SIZE * SIZE;
    const posType = floatRT ? THREE.FloatType : THREE.HalfFloatType;
    const positions = ganda(SIZE, SIZE, posType, THREE.NearestFilter);

    const asal = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      asal[i * 4] = Math.random() * 2 - 1;
      asal[i * 4 + 1] = Math.random() * 2 - 1;
      asal[i * 4 + 2] = Math.random() * 2 - 1;
      asal[i * 4 + 3] = 1;
    }
    const originTex = new THREE.DataTexture(asal, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType);
    originTex.minFilter = originTex.magFilter = THREE.NearestFilter;
    originTex.needsUpdate = true;

    const copyMat = shader(/* glsl */`
      varying vec2 vUv;
      uniform sampler2D uTexture;
      void main() { gl_FragColor = texture2D(uTexture, vUv); }`,
      { uTexture: { value: originTex }, texelSize: { value: new THREE.Vector2(1 / SIZE, 1 / SIZE) } });
    pass(copyMat, positions.read);
    pass(copyMat, positions.write);

    // Fungsi bentuk (SDF) dipakai dua shader: penghitung "posisi rumah" dan simulasi.
    const SDF_GLSL = /* glsl */`
      vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }

      // Cincin organik terpelintir dengan satu lubang besar, sekitar 0,7 unit.
      float sdfShape(vec3 p) {
        float L = length(p);
        if (L > 0.8) return L - 0.7;
        p.z = sqrt(p.z * p.z + 0.0215) - sqrt(0.012);   // simetris depan-belakang, sambungan lembut
        p = qrot(vec4(0.5), p);
        float a = atan(p.y, p.x);
        float R = 0.17 + 0.025 * sin(a * 2.0 + 0.6);
        vec2 q = vec2(length(p.xy) - R, p.z - 0.045 * sin(a + 0.8));
        float tw = a * 0.5;                               // pelintiran penampang
        q = mat2(cos(tw), -sin(tw), sin(tw), cos(tw)) * q;
        float lobus = 0.015 * sin(a * 3.0 + 1.3) * cos(a * 2.0);
        return (length(q * vec2(1.0, 1.35)) - (0.065 + lobus)) * 0.7;
      }
      vec3 sdfNormal(vec3 p) {
        const float e = 0.001;
        return normalize(vec3(
          sdfShape(p + vec3(e, 0, 0)) - sdfShape(p - vec3(e, 0, 0)),
          sdfShape(p + vec3(0, e, 0)) - sdfShape(p - vec3(0, e, 0)),
          sdfShape(p + vec3(0, 0, e)) - sdfShape(p - vec3(0, 0, e))) + 1e-6);
      }`;

    // "Posisi rumah": titik asal acak yang diproyeksikan ke permukaan bentuk.
    // Dihitung sekali di awal; partikel ditarik pegas ke sini supaya bentuknya
    // pulih dalam ±1–2 detik setelah diaduk kursor.
    const homes = ganda(SIZE, SIZE, posType, THREE.NearestFilter);
    const settleMat = shader(/* glsl */`
      varying vec2 vUv;
      uniform sampler2D uPos;
      ${SDF_GLSL}
      void main() {
        vec3 p = texture2D(uPos, vUv).xyz;
        if (length(p) > 0.7) p /= 2.0;
        p -= sdfNormal(p) * sdfShape(p);
        gl_FragColor = vec4(p, 1.0);
      }`, { uPos: { value: null }, texelSize: { value: new THREE.Vector2(1 / SIZE, 1 / SIZE) } });
    pass(copyMat, homes.read);
    for (let i = 0; i < 40; i++) {
      settleMat.uniforms.uPos.value = homes.read.texture;
      pass(settleMat, homes.write);
      homes.swap();
    }
    const homeTex = homes.read.texture;

    const simMat = shader(/* glsl */`
      varying vec2 vUv;
      uniform sampler2D uPos, uHome, uVel, uDen;
      uniform float uTime, uHZ, uMouse;
      uniform mat4 uProj, uModel;
      uniform mat3 uCamRot, uModelInvRot;
      ${SDF_GLSL}

      // Curl noise dari tiga potensial jumlah-sinus (gaya Bridson)
      vec3 potensial(vec3 p) {
        return vec3(
          sin(p.y * 1.7 + cos(p.z * 1.3)) + 0.5 * sin(p.z * 2.3 + 1.1),
          sin(p.z * 1.9 + cos(p.x * 1.1)) + 0.5 * sin(p.x * 2.1 + 2.3),
          sin(p.x * 1.5 + cos(p.y * 1.7)) + 0.5 * sin(p.y * 2.7 + 0.7));
      }
      vec3 curlNoise(vec3 p) {
        const float e = 0.01;
        vec3 dx = (potensial(p + vec3(e, 0, 0)) - potensial(p - vec3(e, 0, 0))) / (2.0 * e);
        vec3 dy = (potensial(p + vec3(0, e, 0)) - potensial(p - vec3(0, e, 0))) / (2.0 * e);
        vec3 dz = (potensial(p + vec3(0, 0, e)) - potensial(p - vec3(0, 0, e))) / (2.0 * e);
        vec3 c = vec3(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x);
        return c / (length(c) + 1e-5);
      }

      void main() {
        vec3 pos = texture2D(uPos, vUv).xyz;
        vec3 home = texture2D(uHome, vUv).xyz;

        if (length(pos) > 0.7) pos /= 2.0;
        pos += curlNoise(pos * 0.1 + uTime * 0.05) * 0.0002 * uHZ;
        vec3 grad = sdfNormal(pos);
        float d = sdfShape(pos);
        pos += cross(normalize(pos + 1e-6), grad) * 0.0005 * uHZ;  // berputar di sepanjang permukaan
        pos += -grad * d * min(0.5 * uHZ, 0.9);                     // ditarik ke permukaan
        pos += (home - pos) * min(0.03 * uHZ, 0.5);                 // pegas ke posisi rumah (pulih ±1–2 dtk)

        // dorongan fluida dari kursor
        vec4 clip = uProj * uModel * vec4(pos, 1.0);
        vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
        if (clip.w > 0.0 && all(greaterThan(suv, vec2(0.0))) && all(lessThan(suv, vec2(1.0)))) {
          vec2 v = texture2D(uVel, suv).xy;
          float den = clamp(texture2D(uDen, suv).r, 0.0, 1.0);
          vec3 flow = uModelInvRot * (uCamRot * vec3(v, 0.0));
          pos += flow * 0.0001 * uHZ * uMouse * den;
        }
        gl_FragColor = vec4(pos, 1.0);
      }`, {
      uPos: { value: null }, uHome: { value: homeTex }, uVel: { value: null }, uDen: { value: null },
      uTime: { value: 0 }, uHZ: { value: 1 }, uMouse: { value: 0.8 },
      uProj: { value: new THREE.Matrix4() }, uModel: { value: new THREE.Matrix4() },
      uCamRot: { value: new THREE.Matrix3() }, uModelInvRot: { value: new THREE.Matrix3() },
      texelSize: { value: new THREE.Vector2(1 / SIZE, 1 / SIZE) },
    });

    /* =====================================================
       4. MENGGAMBAR PARTIKEL
       ===================================================== */
    const geo = new THREE.BufferGeometry();
    const uvPos = new Float32Array(N * 3);
    const acak = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      uvPos[i * 3] = ((i % SIZE) + 0.5) / SIZE;
      uvPos[i * 3 + 1] = (Math.floor(i / SIZE) + 0.5) / SIZE;
      for (let k = 0; k < 4; k++) acak[i * 4 + k] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(uvPos, 3));
    geo.setAttribute('random', new THREE.BufferAttribute(acak, 4));

    // Matcap: bola abu-abu lembut 64×64, dibuat di canvas (pengganti data URI)
    const mc = document.createElement('canvas');
    mc.width = mc.height = 64;
    const cx = mc.getContext('2d');
    const gr = cx.createRadialGradient(24, 22, 2, 32, 32, 34);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#bdbdbd');
    gr.addColorStop(0.75, '#5a5a5a'); gr.addColorStop(1, '#1a1a1a');
    cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    const matcap = new THREE.CanvasTexture(mc);

    const pointMat = new THREE.ShaderMaterial({
      uniforms: { uPos: { value: null }, uMatcap: { value: matcap }, uTime: { value: 0 }, uDPR: { value: DPR } },
      vertexShader: /* glsl */`
        uniform sampler2D uPos; uniform float uDPR;
        attribute vec4 random;
        varying vec4 vRandom; varying float vScale;
        void main() {
          vec3 p = texture2D(uPos, position.xy).xyz;
          p *= mix(1.0, 1.5, pow(random.y, 150.0));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          float scale = smoothstep(3.0, 15.0, dist) * mix(0.5, 1.0, random.z);
          vScale = scale; vRandom = random;
          gl_PointSize = 0.0369 * uDPR * 2.0 * scale * (1000.0 / dist);   // asal 0.04: −10% lalu +2,5% (≈92% dari ukuran awal)
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMatcap; uniform float uTime;
        varying vec4 vRandom; varying float vScale;
        vec3 softLight(vec3 b, vec3 s) {
          return mix(2.0 * b * s + b * b * (1.0 - 2.0 * s), sqrt(b) * (2.0 * s - 1.0) + 2.0 * b * (1.0 - s), step(0.5, s));
        }
        vec3 overlay(vec3 b, vec3 s) { return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b)); }
        void main() {
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          if (dot(uv, uv) > 1.0 || vScale < 0.1) discard;
          vec3 col = vec3(mix(0.0, 0.2, vRandom.x));
          col = mix(col, vec3(0.6, 0.45, 1.0), pow(vRandom.z, 100.0));
          col = mix(col, vec3(1.0, 0.78, 0.36), pow(vRandom.w, 60.0));   // sedikit titik emas (palet Emas & Ungu)
          float sparkle = 0.5 + (0.4 + sin(uTime * 4.0 + vRandom.y * 20.0)) * pow(vRandom.z, 10.0) * 2.5;
          float ang = sin(uTime + vRandom.z * 20.0) * 0.5 + 1.0;
          vec2 ruv = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * uv * 0.5 + 0.5;
          vec3 m = texture2D(uMatcap, ruv).rgb;
          col = mix(col, softLight(col, m), 0.8);
          col = mix(col, overlay(col, m), 0.2);
          // Diredupkan sedikit: bagian cincin yang partikelnya bertumpuk tidak jadi putih pekat
          gl_FragColor = vec4(col * sparkle * 0.6, 1.0);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false,
    });
    const points = new THREE.Points(geo, pointMat);
    points.frustumCulled = false;
    group.add(points);

    /* =====================================================
       5. INPUT KURSOR / SENTUH
       ===================================================== */
    const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    const sebelum = { x: mouse.x, y: mouse.y };
    let splatTerakhir = 0;
    const setMouse = (x, y) => { mouse.x = x; mouse.y = y; };
    addEventListener('pointermove', e => setMouse(e.clientX, e.clientY), { passive: true });
    addEventListener('touchstart', e => { const t = e.touches[0]; if (t) { setMouse(t.clientX, t.clientY); sebelum.x = t.clientX; sebelum.y = t.clientY; } }, { passive: true });
    addEventListener('touchmove', e => { const t = e.touches[0]; if (t) setMouse(t.clientX, t.clientY); }, { passive: true });

    const petaClamp = (v, a, b, c, d) => c + (Math.min(Math.max(v, a), b) - a) / (b - a) * (d - c);
    const tmpA = new THREE.Vector2(), tmpB = new THREE.Vector2(), warna = new THREE.Vector3(), putih = new THREE.Vector3(1, 1, 1);

    function inputKursor(now) {
      const dx = mouse.x - sebelum.x, dy = mouse.y - sebelum.y;
      const len = Math.hypot(dx, dy);
      if (len > 0.01) {
        const radius = petaClamp(len, 0, 5, 0, 60) * 0.6 * (mobile ? 0.8 : 1);
        const mult = petaClamp(len, 0, 15, 0, 10);
        const dariSini = now - splatTerakhir > 50;
        tmpB.set(mouse.x / innerWidth, 1 - mouse.y / innerHeight);
        if (dariSini) tmpA.copy(tmpB); else tmpA.set(sebelum.x / innerWidth, 1 - sebelum.y / innerHeight);
        warna.set(dx * mult, -dy * mult, 1);
        splat(velocity, simTexel, tmpA, tmpB, warna, radius / 200);
        splat(density, dyeTexel, tmpA, tmpB, putih, radius / 200);
        splatTerakhir = now;
      }
      sebelum.x = mouse.x; sebelum.y = mouse.y;
    }

    /* =====================================================
       6. LOOP
       ===================================================== */
    const target = new THREE.Vector3();
    const qInv = new THREE.Quaternion();
    const m4 = new THREE.Matrix4();
    let waktu = 0, lalu = performance.now();

    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min((now - lalu) / 1000, 1 / 20);
      lalu = now;
      waktu += dt;
      const HZ = dt * 60;

      // kamera "melirik" mengikuti kursor
      target.set(
        camBase.x + (mouse.x / innerWidth * 2 - 1) * -1,
        camBase.y + (mouse.y / innerHeight * 2 - 1) * 2,
        camBase.z);
      camera.position.lerp(target, 0.05);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      group.updateMatrixWorld();

      inputKursor(now);
      langkahFluida();

      const u = simMat.uniforms;
      u.uPos.value = positions.read.texture;
      u.uVel.value = velocity.read.texture;
      u.uDen.value = density.read.texture;
      u.uTime.value = waktu;
      u.uHZ.value = HZ;
      u.uProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      u.uModel.value.copy(group.matrixWorld);
      u.uCamRot.value.setFromMatrix4(camera.matrixWorld);
      qInv.copy(group.quaternion).invert();
      u.uModelInvRot.value.setFromMatrix4(m4.makeRotationFromQuaternion(qInv));
      pass(simMat, positions.write);
      positions.swap();

      pointMat.uniforms.uPos.value = positions.read.texture;
      pointMat.uniforms.uTime.value = waktu;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }

    addEventListener('resize', () => {
      renderer.setSize(innerWidth, innerHeight);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      aturJarak();
    });

    requestAnimationFrame(frame);
  }
})();
