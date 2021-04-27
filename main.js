const SCREEN_WIDTH = 480;
const SCREEN_HEIGHT = 270;
const TEX_WIDTH = 512;
const TEX_HEIGHT = 512;

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
  gl = this.gl = el.getContext('webgl', {preserveDrawingBuffer: true});
  if (gl === null) {
    throw new Error('unable to create webgl context');
  }
}

function makeFullScreenQuad() {
  const w = SCREEN_WIDTH / TEX_WIDTH;
  const h = SCREEN_HEIGHT / TEX_HEIGHT;
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  0, h,
    +1, -1,  w, h,
    -1, +1,  0, 0,
    +1, +1,  w, 0,
  ]), gl.STATIC_DRAW);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX_WIDTH, TEX_HEIGHT, 0, gl.RGBA,
                gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  return {buffer, texture};
}

function makeTextureShader() {
  const vertexShader = compileShader(gl.VERTEX_SHADER,
     `attribute vec2 aPos;
      attribute vec2 aTexCoord;
      varying highp vec2 vTexCoord;
      void main(void) {
        gl_Position = vec4(aPos, 0.0, 1.0);
        vTexCoord = aTexCoord;
      }`);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER,
     `varying highp vec2 vTexCoord;
      uniform sampler2D uSampler;
      void main(void) {
        gl_FragColor = texture2D(uSampler, vTexCoord);
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

  gl.enableVertexAttribArray(aPos);
  gl.enableVertexAttribArray(aTexCoord);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, gl.FALSE, 16, 0);
  gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, gl.FALSE, 16, 8);

  return {program, uSampler};
}

function draw(buffer, texture, shader) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.useProgram(shader.program);

  gl.uniform1i(shader.uSampler, 0);

  this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
}

function uploadTex(texture, data) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  this.gl.texSubImage2D(
      this.gl.TEXTURE_2D, 0, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, this.gl.RGBA,
      this.gl.UNSIGNED_BYTE, data);
}

initGl();
const {buffer, texture} = makeFullScreenQuad();
const shader = makeTextureShader();

const texdata = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT * 4);

for (let y = 0; y < SCREEN_HEIGHT; ++y) {
  for (let x = 0; x < SCREEN_WIDTH; ++x) {
    texdata[(y * SCREEN_WIDTH + x) * 4] = x / SCREEN_WIDTH * 256;
    texdata[(y * SCREEN_WIDTH + x) * 4 + 1] = y / SCREEN_HEIGHT * 256;
    texdata[(y * SCREEN_WIDTH + x) * 4 + 2] = 0;
    texdata[(y * SCREEN_WIDTH + x) * 4 + 3] = 255;
  }
}

uploadTex(texture, texdata);

function playSound(filename) {
  const audio = new Audio();
  audio.src = filename;
  audio.play();
  return audio;
}

document.onkeydown = (event) => {
  if (event.key == 'p') {
    playSound('boom.mp3');
  }
};

(function tick(time) {
  requestAnimationFrame(tick);

  this.gl.clearColor(0, 0, 0, 1.0);
  this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  draw(buffer, texture, shader);
})();
