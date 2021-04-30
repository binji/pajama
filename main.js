const SCREEN_WIDTH = 480;
const SCREEN_HEIGHT = 270;
const TEX_WIDTH = 512;
const TEX_HEIGHT = 512;
const TILE_SIZE = 48;

let gl;

function clamp(min, x, max) {
  return Math.min(Math.max(x, min), max);
}

class Mat3 {
  constructor() {
    this.m = new Float32Array(9);
    this.setIdentity();
  }

  static makeScale(sx, sy) { return (new Mat3()).setScale(sx, sy); }

  static makeTranslate(tx, ty) { return (new Mat3()).setTranslate(tx, ty); }

  setIdentity() {
    this.m.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    return this;
  }

  setTranslate(tx, ty) {
    this.m[6] = tx;
    this.m[7] = ty;
    return this;
  }

  setScale(sx, sy) {
    this.m[0] = sx;
    this.m[4] = sy;
    return this;
  }
};

const mat3Id = new Mat3();

//------------------------------------------------------------------------------
// VertexBuffer

class VertexBuffer {
  constructor() {
    this.data = [];
    this.glbuf = gl.createBuffer();
    this.first = 0;
    this.count = 0;
  }

  destroy() {
    gl.deleteBuffer(this.glbuf);
  }

  reset() {
    this.data.length = 0;
    this.count = 0;
  }

  push(x, y, u, v) {
    this.data.push(x, y, u, v);
    this.count++;
  }

  pushTriStripQuad(x, y, u, v, dx, dy, du, dv) {
    this.push(x, y, u, v);                     // TL
    this.push(x, y, u, v);                     // TL
    this.push(x, y + dy, u, v + dv);           // BL
    this.push(x + dx, y, u + du, v);           // TR
    this.push(x + dx, y + dy, u + du, v + dv); // BR
    this.push(x + dx, y + dy, u + du, v + dv); // BR
  }

  upload(usage = gl.STATIC_DRAW) {
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.data), usage);
  }
};

//------------------------------------------------------------------------------
// Sprite

class Sprite {
  constructor(buffer, texture, objMat, texMat) {
    if (objMat === undefined) objMat = new Mat3();
    if (texMat === undefined) texMat = new Mat3();

    this.buffer = buffer;
    this.texture = texture;
    this.objMat = objMat;
    this.texMat = texMat;
  }

  destroy() {
    this.buffer.destroy();
  }

  static makeEmptyBuffer(texture, objMat, texMat) {
    let vb = new VertexBuffer();
    return new Sprite(vb, texture, objMat, texMat);
  }

  static makeQuad(texture, objMat, texMat) {
    let vb = new VertexBuffer();
    vb.push(-0.5, -0.5, 0, 0);
    vb.push(-0.5, +0.5, 0, 1);
    vb.push(+0.5, -0.5, 1, 0);
    vb.push(+0.5, +0.5, 1, 1);
    vb.upload();
    return new Sprite(vb, texture, objMat, texMat);
  }

  static makeText(font, str, objMat, texMat) {
    const dx = 16;
    const dy = 16;
    const du = 16 / TEX_WIDTH;
    const dv = 16 / TEX_HEIGHT;

    let x = 0, y = 0;
    let vb = new VertexBuffer();
    for (let i = 0; i < str.length; ++i) {
      const chr = str.charCodeAt(i);
      if (chr != 32) {
        const {u, v} = font.map[chr];
        vb.pushTriStripQuad(x, y, u, v, dx, dy, du, dv);
      }
      x += dx;
    }
    vb.upload();
    return new Sprite(vb, font.texture, objMat, texMat);
  }
}


function getSpriteTexPos(index) {
  const margin = 1;
  const spacing = 2;
  const columns = 10;

  return {
    x: ((index % columns) * (TILE_SIZE + spacing) + margin) / TEX_WIDTH,
    y: (Math.floor(index / columns) * (TILE_SIZE + spacing) + margin) / TEX_HEIGHT
  };
}

class SpriteBatch {
  constructor(texture) {
    this.sprite = Sprite.makeEmptyBuffer(texture);
  }

  reset() {
    this.sprite.buffer.reset();
  }

  pushFrame(x, y, frame, dx = TILE_SIZE, dy = TILE_SIZE,
            du = TILE_SIZE / TEX_WIDTH, dv = TILE_SIZE / TEX_HEIGHT) {
    let {x: u, y: v} = getSpriteTexPos(frame);
    this.sprite.buffer.pushTriStripQuad(x, y, u, v, dx, dy, du, dv);
  }

