/* ==========================================================================
 * matrix3.js — Library kecil Matrix 3×3 untuk transformasi 2D (homogeneous)
 * --------------------------------------------------------------------------
 * Penyimpanan  : Float32Array(9) COLUMN-MAJOR, siap dikirim ke GLSL mat3
 *                lewat gl.uniformMatrix3fv(loc, false, m).
 *
 *   indeks  0  1  2      | m00 m01 m02 |     | a c tx |   (a,b,c,d = bagian
 *           3  4  5   =  | m10 m11 m12 |  =  | b d ty |    linear, tx,ty =
 *           6  7  8      | m20 m21 m22 |     | 0 0  1 |    translasi)
 *
 *   Layout memori column-major:  [ a, b, 0,  c, d, 0,  tx, ty, 1 ]
 *
 * Konvensi     : vektor kolom, sehingga  p' = M · p  dan  (A · B) berarti
 *                "terapkan B lebih dulu, lalu A".
 * ========================================================================== */
(function (global) {
  'use strict';

  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  /** Matriks identitas. */
  function identity() {
    return new Float32Array([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1
    ]);
  }

  /** Matriks translasi T(tx, ty). */
  function translation(tx, ty) {
    return new Float32Array([
      1,  0,  0,
      0,  1,  0,
      tx, ty, 1
    ]);
  }

  /** Matriks rotasi R(θ) berlawanan arah jarum jam (CCW), θ dalam radian. */
  function rotation(rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return new Float32Array([
       c, s, 0,
      -s, c, 0,
       0, 0, 1
    ]);
  }

  /** Matriks skala S(sx, sy). Uniform bila sx === sy, non-uniform bila berbeda. */
  function scaling(sx, sy) {
    return new Float32Array([
      sx, 0,  0,
      0,  sy, 0,
      0,  0,  1
    ]);
  }

  /** Perkalian a · b (b diterapkan lebih dulu, lalu a). */
  function multiply(a, b) {
    const out = new Float32Array(9);
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 3; row++) {
        out[col * 3 + row] =
          a[0 * 3 + row] * b[col * 3 + 0] +
          a[1 * 3 + row] * b[col * 3 + 1] +
          a[2 * 3 + row] * b[col * 3 + 2];
      }
    }
    return out;
  }

  /** Perkalian berantai: chain(A, B, C) = A · B · C. */
  function chain() {
    let m = arguments[0];
    for (let i = 1; i < arguments.length; i++) m = multiply(m, arguments[i]);
    return m;
  }

  /** Terapkan matriks ke titik (x, y) → [x', y']. */
  function transformPoint(m, x, y) {
    return [
      m[0] * x + m[3] * y + m[6],
      m[1] * x + m[4] * y + m[7]
    ];
  }

  /**
   * Model Matrix dari parameter TRS dengan DUA urutan transformasi berbeda.
   *
   *  order 0  →  M = T · R · S   (Scale → Rotate → Translate)
   *              Objek diskala & diputar terhadap pusatnya sendiri,
   *              baru dipindahkan. Posisi = (tx, ty) apa adanya.
   *
   *  order 1  →  M = R · T · S   (Scale → Translate → Rotate)
   *              Objek diskala, dipindahkan, lalu SELURUH hasilnya diputar
   *              terhadap ORIGIN dunia (0,0), sehingga objek "mengorbit".
   */
  function compose(order, tx, ty, rad, sx, sy) {
    const T = translation(tx, ty);
    const R = rotation(rad);
    const S = scaling(sx, sy);
    return order === 0 ? chain(T, R, S) : chain(R, T, S);
  }

  /** Nama & rumus tiap urutan, dipakai HUD dan penjelasan di halaman. */
  const ORDERS = [
    { id: 0, short: 'S → R → T', formula: 'M = T · R · S', label: 'Scale → Rotate → Translate' },
    { id: 1, short: 'S → T → R', formula: 'M = R · T · S', label: 'Scale → Translate → Rotate' }
  ];

  global.Matrix3 = {
    DEG2RAD, RAD2DEG, ORDERS,
    identity, translation, rotation, scaling,
    multiply, chain, transformPoint, compose
  };
})(window);
