const SCREEN_WIDTH = 1440;
const SCREEN_HEIGHT = 810;
const TEX_WIDTH = 512;
const TEX_HEIGHT = 512;
const TILE_SIZE = 48;

let gl;
let audio;
let audioStarted = false;

function clamp(min, x, max) {
  return Math.min(Math.max(x, min), max);
}
function lerp(t, lo, hi) {
  t = clamp(0, t, 1);
  return t * (hi - lo) + lo;
}

function rand(lo, hi) {
  if (hi === undefined) {
    // rand(x) == rand(0, x)
    hi = lo;
    lo = 0;
  }
  return Math.random() * (hi - lo) + lo;
}

function randInt(lo, hi) {
  return Math.floor(rand(lo, hi));
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
  factoryTiles: {filename: 'factory_tiles.png', type: 'image', data: null},

  testing: {filename: 'testing.json', type: 'level', data: null, depends: ['tiles']},
  tiny: {filename: 'tiny.json', type: 'level', data: null, depends: ['tiles']},
  factory: {filename: 'factory.json', type: 'level', data: null, depends: ['factoryTiles']},

  boom: {filename: 'boom.mp3', type: 'sfx', data: null},
  doots: {filename: 'doots.wav', type: 'music', data: null},
};

function loadImage(asset) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = async () => {
      let imgbmp = await createImageBitmap(image);
      resolve(imgbmp);
    };
    image.src = asset.filename;
  });
}

async function loadJson(asset) {
  let response = await fetch(asset.filename);
  let json = await response.json();
  return json;
}

async function loadSfx(asset) {
  let response = await fetch(asset.filename);
  let buffer = await response.arrayBuffer();
  let data = await audio.decodeAudioData(buffer);
  return data;
}

async function loadMusic(asset) {
  let music = new Audio(asset.filename);
  let source = audio.createMediaElementSource(music);
  source.connect(audio.destination);
  music.pause();
  music.loop = true; // music should loop
  music.volume = 0;  // set to 0 so first M press will set to 1
  return source;
}

async function loadLevel(asset) {
  let filename = asset.filename;
  let response = await fetch(filename);
  let json = await response.json();

  let level = {
    data: json,
    sprite: null,
    tiles: {},
    collision: {
      width: 0,
      height: 0,
      data: [],
    },
    triggers: [],
    emitters: [],
    platforms: [],
    startPos: {x: 0, y: 0},
    stairPos: {x: 0, y: 0},
    width: 0,
    height: 0,
  };

  if (level.data.tilesets.length != 1) { throw 'no'; }

  let tileset = level.data.tilesets[0];
  let texture = makeTexture(assets[asset.depends[0]]);
  level.sprite = Sprite.makeEmptyBuffer(texture);

  // preprocess tileset data for ease of lookup later
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

  // Handle collision layer
  {
    let layer = level.data.layers[1];
    let collision = level.collision;

    collision.width = layer.width;
    collision.height = layer.height;
    collision.data = [];

    function getCell(x, y) {
      if (x < 0 || x >= layer.width || y < 0 || y >= layer.height) {
        return null;
      }
      return collision.data[y * layer.width + x];
    }

    for (let y = 0; y < layer.height; ++y) {
      for (let x = 0; x < layer.width; ++x) {
        let gid = layer.data[y * layer.width + x];
        if (gid == 0) continue;

        const ts = TILE_SIZE;
        let px = x * ts;
        let py = y * ts;

        let left = getCell(x - 1, y);
        let top = getCell(x, y - 1);

        let boxSegs = [
          {x0: px + 0,  y0: py + 0,  x1: px + ts, y1 : py + 0},  // top
          {x0: px + 0,  y0: py + 0,  x1: px + 0,  y1 : py + ts}, // left
          {x0: px + 0,  y0: py + ts, x1: px + ts, y1 : py + ts}, // bottom
          {x0: px + ts, y0: py + 0,  x1: px + ts, y1 : py + ts}, // right
        ];

        if (left != null) {
          // extend top and bottom segments
          left[0].x1 = boxSegs[0].x1;
          left[2].x1 = boxSegs[2].x1;
          boxSegs[0] = left[0];
          boxSegs[2] = left[2];
        }

        if (top != null) {
          // extend right and left segments
          top[1].y1 = boxSegs[1].y1;
          top[3].y1 = boxSegs[3].y1;
          boxSegs[1] = top[1];
          boxSegs[3] = top[3];
        }

        collision.data[y * layer.width + x] = boxSegs;
      }
    }
  }

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

        case 'platform': {
          let x = object.x, y = object.y;
          let points = [];
          for (let point of object.polygon) {
            points.push({x: x + point.x, y: y + point.y});
          }
          level.platforms.push({points});
          break;
        }

        case 'particle-emitter':
          level.emitters.push({
            x: object.x, y: object.y,
            w: object.width, h: object.height,
          });
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

      let cbs = {
        'image': loadImage,
        'json': loadJson,
        'sfx': loadSfx,
        'music': loadMusic,
        'level': loadLevel,
      };

      promises.push((async () => {
        let image = await cbs[asset.type](asset);
        asset.data = image;
      })());
    }

    if (promises.length == 0) break;

    await Promise.all(promises);
  }
}

