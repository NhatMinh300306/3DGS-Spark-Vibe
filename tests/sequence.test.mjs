import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const moduleFromFile = (path) =>
  import(
    'data:text/javascript;base64,' +
      fs.readFileSync(new URL(path, import.meta.url)).toString('base64')
  );
const { groupFiles, buildRemoteGroups, initSequence } = await moduleFromFile('../dist/sequence.js');
const { sceneCatalog, viewerSettings } = await moduleFromFile('../dist/scenes.js');
const flush = async () => {
  for (let step = 0; step < 120; step += 1) await Promise.resolve();
};
const file = (name, folder = '') => ({
  name,
  webkitRelativePath: `${folder}/${name}`,
  arrayBuffer: async () => new ArrayBuffer(10),
});
const config = {
  baseUrl: './data/redandblack-pages/',
  resolutions: ['res1', 'res2', 'res4', 'res8'],
  firstFrame: 1450,
  lastFrame: 1479,
  padding: 6,
  defaultResolution: 'res8',
  fps: 30,
};

function harness(fetchOverride) {
  const nodes = new Map();
  const values = { seqBuffer: '4', seqFPS: '30', seqRotation: '0', seqAssign: 'res8' };
  globalThis.document = {
    getElementById(id) {
      if (!nodes.has(id))
        nodes.set(id, {
          value: values[id] || '',
          checked: true,
          textContent: '',
          children: [],
          replaceChildren() {
            this.children = [];
          },
          append(child) {
            this.children.push(child);
          },
        });
      return nodes.get(id);
    },
    createElement() {
      return {};
    },
  };
  globalThis.location = { href: 'https://user.github.io/project/' };
  const requests = [];
  globalThis.fetch =
    fetchOverride ||
    (async (url) => {
      requests.push(url);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(10) };
    });
  const meshes = new Set();
  const root = {
    visible: true,
    rotation: { x: 0 },
    add(mesh) {
      meshes.add(mesh);
    },
    remove(mesh) {
      meshes.delete(mesh);
    },
  };
  let alive = 0,
    peak = 0,
    fits = 0;
  class Mesh {
    constructor(options) {
      this.name = options.fileName;
      this.initialized = Promise.resolve(this);
      alive++;
      peak = Math.max(peak, alive);
    }
    dispose() {
      assert(!this.disposed, 'mesh disposed twice');
      this.disposed = true;
      alive--;
    }
  }
  const player = initSequence({
    THREE: {
      Group: class {
        constructor() {
          return root;
        }
      },
      MathUtils: { degToRad: (x) => (x * Math.PI) / 180 },
    },
    SplatMesh: Mesh,
    scene: { add() {} },
    fitMesh() {
      fits++;
    },
    setNavigation() {},
    onOpen() {},
  });
  return {
    player,
    $: (id) => document.getElementById(id),
    meshes,
    requests,
    get alive() {
      return alive;
    },
    get peak() {
      return peak;
    },
    get fits() {
      return fits;
    },
  };
}

test('catalogue retains all samples and uses project-relative PLY URLs', () => {
  assert.equal(viewerSettings.defaultSceneId, 'redandblack');
  assert.deepEqual(
    sceneCatalog
      .filter((s) => s.type === 'static')
      .map((s) => s.id)
      .sort(),
    ['butterfly', 'hobbit', 'poland', 'spaceship', 'tower'],
  );
  const groups = buildRemoteGroups(config, 'https://user.github.io/project/?scene=redandblack');
  assert.equal(Object.keys(groups).length, 4);
  assert.equal(groups.res8.length, 30);
  assert.equal(
    groups.res8[0].url,
    'https://user.github.io/project/data/redandblack-pages/res8/001450.ply',
  );
  assert.equal(groups.res1[29].name, '001479.ply');
  assert.throws(() => buildRemoteGroups({ ...config, firstFrame: 2000 }, 'https://example.com/'));
  assert.throws(() =>
    buildRemoteGroups({ ...config, baseUrl: 'file:///tmp/' }, 'https://example.com/'),
  );
  assert.equal(
    buildRemoteGroups(
      { ...config, baseUrl: 'https://data.example.com/scans/' },
      'https://user.github.io/project/',
    ).res8[0].url,
    'https://data.example.com/scans/res8/001450.ply',
  );
});

test('local sequences are naturally sorted and duplicates are rejected', () => {
  assert.deepEqual(
    groupFiles([file('10.ply'), file('2.ply')]).res8.map((f) => f.name),
    ['2.ply', '10.ply'],
  );
  assert.equal(groupFiles([file('1.ply', 'root/res4')]).res4.length, 1);
  assert.throws(() => groupFiles([file('1.ply'), file('1.ply')]));
});

test('hosted autoplay, playback, resolution, seek and cleanup stay bounded', async () => {
  const h = harness();
  assert.equal(
    await h.player.loadRemote(config, { id: 'redandblack', name: 'Redandblack', autoplay: true }),
    true,
  );
  await flush();
  assert.equal(h.player.state().playing, true);
  assert.equal(h.fits, 1);
  assert.equal(
    h.requests[0],
    'https://user.github.io/project/data/redandblack-pages/res8/001450.ply',
  );
  let now = performance.now() + 100;
  for (let i = 0; i < 40; i++) {
    h.player.tick((now += 100));
    await flush();
    assert.equal([...h.meshes].filter((m) => m.visible).length, 1);
    assert(h.player.state().buffered <= 4);
    assert(h.alive <= 4);
  }
  const name = h.player.state().frameName;
  await h.player.selectResolution('res1');
  await flush();
  assert.equal(h.player.state().frameName, name);
  assert.equal(h.player.state().playing, true);
  assert.equal(h.fits, 1, 'camera preserved between resolutions');
  h.$('seqSeek').value = '29';
  h.$('seqSeek').oninput();
  h.$('seqSeek').value = '4';
  h.$('seqSeek').oninput();
  await flush();
  assert.equal(h.player.state().index, 4);
  assert.equal(h.player.state().playing, false);
  assert(h.alive <= 4);
  h.player.deactivate();
  await flush();
  assert.equal(h.alive, 0);
  assert.equal(h.player.state().visible, false);
  h.player.clear();
  assert.equal(h.player.state().frameCount, 0);
});

test('a missing hosted frame reports HTTP and never pretends to play', async () => {
  const h = harness(async () => ({ ok: false, status: 404 }));
  assert.equal(await h.player.loadRemote(config, { autoplay: true }), false);
  assert.equal(h.player.state().playing, false);
  assert.equal(h.player.state().ready, false);
  assert.match(h.player.state().error, /HTTP 404/);
  assert.equal(h.alive, 0);
});

test('scene change aborts a pending fetch without resurrecting a frame', async () => {
  let aborted = false;
  const h = harness(
    (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new Error('AbortError'));
          },
          { once: true },
        );
      }),
  );
  const load = h.player.loadRemote(config, { autoplay: true });
  await flush();
  h.player.deactivate();
  assert.equal(await load, false);
  assert.equal(aborted, true);
  assert.equal(h.alive, 0);
  assert.equal(h.player.state().error, '');
});

test('autoplay can be paused while the first file is still loading', async () => {
  let finish;
  const h = harness(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) });
      }),
  );
  const load = h.player.loadRemote(config, { autoplay: true });
  await flush();
  h.player.pause();
  finish();
  assert.equal(await load, true);
  assert.equal(h.player.state().playing, false);
  h.player.deactivate();
});
