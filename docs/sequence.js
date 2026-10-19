/** Natural ordering for PLY sequences selected from disk. No files are uploaded. */
export function groupFiles(files, fallback = 'res8') {
  const groups = {};
  for (const file of files) {
    if (!/\.ply$/i.test(file.name)) continue;
    const path = file.webkitRelativePath || file.name;
    const match = path.match(/(?:^|\/)res(1|2|4|8)(?:\/|$)/i);
    const resolution = match ? `res${match[1]}` : fallback;
    (groups[resolution] ??= []).push({ name: file.name, file });
  }
  for (const frames of Object.values(groups)) {
    frames.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (new Set(frames.map((frame) => frame.name)).size !== frames.length) {
      throw new Error('Tên frame trùng trong cùng resolution. Chọn một bộ dữ liệu.');
    }
  }
  return groups;
}

/** Build URLs from the known directory layout, without guessing a manifest schema. */
export function buildRemoteGroups(config, pageUrl) {
  const { firstFrame, lastFrame, padding = 6, resolutions } = config;
  if (
    !Number.isInteger(firstFrame) ||
    !Number.isInteger(lastFrame) ||
    firstFrame < 0 ||
    lastFrame < firstFrame ||
    lastFrame - firstFrame > 9999
  ) {
    throw new Error('Khoảng frame không hợp lệ.');
  }
  if (!resolutions?.length || !resolutions.every((res) => /^[a-zA-Z0-9_-]+$/.test(res))) {
    throw new Error('Danh sách resolution không hợp lệ.');
  }
  const base = new URL(config.baseUrl.replace(/\/?$/, '/'), pageUrl);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Cần URL HTTP/HTTPS.');
  return Object.fromEntries(
    resolutions.map((resolution) => [
      resolution,
      Array.from({ length: lastFrame - firstFrame + 1 }, (_, offset) => {
        const name = String(firstFrame + offset).padStart(padding, '0') + '.ply';
        return { name, url: new URL(`${resolution}/${name}`, base).href };
      }),
    ]),
  );
}

/**
 * One visible SplatMesh; a bounded decoded-frame cache; serial background decode.
 * Playback stalls on a missing frame. Content FPS measures mesh changes, not GPU
 * presentation. PLY frames do not build a spatial LoD tree during playback.
 */
