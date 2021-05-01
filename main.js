const SCREEN_WIDTH = 1440;
const SCREEN_HEIGHT = 810;
const TEX_WIDTH = 512;
const TEX_HEIGHT = 512;
const TILE_SIZE = 48;

const NOCOLLIDE_LADDER_GIDS = [21, 31];
const LADDER_GIDS = [21, 31, 32];

function makeKeys() {
  return {
    up : false,
    left : false,
    right : false,
    down : false,
    shift : false,
    jump : false
  };
}

// global vars
let gl;
let audio;
let audioStarted = false;
let lastKeys = makeKeys();
let keyState = makeKeys();
let keyPressed = makeKeys();
let keyReleased = makeKeys();

let assets;

let smiley;
let level;
let platforms;
let pickups;
let particles;
let font;
let camMat;
let ui;
let score = 0;
let slowmo = false;

//------------------------------------------------------------------------------
// Math stuff

const PI = 3.1415926535;

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

function randSign() {
  return 2 * randInt(2) - 1;
}

function randElem(list) {
  return list[randInt(list.length)];
}

function dist2(x0, y0, x1, y1) {
  return (x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0);
}

function gradientLerp(t, colors) {
  let maxIdx = colors.length - 1;
  let lo = Math.floor(t * maxIdx);
  t = t * maxIdx - lo;
  let hi = colors[lo+1];
  lo = colors[lo];
  return {
    r: lerp(t, lo.r, hi.r),
    g: lerp(t, lo.g, hi.g),
    b: lerp(t, lo.b, hi.b),
  };
}

class Segment {
  constructor(x0, y0, x1, y1) {
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
  }

  translate(x, y) {
    this.x0 += x;
    this.x1 += x;
    this.y0 += y;
    this.y1 += y;
    return this;
  }

  dist2() { return dist2(this.x0, this.y0, this.x1, this.y1); }

  dot(x, y) {
    return (x - this.x0) * (this.x1 - this.x0) +
           (y - this.y0) * (this.y1 - this.y0);
  }

  cross(x, y) {
    return (x - this.x0) * (this.y1 - this.y0) -
           (y - this.y0) * (this.x1 - this.x0);
  }
}

class Rect {
  constructor(x, y, w, h) {
    if (w == undefined && h == undefined) {
      this.x = 0;
      this.y = 0;
      this.w = x;
      this.h = y;
    } else {
      this.x = x;
      this.y = y;
      this.w = w;
      this.h = h;
    }
  }

  static makeCenterRadius(x, y, rad) {
    return new Rect(x - rad, y - rad, rad * 2, rad * 2);
  }

  static makeExtents(x0, y0, x1, y1) {
    return new Rect(x0, y0, x1 - x0, y1 - y0);
  }

