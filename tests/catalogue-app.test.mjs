// Smoke the scene coordinator without a browser or GPU. These are logic tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (name) => fs.readFileSync(new URL('../dist/' + name, import.meta.url), 'utf8');
const appSource = read('app.js').replace(/^import .*;\n/gm, '');
const sequenceSource = read('sequence.js').replace(/^export /gm, '');
const catalogSource = read('scenes.js').replace(/^export /gm, '');
const flush = async () => {
  for (let i = 0; i < 150; i++) await Promise.resolve();
};

function setup({ missing = false, query = '' } = {}) {
  const elements = new Map();
  const defaults = {
    seqBuffer: '4',
    seqFPS: '30',
    seqRotation: '0',
    seqAssign: 'res8',
    speed: '3',
  };
  class Element {
    constructor() {
      this.value = '';
      this.children = [];
      this.style = {};
      this.checked = true;
      this.classList = {
        remove() {},
        toggle() {},
        contains() {
          return false;
        },
      };
      this.clientWidth = 900;
      this.clientHeight = 700;
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    prepend(node) {
      this.children.unshift(node);
    }
    replaceChildren(...nodes) {
      this.children = nodes;
    }
    setAttribute() {}
    addEventListener() {}
    remove() {}
    focus() {}
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const e = new Element();
        e.value = defaults[id] || '';
        elements.set(id, e);
      }
      return elements.get(id);
    },
    createElement() {
      return new Element();
    },
    body: new Element(),
    addEventListener() {},
  };
  class Vector {
    constructor(x = 0, y = 0, z = 0) {
      Object.assign(this, { x, y, z });
    }
    clone() {
      return new Vector(this.x, this.y, this.z);
    }
    copy(v) {
      Object.assign(this, { x: v.x, y: v.y, z: v.z });
      return this;
    }
    set(x, y, z) {
      Object.assign(this, { x, y, z });
      return this;
    }
    fromArray(a) {
      return this.set(...a);
    }
    add() {
      return this;
    }
    addScaledVector() {
      return this;
    }
    normalize() {
      return this;
    }
    applyQuaternion() {
      return this;
    }
    length() {
      return 1;
    }
  }
  class Group {
    constructor() {
      this.position = new Vector();
      this.quaternion = new Vector();
      this.rotation = new Vector();
      this.scale = { setScalar() {} };
      this.visible = true;
      this.children = [];
      this.matrixWorld = {};
    }
    add(m) {
      this.children.push(m);
    }
    remove(m) {
      this.children = this.children.filter((n) => n !== m);
    }
    updateWorldMatrix() {}
  }
  class Scene extends Group {}
  const staticUrls = [];
  let uuid = 0;
  class SplatMesh extends Group {
    constructor(options) {
      super();
      this.uuid = String(uuid++);
      this.paged = options.paged;
      this.recolor = { set() {} };
      this.initialized = Promise.resolve(this);
      if (options.url) staticUrls.push(options.url);
    }
    dispose() {}
    getBoundingBox() {
      return {
        min: { x: 0 },
        clone() {
          return this;
        },
        applyMatrix4() {
          return this;
        },
        isEmpty() {
          return false;
        },
        getCenter() {
          return new Vector();
        },
        getSize() {
          return new Vector(1, 1, 1);
        },
      };
    }
  }
  class Renderer {
    constructor() {
      this.domElement = new Element();
    }
    setPixelRatio() {}
    setSize() {}
    setAnimationLoop() {}
    getPixelRatio() {
      return 1;
    }
  }
  class Camera extends Group {
    constructor() {
      super();
      this.up = new Vector(0, 1, 0);
    }
    updateProjectionMatrix() {}
    getWorldDirection() {
      return new Vector(0, 0, -1);
    }
  }
  class Controls {
    constructor() {
      this.target = new Vector();
    }
    update() {}
  }
  class SparkControls {
    constructor() {
      this.fpsMovement = {};
      this.pointerControls = {
        scroll: new Vector(),
        rotateVelocity: new Vector(),
        moveVelocity: new Vector(),
      };
    }
  }
  const location = { href: 'https://user.github.io/project/' + query, search: query };
  const requests = [];
  const context = vm.createContext({
    document,
    location,
    URL,
    URLSearchParams,
    AbortController,
    performance,
    console,
    setTimeout,
    history: {
      replaceState(a, b, url) {
        location.href = String(url);
      },
    },
    Option: class extends Element {
      constructor(text, value) {
        super();
        this.textContent = text;
        this.value = value;
      }
    },
    window: { addEventListener() {} },
    ResizeObserver: class {
      observe() {}
    },
    THREE: {
      Scene,
      Group,
      Vector3: Vector,
      Color: class {
        set() {}
      },
      PerspectiveCamera: Camera,
      WebGLRenderer: Renderer,
      MathUtils: { degToRad: (x) => (x * Math.PI) / 180, radToDeg: (x) => (x * 180) / Math.PI },
    },
    OrbitControls: Controls,
    SparkControls,
    SplatMesh,
    SparkRenderer: class {
      constructor(options) {
        Object.assign(this, options);
      }
    },
    fetch: async (url) => {
      requests.push(url);
      return {
        ok: !missing,
        status: missing ? 404 : 200,
        arrayBuffer: async () => new ArrayBuffer(10),
      };
    },
  });
  vm.runInContext(catalogSource + '\n' + sequenceSource + '\n' + appSource, context);
  return { context, requests, staticUrls, $: (id) => document.getElementById(id) };
}

test('opening the site starts hosted redandblack with visible resolution controls', async () => {
  const h = setup();
  await flush();
  assert.match(h.requests[0], /\/project\/data\/redandblack-pages\/res8\/001450.ply$/);
  assert.equal(h.$('scenePicker').value, 'redandblack');
  assert.equal(h.$('quickSequence').hidden, false);
  assert.equal(h.$('quickResolution').value, 'res8');
  assert.match(h.$('quickPlay').textContent, /Tạm dừng/);
  assert.equal(h.staticUrls.length, 0);
  await vm.runInContext("selectScene('spaceship')", h.context);
  await flush();
  assert.equal(h.$('quickSequence').hidden, true);
  assert.match(h.staticUrls.at(-1), /cozy-spaceship/);
});

test('missing PLY falls back to a real sample and keeps an honest data notice', async () => {
  const h = setup({ missing: true });
  await flush();
  assert.equal(h.$('scenePicker').value, 'butterfly');
  assert.equal(h.$('datasetNotice').hidden, false);
  assert.match(h.$('datasetNotice').textContent, /chưa sẵn sàng/);
  assert.equal(h.staticUrls.at(-1), 'https://sparkjs.dev/assets/splats/butterfly.spz');
  assert.equal(h.$('quickSequence').hidden, true);
});

test('shared scene/resolution links select the requested data instead of res8', async () => {
  const h = setup({ query: '?scene=redandblack&res=res2' });
  await flush();
  assert.match(h.requests[0], /\/res2\/001450.ply$/);
  assert.equal(h.$('quickResolution').value, 'res2');
});