export function initSequence({
  THREE,
  SplatMesh,
  scene,
  fitMesh,
  setNavigation,
  onOpen = () => {},
  onState = () => {},
}) {
  const $ = (id) => document.getElementById(id);
  const root = new THREE.Group();
  scene.add(root);

  let groups = {};
  let resolution = '';
  let index = 0;
  let requestedIndex = 0;
  let current = null;
  let playing = false;
  let switching = false;
  let generation = 0;
  let requestId = 0;
  let needsFit = true;
  let lastStep = 0;
  let lastUiUpdate = 0;
  let error = '';
  let sourceName = '';
  let sourceId = '';
  let contentFps = 0;
  let changes = 0;
  let sampleStart = performance.now();
  let controller = new AbortController();
  let serial = Promise.resolve();
  const cache = new Map();
  const pending = new Map();

  const frames = () => groups[resolution] || [];
  const capacity = () => Math.max(2, Math.min(10, Number($('seqBuffer').value) || 4));
  const targetFps = () => Math.max(1, Math.min(60, Number($('seqFPS').value) || 30));
  const dispose = (mesh) => {
    root.remove(mesh);
    mesh.dispose();
  };

  function state() {
    return {
      sourceId,
      sourceName,
      resolution,
      resolutions: Object.keys(groups),
      index,
      frameName: current ? frames()[index]?.name : '',
      frameCount: frames().length,
      playing,
      switching,
      ready: Boolean(current),
      visible: root.visible,
      buffered: cache.size,
      capacity: capacity(),
      contentFps,
      error,
    };
  }

  function emit() {
    $('seqPlay').textContent = playing ? '❚❚ Tạm dừng' : '▶ Phát';
    $('seqFrame').textContent = current
      ? `${index + 1}/${frames().length} · ${frames()[index].name}`
      : frames().length
        ? `${frames().length} frame · đang chờ`
        : 'Chưa có chuỗi';
    $('seqStats').textContent =
      `Buffer ${cache.size}/${capacity()} frame · nội dung ${contentFps.toFixed(1)} fps`;
    onState(state());
  }

  function pause() {
    playing = false;
    contentFps = 0;
    emit();
  }

  function reset(keepPlaying = false) {
    controller.abort();
    controller = new AbortController();
    generation += 1;
    requestId += 1;
    for (const mesh of cache.values()) dispose(mesh);
    cache.clear();
    pending.clear();
    current = null;
    switching = false;
    playing = keepPlaying;
    needsFit = true;
    error = '';
    changes = 0;
    contentFps = 0;
    sampleStart = performance.now();
  }

  function desiredFrames() {
    const count = frames().length;
    const wanted = new Set();
    for (let offset = 0; offset < Math.min(capacity(), count); offset += 1) {
      const next = requestedIndex + offset;
      if (next >= count && !$('seqLoop').checked) break;
      wanted.add(next % count);
    }
    return wanted;
  }

  function trim() {
    const wanted = desiredFrames();
    for (const [frameIndex, mesh] of cache) {
      if (!wanted.has(frameIndex) && mesh !== current) {
        dispose(mesh);
        cache.delete(frameIndex);
      }
    }
    // During a seek, retain the displayed frame until its replacement is ready.
    for (const [frameIndex, mesh] of [...cache].reverse()) {
      if (cache.size <= capacity()) break;
      if (mesh !== current && frameIndex !== requestedIndex) {
        dispose(mesh);
        cache.delete(frameIndex);
      }
    }
  }

  function ensureFrame(frameIndex) {
    if (cache.has(frameIndex)) return Promise.resolve(cache.get(frameIndex));
    if (pending.has(frameIndex)) return pending.get(frameIndex);
    const entry = frames()[frameIndex];
    const session = generation;
    const signal = controller.signal;
    if (!entry) return Promise.reject(new Error('Không có frame này.'));

    const job = serial.then(async () => {
      if (session !== generation || !desiredFrames().has(frameIndex)) return null;
      let mesh;
      try {
        let bytes;
        if (entry.file) {
          bytes = await entry.file.arrayBuffer();
        } else {
          const response = await fetch(entry.url, { signal });
          if (!response.ok) throw new Error(`HTTP ${response.status} — ${entry.url}`);
          bytes = await response.arrayBuffer();
        }
        if (session !== generation || !desiredFrames().has(frameIndex)) return null;
        mesh = new SplatMesh({ fileBytes: bytes, fileName: entry.name, lod: false });
        await mesh.initialized;
        if (session !== generation || !desiredFrames().has(frameIndex)) {
          mesh.dispose();
          return null;
        }
        mesh.visible = false;
        root.add(mesh);
        cache.set(frameIndex, mesh);
        trim();
        return cache.get(frameIndex) || null;
      } catch (cause) {
        if (mesh) mesh.dispose();
        if (session !== generation || signal.aborted) return null;
        throw new Error(`${entry.name}: ${cause.message}`);
      }
    });
    pending.set(frameIndex, job);
    serial = job.catch(() => {});
    const removePending = () => {
      if (session === generation) pending.delete(frameIndex);
    };
    job.then(removePending, removePending);
    return job;
  }

  function prefetch() {
    trim();
    for (const frameIndex of desiredFrames()) {
      // A prefetch failure is reported if that frame becomes the playback target.
      ensureFrame(frameIndex).catch(() => {});
    }
  }

  async function showFrame(frameIndex) {
    const session = generation;
    const ticket = ++requestId;
    requestedIndex = frameIndex;
    switching = true;
    error = '';
    $('seqStatus').textContent = `Đang chuẩn bị ${frames()[frameIndex]?.name}…`;
    trim();
    emit();
    try {
      const mesh = await ensureFrame(frameIndex);
      if (session !== generation || ticket !== requestId || !mesh) return false;
      if (current) current.visible = false;
      current = mesh;
      current.visible = true;
      index = frameIndex;
      root.rotation.x = THREE.MathUtils.degToRad(Number($('seqRotation').value) || 0);
      if (needsFit) {
        setNavigation('orbit');
        fitMesh(mesh);
        needsFit = false;
      }
      $('seqSeek').value = index;
      lastStep = performance.now();
      changes += 1;
      $('seqStatus').textContent = `${resolution} · ${frames().length} frame · sẵn sàng`;
      prefetch();
      return true;
    } catch (cause) {
      if (session === generation && ticket === requestId) {
        error = cause.message;
        playing = false;
        $('seqStatus').textContent = `Lỗi: ${error} — nhấn Phát để thử lại.`;
      }
      return false;
    } finally {
      if (session === generation && ticket === requestId) {
        switching = false;
        emit();
      }
    }
  }

  function updateResolutionOptions() {
    $('seqResolution').replaceChildren();
    for (const key of Object.keys(groups).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    )) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = `${key} · ${groups[key].length} frame`;
      $('seqResolution').append(option);
    }
    $('seqResolution').value = resolution;
    $('seqSeek').max = Math.max(0, frames().length - 1);
  }

  function selectResolution(value) {
    if (!groups[value]?.length) return Promise.resolve(false);
    const frameName = frames()[index]?.name;
    const wasPlaying = playing;
    const hadCamera = Boolean(current) && !needsFit;
    reset(wasPlaying);
    resolution = value;
    index = Math.max(
      0,
      frames().findIndex((frame) => frame.name === frameName),
    );
    requestedIndex = index;
    needsFit = !hadCamera;
    updateResolutionOptions();
    return showFrame(index);
  }

  function install(nextGroups, options = {}) {
    if (!Object.keys(nextGroups).length) throw new Error('Không tìm thấy file PLY.');
    reset(Boolean(options.autoplay));
    groups = nextGroups;
    sourceId = options.id || '';
    sourceName = options.name || 'Chuỗi PLY của bạn';
    resolution = groups[options.resolution]
      ? options.resolution
      : groups.res8
        ? 'res8'
        : Object.keys(groups)[0];
    index = 0;
    requestedIndex = 0;
    root.visible = true;
    if (options.rotationX !== undefined) $('seqRotation').value = options.rotationX;
    if (options.fps !== undefined) $('seqFPS').value = options.fps;
    updateResolutionOptions();
    onOpen({ id: sourceId, name: sourceName });
    return showFrame(0);
  }

  function loadRemote(config, options = {}) {
    const next = buildRemoteGroups(config, location.href);
    $('seqBase').value = config.baseUrl;
    $('seqStart').value = config.firstFrame;
    $('seqEnd').value = config.lastFrame;
    return install(next, {
      resolution: config.defaultResolution,
      fps: config.fps,
      rotationX: config.rotationX,
      ...options,
    });
  }

  function togglePlayback() {
    if (!frames().length) {
      $('seqStatus').textContent = 'Chọn scene Redandblack hoặc mở một chuỗi PLY.';
      return;
    }
    if (playing) {
      pause();
      return;
    }
    if (!root.visible) {
      root.visible = true;
      onOpen({ id: sourceId, name: sourceName });
    }
    playing = true;
    lastStep = performance.now();
    sampleStart = lastStep;
    changes = 0;
    if (!current || error) showFrame(requestedIndex);
    else prefetch();
    emit();
  }

  function clear() {
    reset();
    groups = {};
    resolution = '';
    sourceId = '';
    sourceName = '';
    index = 0;
    requestedIndex = 0;
    updateResolutionOptions();
    $('seqSeek').value = 0;
    $('seqStatus').textContent = 'Đã đóng chuỗi PLY.';
    emit();
  }

  $('seqFolder').onchange = (event) => {
    try {
      install(groupFiles([...event.target.files]), { name: 'Chuỗi PLY từ thư mục' });
    } catch (cause) {
      $('seqStatus').textContent = cause.message;
    }
    event.target.value = '';
  };
  $('seqFiles').onchange = (event) => {
    try {
      const added = groupFiles([...event.target.files], $('seqAssign').value);
      if (!Object.keys(added).length) throw new Error('Chưa chọn file PLY.');
      install({ ...groups, ...added }, { resolution: $('seqAssign').value });
    } catch (cause) {
      $('seqStatus').textContent = cause.message;
    }
    event.target.value = '';
  };
  $('seqRemote').onclick = () => {
    try {
      loadRemote(
        {
          baseUrl: $('seqBase').value,
          firstFrame: Number($('seqStart').value),
          lastFrame: Number($('seqEnd').value),
          resolutions: ['res1', 'res2', 'res4', 'res8'],
          defaultResolution: 'res8',
        },
        { name: 'Chuỗi PLY từ URL' },
      );
    } catch (cause) {
      $('seqStatus').textContent = cause.message;
    }
  };
  $('seqResolution').onchange = () => selectResolution($('seqResolution').value);
  $('seqPlay').onclick = togglePlayback;
  $('seqSeek').oninput = () => {
    pause();
    if (frames().length) showFrame(Math.min(frames().length - 1, Number($('seqSeek').value)));
  };
  $('seqRotation').onchange = () => {
    root.rotation.x = THREE.MathUtils.degToRad(Number($('seqRotation').value) || 0);
  };
  $('seqFit').onclick = () => {
    if (current) {
      setNavigation('orbit');
      fitMesh(current);
    }
  };
  $('seqBuffer').onchange = () => {
    if (frames().length) prefetch();
  };
  $('seqLoop').onchange = () => {
    if (frames().length) prefetch();
  };
  $('seqClear').onclick = clear;

  function tick(now) {
    if (playing && !switching && current && now - lastStep >= 1000 / targetFps()) {
      let next = index + 1;
      if (next >= frames().length) {
        if (!$('seqLoop').checked) {
          pause();
          return;
        }
        next = 0;
      }
      showFrame(next);
    }
    if (now - sampleStart >= 1000) {
      contentFps = playing ? (changes * 1000) / (now - sampleStart) : 0;
      changes = 0;
      sampleStart = now;
    }
    if (now - lastUiUpdate >= 250) {
      emit();
      lastUiUpdate = now;
    }
  }

  return {
    tick,
    pause,
    clear,
    loadRemote,
    selectResolution,
    togglePlayback,
    state,
    deactivate() {
      reset();
      root.visible = false;
      emit();
    },
    metrics() {
      return {
        content_fps: contentFps,
        sequence_resolution: resolution,
        sequence_frame: index,
        buffered_frames: cache.size,
      };
    },
  };
}