  upload() {
    this.sprite.buffer.upload(gl.DYNAMIC_DRAW);
  }
}


//------------------------------------------------------------------------------
// Asset loading

let assets = {
  sprites: {filename: 'sprites.png', type: 'image', data: null},
  tiles: {filename: 'tiles.png', type: 'image', data: null},
  font: {filename: 'font.png', type: 'image', data: null},

  testing: {filename: 'testing.json', type: 'level', data: null, depends: ['tiles']},
  tiny: {filename: 'tiny.json', type: 'level', data: null, depends: ['tiles']},

  boom: {filename: 'boom.mp3', type: 'audio', data: null},
  doots: {filename: 'doots.wav', type: 'audio', data: null},
};

function loadImage(filename) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = async () => {
      let imgbmp = await createImageBitmap(image);
      resolve(imgbmp);
    };
    image.src = filename;
  });
}

async function loadJson(filename) {
  let response = await fetch(filename);
  let json = await response.json();
  return json;
}

function loadAudio(filename) {
  let audio = new Audio(filename);
  return audio;
}

async function loadLevel(filename) {
  let response = await fetch(filename);
  let json = await response.json();
  let texture = makeTexture(assets.tiles);

  let level = {
    data: json,
    sprite: Sprite.makeEmptyBuffer(texture),
    tiles: {},
    triggers: [],
    startPos: {x: 0, y: 0},
    stairPos: {x: 0, y: 0},
    width: 0,
    height: 0,
  };

  if (level.data.tilesets.length != 1) { throw 'no'; }

  // preprocess tileset data for ease of lookup later
  let tileset = level.data.tilesets[0];
  const strideu = (tileset.tilewidth + tileset.spacing) / tileset.imagewidth;
  const stridev = (tileset.tileheight + tileset.spacing) / tileset.imageheight;
  const marginu = tileset.margin / tileset.imagewidth;
  const marginv = tileset.margin / tileset.imageheight;

  for (let gid = tileset.firstgid; gid < tileset.firstgid + tileset.tilecount; ++gid) {
    const u = ((gid - tileset.firstgid) % tileset.columns) * strideu + marginu;
    const v = (Math.floor((gid - tileset.firstgid) / tileset.columns)) * stridev + marginv;
    level.tiles[gid] = {u, v};
  }

  // generate render buffer
  for (let layer of level.data.layers) {
    if (layer.type != 'tilelayer') continue;
    level.width = Math.max(level.width, layer.width * tileset.tilewidth);
    level.height = Math.max(level.height, layer.height * tileset.tileheight);
  }

  if (tileset.tilewidth != TILE_SIZE || tileset.tileheight != TILE_SIZE) {
    throw 'why';
  }

  const dx = TILE_SIZE;
  const dy = TILE_SIZE;
  const du = TILE_SIZE / tileset.imagewidth;
  const dv = TILE_SIZE / tileset.imageheight;

  for (let layer of level.data.layers) {
    if (layer.type != 'tilelayer') continue;
    let x = 0;
    let y = 0;
    for (let i = 0; i < layer.data.length; ++i) {
      let gid = layer.data[i];
      if (gid != 0) {
        const x = (i % layer.width) * dx;
        const y = Math.floor(i / layer.width) * dy;
        const {u, v} = level.tiles[gid];
        level.sprite.buffer.pushTriStripQuad(x, y, u, v, dx, dy, du, dv);
      }
    }
  }
  level.sprite.buffer.upload();

  // Handle object layer
  for (let layer of level.data.layers) {
    if (layer.type != 'objectgroup') continue;

    for (let object of layer.objects) {
      switch (object.type) {
        case 'player':
          level.startPos.x = object.x;
          level.startPos.y = object.y;
          break;

        case 'message':
          level.triggers.push({
            type: 'message',
            x: object.x, y: object.y,
            w: object.width, h: object.height,
            message: object.properties[0].value,
          });
          break;

        case 'stairs':
          level.triggers.push({
            type: 'stairs',
            x: object.x, y: object.y,
            w: object.width, h: object.height,
            dest: object.properties[0].value,
          });
          break;

        case 'stairpos':
          level.stairPos.x = object.x;
          level.stairPos.y = object.y;
          break;

        default:
          throw 'what';
      }
    }
  }

  return level;
}

