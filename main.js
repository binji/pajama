const SCREEN_WIDTH = 480;
const SCREEN_HEIGHT = 270;
const TEX_WIDTH = 512;
const TEX_HEIGHT = 512;

const noPos = {x: 0, y: 0};
const noScale = {x: 1, y: 1};
const id3x3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

let gl;

function clamp(min, x, max) {
  return Math.min(Math.max(x, min), max);
}

//------------------------------------------------------------------------------
// Asset loading

let assets = {
  sprites: {filename: 'sprites.png', type: 'image', data: null},
  tiles: {filename: 'tiles.png', type: 'image', data: null},
  font: {filename: 'font.png', type: 'image', data: null},

  level: {filename: 'testing.json', type: 'json', data: null},

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

async function loadAssets() {
  let promises = [];
  for (let name of Object.keys(assets)) {
    let asset = assets[name];
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
    }
  }

  await Promise.all(promises);
}

//------------------------------------------------------------------------------

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

function makeQuad(texture) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -0.5, -0.5,  0, 0,
    -0.5, +0.5,  0, 1,
    +0.5, -0.5,  1, 0,
    +0.5, +0.5,  1, 1,
  ]), gl.STATIC_DRAW);

  return {first: 0, count: 4, buffer, texture};
}

function getSpriteTexPos(index) {
  const margin = 1;
  const spacing = 2;
  const tileSize = 48;
  const columns = 10;

  return {
    x: ((index % columns) * (tileSize + spacing) + margin) / TEX_WIDTH,
    y: (Math.floor(index / columns) * (tileSize + spacing) + margin) / TEX_HEIGHT
  };
}

function makeTexMat3x3(texPos, w, h) {
  return new Float32Array([
    w / TEX_WIDTH, 0, 0,
    0, h / TEX_HEIGHT, 0,
    texPos.x, texPos.y, 0,
  ]);
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

function setTileCoord(data, i, x, y, u, v, dx, dy, du, dv) {
  data[i * 6 * 4 + 0] = x; // TL x
  data[i * 6 * 4 + 1] = y; // TL y
  data[i * 6 * 4 + 2] = u; // TL u
  data[i * 6 * 4 + 3] = v; // TL v

  data[i * 6 * 4 + 4] = x; // TL x
  data[i * 6 * 4 + 5] = y; // TL y
  data[i * 6 * 4 + 6] = u; // TL u
  data[i * 6 * 4 + 7] = v; // TL v

  data[i * 6 * 4 + 8] = x;      // BL x
  data[i * 6 * 4 + 9] = y + dy; // BL y
  data[i * 6 * 4 + 10] = u;      // BL u
  data[i * 6 * 4 + 11] = v + dv; // BL v

  data[i * 6 * 4 + 12] = x + dx;  // TR x
  data[i * 6 * 4 + 13] = y;       // TR y
  data[i * 6 * 4 + 14] = u + du; // TR u
  data[i * 6 * 4 + 15] = v;      // TR v

  data[i * 6 * 4 + 16] = x + dx; // BR x
  data[i * 6 * 4 + 17] = y + dy; // BR y
  data[i * 6 * 4 + 18] = u + du; // BR u
  data[i * 6 * 4 + 19] = v + dv; // BR v

  data[i * 6 * 4 + 20] = x + dx; // BR x
  data[i * 6 * 4 + 21] = y + dy; // BR y
  data[i * 6 * 4 + 22] = u + du; // BR u
  data[i * 6 * 4 + 23] = v + dv; // BR v
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
      setTileCoord(data, i, x, y, u, v, dx, dy, du, dv);
    }
    x += dx;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

  return {first: 0, count, buffer, texture: font.texture};
}

function destroyText(sprite) {
  gl.deleteBuffer(sprite.buffer);
}