  setTranslate(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  topSeg() { return new Segment(this.x, this.y, this.x + this.w, this.y); }

  leftSeg() { return new Segment(this.x, this.y + this.h, this.x, this.y); }

  bottomSeg() {
    return new Segment(this.x + this.w, this.y + this.h, this.x,
                       this.y + this.h);
  }

  rightSeg() {
    return new Segment(this.x + this.w, this.y, this.x + this.w,
                       this.y + this.h);
  }

  contains(x, y) {
    return x >= this.x && x < this.x + this.w &&
           y >= this.y && y < this.y + this.h;
  }

  intersects(rect) {
    return rect.x + rect.w >= this.x && rect.x <= this.x + this.w &&
           rect.y + rect.h >= this.y && rect.y <= this.y + this.h;
  }
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

class Text {
  constructor(font, objMat, texMat) {
    this.sprite = Sprite.makeEmptyBuffer(font.texture);
  }

  reset() {
    this.sprite.buffer.reset();
  }

  add(x, y, str, sx = 1, sy = 1) {
    const dx = 16 * sx;
    const dy = 16 * sy;
    const du = 16 / TEX_WIDTH;
    const dv = 16 / TEX_HEIGHT;

    for (let i = 0; i < str.length; ++i) {
      const chr = str.charCodeAt(i);
      if (chr != 32) {
        const {u, v} = font.map[chr];
        this.sprite.buffer.pushTriStripQuad(x, y, u, v, dx, dy, du, dv);
      }
      x += dx;
    }
  }

  upload() {
    this.sprite.buffer.upload(gl.DYNAMIC_DRAW);
  }

  set(x, y, message, sx = 1, sy = 1) {
    this.reset();
    this.add(x, y, message, sx, sy);
    this.upload();
  }

  draw(shader, dt) {
    if (this.sprite.buffer.count != 0) {
      draw(this.sprite, shader)
    }
  }
}

//------------------------------------------------------------------------------
// Level

function getProperty(value, name) {
  for (let prop of value.properties) {
    if (prop.name == name) {
      return prop.value;
    }
  }
  throw 'ouch';
}

class Level {
  constructor(data, tilesAsset) {
    this.data = data;
    this.tileset = null;
    this.sprite = null;
    this.tiles = {};
    this.collision = {
      layer: null,
      width : 0,
      height : 0,
      data : [],
    };
    this.triggers = [];
    this.emitters = [];
    this.platforms = [];
    this.pickupRegions = [];
    this.startPos = {x : 0, y : 0};
    this.width = 0;
    this.height = 0;

    this.load(tilesAsset);
  }

  load(tilesAsset) {
    if (this.data.tilesets.length != 1) {
      throw 'no';
    }

    this.tileset = this.data.tilesets[0];
    let texture = tilesAsset.data.texture;
    this.sprite = Sprite.makeEmptyBuffer(texture);

    if (this.tileset.tilewidth != TILE_SIZE ||
        this.tileset.tileheight != TILE_SIZE ||
        this.tileset.imagewidth != TEX_WIDTH ||
        this.tileset.imageheight != TEX_HEIGHT) {
      throw 'why';
    }

    // preprocess tileset data for ease of lookup later
    this.preprocessTiles();
    this.calculatePixelSize();

    for (let layer of this.data.layers) {
      switch (layer.type) {
        case 'tilelayer':
          if (getProperty(layer, 'collision')) {
            this.doCollisionLayer(layer);
          }
          this.doTileLayer(layer);
          break;

        case 'objectgroup':
          this.doObjectLayer(layer);
          break;
      }
    }
    this.sprite.buffer.upload();
  }

  preprocessTiles() {
    const strideu = (TILE_SIZE + this.tileset.spacing) / TEX_WIDTH;
    const stridev = (TILE_SIZE + this.tileset.spacing) / TEX_HEIGHT;
    const marginu = this.tileset.margin / TEX_WIDTH;
    const marginv = this.tileset.margin / TEX_HEIGHT;

    for (let gid = this.tileset.firstgid;
         gid < this.tileset.firstgid + this.tileset.tilecount; ++gid) {
      const u =
          ((gid - this.tileset.firstgid) % this.tileset.columns) * strideu +
          marginu;
      const v =
          (Math.floor((gid - this.tileset.firstgid) / this.tileset.columns)) *
              stridev +
          marginv;
      this.tiles[gid] = {u, v};
    }
  }

  calculatePixelSize() {
    for (let layer of this.data.layers) {
      if (layer.type != 'tilelayer')
        continue;
    }
  }

  doTileLayer(layer) {
    const dx = TILE_SIZE;
    const dy = TILE_SIZE;
    const du = TILE_SIZE / this.tileset.imagewidth;
    const dv = TILE_SIZE / this.tileset.imageheight;

    // Update level pixel width/height
    this.width = Math.max(this.width, layer.width * TILE_SIZE);
    this.height = Math.max(this.height, layer.height * TILE_SIZE);

    let x = 0;
    let y = 0;
    for (let i = 0; i < layer.data.length; ++i) {
      let gid = layer.data[i];
      if (gid != 0) {
        const x = (i % layer.width) * dx;
        const y = Math.floor(i / layer.width) * dy;
        const {u, v} = this.tiles[gid];
        this.sprite.buffer.pushTriStripQuad(x, y, u, v, dx, dy, du, dv);
      }
    }
  }

  getCell(layer, x, y) {
    if (x < 0 || x >= layer.width || y < 0 || y >= layer.height) {
      return null;
    }
    return layer.data[y * layer.width + x];
  }

  getCollisionCell(x, y) {
    return this.getCell(this.collision.layer, x, y);
  }

  getSegs(x, y) {
    if (x < 0 || x >= this.collision.width || y < 0 ||
        y >= this.collision.height) {
      return null;
    }
    return this.collision.data[y * this.collision.width + x];
  }

  doCollisionLayer(layer) {
    let collision = this.collision;
    collision.layer = layer;
    collision.width = layer.width;
    collision.height = layer.height;
    collision.data = [];

    for (let y = 0; y < layer.height; ++y) {
      for (let x = 0; x < layer.width; ++x) {
        let gid = layer.data[y * layer.width + x];
        if (gid == 0 || NOCOLLIDE_LADDER_GIDS.includes(gid))
          continue;

        const ts = TILE_SIZE;
        let px = x * ts;
        let py = y * ts;

        let left = this.getSegs(x - 1, y);
        let top = this.getSegs(x, y - 1);

        let rect = new Rect(px, py, ts, ts);
        let boxSegs = [
          rect.topSeg(), rect.leftSeg(), rect.bottomSeg(), rect.rightSeg()
        ];

        if (left != null) {
          // extend top and bottom segments
          left[0].x1 = boxSegs[0].x1;
          left[2].x0 = boxSegs[2].x0;
          boxSegs[0] = left[0];
          boxSegs[2] = left[2];
        }

        if (top != null) {
          // extend right and left segments
          top[1].y0 = boxSegs[1].y0;
          top[3].y1 = boxSegs[3].y1;
          boxSegs[1] = top[1];
          boxSegs[3] = top[3];
        }

        // make sure segments aren't 0 length
        for (let seg of boxSegs) {
          if (seg.x0 == seg.x1 && seg.y0 == seg.y1) {
            console.log('no');
            throw 'no';
          }
        }

        collision.data[y * layer.width + x] = boxSegs;
      }
    }
  }

  doObjectLayer(layer) {
    for (let object of layer.objects) {
      switch (object.type) {
      case 'player':
        this.startPos.x = object.x;
        this.startPos.y = object.y;
        break;

      case 'message':
        this.triggers.push({
          type : 'message',
          x : object.x,
          y : object.y,
          w : object.width,
          h : object.height,
          message : getProperty(object, 'message'),
        });
        break;

      case 'platform': {
        let x = object.x, y = object.y;
        let points = [];
        for (let point of object.polygon) {
          points.push({x : x + point.x, y : y + point.y});
        }
        this.platforms.push({points});
        break;
      }

      case 'particle-emitter':
        this.emitters.push({
          x : object.x,
          y : object.y,
          w : object.width,
          h : object.height,
        });
        break;

      case 'pickup-spawn':
        this.pickupRegions.push({
          x : object.x,
          y : object.y,
          w : object.width,
          h : object.height,
        });
        break;

      default:
        throw 'what';
      }
    }
  }
};

//------------------------------------------------------------------------------
// Asset loading

assets = {
  sprites: {filename: 'sprites.png', type: 'image', data: null},
  tiles: {filename: 'tiles.png', type: 'image', data: null},
  font: {filename: 'font.png', type: 'image', data: null},
  factoryTiles: {filename: 'factory_tiles.png', type: 'image', data: null},

  factory: {filename: 'factory.json', type: 'level', data: null, depends: ['factoryTiles']},

  boom: {filename: 'boom.mp3', type: 'sfx', data: null},
  doots: {filename: 'doots.wav', type: 'music', data: null},
};

function loadImage(asset) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = async () => {
      let bitmap = await createImageBitmap(image);
      let texture = makeTexture(bitmap);
      resolve({bitmap, texture});
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
  let level = new Level(json, assets[asset.depends[0]]);
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

let isMuted = true;
function playSound(asset) {
  if (isMuted) { return; }
  let node = audio.createBufferSource();
  node.buffer = asset.data;
  node.connect(audio.destination);
  node.start();
}

function playMusic(asset) {
  isMuted = !isMuted;
  let media = asset.data.mediaElement;
  media.play();
  media.volume = 1 - (isMuted|0);
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
    if (particle.gravity === undefined) {
      particle.gravity = 0;
    }
    particle.t = 0;
    this.particles.push(particle);
  }

  update() {
    for (let i = 0; i < this.particles.length; ++i) {
      const p = this.particles[i];
      p.x += p.dx;
      p.y += p.dy;
      p.dy += p.gravity;

      p.t++;
      if (p.t > p.life) {
        // O(1) removal by moving the last particle up
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.length--;
        i--;
      }
    }
  }

  draw(shader, camera, dt) {
    // clear alpha byte
    for (let i = 3; i < this.texBuffer.length; i += 4) {
      // or do a blur effect, either way
      this.texBuffer[i] /= 1.2;
    }

    // TODO: don't copy these values from camera
    let zoomPosX = smiley.x - camera.x;
    let zoomPosY = smiley.y - camera.y;
    let curZoom = camera.zoom - (camera.zoom - camera.lastZoom) * dt;
    let camX = -(camera.x + zoomPosX) * curZoom + zoomPosX;
    let camY = -(camera.y + zoomPosY) * curZoom + zoomPosY;
    let invScale = 1 / this.scale;

    for (let p of this.particles) {
      let x = ((p.x - p.dx * dt) * curZoom + camX) * invScale;
      let y = ((p.y - p.dy * dt) * curZoom + camY) * invScale;
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

function makeTexture(bitmap) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX_WIDTH, TEX_HEIGHT, 0, gl.RGBA,
                gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);

  uploadTex(texture, bitmap);
  return texture;
}

function makeTexMat3x3(texPos, w, h) {
  return new Mat3()
      .setScale(w / TEX_WIDTH, h / TEX_HEIGHT)
      .setTranslate(texPos.x, texPos.y);
}

function makeFont() {
  const texture = assets.font.data.texture;

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

const keymap = {
  'ArrowLeft' : 'left',
  'ArrowRight' : 'right',
  'ArrowUp' : 'up',
  'ArrowDown' : 'down',
  ' ' : 'jump',
  'Shift' : 'shift',

  // alternate controls
  'a' : 'left',
  'd' : 'right',
  'w' : 'up',
  's' : 'down',
  // and again but capitalized because holding shift
  'A' : 'left',
  'D' : 'right',
  'W' : 'up',
  'S' : 'down',
};

function onKeyDown(event) {
  maybeResumeAudio();

  if (event.key in keymap) {
    keyState[keymap[event.key]] = true;
  }

  switch (event.key) {
    case 'p':
      playSound(assets.boom);
      break;

    case 'm':
      playMusic(assets.doots);
      break;
  }
}

function onKeyUp(event) {
  maybeResumeAudio();

  if (event.key in keymap) {
    keyState[keymap[event.key]] = false;
  }
}

function updateKeys() {
  for (let key in keyState) {
    keyPressed[key] = keyState[key] && !lastKeys[key];
    keyReleased[key] = !keyState[key] && lastKeys[key];
    lastKeys[key] = keyState[key];
  }
}

//------------------------------------------------------------------------------
// Collision detection
// see https://stackoverflow.com/questions/849211/shortest-distance-between-a-point-and-a-line-segment

function distToLineSegment2(px, py, seg) {
  let l2 = seg.dist2();
  if (l2 == 0) { throw 'no'; }
  let t = clamp(0, seg.dot(px, py) / l2, 1);
  let ix = seg.x0 + t * (seg.x1 - seg.x0);
  let iy = seg.y0 + t * (seg.y1 - seg.y0);
  return {dist2: dist2(px, py, ix, iy), ix, iy};
}

//------------------------------------------------------------------------------
// Platforms

class Platforms {
  constructor(texture) {
    this.batch = new SpriteBatch(texture);
    this.objs = [];

    // TODO: handle level changes better
    for (let platform of level.platforms) {
      let obj = {
        rect: new Rect(48 * 3, 48),
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
      obj.rect.setTranslate(obj.x, obj.y);
    }
  }

  draw(shader, dt) {
    this.batch.reset();
    for (let obj of this.objs) {
      this.batch.pushFrame(lerp(dt, obj.x, obj.lastX),
                           lerp(dt, obj.y, obj.lastY), 10, TILE_SIZE * 3,
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
    this.isClimbing = false;
    this.gravity = 2 * this.jumpHeight / Math.pow(this.jumpTime, 2);

    this.x = level.startPos.x;
    this.y = level.startPos.y;
    this.lastX = this.x;
    this.lastY = this.y;
    this.dx = 0;
    this.dy = 0;
    this.ddx = 0;
    this.ddy = this.gravity;
    this.baseFrame = 10;
    this.frame = 10;

    this.radius = 22;
    this.rect = Rect.makeCenterRadius(this.x, this.y, this.radius);

    this.animTimer = 0;
    this.blinkTimer = 0;

    this.accel = 0.55;
    this.drag = 0.85;
    this.maxvelX = 3;
    this.climbAccel = 0.55;
    this.maxClimbVel = 3;

    this.maxJump = -30;
    this.maxFall = 10;

    this.currentTriggers = [];
  }

  jump() {
    if (!this.isJumping) {
      this.isJumping = true;
      this.isClimbing = false;
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
    } else if (this.isClimbing) {
      this.baseFrame = 40;
      moving = this.ddy != 0;
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
    let px = this.x;
    let py = this.y;
    let rad2 = this.radius * this.radius;

    let handleSeg = (seg) => {
      let cross = seg.cross(px, py);
      if (cross < 0) return false;

      let {dist2, ix, iy} = distToLineSegment2(px, py, seg);

      if (dist2 < rad2) {
        // push away along vec between object and segment.
        let dist = Math.sqrt(dist2);
        let push = (this.radius - dist) / dist;
        px += (px - ix) * push;
        py += (py - iy) * push;
        return true;
      }
      return false;
    }

    // Platform collision
    for (let obj of platforms.objs) {
      if (this.rect.intersects(obj.rect)) {
        // Riding on top of the platform
        if (handleSeg(obj.rect.topSeg().translate(0, 20))) {
          let dx = obj.x - obj.lastX;
          let dy = obj.y - obj.lastY;
          px += dx;
          py += dy;
        }
      }
    }

    // Tile collision
    let tx = Math.floor(px / TILE_SIZE);
    let ty = Math.floor(py / TILE_SIZE);
    let t0x = Math.floor((px - this.radius) / TILE_SIZE);
    let t0y = Math.floor((py - this.radius) / TILE_SIZE);
    let t1x = Math.floor((px + this.radius) / TILE_SIZE);
    let t1y = Math.floor((py + this.radius) / TILE_SIZE);
    let tiles = [{x: t0x, y: t0y}];
    if (t0x != t1x) {
      tiles.push({x: t1x, y: t0y});
      if (t0y != t1y) {
        tiles.push({x: t0x, y: t1y});
        tiles.push({x: t1x, y: t1y});
      }
    } else if (t0y != t1y) {
      tiles.push({x: t0x, y: t1y});
    }

    for (let tile of tiles) {
      let segs = level.getSegs(tile.x, tile.y);
      let gid = level.getCollisionCell(tile.x, tile.y);
      if (LADDER_GIDS.includes(gid) && this.isClimbing) continue;

      if (segs) {
        for (let seg of segs) {
          handleSeg(seg);
        }
      }
    }

    // Ladders
    if (this.isClimbing || keyState.up|| keyState.down) {
      let gid = level.getCollisionCell(tx, ty);
      this.isClimbing = LADDER_GIDS.includes(gid);
      // Try to align horizontally with the ladder if pressing up/down.
      if (this.isClimbing && (keyState.up || keyState.down)) {
        this.dx += ((tx + 0.5) * TILE_SIZE - px) * 0.01;
      }
    }

    // Pickups
    slowmo = false;
    for (let i = 0; i < pickups.objs.length; ++i) {
      let pickup = pickups.objs[i];
      if (this.rect.intersects(pickup.slowmoRect)) {
        slowmo = true;
      }

      if (this.rect.intersects(pickup.rect)) {
        pickup.onCollect(pickup);
        pickups.objs.splice(i, 1);
        i--;
      }
    }

    this.x = px;
    this.y = py;
    this.rect.setTranslate(this.x - this.radius, this.y - this.radius);
  }

  doTriggers() {
    let newTriggers = [];
    for (let trigger of level.triggers) {
      let rect = new Rect(trigger.x, trigger.y, trigger.w, trigger.h);
      if (this.rect.intersects(rect)) {
        newTriggers.push(trigger);
      }
    }

    for (let trigger of newTriggers) {
      if (!this.currentTriggers.includes(trigger)) {
        // Newly triggered
        switch (trigger.type) {
        case 'message':
          ui.showMessage(trigger.message);
          break;
        }
      }
    }

    for (let trigger of this.currentTriggers) {
      if (!newTriggers.includes(trigger)) {
        // Newly untriggered
        switch (trigger.type) {
        case 'message':
          ui.hideMessage();
          break;
        }
      }
    }

    this.currentTriggers = newTriggers;
  }

  update() {
    if (keyPressed.jump) {
      this.jump();
    } else if (keyReleased.jump) {
      this.unjump();
    }

    if (this.isClimbing) {
      this.ddy = this.climbAccel * ((keyState.down|0) - (keyState.up|0));
    } else {
      this.ddy = this.gravity;
    }

    this.ddx = this.accel * ((keyState.right|0) - (keyState.left|0));
    this.lastX = this.x;
    this.lastY = this.y;
    this.dx = clamp(-this.maxvelX, (this.dx + this.ddx) * this.drag, this.maxvelX);
    if (this.isClimbing) {
      this.dy = clamp(-this.maxClimbVel, (this.dy + this.ddy) * this.drag,
                      this.maxClimbVel);
    } else {
      this.dy = clamp(this.maxJump, this.dy + this.ddy, this.maxFall);
    }
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
    draw(this.sprite, shader);
  }
};

//------------------------------------------------------------------------------
// Pickups, collectibles, non-player world objects

class Pickup {
  constructor(x, y, onCollect) {
    this.x = x;
    this.y = y;
    this.lastX = this.x;
    this.lastY = this.y;

    this.frame = 0;
    this.onCollect = onCollect;

    this.rect = Rect.makeCenterRadius(this.x, this.y, TILE_SIZE/2 - 4);
    this.slowmoRect = Rect.makeCenterRadius(this.x, this.y, TILE_SIZE * 0.7);
  }
}

class Pickups {
  constructor(texture) {
    this.sprite = Sprite.makeQuad(
        texture, Mat3.makeScale(TILE_SIZE, TILE_SIZE),
        Mat3.makeScale(TILE_SIZE / TEX_WIDTH, TILE_SIZE / TEX_HEIGHT));

    this.objs = [];
    this.spawnDelay = 300;
    this.maxSpawned = 5;
    this.spawnTimer = 0;
  }

  push(pickup) {
    this.objs.push(pickup);
  }

  update() {
    // Spawning logic
    if (this.objs.length >= this.maxSpawned) {
      return;
    }

    this.spawnTimer--;
    if (this.spawnTimer >= 0) {
      return;
    }
    this.spawnTimer = this.spawnDelay;

    let region = randElem(level.pickupRegions);
    let x = rand(region.x, region.x+region.w);
    let y = rand(region.y, region.y+region.h);
    this.objs.push(new Pickup(x, y, (p) => {
      playSound(assets.boom);
      for (let i = 0; i < 375; ++i) {
        let t = rand(2*PI);
        let v = rand(6);
        let c = rand(0.6, 1)
        particles.spawn({
          x: p.x, y: p.y,
          dx: v * Math.cos(t), dy: v * Math.sin(t) - 2,
          r: 255*c, g: 205*c, b: 64,
          life: rand(25, 75),
          gravity: 0.2,
        });
      }
      score++;
    }));
  }

  draw(shader, dt) {
    // todo: use spritebatch
    for (let pickup of this.objs) {
      this.sprite.objMat.setTranslate(lerp(dt, pickup.x, pickup.lastX),
                                      lerp(dt, pickup.y, pickup.lastY));
      draw(this.sprite, shader);
    }
  }
}

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

    this.zoom = slowmo ? 2.0 : 1.0;
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
// UI

class UI {
  constructor() {
    this.toast = new Toast();
    this.text = new Text(font);
    this.clock = new Clock();
  }

  showMessage(message) {
    this.toast.showMessage(message);
  }

  hideMessage() {
    this.toast.hideMessage();
  }

  update() {
    this.toast.update();
    this.clock.update();
  }

  draw(shader, dt) {
    this.text.reset();
    this.text.add(0, 0, `score: ${score}`, 2, 2);
    this.clock.addText(this.text);
    this.text.upload();
    this.text.draw(shader, dt);
    this.toast.draw(shader, dt);
  }
}

class Toast {
  constructor() {
    this.text = new Text(font);
    this.message = '';
    this.x = 0;
    this.y = 0;
    this.startX = 0;
    this.startY = 0;
    this.destX = 0;
    this.destY = 0;
    this.t = 0;
  }

  showMessage(message) {
    this.message = message;
    this.startX = this.destX = (SCREEN_WIDTH - message.length * 64) * 0.5;
    this.startY = SCREEN_HEIGHT;
    this.destY = SCREEN_HEIGHT - 64;
    this.t = 0;
  }

  hideMessage() {
    this.startY = this.y;
    this.destY = SCREEN_HEIGHT;
    this.t = 0;
  }

  update() {
    this.t = Math.min(this.t + 0.1, 1);
    this.x = lerp(this.t, this.startX, this.destX);
    this.y = lerp(this.t, this.startY, this.destY);
  }

  draw(shader, dt) {
    this.text.set(this.x, this.y, this.message, 4, 4);
    this.text.draw(shader, dt);
  }
}

class Clock {
  constructor() {
    this.frames = 0;

    this.weekday = 0;
    this.startHour = 7;
    const endHour = 5 + 12;
    this.workdayMinutes = (endHour - this.startHour) * 60;
    this.workdayFrames = 2 * 60 * 60;  // 2 minutes
    this.framesPerMinute = this.workdayMinutes / this.workdayFrames;
  }

  update() {
    this.frames++;
    if (this.frames >= this.workdayFrames) {
      this.frames = 0;
      this.weekday++;
      if (this.weekday >= 5) {
        this.weekday = 0;
      }
    }
  }

  toString() {
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    let totalMinutes = Math.floor(this.frames * this.framesPerMinute);
    let padInt = (num, len, chr) => num.toString().padStart(len, chr);
    let min = totalMinutes % 60;
    let hour = this.startHour + (Math.floor(totalMinutes / 60)) % 24;
    let ampm = 'AM';
    if (hour >= 12 && hour < 24) {
      ampm = 'PM';
      hour -= 12;
    }
    if (hour == 0) {
      hour = 12;
    }
    return `${dayNames[this.weekday]} ${padInt(hour, 2, ' ')}:${padInt(min, 2, '0')}${ampm}`;
  }

  addText(text) {
    text.add(0, 32, this.toString(), 2, 2);
  }

  workdayFraction() {
    return this.frames / this.workdayFrames;
  }
};

//------------------------------------------------------------------------------

async function start() {
  initGl();
  initAudio();

  await loadAssets();

  level = assets.factory.data;

  const shader = makeTextureShader();
  font = makeFont();
  smiley = new Smiley(assets.sprites.data.texture);
  ui = new UI();

  platforms = new Platforms(assets.factoryTiles.data.texture);
  pickups = new Pickups(assets.sprites.data.texture);

  document.onkeydown = onKeyDown;
  document.onkeyup = onKeyUp;

  let camera = new Camera();
  particles = new ParticleSystem();

  const updateMs = 16.6;
  let lastTimestamp;
  let updateRemainder = updateMs + 1;
  function tick(timestamp) {
    requestAnimationFrame(tick);

    if (lastTimestamp === undefined) { lastTimestamp = timestamp; }
    let elapsed = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    let clearColor = gradientLerp(ui.clock.workdayFraction(), [
      {r: 0.2, g: 0.3, b: 1.0},
      {r: 0.3, g: 0.8, b: 1.0},
      {r: 0.4, g: 0.9, b: 1.0},
      {r: 0.7, g: 0.3, b: 0.8},
      {r: 0.5, g: 0.1, b: 0.5},
      {r: 0.2, g: 0.1, b: 0.3},
    ]);
    gl.clearColor(clearColor.r, clearColor.g, clearColor.b, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let timeScale = slowmo ? 0.33 : 1;
    updateRemainder += elapsed * timeScale;
    let maxUpdates = 20;
    while (updateRemainder > updateMs && maxUpdates > 0) {
      updateRemainder -= updateMs;
      maxUpdates--;
      if (maxUpdates <= 0) {
        // don't run in fast-forward for the forseeable future
        updateRemainder = 0;
      }

      updateKeys();

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
      particles.update();
      platforms.update();
      pickups.update();
      ui.update();
    }

    let dt = 1 - updateRemainder / updateMs;

    camera.draw(dt);

    camMat = camera.mat;
    draw(level.sprite, shader);

    platforms.draw(shader, dt);
    smiley.draw(shader, dt);
    pickups.draw(shader, dt);


    camMat = Mat3.makeTranslate(SCREEN_WIDTH/2, SCREEN_HEIGHT/2);
    particles.draw(shader, camera, dt);

    camMat = mat3Id;
    ui.draw(shader, dt);
  }
  requestAnimationFrame(tick);
};

start();