async function loadAssets() {
  while (true) {
    let promises = [];
    for (let name of Object.keys(assets)) {
      let asset = assets[name];

      // Skip this asset if its dependies aren't loaded
      let hasMissingDeps = false;
      if (asset.depends) {
        for (let depend of asset.depends) {
          if (assets[depend].data == null) {
            hasMissingDeps = true;
            break;
          }
        }
      }

      // Skip this asset if it is already loaded
      if (asset.data != null || hasMissingDeps) continue;

      switch (asset.type) {
        case 'image':
          promises.push((async () => {
            let image = await loadImage(asset.filename);
            asset.data = image;
          })());
          break;

        case 'json':
          promises.push((async () => {
            let json = await loadJson(asset.filename);
            asset.data = json;
          })());
          break;

        case 'audio':
          promises.push((async () => {
            let audio = loadAudio(asset.filename);
            asset.data = audio;
          })());
          break;

        case 'level':
          promises.push((async () => {
            let json = await loadLevel(asset.filename);
            asset.data = json;
          })());
          break;
      }
    }

    if (promises.length == 0) break;

    await Promise.all(promises);
  }
}

//------------------------------------------------------------------------------
// GL stuff

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

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

class ParticleSystem {
  constructor() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX_WIDTH, TEX_HEIGHT, 0, gl.RGBA,
                  gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    this.texture = texture;
    this.texBuffer = new Uint8Array(TEX_WIDTH * TEX_HEIGHT * 4);

    this.sprite = Sprite.makeQuad(texture, Mat3.makeScale(SCREEN_WIDTH, SCREEN_HEIGHT),
      Mat3.makeScale(SCREEN_WIDTH / TEX_WIDTH, SCREEN_HEIGHT / TEX_HEIGHT));
    this.particles = [];

    for (let i = 0; i < 10000; ++i) {
      let c = Math.random();
      this.particles.push({
        x: (1.2 * Math.random() - 0.1) * 1024,
        y: (1.2 * Math.random() - 0.1) * 1024,
        dx: 3*(Math.random() - 0.5),
        dy: 3*(Math.random() - 0.5),
        t: 0,
        r: 255 * c,
        g: 255 * (1 - c),
        b: 192,
      });
    }
  }

  update() {
    for (let p of this.particles) {
      p.x += p.dx;
      p.y += p.dy;
      p.t++;
    }
  }

  draw(shader, camX, camY) {
    // clear alpha byte
    for (let i = 3; i < this.texBuffer.length; i += 4) {
      // or do a blur effect, either way
      this.texBuffer[i] /= 1.2;
    }

    for (let p of this.particles) {
      let x = p.x - camX;
      let y = p.y - camY;
      if (x < 0 || x >= TEX_WIDTH || y < 0 || y >= TEX_HEIGHT) {
        continue;
      }
      let i = Math.floor(y) * TEX_WIDTH + Math.floor(x);
      this.texBuffer[4*i + 0] = p.r;
      this.texBuffer[4*i + 1] = p.g;
      this.texBuffer[4*i + 2] = p.b;
      this.texBuffer[4*i + 3] = 255;
    }

    gl.bindTexture(gl.TEXTURE_2D, this.sprite.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_WIDTH, TEX_HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, this.texBuffer);

    draw(this.sprite, shader);
  }
}

function makeTexture(asset) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX_WIDTH, TEX_HEIGHT, 0, gl.RGBA,
                gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

  uploadTex(texture, asset.data);
  return texture;
}

function makeTexMat3x3(texPos, w, h) {
  return new Mat3()
      .setScale(w / TEX_WIDTH, h / TEX_HEIGHT)
      .setTranslate(texPos.x, texPos.y);
}

function makeFont() {
  const texture = makeTexture(assets.font);

  let map = {};
  for (let i = 0x21; i < 0x7e; ++i) {
    const chr = String.fromCharCode(i);
    const u = ((i - 0x21) % 32) * 16 / TEX_WIDTH;
    const v = Math.floor((i - 0x21) / 32) * 16 / TEX_HEIGHT;
    map[i] = {u, v};
  }
  return {texture, map};
}

