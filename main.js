const SCREEN_WIDTH = 1440;
const SCREEN_HEIGHT = 810;
const TEX_WIDTH = 512;
const TEX_HEIGHT = 512;
const TILE_SIZE = 48;
const FADE_TIME = 0.75;

const NOCOLLIDE_LADDER_GIDS = [21, 31];
const LADDER_GIDS = [21, 31, 32, 19, 29];
const DOWNRIGHT_GIDS = [35, 55];
const UPRIGHT_GIDS = [36, 56];

const PICKUP_DATA = {
  // numbers correspond with sprite frame ids
  carrot: {kind: 'carrot', frame: 50, r: 255, g: 126, b: 0, sounds: ['carrot1', 'carrot2']},
  tomato: {kind: 'tomato', frame: 51, r: 237, g: 28, b: 36, sounds: ['tomato1', 'tomato2']},
  chicken: {kind: 'chicken', frame: 52, r: 220, g: 220, b: 220, sounds: ['chicken1', 'chicken2']},
  soup: {kind: 'soup', frame: 53, r: 220, g: 220, b: 220, sounds: []},
  badge: {kind: 'badge', frame: 54, r: 220, g: 220, b: 220, sounds: []},
};

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

function makeMouse() {
  return {
    left: false,
    right: false,
    middle: false,
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
let lastMouse = makeMouse();
let mouseState = makeMouse();
let mousePressed = makeMouse();
let mouseReleased = makeMouse();
let mouseScreenX = 0;
let mouseScreenY = 0;

let assets;

let state;
let titleState;
let gameState;
let endDayState;

let fader;

let shader;
let colorShader;
let smiley;
let level;
let platforms;
let pickups;
let particles;
let font;
let camera;
let camMat;
let ui;
let tossers;
let counters;

const maxSlow = 0.33;
const maxZoom = 2.0;
let slowScale = 0.0;

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
function dist(x0, y0, x1, y1) {
  return Math.sqrt(dist2(x0, y0, x1, y1));
}

function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
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

  isTop() {
    return this.x0 < this.x1;
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

  downRightSeg() {
    return new Segment(this.x, this.y, this.x + this.w, this.y + this.h);
  }

  upRightSeg() {
    return new Segment(this.x, this.y + this.h, this.x + this.w, this.y);
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

  static makeTileObj() {
    return Mat3.makeScale(TILE_SIZE, TILE_SIZE);
  }

  static makeTileTex() {
    return Mat3.makeScale(TILE_SIZE / TEX_WIDTH, TILE_SIZE / TEX_HEIGHT);
  }

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

  pushColor(x, y, r, g, b, a) {
    this.data.push(x, y, r, g, b, a);
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

  draw(shader, dt) {
    draw(this.sprite, shader)
  }
}

class Text {
  constructor(font, objMat, texMat) {
    this.sprite = Sprite.makeEmptyBuffer(font.texture);
  }

  reset() {
    this.sprite.buffer.reset();
  }

  add(x, y, str, sx = 1, sy = 1, spacingX = 1) {
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
      x += dx * spacingX;
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
    draw(this.sprite, shader)
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
    this.collectors = [];
    this.counters = [];
    this.spouts = [];
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

        let rect = new Rect(px, py, ts, ts);
        let boxSegs = {
          downRight : null,
          upRight : null,
          top : null,
          bottom : null,
          left : null,
          right : null
        };

        if (DOWNRIGHT_GIDS.includes(gid)) {
          // Shaped like: |\
          //              |_\
          boxSegs.downRight = rect.downRightSeg();
          boxSegs.bottom = rect.bottomSeg();
          boxSegs.left = rect.leftSeg();

          let upLeftSegs = this.getSegs(x - 1, y - 1);
          let topSegs = this.getSegs(x, y - 1);
          let leftSegs = this.getSegs(x - 1, y);

          if (leftSegs) {
            if (leftSegs.bottom && boxSegs.bottom) {
              // extend bottom segment
              leftSegs.bottom.x0 = boxSegs.bottom.x0;
              boxSegs.bottom = leftSegs.bottom;
            }

            // Remove shared wall
            if (leftSegs.right) {
              leftSegs.right = null;
              boxSegs.left = null;
            }
          }

          if (topSegs && topSegs.left && boxSegs.left) {
            // extend left segment
            topSegs.left.y0 = boxSegs.left.y0;
            boxSegs.left = topSegs.left;
          }

          if (upLeftSegs && upLeftSegs.downRight && boxSegs.downRight) {
            // extend downright segment
            upLeftSegs.downRight.x1 = boxSegs.downRight.x1;
            upLeftSegs.downRight.y1 = boxSegs.downRight.y1;
            boxSegs.downRight = upLeftSegs.downRight;
          }
        } else if (UPRIGHT_GIDS.includes(gid)) {
          // Shaped like:  /|
          //              /_|
          boxSegs.upRight = rect.upRightSeg();
          boxSegs.bottom = rect.bottomSeg();
          boxSegs.right = rect.rightSeg();

          let upRightSegs = this.getSegs(x + 1, y - 1);
          let topSegs = this.getSegs(x, y - 1);
          let leftSegs = this.getSegs(x - 1, y);

          if (leftSegs) {
            if (leftSegs.bottom && boxSegs.bottom) {
              // extend bottom segment
              leftSegs.bottom.x0 = boxSegs.bottom.x0;
              boxSegs.bottom = leftSegs.bottom;
            }

            // Remove shared wall
            if (leftSegs.right) {
              leftSegs.right = null;
              boxSegs.left = null;
            }
          }

          if (topSegs && topSegs.right && boxSegs.right) {
            // extend right segment
            topSegs.right.y1 = boxSegs.right.y1;
            boxSegs.right = topSegs.right;
          }

          if (upRightSegs && upRightSegs.downRight && boxSegs.downRight) {
            // extend downRight segment
            upRightSegs.downRight.x0 = boxSegs.downRight.x0;
            upRightSegs.downRight.y0 = boxSegs.downRight.y0;
            boxSegs.downRight = upRightSegs.downRight;
          }
        } else {
          // Rectangular
          boxSegs.top = rect.topSeg();
          boxSegs.bottom = rect.bottomSeg();
          boxSegs.left = rect.leftSeg();
          boxSegs.right = rect.rightSeg();

          let leftSegs = this.getSegs(x - 1, y);
          let topSegs = this.getSegs(x, y - 1);

          if (leftSegs) {
            // extend top and bottom segments
            if (leftSegs.top && boxSegs.top) {
              leftSegs.top.x1 = boxSegs.top.x1;
              boxSegs.top = leftSegs.top;
            }

            if (leftSegs.bottom && boxSegs.bottom) {
              leftSegs.bottom.x0 = boxSegs.bottom.x0;
              boxSegs.bottom = leftSegs.bottom;
            }

            // Remove shared wall
            if (leftSegs.right) {
              leftSegs.right = null;
              boxSegs.left = null;
            }
          }

          if (topSegs) {
            // extend right and left segments
            if (topSegs.left && boxSegs.left) {
              topSegs.left.y0 = boxSegs.left.y0;
              boxSegs.left = topSegs.left;
            }

            if (topSegs.right && boxSegs.right) {
              topSegs.right.y1 = boxSegs.right.y1;
              boxSegs.right = topSegs.right;
            }

            // Remove shared wall
            if (topSegs.bottom) {
              topSegs.bottom = null;
              boxSegs.top = null;
            }
          }
        }

        // make sure segments aren't 0 length
        for (let seg of Object.values(boxSegs)) {
          if (seg && seg.x0 == seg.x1 && seg.y0 == seg.y1) {
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
          kind : getProperty(object, 'kind'),
          maxSpawned : getProperty(object, 'maxSpawned'),
          spawnDelay : getProperty(object, 'spawnDelay'),
        });
        break;

      case 'collector':
        this.collectors.push({
          x : object.x,
          y : object.y,
          w : object.width,
          h : object.height,
          kind : getProperty(object, 'kind')
        });
        break;

      case 'counter':
        this.counters.push({
          x : object.x,
          y : object.y,
          w : object.width,
          h : object.height,
          kind : getProperty(object, 'kind')
        });
        break;

      case 'spout':
        this.spouts.push({
          x : object.x,
          y : object.y,
        });
        break;

      case 'badge':
        this.triggers.push({
          type : 'badge',
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

  getTiles(rect) {
    let tiles = [];
    let t0x = Math.floor(rect.x / TILE_SIZE);
    let t0y = Math.floor(rect.y / TILE_SIZE);
    let t1x = Math.floor((rect.x + rect.w) / TILE_SIZE);
    let t1y = Math.floor((rect.y + rect.h) / TILE_SIZE);
    for (let ty = t0y; ty <= t1y; ++ty) {
      for (let tx = t0x; tx <= t1x; ++tx) {
        tiles.push({x: tx, y: ty});
      }
    }
    return tiles;
  }

  handleObjCollision(thing, isClimbing = false, cb) {
    let hasCollision = false;
    for (let tile of this.getTiles(thing.rect)) {
      let gid = this.getCollisionCell(tile.x, tile.y);
      if (LADDER_GIDS.includes(gid) && isClimbing)
        continue;

      let segs = this.getSegs(tile.x, tile.y);
      if (segs) {
        for (let seg of Object.values(segs)) {
          if (seg && checkSegObjCollision(thing, seg)) {
            this.x += thing.x - thing.lastX;
            this.y += thing.y - thing.lastY;

            if (cb) {
              cb(tile, seg);
            }
            hasCollision = true;
          }
        }
      }
    }
    return hasCollision;
  }

  update() {
    // don't think we have these but hey just in case
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
  }
};

//------------------------------------------------------------------------------
// Asset loading

assets = {
  title: {filename: 'title.png', type: 'image', data: null},
  days: {filename: 'days.png', type: 'image', data: null},
  sprites: {filename: 'sprites.png', type: 'image', data: null},
  tiles: {filename: 'tiles.png', type: 'image', data: null},
  font: {filename: 'font.png', type: 'image', data: null},
  factoryTiles: {filename: 'factory_tiles.png', type: 'image', data: null},

  factory: {filename: 'factory.json', type: 'level', data: null, depends: ['factoryTiles']},

  boom: {filename: 'boom.mp3', type: 'sfx', data: null},
  doots: {filename: 'doots.wav', type: 'music', data: null},

  // sfx
  carrot1: {filename: 'sounds/carrot1.ogg', type: 'sfx', data: null},
  carrot2: {filename: 'sounds/carrot2.ogg', type: 'sfx', data: null},
  tomato1: {filename: 'sounds/tomato1.ogg', type: 'sfx', data: null},
  tomato2: {filename: 'sounds/tomato2.ogg', type: 'sfx', data: null},
  chicken1: {filename: 'sounds/chicken1.ogg', type: 'sfx', data: null},
  chicken2: {filename: 'sounds/chicken2.ogg', type: 'sfx', data: null},
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

function makeColorShader() {
  const vertexShader = compileShader(gl.VERTEX_SHADER,
     `uniform mat3 uObjMat;
      uniform mat3 uCamMat;
      attribute vec2 aPos;
      attribute vec4 aColor;
      varying highp vec4 vColor;

      void main(void) {
        float w = 1440.0, h = 810.0;
        mat3 proj = mat3(2.0 / w,         0,  0,
                               0,  -2.0 / h,  0,
                            -1.0,       1.0,  0);

        vec3 pos = vec3(aPos, 1.0);
        gl_Position = vec4(proj * uCamMat * uObjMat * pos, 1.0);
        vColor = aColor;
      }`);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER,
     `precision highp float;
      varying vec4 vColor;
      void main(void) {
        gl_FragColor = vColor;
      }`);

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
  }

  const aPos = gl.getAttribLocation(program, 'aPos');
  const aColor = gl.getAttribLocation(program, 'aColor');
  const uObjMat = gl.getUniformLocation(program, 'uObjMat');
  const uCamMat = gl.getUniformLocation(program, 'uCamMat');

  return {program, aPos, aColor, uObjMat, uCamMat};
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
  if (!sprite || sprite.buffer.count == 0) return;

  gl.bindBuffer(gl.ARRAY_BUFFER, sprite.buffer.glbuf);
  gl.bindTexture(gl.TEXTURE_2D, sprite.texture);
  gl.useProgram(shader.program);

  gl.enableVertexAttribArray(shader.aPos);

  if (shader.aTexCoord) {
    gl.vertexAttribPointer(shader.aPos, 2, gl.FLOAT, gl.FALSE, 16, 0);
    gl.enableVertexAttribArray(shader.aTexCoord);
    gl.vertexAttribPointer(shader.aTexCoord, 2, gl.FLOAT, gl.FALSE, 16, 8);
  }

  if (shader.aColor) {
    gl.vertexAttribPointer(shader.aPos, 2, gl.FLOAT, gl.FALSE, 24, 0);
    gl.enableVertexAttribArray(shader.aColor);
    gl.vertexAttribPointer(shader.aColor, 4, gl.FLOAT, gl.FALSE, 24, 8);
  }

  if (shader.uSampler) {
    gl.uniform1i(shader.uSampler, 0);
  }

  gl.uniformMatrix3fv(shader.uObjMat, false, sprite.objMat.m);
  gl.uniformMatrix3fv(shader.uCamMat, false, camMat.m);

  if (shader.uTexMat) {
    gl.uniformMatrix3fv(shader.uTexMat, false, sprite.texMat.m);
  }

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

    case '1': ui.inventory.selected = 0; break;
    case '2': ui.inventory.selected = 1; break;
    case '3': ui.inventory.selected = 2; break;
    case '4': ui.inventory.selected = 3; break;
    case '5': ui.inventory.selected = 4; break;
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

function convertEventMouseLocation(event) {
  const target = event.target;
  const cw = target.clientWidth, ch = target.clientHeight;
  const clientAspect = cw / ch;
  const wantedAspect = SCREEN_WIDTH / SCREEN_HEIGHT;
  let scalex, scaley, ow, oh;

  if (clientAspect < wantedAspect) {
    // top+bottom bars
    ow = 0;
    oh = (ch - cw / wantedAspect) / 2;
    scalex = cw;
    scaley = ch - oh * 2;
  } else {
    // left+right bars
    ow = (cw - ch * wantedAspect) / 2;
    oh = 0;
    scalex = cw - ow * 2;
    scaley = ch;
  }
  let offsetX = event.clientX - target.offsetLeft;
  let offsetY = event.clientY - target.offsetTop;

  return [
    SCREEN_WIDTH * (offsetX - ow) / scalex,
    SCREEN_HEIGHT * (offsetY - oh) / scaley
  ];
}

function onMouseEvent(event) {
  let [x, y] = convertEventMouseLocation(event);
  mouseScreenX = x;
  mouseScreenY = y;
  mouseState.left = !!(event.buttons & 1);
  mouseState.right = !!(event.buttons & 2);
  mouseState.middle = !!(event.buttons & 4);
}

function updateMouse() {
  for (let key in mouseState) {
    mousePressed[key] = mouseState[key] && !lastMouse[key];
    mouseReleased[key] = !mouseState[key] && lastMouse[key];
    lastMouse[key] = mouseState[key];
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

function checkSegObjCollision(obj, seg) {
  let rad2 = obj.radius * obj.radius;
  let cross = seg.cross(obj.x, obj.y);
  if (cross < 0) return false;

  let {dist2, ix, iy} = distToLineSegment2(obj.x, obj.y, seg);

  if (dist2 < rad2) {
    // push away along vec between object and segment.
    let dist = Math.sqrt(dist2);
    let push = (obj.radius - dist) / dist;
    obj.x += (obj.x - ix) * push;
    obj.y += (obj.y - iy) * push;
    return true;
  }
  return false;
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

  handleObjCollision(thing, cb) {
    let hasCollision = false;
    for (let obj of this.objs) {
      if (thing.rect.intersects(obj.rect)) {
        // Riding on top of the platform
        let seg = obj.rect.topSeg().translate(0, 20);
        if (checkSegObjCollision(thing, seg)) {
          if (cb) {
            cb(obj, seg);
          }
          hasCollision = true;
        }
      }
    }
    return hasCollision;
  }
};

//------------------------------------------------------------------------------
// Smiley

class Smiley {
  constructor(texture) {
    this.sprite =
        Sprite.makeQuad(texture, Mat3.makeTileObj(), Mat3.makeTileTex());
    this.jumpHeight = 100;
    this.jumpTime = 30;
    this.jumpVel = -2 * this.jumpHeight / this.jumpTime;
    this.isJumping = false;
    this.isClimbing = false;
    this.gravity = 2 * this.jumpHeight / Math.pow(this.jumpTime, 2);
    this.framesOffGround = 0;

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
    const coyote = 5;
    if (!this.isJumping && this.framesOffGround <= coyote) {
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
    this.framesOffGround++;

    // Platform collision
    platforms.handleObjCollision(this, (obj, seg) => {
      if (seg.isTop()) {
        this.framesOffGround = 0;
      }
    });

    // Tile collision
    level.handleObjCollision(this, this.isClimbing, (tile, seg) => {
      if (seg.isTop()) {
        this.framesOffGround = 0;
      }
    });

    // Ladders
    let tx = Math.floor(this.x / TILE_SIZE);
    let ty = Math.floor(this.y / TILE_SIZE);
    if (this.isClimbing || keyState.up|| keyState.down) {
      let gid = level.getCollisionCell(tx, ty);
      this.isClimbing = LADDER_GIDS.includes(gid);
      // Try to align horizontally with the ladder if pressing up/down.
      if (this.isClimbing && (keyState.up || keyState.down)) {
        this.dx += ((tx + 0.5) * TILE_SIZE - this.x) * 0.01;
      }
    }

    // Pickups
    let targetSlow = 0.0;
    for (let i = 0; i < pickups.objs.length; ++i) {
      let pickup = pickups.objs[i];
      if (this.rect.intersects(pickup.slowmoRect)) {
        const dist = Math.max(Math.abs(this.x - pickup.x), Math.abs(this.y - pickup.y));
        targetSlow = clamp(0, 1 - (dist - pickup.rect.w) / pickup.slowmoRect.w, 1);
      }

      if (this.rect.intersects(pickup.rect)) {
        pickup.onCollect();
        pickups.objs.splice(i, 1);
        i--;
      }
    }
    slowScale = slowScale*0.95 + targetSlow*0.05;

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

        case 'badge':
          ui.clock.start();
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

  doParticles() {
    for (let i = 0; i < 2; ++i) {
      particles.spawn({
        x: this.x + rand(-1,1)*TILE_SIZE/4, y: this.y + rand(-1,1)*TILE_SIZE/2,
        dx: rand(-0.4, 0.4), dy: rand(-0.4, 0.4),
        life: 30});
    }
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

    const slot = ui.inventory.selectedSlot();
    if (mousePressed.left && slot.count > 0) {
      slot.count--;
      const force = 8;
      let {x, y} = ui.cursor.toWorldPos();
      let invDist = force / dist(this.x, this.y, x, y);
      let throwX = (x - this.x) * invDist;
      let throwY = (y - this.y) * invDist;
      let data = slot.data;
      tossers.push(new Tosser(data, this.x, this.y, throwX, throwY));
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
    this.doParticles();

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
  constructor(kind, x, y, region) {
    this.x = x;
    this.y = y;
    this.lastX = this.x;
    this.lastY = this.y;
    this.radius = 22;
    this.region = region;

    this.data = PICKUP_DATA[kind];
    this.frame = this.data.frame;
    if (kind === 'tomato' && rand(1) < 0.05) {
      // tomato surprise
      this.frame += 10;
    }

    this.rect = Rect.makeCenterRadius(this.x, this.y, TILE_SIZE/2 - 4);
    this.slowmoRect = Rect.makeCenterRadius(this.x, this.y, TILE_SIZE * 1.5);
  }

  draw(batch, dt) {
    batch.pushFrame(lerp(dt, this.x, this.lastX) - this.radius,
                    lerp(dt, this.y, this.lastY) - this.radius, this.frame);
  }

  onCollect() {
    let sfx = assets[randElem(this.data.sounds)];
    if (sfx) {
      playSound(sfx);
    }
    for (let i = 0; i < 375; ++i) {
      let t = rand(2*PI);
      let v = rand(6);
      let c = rand(0.6, 1)
      particles.spawn({
        x: this.x, y: this.y,
        dx: v * Math.cos(t), dy: v * Math.sin(t) - 2,
        r: c*this.data.r, g: c*this.data.g, b: c*this.data.b,
        life: rand(25, 75),
        gravity: 0.2,
      });
    }
    this.region.count--;
    const slot = ui.inventory.slotFor(this.data.frame);
    slot.count++;
  }
}

class Pickups {
  constructor(texture) {
    this.batch = new SpriteBatch(texture);

    this.objs = [];

    this.soupSpawnRegion = {spawnTimer: 0, count: 0, data: null};

    this.spawnRegions = [];
    for (let data of level.pickupRegions) {
      this.spawnRegions.push({
        spawnTimer: 0,
        count: 0,
        data,
      })
    }
    this.spawnDelay = 200;
    this.maxSpawned = 8;
    this.spawnTimer = 0;
  }

  update() {
    // Spawning logic
    for (let region of this.spawnRegions) {
      let data = region.data;
      if (region.count >= data.maxSpawned) {
        // don't tick the timer when at capacity
        continue;
      }
      region.spawnTimer++;
      if (region.spawnTimer < data.spawnDelay) {
        continue;
      }
      region.spawnTimer = 0;
      region.count++;

      let x = rand(data.x, data.x+data.w);
      let y = rand(data.y, data.y+data.h);
      this.objs.push(new Pickup(data.kind, x, y, region));
    }
  }

  draw(shader, dt) {
    this.batch.reset();
    for (let pickup of this.objs) {
      pickup.draw(this.batch, dt);
    }
    this.batch.upload();
    draw(this.batch.sprite, shader);
  }
}

//------------------------------------------------------------------------------
// Tossers

class Tosser {
  constructor(data, x, y, dx, dy) {
    // share w/ smiley
    const jumpHeight = 100;
    const jumpTime = 30;
    const gravity = 2 * jumpHeight / Math.pow(jumpTime, 2);

    this.maxFall = 10;

    this.x = this.lastX = x;
    this.y = this.lastY = y;
    this.dx = dx;
    this.dy = dy;
    this.ddy = gravity;
    this.data = data;
    this.frame = data.frame;
    this.radius = 22;

    this.lifeTime = 180;

    this.drag = 0.85;

    this.rect = Rect.makeCenterRadius(this.x, this.y, this.radius);
  }

  update() {
    this.lastX = this.x;
    this.lastY = this.y;
    this.dy = clamp(-this.maxFall, this.dy + this.ddy, this.maxFall);
    this.x += this.dx;
    this.y += this.dy;
    this.lifeTime--;

    let hasCollision = false;
    hasCollision |= platforms.handleObjCollision(this);
    hasCollision |= level.handleObjCollision(this);
    if (hasCollision) {
      this.dx *= this.drag;
    }

    this.doCollectors();

    this.rect.setTranslate(this.x - this.radius, this.y - this.radius);

    // particles
    for (let i = 0; i < 2; ++i) {
      let c = rand(0.5, 1)
      particles.spawn({
        x: this.x + rand(-1,1)*TILE_SIZE/6, y: this.y + rand(-1,1)*TILE_SIZE/6,
        dx: rand(-0.4, 0.4), dy: rand(-0.4, 0.4),
        r: c*this.data.r, g: c*this.data.g, b: c*this.data.b,
        life: 30});
    }
  }

  draw(batch, dt) {
    batch.pushFrame(lerp(dt, this.x, this.lastX) - this.radius,
                    lerp(dt, this.y, this.lastY) - this.radius, this.frame);
  }

  doCollectors() {
    for (let collector of level.collectors) {
      let matches;
      if (collector.kind === 'crate') {
        matches = this.data.kind === 'soup';
      } else if (collector.kind === 'pot') {
        matches = this.data.kind !== 'soup';
      } else {
        throw 'halp;';
      }
      let rect = new Rect(collector.x, collector.y, collector.w, collector.h);
      if (matches && this.rect.intersects(rect)) {
        this.lifeTime = 0;
        counters.increment(this.data.kind);
      }
    }
  }
}

class Tossers {
  constructor(texture) {
    this.batch = new SpriteBatch(texture);
    this.objs = [];
  }

  push(tosser) {
    this.objs.push(tosser);
  }

  update() {
    for (let i = 0; i < this.objs.length; ++i) {
      const obj = this.objs[i];
      obj.update();
      if (obj.lifeTime <= 0) {
        this.objs.splice(i, 1);
        i--;
      }
    }
  }

  draw(shader, dt) {
    this.batch.reset();
    for (let obj of this.objs) {
      obj.draw(this.batch, dt);
    }
    this.batch.upload();
    draw(this.batch.sprite, shader);
  }
}

//------------------------------------------------------------------------------
// Counters (in-game counters on collectors)

class Counters {
  constructor() {
    this.text = new Text(font);
    this.objs = [];

    for (let data of level.counters) {
      this.objs.push({
        x : data.x,
        y : data.y,
        kind : data.kind,
        count : 0,
      })
    }
  }

  increment(kind) {
    for (let obj of this.objs) {
      if (obj.kind == kind) {
        obj.count++;
      }
    }

    this.tryMake();
  }

  tryMake() {

    const required = 2;
    for (let obj of this.objs) {
      if (obj.kind === 'soup') continue;
      if (obj.count < required) {
        return;
      }
    }

    // OK, we have enough resources
    for (let obj of this.objs) {
      if (obj.kind === 'soup') continue;
      obj.count -= required;
    }

    // TODO: more collectors and spouts?
    let spout = level.spouts[0];

    // Make a can of soup
    pickups.objs.push(
        new Pickup('soup', spout.x + rand(-10, 10), spout.y + rand(-10, 10), pickups.soupSpawnRegion));
  }

  draw(shader, dt) {
    this.text.reset();
    for (let obj of this.objs) {
      // TODO: bold or different color?
      let count = obj.count.toString();
      let textX = obj.x + TILE_SIZE - 24;
      if (count.length > 1) {
        textX -= (count.length - 1) * 20;
      }
      this.text.add(textX, obj.y - 24, count, 2, 2, 0.6);
    }

    this.text.upload();
    this.text.draw(shader, dt);
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

    this.zoom = lerp(slowScale, 1.0, maxZoom);
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

  worldToScreen(x, y, dt = 0) {
    let zoomPosX = smiley.x - this.x;
    let zoomPosY = smiley.y - this.y;
    let curZoom = this.zoom - (this.zoom - this.lastZoom) * dt;
    let camX = -(lerp(dt, this.x, this.lastX) + zoomPosX) * curZoom + zoomPosX;
    let camY = -(lerp(dt, this.y, this.lastY) + zoomPosY) * curZoom + zoomPosY;
    x = (x * curZoom) + camX;
    y = (y * curZoom) + camY;
    return {x, y};
  }

  screenToWorld(x, y, dt = 1) {
    let zoomPosX = smiley.x - this.x;
    let zoomPosY = smiley.y - this.y;
    let curZoom = this.zoom - (this.zoom - this.lastZoom) * dt;
    let camX = -(lerp(dt, this.x, this.lastX) + zoomPosX) * curZoom + zoomPosX;
    let camY = -(lerp(dt, this.y, this.lastY) + zoomPosY) * curZoom + zoomPosY;
    x = (x - camX) / curZoom;
    y = (y - camY) / curZoom;
    return {x, y};
  }
};

//------------------------------------------------------------------------------
// UI

class UI {
  constructor() {
    this.toast = new Toast();
    this.text = new Text(font);
    this.clock = new Clock();
    this.cursor = new Cursor();
    this.inventory = new Inventory();
    this.day = new Day();
  }

  showMessage(message) {
    this.toast.showMessage(message);
  }

  hideMessage() {
    this.toast.hideMessage();
  }

  update() {
    if (ui.cursor) {
      ui.cursor.setPos(mouseScreenX, mouseScreenY);
    }

    this.toast.update();
    this.clock.update();
    this.day.update();
  }

  draw(shader, dt) {
    this.text.reset();
    this.clock.addText(this.text);
    this.text.upload();
    this.text.draw(shader, dt);
    this.toast.draw(shader, dt);
    this.cursor.draw(shader, dt);
    this.inventory.draw(shader, dt);
    this.day.draw(shader, dt);
  }
}

class Day {
  constructor() {
    this.width = 256;
    this.height = 64;
    this.sprite = Sprite.makeQuad(
        assets.days.data.texture,
        Mat3.makeScale(this.width * 2, this.height * 2),
        Mat3.makeScale(this.width / TEX_WIDTH, this.height / TEX_HEIGHT));
    this.started = false;
    this.p0 = null;
    this.p1 = null;

    let left = -this.width;
    let middle = SCREEN_WIDTH * 0.5;
    let right = SCREEN_WIDTH + this.width;
    let y = SCREEN_HEIGHT * 0.5;

    this.points = [
      {x: left, y},
      {x: middle, y},
      {x: middle, y},
      {x: right, y},
    ];
  }

  start(day) {
    this.sprite.texMat.setTranslate(0, day * 64 / TEX_HEIGHT);
    this.started = true;
    this.setIndex(0);
    this.t = 0;
  }

  update() {
    if (!this.started) return;

    this.t = this.t + 0.05;
    let cubic = easeOutCubic(this.t);
    this.x = lerp(cubic, this.p0.x, this.p1.x);
    this.y = lerp(cubic, this.p0.y, this.p1.y);
    this.sprite.objMat.setTranslate(this.x, this.y);

    if (this.t >= 1) {
      this.t -= 1;
      this.setIndex(this.index + 1);
    }
  }

  setIndex(index) {
    if (index == this.points.length - 1) {
      this.started = false;
      return;
    }

    this.index = index;
    this.p0 = this.points[this.index];
    this.p1 = this.points[this.index + 1];
  }

  draw(shader, dt) {
    if (!this.started) return;

    draw(this.sprite, shader);
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
    this.startY = -64;
    this.destY = 0;
    this.t = 0;
  }

  hideMessage() {
    this.startY = this.y;
    this.destY = -64;
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
    this.running = false;
    this.frames = 0;

    this.weekday = 0;
    this.startHour = 7;
    const endHour = 5 + 12;
    this.workdayMinutes = (endHour - this.startHour) * 60;
    this.workdayFrames = 2 * 60 * 60;  // 2 minutes
    this.minutesPerFrame = this.workdayMinutes / this.workdayFrames;

    this.framesPerHour =
        Math.floor(this.workdayFrames / this.workdayMinutes * 60);
  }

  start() {
    this.running = true;
  }

  update() {
    if (!this.running) return;

    this.frames++;
    // One hour left
    if (this.frames + this.framesPerHour == this.workdayFrames) {
      ui.day.start(5);
    }

    if (this.frames >= this.workdayFrames) {
      this.running = false;

      fader.fadeOut(FADE_TIME, () => {
        state = endDayState;
        state.start();
      });

      this.frames = 0;
      this.weekday++;
      if (this.weekday >= 5) {
        // TODO end of week

        this.weekday = 0;
      }
    }
  }

  toString() {
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    let totalMinutes = Math.floor(this.frames * this.minutesPerFrame);
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
    let str = this.toString();
    text.add(SCREEN_WIDTH - str.length * 32, SCREEN_HEIGHT - 32, str, 2, 2);
  }

  workdayFraction() {
    return this.frames / this.workdayFrames;
  }
};

class Cursor {
  constructor() {
    this.sprite = Sprite.makeQuad(assets.sprites.data.texture,
                                  Mat3.makeTileObj(), Mat3.makeTileTex());

    let {x, y} = getSpriteTexPos(2);
    this.sprite.texMat.setTranslate(x, y);
  }

  setPos(x, y) {
    this.x = x;
    this.y = y;
    this.sprite.objMat.setTranslate(x, y);
  }

  draw(shader, dt) {
    draw(this.sprite, shader);
  }

  toWorldPos() {
    return camera.screenToWorld(this.x, this.y);
  }
}

//------------------------------------------------------------------------------
class InventorySlot {
  constructor(data, count) {
    this.data = data;
    this.frame = data.frame;
    this.count = count;
  }
};

class Inventory {
  constructor() {
    this.batch = new SpriteBatch(assets.sprites.data.texture);
    this.text = new Text(font);
    this.selected = 0;

    this.slots = [
      new InventorySlot(PICKUP_DATA.carrot, 0),
      new InventorySlot(PICKUP_DATA.tomato, 0),
      new InventorySlot(PICKUP_DATA.chicken, 0),
      new InventorySlot(PICKUP_DATA.soup, 0),
      new InventorySlot(PICKUP_DATA.badge, null),
    ];

    this.margin = 4;
    this.x =
        (SCREEN_WIDTH - this.slots.length * (TILE_SIZE + this.margin)) * 0.5;
    this.y = SCREEN_HEIGHT - TILE_SIZE;
  }

  draw(shader, dt) {
    let x = this.x;
    let y = this.y;
    let dx = TILE_SIZE + this.margin;

    this.batch.reset();
    this.text.reset();
    for (let i = 0; i < this.slots.length; ++i) {
      let slot = this.slots[i];
      const boxFrame = i == this.selected ? 5 : 4;
      this.batch.pushFrame(x, y, boxFrame);
      this.batch.pushFrame(x, y, slot.frame);

      this.text.add(x, y, (i + 1).toString());

      if (slot.count !== null) {
        // TODO: bold or different color?
        let count = (slot.count).toString();
        let textX = x + TILE_SIZE - 32;
        if (count.length > 1) {
          textX -= (count.length - 1) * 20;
        }
        this.text.add(textX, y + TILE_SIZE - 32, count, 2, 2, 0.6);
      }

      x += dx;
    }

    this.batch.upload();
    this.text.upload();
    this.batch.draw(shader, dt);
    this.text.draw(shader, dt);
  }

  selectedSlot() {
    return this.slots[this.selected];
  }
  slotFor(frame) {
    for (let slot of this.slots) {
      if (slot.frame == frame) {
        return slot;
      }
    }
    throw 'heck';
  }
};

//------------------------------------------------------------------------------
class Fader {
  constructor() {
    this.sprite = Sprite.makeEmptyBuffer(null);
    this.fading = false;
    this.t = 0;
    this.dt = 0;
    this.color = [0, 0, 0, 0];
    this.cb = null;
  }

  startFade(secs, start, end, cb) {
    this.startColor = start;
    this.endColor = end;
    this.fading = true;
    this.cb = cb;
    this.dt = 1 / (secs * 60);
  }

  fadeIn(secs, cb) {
    this.startFade(secs, [0, 0, 0, 1], [0, 0, 0, 0], cb);
  }

  fadeOut(secs, cb) {
    this.startFade(secs, [0, 0, 0, 0], [0, 0, 0, 1], cb);
  }

  update() {
    if (!this.fading) return;

    this.t += this.dt;
    if (this.t >= 1) {
      this.t = 0;
      this.fading = false;
      this.cb();
      return;
    }

    this.color = [
      lerp(this.t, this.startColor[0], this.endColor[0]),
      lerp(this.t, this.startColor[1], this.endColor[1]),
      lerp(this.t, this.startColor[2], this.endColor[2]),
      lerp(this.t, this.startColor[3], this.endColor[3]),
    ];
  }

  draw(dt) {
    if (!this.fading) return;

    let [r, g, b, a] = this.color;

    let buffer = this.sprite.buffer;
    buffer.reset();
    buffer.pushColor(0, 0, r, g, b, a);
    buffer.pushColor(0, SCREEN_HEIGHT, r, g, b, a);
    buffer.pushColor(SCREEN_WIDTH, 0, r, g, b, a);
    buffer.pushColor(SCREEN_WIDTH, SCREEN_HEIGHT, r, g, b, a);
    buffer.upload();

    draw(this.sprite, colorShader);
  }
};

//------------------------------------------------------------------------------
// Game states

class TitleState {
  constructor() {
    this.scale = 3;
    this.sprite = Sprite.makeQuad(
        assets.title.data.texture, Mat3.makeScale(SCREEN_WIDTH, SCREEN_HEIGHT),
        Mat3.makeScale(SCREEN_WIDTH / (this.scale * TEX_WIDTH),
                       SCREEN_HEIGHT / (this.scale * TEX_HEIGHT)));
    this.text = new Text(font);
  }

  start() {
  }

  update() {
    if (!fader.isFading && keyPressed.jump) {
      fader.fadeOut(FADE_TIME, () => {
        state = gameState;
        state.start();
      });
    }
  }

  draw(dt) {
    gl.clearColor(0.1, 0.1, 0.1, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let message = 'Press SPACE';
    this.text.reset();
    this.text.add((SCREEN_WIDTH - message.length * 48) * 0.5,
                  SCREEN_HEIGHT - 100, message, 3, 3);
    this.text.upload();

    camMat = mat3Id;
    this.text.draw(shader, dt);
    this.sprite.objMat.setTranslate(SCREEN_WIDTH * 0.5, SCREEN_HEIGHT * 0.5);

    draw(this.sprite, shader);

  }
};

class GameState {
  constructor() {
    level = assets.factory.data;

    smiley = new Smiley(assets.sprites.data.texture);
    ui = new UI();

    platforms = new Platforms(assets.factoryTiles.data.texture);
    pickups = new Pickups(assets.sprites.data.texture);
    tossers = new Tossers(assets.sprites.data.texture);
    counters = new Counters();

    camera = new Camera();
    particles = new ParticleSystem();
  }

  start() {
    fader.fadeIn(FADE_TIME, () => {
      ui.day.start(ui.clock.weekday);
    });
  }

  update() {
    // Debug stuff
    if (mousePressed.right) {
      let {x, y} = ui.cursor.toWorldPos();
      let tx = Math.floor(x / TILE_SIZE);
      let ty = Math.floor(y / TILE_SIZE);
      let segs = level.getSegs(tx, ty);
      let msg = `pos: ${tx}, ${ty}\n`;
      if (segs) {
        for (let [name, seg] of Object.entries(segs)) {
          if (seg) {
            msg += `    ${name}: x0:${seg.x0} y0:${seg.y0} x1:${seg.x1} y1:${seg.y1}\n`;
          }
        }
      }
      console.log(msg);
    }

    smiley.update();

    camera.update();
    particles.update();
    platforms.update();
    pickups.update();
    tossers.update();
    ui.update();
  }

  draw(dt) {
    let clearColor = gradientLerp(ui.clock.workdayFraction(), [
      // todo: light blue -> blue -> orange-red
      {r : 0.2, g : 0.3, b : 1.0},
      {r : 0.3, g : 0.8, b : 1.0},
      {r : 0.4, g : 0.9, b : 1.0},
      {r : 0.7, g : 0.3, b : 0.8},
      {r : 0.5, g : 0.1, b : 0.5},
      {r : 0.2, g : 0.1, b : 0.3},
    ]);
    gl.clearColor(clearColor.r, clearColor.g, clearColor.b, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    camera.draw(dt);

    camMat = camera.mat;
    draw(level.sprite, shader);

    platforms.draw(shader, dt);
    smiley.draw(shader, dt);
    pickups.draw(shader, dt);
    tossers.draw(shader, dt);
    counters.draw(shader, dt);

    camMat = Mat3.makeTranslate(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2);
    particles.draw(shader, camera, dt);

    camMat = mat3Id;
    ui.draw(shader, dt);
  }
}

class EndDayState {
  constructor() {
    this.running = false;
    this.t = 0;

    let w = SCREEN_WIDTH;

    this.objs = [
      this.makeTitleObj(0, 0.3, -512, w * 0.5, 128),
      this.makeTextObj('carrot', 0.5, 0.7, -512, (w - 7 * 32) * 0.5, 256),
      this.makeSpriteObj(PICKUP_DATA.carrot.frame, 0.5, 0.7, -512,
                         w * 0.5 + 4 * 32, 272),

      this.makeTextObj('tomato', 0.7, 0.9, -512, (w - 7 * 32) * 0.5, 320),
      this.makeSpriteObj(PICKUP_DATA.tomato.frame, 0.7, 0.9, -512,
                         w * 0.5 + 4 * 32, 336),

      this.makeTextObj('chicken', 0.9, 1.1, -512, (w - 9 * 32) * 0.5, 384),
      this.makeSpriteObj(PICKUP_DATA.chicken.frame, 0.9, 1.1, -512,
                         w * 0.5 + 4 * 32, 400),

      this.makeTextObj('soup', 1.1, 1.3, -512, (w - 4 * 32) * 0.5, 448),
      this.makeSpriteObj(PICKUP_DATA.soup.frame, 1.1, 1.3, -512,
                         w * 0.5 + 4 * 32, 464),

      // carrots
      this.makeTextObj('0', 1.5, 1.7, w, (w + 12 * 32) * 0.5, 256),

      // tomato
      this.makeTextObj('0', 1.7, 1.9, w, (w + 12 * 32) * 0.5, 320),

      // chicken
      this.makeTextObj('0', 1.9, 2.1, w, (w + 12 * 32) * 0.5, 384),

      // soup
      this.makeTextObj('0', 2.1, 2.3, w, (w + 12 * 32) * 0.5, 448),

      this.makeTextObj('PRESS SPACE', 2.5, 2.7, -512, (w - 12 * 32) * 0.5, 600),
    ]
  }

  makeTitleObj(startTime, endTime, startX, endX, y) {
    // End of Day
    let sprite = Sprite.makeQuad(
        assets.days.data.texture,
        Mat3.makeScale(512, 128),
        Mat3.makeScale(256 / TEX_WIDTH, 64 / TEX_HEIGHT));
    sprite.texMat.setTranslate(0, 6 * 64 / TEX_HEIGHT);

    sprite.objMat.setTranslate(startX, y);

    return {sprite, startTime, endTime, startX, endX, y};
  }

  makeSpriteObj(frame, startTime, endTime, startX, endX, y) {
    let sprite = Sprite.makeQuad(assets.sprites.data.texture,
                                 Mat3.makeTileObj(), Mat3.makeTileTex());

    let texPos = getSpriteTexPos(frame);
    sprite.texMat.setTranslate(texPos.x, texPos.y);

    sprite.objMat.setTranslate(startX, y);

    return {sprite, startTime, endTime, startX, endX, y};
  }

  makeTextObj(message, startTime, endTime, startX, endX, y) {
    let text = new Text(font);
    text.set(0, 0, message, 2, 2);

    text.sprite.objMat.setTranslate(startX, y);

    return {sprite: text.sprite, message, startTime, endTime, startX, endX, y};
  }

  start() {
    fader.fadeIn(FADE_TIME, () => {
      this.running = true;
    });
  }

  update() {
    if (!this.running) return;

    this.t += 1/60;

    for (let obj of this.objs) {
      if (this.t >= obj.startTime)  {
        let tscale = (this.t - obj.startTime) / (obj.endTime - obj.startTime);
        tscale = Math.min(tscale, 1);
        let cubic = easeOutCubic(tscale);

        obj.sprite.objMat.setTranslate(lerp(tscale, obj.startX, obj.endX),
                                       obj.y);
      }
    }

    if (this.t < 3 && keyPressed.jump) {
      this.t = 3;
    } else if (this.t >= 3 && keyPressed.jump) {
      fader.fadeOut(FADE_TIME, () => {
        state = gameState;
        state.start();
      });
    }
  }

  draw() {
    gl.clearColor(0.1, 0.1, 0.1, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    camMat = mat3Id;

    if (!this.running) return;

    for (let obj of this.objs) {
      draw(obj.sprite, shader);
    }
  }
}

//------------------------------------------------------------------------------

async function start() {
  initGl();
  initAudio();

  await loadAssets();

  shader = makeTextureShader();
  colorShader = makeColorShader();
  font = makeFont();

  document.onkeydown = onKeyDown;
  document.onkeyup = onKeyUp;
  canvas.onmousemove = onMouseEvent;
  canvas.onmousedown = onMouseEvent;
  canvas.onmouseup = onMouseEvent;

  fader = new Fader();

  titleState = new TitleState();
  gameState = new GameState();
  endDayState = new EndDayState();

  state = titleState;
  state.start();

  const updateMs = 16.6;
  let lastTimestamp;
  let updateRemainder = updateMs + 1;
  function tick(timestamp) {
    requestAnimationFrame(tick);

    if (lastTimestamp === undefined) { lastTimestamp = timestamp; }
    let elapsed = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    let timeScale = lerp(slowScale, 1.0, maxSlow);
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
      updateMouse();

      state.update();
      fader.update();
    }

    let dt = 1 - updateRemainder / updateMs;
    state.draw(dt);
    fader.draw(dt);
  }
  requestAnimationFrame(tick);
};

start();
