const SCREEN_WIDTH = 480;
const SCREEN_HEIGHT = 270;
const TEX_WIDTH = 512;
const TEX_HEIGHT = 512;

const noPos = {x: 0, y: 0};
const noScale = {x: 1, y: 1};

let gl;

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`compileShader failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function initGl() {
  const el = document.querySelector('canvas');
  gl = el.getContext('webgl', {preserveDrawingBuffer: true});
  if (gl === null) {
    throw new Error('unable to create webgl context');
  }
}

function makeTexture() {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX_WIDTH, TEX_HEIGHT, 0, gl.RGBA,
                gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  return texture;
}

function makeFullScreenQuad() {
  const w = SCREEN_WIDTH / TEX_WIDTH;
  const h = SCREEN_HEIGHT / TEX_HEIGHT;
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    0, 0,  0, 0,
    0, SCREEN_HEIGHT,  0, h,
    SCREEN_WIDTH, 0,  w, 0,
    SCREEN_WIDTH, SCREEN_HEIGHT,  w, h,
  ]), gl.STATIC_DRAW);

  const texture = makeTexture();
  return {first: 0, count: 4, buffer, texture};
}

function makeFont() {
  const texture = makeTexture();
  const img = new Image();
  img.onload = async () => {
    let imgbmp = await createImageBitmap(img);
    uploadTex(texture, imgbmp);
  };
  img.src = 'font.png';

  let map = {};
  for (let i = 0x21; i < 0x7e; ++i) {
    const chr = String.fromCharCode(i);
    const u = ((i - 0x21) % 32) * 16 / TEX_WIDTH;
    const v = Math.floor((i - 0x21) / 32) * 16 / TEX_HEIGHT;
    map[i] = {u, v};
  }
  return {texture, map};
}

function makeText(font, str, x = 0, y = 0) {
  const dx = 16;
  const dy = 16;
  const du = 16 / TEX_WIDTH;
  const dv = 16 / TEX_HEIGHT;

  const buffer = gl.createBuffer();
  const count = str.length * 6;
  const data = new Float32Array(count * 4);

  for (let i = 0; i < str.length; ++i) {
    const chr = str.charCodeAt(i);
    if (chr != 32) {
      const {u, v} = font.map[chr];

      data[i * 6 * 4 + 0] = x; // TL x
      data[i * 6 * 4 + 1] = y; // TL y
      data[i * 6 * 4 + 2] = u; // TL u
      data[i * 6 * 4 + 3] = v; // TL v

      data[i * 6 * 4 + 4] = x;      // BL x
      data[i * 6 * 4 + 5] = y + dy; // BL y
      data[i * 6 * 4 + 6] = u;      // BL u
      data[i * 6 * 4 + 7] = v + dv; // BL v

      data[i * 6 * 4 + 8] = x + dx;  // TR x
      data[i * 6 * 4 + 9] = y;       // TR y
      data[i * 6 * 4 + 10] = u + du; // TR u
      data[i * 6 * 4 + 11] = v;      // TR v

      data[i * 6 * 4 + 12] = x + dx; // BR x
      data[i * 6 * 4 + 13] = y + dy; // BR y
      data[i * 6 * 4 + 14] = u + du; // BR u
      data[i * 6 * 4 + 15] = v + dv; // BR v
    }

    // degenerate tris
    data[i * 6 * 4 + 16] = x + dx; // BR x
    data[i * 6 * 4 + 17] = y + dy; // BR y
    data[i * 6 * 4 + 18] = 0;      // BR u
    data[i * 6 * 4 + 19] = 0;      // BR v

    data[i * 6 * 4 + 20] = x + dx; // next TL x
    data[i * 6 * 4 + 21] = y;      // next TL y
    data[i * 6 * 4 + 22] = 0;      // next TL u
    data[i * 6 * 4 + 23] = 0;      // next TL v

    x += dx;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

  return {first: 0, count, buffer, texture: font.texture};
}

function makeTextureShader() {
  const vertexShader = compileShader(gl.VERTEX_SHADER,
     `uniform vec2 uPos;
      uniform vec2 uScale;
      attribute vec2 aPos;
      attribute vec2 aTexCoord;
      varying highp vec2 vTexCoord;
      void main(void) {
        vec2 pos = vec2((aPos.x + uPos.x) * uScale.x / 240.0 - 1.0,
                         1.0 - (aPos.y + uPos.y) * uScale.y / 135.0);
        gl_Position = vec4(pos, 0.0, 1.0);
        vTexCoord = aTexCoord;
      }`);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER,
     `precision highp float;
      varying vec2 vTexCoord;
      uniform sampler2D uSampler;
      void main(void) {
        vec4 tex = texture2D(uSampler, vTexCoord);
        if (tex.xyz == vec3(1, 0, 1)) {
          discard;
        }
        gl_FragColor = tex;
      }`);

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
  }

  const aPos = gl.getAttribLocation(program, 'aPos');
  const aTexCoord = gl.getAttribLocation(program, 'aTexCoord');
  const uSampler = gl.getUniformLocation(program, 'uSampler');
  const uPos = gl.getUniformLocation(program, 'uPos');
  const uScale = gl.getUniformLocation(program, 'uScale');

  return {program, aPos, aTexCoord, uSampler, uPos, uScale};
}

function draw(sprite, shader, pos = noPos, scale = noScale) {
  gl.bindBuffer(gl.ARRAY_BUFFER, sprite.buffer);
  gl.bindTexture(gl.TEXTURE_2D, sprite.texture);
  gl.useProgram(shader.program);

  gl.enableVertexAttribArray(shader.aPos);
  gl.enableVertexAttribArray(shader.aTexCoord);
  gl.vertexAttribPointer(shader.aPos, 2, gl.FLOAT, gl.FALSE, 16, 0);
  gl.vertexAttribPointer(shader.aTexCoord, 2, gl.FLOAT, gl.FALSE, 16, 8);
  gl.uniform1i(shader.uSampler, 0);
  gl.uniform2f(shader.uPos, pos.x, pos.y);
  gl.uniform2f(shader.uScale, scale.x, scale.y);

  gl.drawArrays(gl.TRIANGLE_STRIP, sprite.first, sprite.count);
}

function uploadTex(texture, data) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

function playSound(filename) {
  const audio = new Audio();
  audio.src = filename;
  audio.play();
  return audio;
}

function onKeyDown(event) {
  if (event.key == 'p') {
    playSound('boom.mp3');
  }
}

//------------------------------------------------------------------------------

initGl();
const shader = makeTextureShader();
const font = makeFont();
const text = makeText(font, 'hello pajama');

const smiley = makeFullScreenQuad();
const smileyImage = new Image();
smileyImage.onload = async () => {
  let imgbmp = await createImageBitmap(smileyImage);
  uploadTex(smiley.texture, imgbmp);
};
smileyImage.src = 'smiley.png';

document.onkeydown = onKeyDown;

(function tick(timestamp) {
  requestAnimationFrame(tick);

  gl.clearColor(0, 0.1, 0.1, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  draw(smiley, shader);
  draw(text, shader, {x: 200 + 30 * Math.cos(timestamp * 0.005),
                      y: 40 + 30 * Math.sin(timestamp * 0.003)});
})();