function makeTextureShader() {
  const vertexShader = compileShader(gl.VERTEX_SHADER,
     `uniform mat3 uObjMat;
      uniform mat3 uCamMat;
      uniform mat3 uTexMat;

      attribute vec2 aPos;
      attribute vec2 aTexCoord;
      varying highp vec2 vTexCoord;

      void main(void) {
        float w = 480.0, h = 270.0;
        mat3 proj = mat3(2.0 / w,         0,  0,
                               0,  -2.0 / h,  0,
                            -1.0,       1.0,  0);

        vec3 pos = vec3(aPos, 1.0);
        gl_Position = vec4(proj * uCamMat * uObjMat * pos, 1.0);
        vTexCoord = (uTexMat * vec3(aTexCoord, 1)).xy;
      }`);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER,
     `precision highp float;
      varying vec2 vTexCoord;
      uniform sampler2D uSampler;
      void main(void) {
        vec4 tex = texture2D(uSampler, vTexCoord);
        if (tex.w == 0.0 || tex.xyz == vec3(1, 0, 1)) {
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
  const uObjMat = gl.getUniformLocation(program, 'uObjMat');
  const uCamMat = gl.getUniformLocation(program, 'uCamMat');
  const uTexMat = gl.getUniformLocation(program, 'uTexMat');

  return {program, aPos, aTexCoord, uSampler, uObjMat, uCamMat, uTexMat};
}

function draw(sprite, shader) {
  if (!sprite) return;

  gl.bindBuffer(gl.ARRAY_BUFFER, sprite.buffer.glbuf);
  gl.bindTexture(gl.TEXTURE_2D, sprite.texture);
  gl.useProgram(shader.program);

  gl.enableVertexAttribArray(shader.aPos);
  gl.enableVertexAttribArray(shader.aTexCoord);
  gl.vertexAttribPointer(shader.aPos, 2, gl.FLOAT, gl.FALSE, 16, 0);
  gl.vertexAttribPointer(shader.aTexCoord, 2, gl.FLOAT, gl.FALSE, 16, 8);
  gl.uniform1i(shader.uSampler, 0);
  gl.uniformMatrix3fv(shader.uObjMat, false, sprite.objMat.m);
  gl.uniformMatrix3fv(shader.uCamMat, false, camMat.m);
  gl.uniformMatrix3fv(shader.uTexMat, false, sprite.texMat.m);

  gl.drawArrays(gl.TRIANGLE_STRIP, sprite.buffer.first,
                sprite.buffer.count);
}

function uploadTex(texture, data) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

function playSound(asset) {
  asset.data.play();
}

let smiley;

function onKeyDown(event) {
  switch (event.key) {
    case 'p':
      playSound(assets.boom);
      break;

    case 'm':
      assets.doots.data.play();
      assets.doots.data.volume = 1 - assets.doots.data.volume;
      break;

    case 'ArrowLeft':
      smiley.moveLeft();
      break;
    case 'ArrowRight':
      smiley.moveRight();
      break;
    case 'ArrowUp':
      smiley.moveUp();
      break;
    case 'ArrowDown':
      smiley.moveDown();
      break;
  }
}

function onKeyUp(event) {
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowRight':
      smiley.stopHoriz();
      break;

    case 'ArrowUp':
    case 'ArrowDown':
      smiley.stopVert();
      break;
  }
}

let level;

//------------------------------------------------------------------------------
// Collision detection
// see https://stackoverflow.com/questions/849211/shortest-distance-between-a-point-and-a-line-segment

function dist2(v0x, v0y, v1x, v1y) {
  return (v0x - v1x) * (v0x - v1x) + (v0y - v1y) * (v0y - v1y);
}

function distToLineSegment2(px, py, v0x, v0y, v1x, v1y) {
  let l2 = dist2(v0x, v0y, v1x, v1y);
  if (l2 == 0) { throw 'no'; }
  let t = clamp(0, ((px - v0x) * (v1x - v0x) + (py - v0y) * (v1y - v0y)) / l2, 1);
  let ix = v0x + t * (v1x - v0x);
  let iy = v0y + t * (v1y - v0y);
  return {dist2: dist2(px, py, ix, iy), ix, iy};
}

let font;
let text;

class Smiley {
  constructor(texture) {
    this.sprite = Sprite.makeQuad(
        texture, Mat3.makeScale(TILE_SIZE, TILE_SIZE),
        Mat3.makeScale(TILE_SIZE / TEX_WIDTH, TILE_SIZE / TEX_HEIGHT));
    this.x = level.startPos.x;
    this.y = level.startPos.y;
    this.dx = 0;
    this.dy = 0;
    this.ddx = 0;
    this.ddy = 0;
    this.baseFrame = 10;
    this.frame = 10;

    this.animTimer = 0;
    this.blinkTimer = 0;

    this.accel = 0.55;
    this.drag = 0.85;
    this.maxvel = 3;
  }

  moveLeft() { this.ddx = -this.accel; }
  moveRight() { this.ddx = +this.accel; }
  moveUp() { this.ddy = -this.accel; }
  moveDown() { this.ddy = +this.accel; }
  stopHoriz() { this.ddx = 0; }
  stopVert() { this.ddy = 0; }

  doAnim() {
    let moving = false;
    if (this.ddx > 0) {
      this.baseFrame = 10;
      moving = true;
    } else if (this.ddx < 0) {
      this.baseFrame = 20;
      moving = true;
    } else if (this.ddy > 0) {
      this.baseFrame = 30;
      moving = true;
    } else if (this.ddy < 0) {
      this.baseFrame = 40;
      moving = true;
    }

    if (moving) {
      this.frame = this.baseFrame + 2 + Math.floor(this.animTimer / 6);
      if (++this.animTimer >= 4 * 6) {
        this.animTimer = 0;
      }
    } else {
      this.animTimer = 0;
      this.frame = this.baseFrame;
      if (--this.blinkTimer < 0) {
        this.frame = this.baseFrame + 1;
        if (this.blinkTimer < -5) {
          this.blinkTimer = Math.floor(Math.random() * 100 + 30);
        }
      }
    }
  }

  doCollision() {
    const boxSegs = [
      {x0 : 0, y0 : 0, x1 : TILE_SIZE, y1 : 0},                 // top
      {x0 : 0, y0 : 0, x1 : 0, y1 : TILE_SIZE},                 // left
      {x0 : 0, y0 : TILE_SIZE, x1 : TILE_SIZE, y1 : TILE_SIZE}, // bottom
      {x0 : TILE_SIZE, y0 : 0, x1 : TILE_SIZE, y1 : TILE_SIZE}, // right
    ];
    const dirs = [
      {x : -1, y : -1},
      {x : -1, y : 0},
      {x : -1, y : +1},
      {x : 0, y : -1},
      {x : 0, y : +1},
      {x : +1, y : -1},
      {x : +1, y : 0},
      {x : +1, y : +1},
    ];
    let px = this.x;
    let py = this.y;
    let rad = 22; // a little less than tile width / 2
    let rad2 = rad * rad;
    let tx = Math.floor(px / TILE_SIZE);
    let ty = Math.floor(py / TILE_SIZE);
    let layer = level.data.layers[1];

    function getCell(x, y) {
      if (x < 0 || x >= layer.width || y < 0 || y >= layer.height) {
        return 0;
      }
      return layer.data[y * layer.width + x];
    }

    for (let dir of dirs) {
      let tile = getCell(tx + dir.x, ty + dir.y);
      if (!tile)
        continue;

      for (let seg of boxSegs) {
        let left = (tx + dir.x) * TILE_SIZE;
        let top = (ty + dir.y) * TILE_SIZE;
        let {dist2, ix, iy} = distToLineSegment2(
            px, py, seg.x0 + left, seg.y0 + top, seg.x1 + left, seg.y1 + top);

        if (dist2 < rad2) {
          // push away along vec between object and segment.
          let dist = Math.sqrt(dist2);
          let pushx = (rad - dist) * (px - ix) / dist;
          let pushy = (rad - dist) * (py - iy) / dist;
          px += pushx;
          py += pushy;
        }
      }
    }

    this.x = px;
    this.y = py;
  }

  doTriggers() {
    for (let trigger of level.triggers) {
      if (this.x >= trigger.x && this.x < trigger.x + trigger.w &&
          this.y >= trigger.y && this.y < trigger.y + trigger.h) {
        switch (trigger.type) {
        case 'message':
          text.destroy();
          text = Sprite.makeText(font, trigger.message, new Mat3(),
                                 Mat3.makeTranslate(10, 10));
          break;

        case 'stairs':
          level = assets[trigger.dest].data;
          this.x = level.stairPos.x;
          this.y = level.stairPos.y;
          break;
        }
        break;
      }
    }
  }

  update() {
    this.dx = clamp(-this.maxvel, (this.dx + this.ddx) * this.drag, this.maxvel);
    this.dy = clamp(-this.maxvel, (this.dy + this.ddy) * this.drag, this.maxvel);
    this.x += this.dx;
    this.y += this.dy;

    this.doAnim();
    this.doCollision();
    this.doTriggers();

    this.sprite.objMat.setTranslate(this.x, this.y);
    let texPos = getSpriteTexPos(this.frame);
    this.sprite.texMat.setTranslate(texPos.x, texPos.y);
  }
};


//------------------------------------------------------------------------------
// Bouncies

class Bouncies {
  constructor(texture) {
    this.batch = new SpriteBatch(texture);
    this.objs = [];
    for (let i = 0; i < 100; ++i) {
      this.objs.push({
        x: Math.random() * assets.testing.data.width,
        y: Math.random() * assets.testing.data.height,
        dx: Math.random() * 2 - 1,
        dy: Math.random() * 2 - 1,
        size: (Math.random() * 40) + 8,
        frame: Math.floor(Math.random() * 2) + 2,
      });
    }
  }

  update() {
    for (let obj of this.objs) {
      obj.x += obj.dx;
      obj.y += obj.dy;

      if (obj.x < obj.size || obj.x > level.width - obj.size) {
        obj.x = clamp(obj.size, obj.x + obj.dx, level.width - obj.size);
        obj.dx = -obj.dx;
      }

      if (obj.y < obj.size || obj.y > level.height - obj.size) {
        obj.y = clamp(obj.size, obj.y + obj.dy, level.height - obj.size);
        obj.dy = -obj.dy;
      }
    }
  }

  draw(shader) {
    this.batch.reset();
    for (let obj of this.objs) {
      this.batch.pushFrame(obj.x, obj.y, obj.frame, obj.size, obj.size);
    }
    this.batch.upload();
    draw(this.batch.sprite, shader);
  }
}


//------------------------------------------------------------------------------

let camMat;
let camPushBox = {l:SCREEN_WIDTH * 0.25, r:SCREEN_WIDTH * 0.75,
                  t:SCREEN_HEIGHT * 0.35, b:SCREEN_HEIGHT * 0.65};

async function start() {
  initGl();

  await loadAssets();

  level = assets.testing.data;

  // music should loop
  assets.doots.data.loop = true;
  assets.doots.data.volume = 0; // set to 0 so first M press will set to 1

  const shader = makeTextureShader();
  font = makeFont();
  text = Sprite.makeText(font, 'find ice; M is for music', new Mat3(),
                         Mat3.makeTranslate(10, 10));
  const spriteTexture = makeTexture(assets.sprites);
  smiley = new Smiley(spriteTexture);
  const bouncies = new Bouncies(spriteTexture);

  document.onkeydown = onKeyDown;
  document.onkeyup = onKeyUp;

  let camMatGame = new Mat3();
  let camX = 0, camY = 0;

  let particles = new ParticleSystem();

  const updateMs = 16.6;
  let lastTimestamp;
  let updateRemainder = updateMs + 1;
  function tick(timestamp) {
    requestAnimationFrame(tick);

    if (lastTimestamp === undefined) { lastTimestamp = timestamp; }
    let elapsed = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    gl.clearColor(0, 0.1, 0.1, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    updateRemainder += elapsed;
    while (updateRemainder > updateMs) {
      updateRemainder -= updateMs;

      smiley.update();

      if (smiley.x - camX < camPushBox.l) {
        camX = Math.max(0, smiley.x - camPushBox.l);
      } else if (smiley.x - camX > camPushBox.r) {
        camX = Math.min(level.width - SCREEN_WIDTH, smiley.x - camPushBox.r);
      }

      if (smiley.y - camY < camPushBox.t) {
        camY = Math.max(0, smiley.y - camPushBox.t);
      } else if (smiley.y - camY > camPushBox.b) {
        camY = Math.min(level.height - SCREEN_HEIGHT, smiley.y - camPushBox.b);
      }

      camMatGame.setTranslate(-camX, -camY);
      bouncies.update();
      particles.update();
    }

    camMat = camMatGame;
    draw(level.sprite, shader);

    bouncies.draw(shader);

    draw(smiley.sprite, shader);

    camMat = Mat3.makeTranslate(SCREEN_WIDTH/2, SCREEN_HEIGHT/2);
    particles.draw(shader, camX, camY);

    camMat = mat3Id;
    draw(text, shader);
  }
  requestAnimationFrame(tick);
};

start();