//------------------------------------------------------------------------------
// Audio stuff

function initAudio() {
  audio = new AudioContext();
}

function maybeResumeAudio() {
  if (!audioStarted) {
    audio.resume();
    audioStarted = true;
  }
}

function playSound(asset) {
  let node = audio.createBufferSource();
  node.buffer = asset.data;
  node.connect(audio.destination);
  node.start();
}

function playMusic(asset) {
  let media = asset.data.mediaElement;
  media.play();
  media.volume = 1 - media.volume;
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
    this.scale = 3;

    this.sprite = Sprite.makeQuad(
        texture, Mat3.makeScale(SCREEN_WIDTH, SCREEN_HEIGHT),
        Mat3.makeScale(SCREEN_WIDTH / (this.scale * TEX_WIDTH),
                       SCREEN_HEIGHT / (this.scale * TEX_HEIGHT)));
    this.particles = [];
  }

  spawn(particle) {
    // expected fields: x, y, dx, dy
    // optional: r, g, b, life
    if (particle.r === undefined) {
      let c = Math.random();
      particle.r = 255 * c;
      particle.g = 255 * (1 - c);
      particle.b = 192;
    }
    if (particle.life === undefined) {
      particle.life = 120;
    }
    particle.t = 0;
    this.particles.push(particle);
  }

  update() {
    for (let i = 0; i < this.particles.length; ++i) {
      const p = this.particles[i];
      p.x += p.dx;
      p.y += p.dy;

      p.t++;
      if (p.t > p.life) {
        // O(1) removal by moving the last particle up
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.length--;
        i--;
      }
    }
  }

  draw(shader, camX, camY, dt) {
    // clear alpha byte
    for (let i = 3; i < this.texBuffer.length; i += 4) {
      // or do a blur effect, either way
      this.texBuffer[i] /= 1.2;
    }

    for (let p of this.particles) {
      let x = (p.x - p.dx * dt - camX) / this.scale;
      let y = (p.y - p.dy * dt - camY) / this.scale;
      if (x < 0 || x >= TEX_WIDTH || y < 0 || y >= TEX_HEIGHT) {
        continue;
      }
      let i = Math.floor(y) * TEX_WIDTH + Math.floor(x);
      this.texBuffer[4*i + 0] = p.r;
      this.texBuffer[4*i + 1] = p.g;
      this.texBuffer[4*i + 2] = p.b;
      this.texBuffer[4*i + 3] = lerp(p.t / p.life, 255, 64);
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
        float w = 1440.0, h = 810.0;
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

let smiley;
let shiftHeld = false;

function onKeyDown(event) {
  maybeResumeAudio();

  switch (event.key) {
    case 'p':
      playSound(assets.boom);
      break;

    case 'm':
      playMusic(assets.doots);
      break;

    case 'ArrowLeft':
      smiley.moveLeft(true);
      break;
    case 'ArrowRight':
      smiley.moveRight(true);
      break;
    case ' ':
      smiley.jump();
      break;

    case 'Shift':
      shiftHeld = true;
      break;
  }
}

function onKeyUp(event) {
  maybeResumeAudio();

  switch (event.key) {
    case 'ArrowLeft':
      smiley.moveLeft(false);
      break;
    case 'ArrowRight':
      smiley.moveRight(false);
      break;
    case ' ':
      smiley.unjump();
      break;

    case 'Shift':
      shiftHeld = false;
      break;
  }
}

let level;
let platforms;

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

//------------------------------------------------------------------------------
// Platforms

class Platforms {
  constructor(texture) {
    this.batch = new SpriteBatch(texture);
    this.objs = [];

    // TODO: handle level changes better
    for (let platform of level.platforms) {
      let obj = {
        lastX : 0,
        lastY : 0,
        x : 0,
        y : 0,
        speed : 0,
        t : 0,
        index : 0,
        points : platform.points,
      };
      this.setIndex(obj, 0);
      this.objs.push(obj);
    }
  }

  setIndex(obj, index) {
    obj.index = index;
    let p0 = obj.points[obj.index];
    let p1 = obj.points[(obj.index + 1) % obj.points.length];
    let dx = p1.x - p0.x;
    let dy = p1.y - p0.y;
    let dist = Math.sqrt(dx * dx + dy * dy);

    obj.speed = 1 / dist;
  }

  update() {
    for (let obj of this.objs) {
      obj.t += obj.speed;
      if (obj.t >= 1) {
        obj.t -= 1;
        this.setIndex(obj, (obj.index + 1) % obj.points.length);
      }

      let p0 = obj.points[obj.index];
      let p1 = obj.points[(obj.index + 1) % obj.points.length];
      obj.lastX = obj.x;
      obj.lastY = obj.y;
      obj.x = lerp(obj.t, p0.x, p1.x);
      obj.y = lerp(obj.t, p0.y, p1.y);
    }
  }

  draw(shader, dt) {
    this.batch.reset();
    for (let obj of this.objs) {
      this.batch.pushFrame(lerp(dt, obj.x, obj.lastX),
                           lerp(dt, obj.y, obj.lastY), 0, TILE_SIZE * 3,
                           TILE_SIZE, TILE_SIZE * 3 / TEX_WIDTH,
                           TILE_SIZE / TEX_WIDTH);
    }
    this.batch.upload();
    draw(this.batch.sprite, shader);
  }
};

//------------------------------------------------------------------------------
// Smiley

class Smiley {
  constructor(texture) {
    this.sprite = Sprite.makeQuad(
        texture, Mat3.makeScale(TILE_SIZE, TILE_SIZE),
        Mat3.makeScale(TILE_SIZE / TEX_WIDTH, TILE_SIZE / TEX_HEIGHT));
    this.jumpHeight = 100;
    this.jumpTime = 30;
    this.jumpVel = -2 * this.jumpHeight / this.jumpTime;
    this.isJumping = false;

    this.x = level.startPos.x;
    this.y = level.startPos.y;
    this.lastX = this.x;
    this.lastY = this.y;
    this.dx = 0;
    this.dy = 0;
    this.ddx = 0;
    this.ddy = 2 * this.jumpHeight / Math.pow(this.jumpTime, 2);
    this.baseFrame = 10;
    this.frame = 10;

    this.animTimer = 0;
    this.blinkTimer = 0;

    this.accel = 0.55;
    this.drag = 0.85;
    this.maxvelX = 3;

    this.maxJump = -30;
    this.maxFall = 10;

    this.leftHeld = false;
    this.rightHeld = false;
  }

  moveLeft(held) { this.leftHeld = held; }
  moveRight(held) { this.rightHeld = held; }

  jump() {
    if (!this.isJumping) {
      this.isJumping = true;
      this.dy = this.jumpVel;
    }
  }
  unjump() {
    if (this.isJumping) {
      this.isJumping = false;
      if (this.dy < 0) {
        this.dy *= 0.25;
      }
    }
  }

  doAnim() {
    let moving = false;
    if (this.ddx > 0) {
      this.baseFrame = 10;
      moving = true;
    } else if (this.ddx < 0) {
      this.baseFrame = 20;
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
          this.blinkTimer = randInt(30, 130);
        }
      }
    }
  }

  doCollision() {
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
    let layer = level.collision;

    function getCell(x, y) {
      if (x < 0 || x >= layer.width || y < 0 || y >= layer.height) {
        return 0;
      }
      return layer.data[y * layer.width + x];
    }

    function handleSeg(seg) {
      let {dist2, ix, iy} =
          distToLineSegment2(px, py, seg.x0, seg.y0, seg.x1, seg.y1);

      if (dist2 < rad2) {
        // push away along vec between object and segment.
        let dist = Math.sqrt(dist2);
        let pushx = (rad - dist) * (px - ix) / dist;
        let pushy = (rad - dist) * (py - iy) / dist;
        px += pushx;
        py += pushy;
        return true;
      }
      return false;
    }

    // Platform collision
    for (let obj of platforms.objs) {
      let ox = obj.x;
      let oy = obj.y;
      const w = 48 * 3;
      const h = 48;

      if (this.x + rad >= ox || this.x - rad <= ox + w || this.y + rad >= oy ||
          this.y - rad < oy + h) {
        let segs = [
          {x0: ox + 0, y0: oy + 0, x1: ox + 0, y1 : oy + h}, // left
          {x0: ox + 0, y0: oy + h, x1: ox + w, y1 : oy + h}, // bottom
          {x0: ox + w, y0: oy + 0, x1: ox + w, y1 : oy + h}, // right
        ];

        for (let seg of segs) {
          handleSeg(seg);
        }

        // Riding on top of the platform
        let seg = {x0: ox + 0, y0: oy + 0, x1: ox + w, y1 : oy + 0};
        if (handleSeg(seg)) {
          let dx = obj.x - obj.lastX;
          let dy = obj.y - obj.lastY;
          px += dx;
          py += dy;
        }
      }
    }

    // Tile collision
    for (let dir of dirs) {
      let segs = getCell(tx + dir.x, ty + dir.y);
      if (!segs)
        continue;

      for (let seg of segs) {
        handleSeg(seg);
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
    this.ddx = this.accel * ((this.rightHeld|0) - (this.leftHeld|0));
    this.lastX = this.x;
    this.lastY = this.y;
    this.dx = clamp(-this.maxvelX, (this.dx + this.ddx) * this.drag, this.maxvelX);
    this.dy = clamp(this.maxJump, this.dy + this.ddy, this.maxFall);
    this.x += this.dx;
    this.y += this.dy;

    this.doAnim();
    this.doCollision();
    this.doTriggers();

    let texPos = getSpriteTexPos(this.frame);
    this.sprite.texMat.setTranslate(texPos.x, texPos.y);
  }

  draw(shader, dt) {
    this.sprite.objMat.setTranslate(lerp(dt, this.x, this.lastX),
                                    lerp(dt, this.y, this.lastY));
    draw(smiley.sprite, shader);
  }
};

//------------------------------------------------------------------------------
// Camera

class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.zoom = 1;
    this.lastZoom = 1;
    this.mat = new Mat3();

  }

  update() {
    const pushBox = {
      l : SCREEN_WIDTH * 0.25,
      r : SCREEN_WIDTH * 0.75,
      t : SCREEN_HEIGHT * 0.35,
      b : SCREEN_HEIGHT * 0.65
    };

    this.lastX = this.x;
    this.lastY = this.y;
    this.lastZoom = this.zoom;

    if (smiley.x - this.x < pushBox.l) {
      this.x = Math.max(0, smiley.x - pushBox.l);
    } else if (smiley.x - this.x > pushBox.r) {
      this.x = Math.min(level.width - SCREEN_WIDTH, smiley.x - pushBox.r);
    }

    if (smiley.y - this.y < pushBox.t) {
      this.y = Math.max(0, smiley.y - pushBox.t);
    } else if (smiley.y - this.y > pushBox.b) {
      this.y = Math.min(level.height - SCREEN_HEIGHT, smiley.y - pushBox.b);
    }

    this.zoom = shiftHeld ? 1.2 : 1.0;
  }

  draw(dt) {
    let zoomPosX = smiley.x - this.x;
    let zoomPosY = smiley.y - this.y;

    let curZoom = this.zoom - (this.zoom - this.lastZoom) * dt;
    this.mat.setTranslate(
        -(lerp(dt, this.x, this.lastX) + zoomPosX) * curZoom + zoomPosX,
        -(lerp(dt, this.y, this.lastY) + zoomPosY) * curZoom + zoomPosY);
    this.mat.setScale(curZoom, curZoom);
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
        x: rand(assets.testing.data.width),
        y: rand(assets.testing.data.height),
        dx: rand(-1, 1),
        dy: rand(-1, 1),
        size: rand(8, 48),
        frame: randInt(2, 4),
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

  draw(shader, dt) {
    this.batch.reset();
    for (let obj of this.objs) {
      this.batch.pushFrame(obj.x - obj.dx * dt, obj.y - obj.dy * dt, obj.frame,
                           obj.size, obj.size);
    }
    this.batch.upload();
    draw(this.batch.sprite, shader);
  }
}


//------------------------------------------------------------------------------

let camMat;

async function start() {
  initGl();
  initAudio();

  await loadAssets();

  level = assets.factory.data;

  const shader = makeTextureShader();
  font = makeFont();
  text = Sprite.makeText(font, 'find ice; M is for music', new Mat3(),
                         Mat3.makeTranslate(10, 10));
  const spriteTexture = makeTexture(assets.sprites);
  smiley = new Smiley(spriteTexture);
  const bouncies = new Bouncies(spriteTexture);

  const factoryTexture = makeTexture(assets.factoryTiles);
  platforms = new Platforms(factoryTexture);

  document.onkeydown = onKeyDown;
  document.onkeyup = onKeyUp;

  let camera = new Camera();
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

    let timeScale = !shiftHeld ? 1 : 0.33;
    updateRemainder += elapsed * timeScale;
    let maxUpdates = 20;
    while (updateRemainder > updateMs && maxUpdates > 0) {
      updateRemainder -= updateMs;
      maxUpdates--;
      if (maxUpdates <= 0) {
        // don't run in fast-forward for the forseeable future
        updateRemainder = 0;
      }

      smiley.update();

      for (let i = 0; i < 2; ++i) {
        particles.spawn({
          x: smiley.x + rand(-1,1)*TILE_SIZE/4, y: smiley.y + rand(-1,1)*TILE_SIZE/2,
          dx: rand(-0.4, 0.4), dy: rand(-0.4, 0.4),
          life: 30});
      }
      for (let emitter of level.emitters) {
        for (let i = 0; i < 5; ++i) {
          particles.spawn({
            x: emitter.x + rand(emitter.w),
            y: emitter.y + rand(emitter.h),
            dx: rand(0.3, 3), dy: rand(0.3, 3),
            r: rand(64, 92), g: rand(132, 194), b: rand(202, 255),
            life: 840,
          });
        }
      }

      camera.update();
      bouncies.update();
      particles.update();
      platforms.update();
    }

    let dt = 1 - updateRemainder / updateMs;

    camera.draw(dt);

    camMat = camera.mat;
    draw(level.sprite, shader);

    bouncies.draw(shader, dt);
    platforms.draw(shader, dt);
    smiley.draw(shader, dt);

    camMat = Mat3.makeTranslate(SCREEN_WIDTH/2, SCREEN_HEIGHT/2);
    particles.draw(shader, camera.x, camera.y, dt);

    camMat = mat3Id;
    draw(text, shader);
  }
  requestAnimationFrame(tick);
};

start();