function makeTextureShader() {
  const vertexShader = compileShader(gl.VERTEX_SHADER,
     `uniform vec2 uPos;
      uniform vec2 uScale;
      uniform vec2 uCamera;
      uniform mat3 uTexMat;

      attribute vec2 aPos;
      attribute vec2 aTexCoord;
      varying highp vec2 vTexCoord;

      void main(void) {
        vec2 pos = vec2((aPos.x * uScale.x + uPos.x - uCamera.x) / 240.0 - 1.0,
                         1.0 - (aPos.y * uScale.y + uPos.y - uCamera.y)  / 135.0);
        gl_Position = vec4(pos, 0.0, 1.0);
        vTexCoord = (uTexMat * vec3(aTexCoord, 1)).xy;
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
  const uCamera = gl.getUniformLocation(program, 'uCamera');
  const uTexMat = gl.getUniformLocation(program, 'uTexMat');

  return {program, aPos, aTexCoord, uSampler, uPos, uScale, uCamera, uTexMat};
}

function draw(sprite, shader, pos = noPos, scale = noScale, texMat = id3x3) {
  if (!sprite) return;

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
  gl.uniform2f(shader.uCamera, cam.x, cam.y);
  gl.uniformMatrix3fv(shader.uTexMat, false, texMat);

  gl.drawArrays(gl.TRIANGLE_STRIP, sprite.first, sprite.count);
}

function uploadTex(texture, data) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

function playSound(asset) {
  asset.data.play();
}

const accel = 0.55;
const drag = 0.85;
const maxvel = 3;
let smilepos = {x: 300, y: 300};
let ddsmile = {x: 0, y: 0};
let dsmile = {x: 0, y: 0};

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
      ddsmile.x = -accel;
      break;
    case 'ArrowRight':
      ddsmile.x = +accel;
      break;
    case 'ArrowUp':
      ddsmile.y = -accel;
      break;
    case 'ArrowDown':
      ddsmile.y = +accel;
      break;
  }
}

function onKeyUp(event) {
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowRight':
      ddsmile.x = 0;
      break;

    case 'ArrowUp':
    case 'ArrowDown':
      ddsmile.y = 0;
      break;
  }
}

let level = {
  data : null,
  tiles : {},
  sprite : null,
  width: 0,
  height: 0,
  messages: [],
};
function loadLevel() {
  level.data = assets.level.data;
  level.sprite = {};

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
  level.sprite.texture = makeTexture(assets.tiles);

  // generate render buffer
  level.sprite.first = 0;
  level.sprite.count = 0;
  level.width = 0;
  level.height = 0;
  for (let layer of level.data.layers) {
    if (layer.type != 'tilelayer') continue;
    level.width = Math.max(level.width, layer.width) * tileset.tilewidth;
    level.height = Math.max(level.height, layer.height) * tileset.tileheight;
    for (let tile of layer.data) {
      if (tile != 0) {
        level.sprite.count += 6;
      }
    }
  }

  level.sprite.buffer = gl.createBuffer();

  const dx = 48;
  const dy = 48;
  const du = tileset.tilewidth / tileset.imagewidth;
  const dv = tileset.tileheight / tileset.imageheight;
  const data = new Float32Array(level.sprite.count * 4);
  let p = 0;

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
        setTileCoord(data, p, x, y, u, v, dx, dy, du, dv);
        p++;
      }
    }
  }

  // Handle object layer
  for (let layer of level.data.layers) {
    if (layer.type != 'objectgroup') continue;

    for (let object of layer.objects) {
      switch (object.type) {
        case 'player':
          smilepos.x = object.x;
          smilepos.y = object.y;
          break;

        case 'message':
          level.messages.push({
            x: object.x, y: object.y,
            w: object.width, h: object.height,
            message: object.properties[0].value,
          });
          break;

        default:
          throw 'what';
      }
    }
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, level.sprite.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
}

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

function smileyCollision() {
  const boxSegs = [
    {x0: 0, y0: 0, x1: 48, y1: 0},  // top
    {x0: 0, y0: 0, x1: 0, y1: 48},  // left
    {x0: 0, y0: 48, x1: 48, y1: 48},  // bottom
    {x0: 48, y0: 0, x1: 48, y1: 48},  // right
  ];
  const dirs = [
    {x: -1, y: -1},
    {x: -1, y:  0},
    {x: -1, y: +1},
    {x:  0, y: -1},
    {x:  0, y: +1},
    {x: +1, y: -1},
    {x: +1, y:  0},
    {x: +1, y: +1},
  ];
  let px = smilepos.x;
  let py = smilepos.y;
  let rad = 22; // a little less than tile width / 2
  let rad2 = rad * rad;
  let tx = Math.floor(px / 48);
  let ty = Math.floor(py / 48);
  let layer = assets.level.data.layers[1];

  function getCell(x, y) {
    if (x < 0 || x >= layer.width || y < 0 || y >= layer.height) { return 0; }
    return layer.data[y * layer.width + x];
  }

  for (let dir of dirs) {
    let tile = getCell(tx + dir.x, ty + dir.y);
    if (!tile) continue;

    for (let seg of boxSegs) {
      let left = (tx + dir.x) * 48;
      let top = (ty + dir.y) * 48;
      let {dist2, ix, iy} = distToLineSegment2(
        px, py,
        seg.x0 + left, seg.y0 + top,
        seg.x1 + left, seg.y1 + top
      );

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

  smilepos.x = px;
  smilepos.y = py;
}

let font;
let text;

function smileyMessages() {
  for (let message of level.messages) {
    if (smilepos.x >= message.x && smilepos.x < message.x + message.w &&
        smilepos.y >= message.y && smilepos.y < message.y + message.h) {
      destroyText(text);
      text = makeText(font, message.message);
      break;
    }
  }
}

//------------------------------------------------------------------------------

let cam;
let camPushBox = {l:SCREEN_WIDTH * 0.25, r:SCREEN_WIDTH * 0.75,
                  t:SCREEN_HEIGHT * 0.35, b:SCREEN_HEIGHT * 0.65};

async function start() {
  await loadAssets();

  // music should loop
  assets.doots.data.loop = true;
  assets.doots.data.volume = 0; // set to 0 so first M press will set to 1

  initGl();
  const shader = makeTextureShader();
  font = makeFont();
  text = makeText(font, 'find ice; M is for music');
  const spriteTexture = makeTexture(assets.sprites);
  const quad = makeQuad(spriteTexture);

  const smiley = makeTexMat3x3(getSpriteTexPos(0), 48, 48);
  const smileyBlink = makeTexMat3x3(getSpriteTexPos(1), 48, 48);

  document.onkeydown = onKeyDown;
  document.onkeyup = onKeyUp;

  loadLevel();

  let camUI = {x: 0, y: 0};
  let camGame = {x: 0, y: 0};

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
      dsmile.x = clamp(-maxvel, (dsmile.x + ddsmile.x) * drag, maxvel);
      dsmile.y = clamp(-maxvel, (dsmile.y + ddsmile.y) * drag, maxvel);
      smilepos.x += dsmile.x;
      smilepos.y += dsmile.y;

      smileyCollision();
      smileyMessages();

      if (smilepos.x - camGame.x < camPushBox.l) {
        camGame.x = Math.max(0, smilepos.x - camPushBox.l);
      } else if (smilepos.x - camGame.x > camPushBox.r) {
        camGame.x = Math.min(level.width - SCREEN_WIDTH, smilepos.x - camPushBox.r);
      }

      if (smilepos.y - camGame.y < camPushBox.t) {
        camGame.y = Math.max(0, smilepos.y - camPushBox.t);
      } else if (smilepos.y - camGame.y > camPushBox.b) {
        camGame.y = Math.min(level.height - SCREEN_HEIGHT, smilepos.y - camPushBox.b);
      }
    }

    cam = camGame;
    draw(level.sprite, shader);

    draw(quad, shader, smilepos, {x: 48, y: 48},
         Math.random() < 0.01 ? smileyBlink : smiley);

    cam = camUI;
    draw(text, shader, {x: 10, y: 10});
  }
  requestAnimationFrame(tick);
};

start();
