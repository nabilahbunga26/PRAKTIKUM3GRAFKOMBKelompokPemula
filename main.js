/* ==========================================================================
 * main.js — Interactive Transformation Playground (WebGL2)
 * EF234504 Grafika Komputer · Praktikum 3
 *
 * Alur besar:
 *   geometry (LOCAL coordinate, 1 VBO dipakai bersama)
 *     → Model Matrix 3×3 (uniform u_model, dihitung di CPU lewat matrix3.js)
 *     → View Matrix 3×3  (uniform u_view, koreksi aspect ratio)
 *     → clip space → pixel
 *
 * Data vertex asli TIDAK PERNAH diubah; semua posisi/rotasi/ukuran dibuat
 * hanya lewat Model Matrix.
 * ========================================================================== */
(function () {
  'use strict';

  const M3 = Matrix3;

  /* ------------------------------------------------------------------ *
   * 1. Setup canvas & WebGL2
   * ------------------------------------------------------------------ */
  const canvas  = document.getElementById('glCanvas');
  const overlay = document.getElementById('overlay');
  const octx    = overlay.getContext('2d');
  const errBox  = document.getElementById('glError');

  function fail(msg) {
    errBox.style.display = 'block';
    errBox.textContent = msg;
  }

  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) {
    fail('WebGL2 tidak tersedia di browser ini. Gunakan Chrome, Edge, atau Firefox versi terbaru.');
    return;
  }

  // Ruang dunia: y ∈ [-1, 1], x ∈ [-ASPECT, ASPECT]
  const ASPECT = canvas.width / canvas.height;
  const VIEW = M3.scaling(1 / ASPECT, 1);

  /* ------------------------------------------------------------------ *
   * 2. Shader
   * ------------------------------------------------------------------ */
  const VS_SRC = `#version 300 es
  in vec2 a_position;          // koordinat LOKAL
  in vec4 a_color;
  uniform mat3 u_model;        // Model Matrix 3x3 (local -> world)
  uniform mat3 u_view;         // koreksi aspect ratio (world -> clip)
  out vec4 v_color;
  void main() {
    vec3 p = u_view * u_model * vec3(a_position, 1.0);
    gl_Position = vec4(p.xy, 0.0, 1.0);
    v_color = a_color;
  }`;

  const FS_SRC = `#version 300 es
  precision mediump float;
  in vec4 v_color;
  uniform vec4 u_tint;         // rgb dikalikan warna vertex, a = opasitas
  out vec4 outColor;
  void main() {
    outColor = vec4(v_color.rgb * u_tint.rgb, v_color.a * u_tint.a);
  }`;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VS_SRC));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FS_SRC));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
  } catch (e) {
    fail('Shader gagal dikompilasi: ' + e.message);
    return;
  }
  gl.useProgram(program);

  const aPos   = gl.getAttribLocation(program, 'a_position');
  const aColor = gl.getAttribLocation(program, 'a_color');
  const uModel = gl.getUniformLocation(program, 'u_model');
  const uView  = gl.getUniformLocation(program, 'u_view');
  const uTint  = gl.getUniformLocation(program, 'u_tint');

  gl.uniformMatrix3fv(uView, false, VIEW);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(1, 1, 1, 1);

  /* ------------------------------------------------------------------ *
   * 3. Geometry — dibuat sekali, disimpan dalam koordinat LOKAL
   *    Format vertex: x, y, r, g, b, a  (stride 6 float)
   * ------------------------------------------------------------------ */
  function pushV(out, x, y, c) { out.push(x, y, c[0], c[1], c[2], c[3]); }

  function pushTri(out, p1, p2, p3, c1, c2, c3) {
    pushV(out, p1[0], p1[1], c1);
    pushV(out, p2[0], p2[1], c2 || c1);
    pushV(out, p3[0], p3[1], c3 || c1);
  }

  function pushLineQuad(out, x1, y1, x2, y2, w, c) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * w / 2, ny = dx / len * w / 2;
    const a = [x1 + nx, y1 + ny], b = [x1 - nx, y1 - ny];
    const d = [x2 + nx, y2 + ny], e = [x2 - nx, y2 - ny];
    pushTri(out, a, b, d, c);
    pushTri(out, b, e, d, c);
  }

  function pushCircle(out, cx, cy, r, c, seg) {
    seg = seg || 28;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      pushTri(out, [cx, cy],
        [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r],
        [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r], c);
    }
  }

  function makeMesh(data) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const stride = 6 * 4;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, stride, 2 * 4);
    gl.bindVertexArray(null);
    return { vao: vao, count: data.length / 6 };
  }

  // --- Bentuk "panah" yang dipakai bersama oleh Object A, B, dan C ---
  // Sengaja asimetris (badan + kepala + sirip di atas) agar rotasi,
  // skala non-uniform, dan urutan transform mudah diamati.
  const shapeData = [];
  (function buildShape() {
    const L = 0.78, R = 0.95, W = 1.0;
    // badan (2 segitiga membentuk persegi panjang)
    pushTri(shapeData, [-0.15, -0.09], [0.10, -0.09], [0.10, 0.09],
      [L, L, L, 1], [R, R, R, 1], [R, R, R, 1]);
    pushTri(shapeData, [-0.15, -0.09], [0.10, 0.09], [-0.15, 0.09],
      [L, L, L, 1], [R, R, R, 1], [L, L, L, 1]);
    // kepala panah (menunjuk ke +X lokal)
    pushTri(shapeData, [0.10, -0.16], [0.28, 0.0], [0.10, 0.16], [W, W, W, 1]);
    // sirip di sisi +Y lokal (penanda orientasi)
    pushTri(shapeData, [-0.15, 0.09], [-0.05, 0.09], [-0.15, 0.22], [0.55, 0.55, 0.55, 1]);
    // titik pusat lokal (0,0) sebagai penanda pivot
  })();
  const shapeMesh = makeMesh(shapeData);

  // --- Grid, sumbu X/Y, tick, dan origin (koordinat dunia, model = identity) ---
  const sceneData = [];
  (function buildScene() {
    const minor = [0.90, 0.90, 0.90, 1];
    const major = [0.74, 0.74, 0.74, 1];
    const RED = [1.0, 0.24, 0.0, 1];
    const GREEN = [0.0, 0.78, 0.33, 1];
    const INK = [0.06, 0.06, 0.06, 1];

    // grid tiap 0.25 unit, garis mayor tiap 0.5
    for (let k = -5; k <= 5; k++) {
      const x = k * 0.25;
      if (k === 0 || Math.abs(x) > ASPECT) continue;
      pushLineQuad(sceneData, x, -1, x, 1, k % 2 === 0 ? 0.006 : 0.003, k % 2 === 0 ? major : minor);
    }
    for (let k = -4; k <= 4; k++) {
      const y = k * 0.25;
      if (k === 0) continue;
      pushLineQuad(sceneData, -ASPECT, y, ASPECT, y, k % 2 === 0 ? 0.006 : 0.003, k % 2 === 0 ? major : minor);
    }

    // sumbu X (merah) dan sumbu Y (hijau) + kepala panah
    pushLineQuad(sceneData, -ASPECT + 0.02, 0, ASPECT - 0.08, 0, 0.013, RED);
    pushTri(sceneData, [ASPECT - 0.005, 0], [ASPECT - 0.10, 0.035], [ASPECT - 0.10, -0.035], RED);
    pushLineQuad(sceneData, 0, -0.98, 0, 0.90, 0.013, GREEN);
    pushTri(sceneData, [0, 0.995], [-0.035, 0.90], [0.035, 0.90], GREEN);

    // tick tiap 0.5 unit
    [-1, -0.5, 0.5, 1].forEach(function (t) {
      pushLineQuad(sceneData, t, -0.03, t, 0.03, 0.007, INK);
    });
    [-0.5, 0.5].forEach(function (t) {
      pushLineQuad(sceneData, -0.03, t, 0.03, t, 0.007, INK);
    });

    // origin (0,0): lingkaran hitam + isi kuning
    pushCircle(sceneData, 0, 0, 0.038, INK);
    pushCircle(sceneData, 0, 0, 0.022, [1.0, 0.84, 0.0, 1]);
  })();
  const sceneMesh = makeMesh(sceneData);

  /* ------------------------------------------------------------------ *
   * 4. State
   * ------------------------------------------------------------------ */
  const DEFAULT_A = { x: -0.45, y: 0.15, rot: 30, sx: 1, sy: 1 };
  const PRESETS = {
    1: { name: 'Preset 1 — Orbit', x: 0.55, y: 0.25, rot: 60, sx: 1.0, sy: 1.0 },
    2: { name: 'Preset 2 — Stretch', x: -0.60, y: -0.35, rot: 45, sx: 2.2, sy: 0.6 },
    3: { name: 'Preset 3 — Big Tilt', x: 0.35, y: -0.45, rot: -35, sx: 1.6, sy: 1.6 }
  };

  // Object A — dikontrol pengguna. rot dalam DERAJAT, dikonversi saat membuat matriks.
  const A = Object.assign({}, DEFAULT_A);
  let order = 0;          // 0: T·R·S   1: R·T·S
  let showGhost = true;   // tampilkan hasil urutan lawan sebagai bayangan
  let showChild = true;   // parent–child: Object C ikut Object B
  let activePreset = 0;

  // Object B — animasi otomatis (rotasi kontinu + skala berdenyut)
  const B = { x: 0.62, y: -0.10, rot: 0, s: 1 };
  const C = { orbit: 0, spin: 0 };
  let animTime = 0;

  // Konstanta kecepatan — SEMUANYA per detik, dikali deltaTime
  const MOVE_SPEED = 0.9;        // unit dunia / detik
  const ROT_SPEED = 110;         // derajat / detik
  const SCALE_RATE = 1.1;        // laju eksponensial / detik (skala berubah ×e^(1.1·dt))
  const SCALE_MIN = 0.25, SCALE_MAX = 3.5;
  const B_SPIN = 80;             // derajat / detik
  const C_ORBIT = 150;           // derajat / detik
  const C_SPIN = -260;           // derajat / detik
  const LIM_X = 1.25, LIM_Y = 0.92;

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function rad(d) { return d * M3.DEG2RAD; }
  function wrap360(d) { return ((d % 360) + 360) % 360; }

  function setA(p) {
    A.x = p.x; A.y = p.y; A.rot = p.rot; A.sx = p.sx; A.sy = p.sy;
  }

  /* ------------------------------------------------------------------ *
   * 5. Input — STATE-BASED (kontinu) + EVENT-BASED (sekali tekan)
   * ------------------------------------------------------------------ */
  const keys = Object.create(null);   // keys[e.code] = true selama ditahan
  const HANDLED = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'KeyC', 'KeyV',
    'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract',
    'KeyR', 'KeyT', 'KeyH', 'KeyP',
    'Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'
  ]);

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (!HANDLED.has(e.code)) return;
    e.preventDefault();                       // cegah scroll halaman oleh panah
    keys[e.code] = true;
    if (e.repeat) return;                     // aksi diskrit: hanya sekali per tekan
    switch (e.code) {
      case 'KeyR': resetTransform(); break;
      case 'KeyT': toggleOrder(); break;
      case 'KeyH': toggleGhost(); break;
      case 'KeyP': toggleChild(); break;
      case 'Digit1': case 'Numpad1': applyPreset(1); break;
      case 'Digit2': case 'Numpad2': applyPreset(2); break;
      case 'Digit3': case 'Numpad3': applyPreset(3); break;
    }
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () {      // cegah tombol "nyangkut"
    for (const k in keys) keys[k] = false;
  });

  // ---- aksi diskrit ----
  function resetTransform() { setA(DEFAULT_A); activePreset = 0; }
  function toggleOrder() { order = 1 - order; syncButtons(); }
  function toggleGhost() { showGhost = !showGhost; syncButtons(); }
  function toggleChild() { showChild = !showChild; syncButtons(); }
  function applyPreset(n) { setA(PRESETS[n]); activePreset = n; }

  // ---- mouse / pointer: drag untuk translation Object A ----
  let dragging = false;
  const mouse = { x: 0, y: 0, inside: false };

  function toWorld(ev) {
    const r = canvas.getBoundingClientRect();
    const nx = (ev.clientX - r.left) / r.width;
    const ny = (ev.clientY - r.top) / r.height;
    return [(nx * 2 - 1) * ASPECT, 1 - ny * 2];
  }

  function dragTo(ev) {
    const w = toWorld(ev);
    let px = w[0], py = w[1];
    if (order === 1) {
      // Pada M = R·T·S posisi dunia = R(θ)·(tx,ty) → parameter = R(-θ)·posisi dunia
      const p = M3.transformPoint(M3.rotation(-rad(A.rot)), px, py);
      px = p[0]; py = p[1];
    }
    A.x = clamp(px, -LIM_X, LIM_X);
    A.y = clamp(py, -LIM_Y, LIM_Y);
    activePreset = 0;
  }

  canvas.addEventListener('pointerdown', function (ev) {
    dragging = true;
    canvas.setPointerCapture(ev.pointerId);
    dragTo(ev);
  });
  canvas.addEventListener('pointermove', function (ev) {
    const w = toWorld(ev);
    mouse.x = w[0]; mouse.y = w[1]; mouse.inside = true;
    if (dragging) dragTo(ev);
  });
  canvas.addEventListener('pointerup', function () { dragging = false; });
  canvas.addEventListener('pointercancel', function () { dragging = false; });
  canvas.addEventListener('pointerleave', function () { mouse.inside = false; });

  /* ------------------------------------------------------------------ *
   * 6. Update — semua perubahan dikalikan deltaTime (detik)
   * ------------------------------------------------------------------ */
  function update(dt) {
    // Translation (Arrow Keys)
    let dx = 0, dy = 0;
    if (keys.ArrowLeft)  dx -= 1;
    if (keys.ArrowRight) dx += 1;
    if (keys.ArrowDown)  dy -= 1;
    if (keys.ArrowUp)    dy += 1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy);                 // diagonal tidak lebih cepat
      A.x += (dx / len) * MOVE_SPEED * dt;
      A.y += (dy / len) * MOVE_SPEED * dt;
      activePreset = 0;
    }
    A.x = clamp(A.x, -LIM_X, LIM_X);
    A.y = clamp(A.y, -LIM_Y, LIM_Y);

    // Rotation (Q = CCW, E = CW)
    if (keys.KeyQ) { A.rot += ROT_SPEED * dt; activePreset = 0; }
    if (keys.KeyE) { A.rot -= ROT_SPEED * dt; activePreset = 0; }
    A.rot = wrap360(A.rot);

    // Scaling — eksponensial supaya konsisten di frame rate berapa pun
    const g = Math.exp(SCALE_RATE * dt);
    if (keys.Equal || keys.NumpadAdd)      { A.sx *= g; A.sy *= g; activePreset = 0; }   // uniform +
    if (keys.Minus || keys.NumpadSubtract) { A.sx /= g; A.sy /= g; activePreset = 0; }   // uniform −
    if (keys.KeyX) { A.sx *= g; activePreset = 0; }   // scale X +
    if (keys.KeyZ) { A.sx /= g; activePreset = 0; }   // scale X −
    if (keys.KeyV) { A.sy *= g; activePreset = 0; }   // scale Y +
    if (keys.KeyC) { A.sy /= g; activePreset = 0; }   // scale Y −
    A.sx = clamp(A.sx, SCALE_MIN, SCALE_MAX);
    A.sy = clamp(A.sy, SCALE_MIN, SCALE_MAX);

    // Object B — animasi otomatis (rotation + scaling)
    animTime += dt;
    B.rot = wrap360(B.rot + B_SPIN * dt);
    B.s = 1 + 0.35 * Math.sin(animTime * 2.2);

    // Object C — child dari B (orbit + spin)
    C.orbit = wrap360(C.orbit + C_ORBIT * dt);
    C.spin = wrap360(C.spin + C_SPIN * dt);
  }

  /* ------------------------------------------------------------------ *
   * 7. Render
   * ------------------------------------------------------------------ */
  const IDENTITY = M3.identity();
  const TINT_WHITE = [1, 1, 1, 1];
  const TINT_A = [1.0, 0.41, 0.71, 1.0];    // pink
  const TINT_GHOST = [1.0, 0.30, 0.0, 0.62];
  const TINT_B = [0.0, 0.34, 1.0, 1.0];     // biru
  const TINT_C = [0.0, 0.80, 0.35, 1.0];    // hijau

  function drawMesh(mesh, model, tint) {
    gl.bindVertexArray(mesh.vao);
    gl.uniformMatrix3fv(uModel, false, model);
    gl.uniform4fv(uTint, tint);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }

  function matrixA(ord) { return M3.compose(ord, A.x, A.y, rad(A.rot), A.sx, A.sy); }
  function matrixB() { return M3.compose(0, B.x, B.y, rad(B.rot), B.s, B.s); }
  function matrixC(mB) {
    // Parent–child + orbit:  M_C = M_B · R(orbit) · T(r,0) · R(spin) · S(0.45)
    return M3.chain(
      mB,
      M3.rotation(rad(C.orbit)),
      M3.translation(0.62, 0),
      M3.rotation(rad(C.spin)),
      M3.scaling(0.45, 0.45)
    );
  }

  function render() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // grid + sumbu + origin
    drawMesh(sceneMesh, IDENTITY, TINT_WHITE);

    // Object A (urutan aktif) + bayangan urutan lawan — GEOMETRY YANG SAMA
    const mA = matrixA(order);
    if (showGhost) drawMesh(shapeMesh, matrixA(1 - order), TINT_GHOST);
    drawMesh(shapeMesh, mA, TINT_A);

    // Object B (animasi otomatis) + Object C (child) — GEOMETRY YANG SAMA
    const mB = matrixB();
    drawMesh(shapeMesh, mB, TINT_B);
    if (showChild) drawMesh(shapeMesh, matrixC(mB), TINT_C);

    drawOverlay(mA, mB);
  }

  /* ------------------------------------------------------------------ *
   * 8. Overlay 2D — label sumbu, garis bantu, label objek
   * ------------------------------------------------------------------ */
  const W = overlay.width, H = overlay.height;
  function px(x) { return (x / ASPECT * 0.5 + 0.5) * W; }
  function py(y) { return (0.5 - y * 0.5) * H; }

  function label(text, x, y, color, bg) {
    octx.font = '700 15px "Courier New", monospace';
    const w = octx.measureText(text).width + 10;
    x = Math.min(Math.max(x, 8), W - w - 4);     // jaga label tetap di dalam canvas
    y = Math.min(Math.max(y, 18), H - 8);
    if (bg) {
      octx.fillStyle = bg;
      octx.fillRect(x - 5, y - 14, w, 20);
      octx.strokeStyle = '#101010';
      octx.lineWidth = 2;
      octx.strokeRect(x - 5, y - 14, w, 20);
    }
    octx.fillStyle = color;
    octx.fillText(text, x, y);
  }

  function dashedLine(x1, y1, x2, y2, color) {
    octx.save();
    octx.setLineDash([8, 6]);
    octx.strokeStyle = color;
    octx.lineWidth = 2;
    octx.beginPath();
    octx.moveTo(px(x1), py(y1));
    octx.lineTo(px(x2), py(y2));
    octx.stroke();
    octx.restore();
  }

  function dot(x, y, color) {
    octx.fillStyle = color;
    octx.strokeStyle = '#101010';
    octx.lineWidth = 2;
    octx.beginPath();
    octx.arc(px(x), py(y), 5, 0, Math.PI * 2);
    octx.fill();
    octx.stroke();
  }

  function drawOverlay(mA, mB) {
    octx.clearRect(0, 0, W, H);

    // label sumbu & origin
    label('X', px(ASPECT) - 26, py(0) - 14, '#FF3D00');
    label('Y', px(0) + 14, py(1) + 24, '#00A844');
    label('(0,0)', px(0) + 20, py(0) + 26, '#101010');
    octx.font = '700 12px "Courier New", monospace';
    octx.fillStyle = '#555';
    [-1, -0.5, 0.5, 1].forEach(function (t) { octx.fillText(String(t), px(t) - 8, py(0) + 20); });
    [-0.5, 0.5].forEach(function (t) { octx.fillText(String(t), px(0) + 10, py(t) + 4); });

    // pusat objek di dunia = kolom translasi model matrix
    const a = M3.transformPoint(mA, 0, 0);
    const g = M3.transformPoint(matrixA(1 - order), 0, 0);
    const b = M3.transformPoint(mB, 0, 0);

    // garis bantu origin → pusat: memperlihatkan efek "orbit" pada urutan S→T→R
    dashedLine(0, 0, a[0], a[1], '#FF69B4');
    dot(a[0], a[1], '#FF69B4');
    if (showGhost) {
      dashedLine(0, 0, g[0], g[1], '#FF3D00');
      dot(g[0], g[1], '#FF3D00');
      label('A · ' + M3.ORDERS[1 - order].short, px(g[0]) + 10, py(g[1]) - 16, '#FFFFFF', '#FF3D00');
    }
    label('A · ' + M3.ORDERS[order].short, px(a[0]) + 10, py(a[1]) + 30, '#101010', '#FF69B4');
    label('B (otomatis)', px(b[0]) - 44, py(b[1]) + 62, '#FFFFFF', '#0047FF');
    if (showChild) {
      const c = M3.transformPoint(matrixC(mB), 0, 0);
      label('C (child B)', px(c[0]) + 8, py(c[1]) - 14, '#101010', '#00C853');
    }
  }

  /* ------------------------------------------------------------------ *
   * 9. HUD (DOM) — diperbarui setiap frame dari state yang sama
   * ------------------------------------------------------------------ */
  const el = function (id) { return document.getElementById(id); };
  const hud = {
    order: el('hudOrder'), formula: el('hudFormula'),
    pos: el('hudPos'), world: el('hudWorld'), rot: el('hudRot'), scale: el('hudScale'),
    preset: el('hudPreset'), fps: el('hudFps'), mouse: el('hudMouse'), bInfo: el('hudB'),
    ghost: el('hudGhost'), child: el('hudChild'),
    mat0: el('mat0'), mat1: el('mat1'),
    card0: el('orderCard0'), card1: el('orderCard1')
  };

  function f(v, d) { return (v >= 0 ? '+' : '') + v.toFixed(d); }
  function fmtMat(m) {
    // tampilkan dalam bentuk baris (row) yang lazim dibaca manusia
    function c(i) { return (m[i] >= 0 ? ' ' : '') + m[i].toFixed(2); }
    return '[ ' + c(0) + '  ' + c(3) + '  ' + c(6) + ' ]\n' +
           '[ ' + c(1) + '  ' + c(4) + '  ' + c(7) + ' ]\n' +
           '[ ' + c(2) + '  ' + c(5) + '  ' + c(8) + ' ]';
  }

  let hudTimer = 0;
  function updateHud(dt) {
    const o = M3.ORDERS[order];
    const world = M3.transformPoint(matrixA(order), 0, 0);
    hud.order.textContent = 'Order ' + (order + 1) + ': ' + o.short;
    hud.formula.textContent = o.formula;
    hud.pos.textContent = 'x ' + f(A.x, 2) + '  y ' + f(A.y, 2);
    hud.world.textContent = 'x ' + f(world[0], 2) + '  y ' + f(world[1], 2);
    hud.rot.textContent = A.rot.toFixed(1) + '°';
    hud.scale.textContent = 'sx ' + A.sx.toFixed(2) + '  sy ' + A.sy.toFixed(2) +
      (Math.abs(A.sx - A.sy) < 0.005 ? '  (uniform)' : '  (non-uniform)');
    hud.preset.textContent = 'Preset: ' + (activePreset ? PRESETS[activePreset].name : 'manual');
    hud.mouse.textContent = mouse.inside
      ? 'Mouse: (' + f(mouse.x, 2) + ', ' + f(mouse.y, 2) + ')'
      : 'Mouse: —';
    hud.bInfo.textContent = 'B: rot ' + B.rot.toFixed(0) + '° · scale ' + B.s.toFixed(2);

    hud.mat0.textContent = fmtMat(matrixA(0));
    hud.mat1.textContent = fmtMat(matrixA(1));
    hud.card0.classList.toggle('active', order === 0);
    hud.card1.classList.toggle('active', order === 1);
  }

  // FPS dihitung dari frame yang benar-benar dirender
  let fpsFrames = 0, fpsClock = 0;
  function tickFps(dt) {
    fpsFrames++; fpsClock += dt;
    if (fpsClock >= 0.5) {
      hud.fps.textContent = 'FPS: ' + Math.round(fpsFrames / fpsClock);
      fpsFrames = 0; fpsClock = 0;
    }
  }

  /* ------------------------------------------------------------------ *
   * 10. Tombol UI
   * ------------------------------------------------------------------ */
  const btnOrder = el('btnOrder'), btnGhost = el('btnGhost'), btnChild = el('btnChild');
  el('btnReset').addEventListener('click', function () { resetTransform(); this.blur(); });
  btnOrder.addEventListener('click', function () { toggleOrder(); this.blur(); });
  btnGhost.addEventListener('click', function () { toggleGhost(); this.blur(); });
  btnChild.addEventListener('click', function () { toggleChild(); this.blur(); });
  [1, 2, 3].forEach(function (n) {
    el('btnPreset' + n).addEventListener('click', function () { applyPreset(n); this.blur(); });
  });

  let targetFps = 0;   // 0 = mengikuti refresh rate monitor
  el('selFps').addEventListener('change', function () {
    targetFps = parseInt(this.value, 10) || 0;
    this.blur();
  });

  function syncButtons() {
    btnGhost.classList.toggle('on', showGhost);
    btnChild.classList.toggle('on', showChild);
    hud.ghost.textContent = 'Bayangan order lawan: ' + (showGhost ? 'ON' : 'OFF');
    hud.ghost.className = showGhost ? 'on' : 'off';
    hud.child.textContent = 'Parent–child (C): ' + (showChild ? 'ON' : 'OFF');
    hud.child.className = showChild ? 'on' : 'off';
  }
  syncButtons();

  /* ------------------------------------------------------------------ *
   * 11. Game loop — deltaTime dari timestamp requestAnimationFrame
   * ------------------------------------------------------------------ */
  let last = null;
  function frame(now) {
    requestAnimationFrame(frame);
    if (last === null) { last = now; return; }

    const elapsed = now - last;
    // Simulasi frame rate rendah (30 / 15 FPS) untuk pengujian konsistensi gerak
    if (targetFps > 0 && elapsed < 1000 / targetFps - 1) return;
    last = now;

    const dt = Math.min(elapsed / 1000, 0.1);   // batasi lonjakan saat tab tidak aktif
    update(dt);
    render();
    updateHud(dt);
    tickFps(dt);
  }
  requestAnimationFrame(frame);
})();
