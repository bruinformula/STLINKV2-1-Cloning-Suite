const defaultStages = [
  'Preflight',
  'Bootloader Flash',
  'Flashing Bootloader',
  'Legacy Upgrade',
  'Recent Upgrade',
  'Option Bytes',
  'Finished',
];

const elements = {
  platformBadge: document.querySelector('#platformBadge'),
  progressLabel: document.querySelector('#progressLabel'),
  progressDetail: document.querySelector('#progressDetail'),
  progressFill: document.querySelector('#progressFill'),
  cubeProgrammerPath: document.querySelector('#cubeProgrammerPath'),
  selectCubeProgrammerPath: document.querySelector('#selectCubeProgrammerPath'),
  javaPath: document.querySelector('#javaPath'),
  selectJavaPath: document.querySelector('#selectJavaPath'),
  swdFrequencyKhz: document.querySelector('#swdFrequencyKhz'),
  optionBytesCommand: document.querySelector('#optionBytesCommand'),
  autoDriveVendorTools: document.querySelector('#autoDriveVendorTools'),
  legacyToolPath: document.querySelector('#legacyToolPath'),
  recentToolPath: document.querySelector('#recentToolPath'),
  refreshButton: document.querySelector('#refreshButton'),
  runFlowButton: document.querySelector('#runFlowButton'),
  runOptionBytesButton: document.querySelector('#runOptionBytesButton'),
  preflightSummary: document.querySelector('#preflightSummary'),
  stageList: document.querySelector('#stageList'),
  logOutput: document.querySelector('#logOutput'),
  replugDialog: document.querySelector('#replugDialog'),
  replugDialogTitle: document.querySelector('#replugDialogTitle'),
  replugDialogMessage: document.querySelector('#replugDialogMessage'),
  replugDialogCountdown: document.querySelector('#replugDialogCountdown'),
};

const state = {
  stages: new Map(),
  detectedPaths: {
    cubeProgrammerPath: '',
    javaPath: '',
  },
  progress: {
    percent: 0,
    stageName: 'Idle',
    stageStatus: 'idle',
    detail: 'Waiting for command.',
  },
  verboseLogs: false,
};

function getConfig() {
  return {
    cubeProgrammerPath: elements.cubeProgrammerPath.value.trim(),
    javaPath: elements.javaPath.value.trim(),
    swdFrequencyKhz: elements.swdFrequencyKhz.value.trim(),
    optionBytesCommand: elements.optionBytesCommand.value.trim(),
    autoDriveVendorTools: elements.autoDriveVendorTools.checked,
  };
}

function setBusy(isBusy) {
  elements.runFlowButton.disabled = isBusy;
  elements.runOptionBytesButton.disabled = isBusy;
  elements.refreshButton.disabled = isBusy;
  elements.selectCubeProgrammerPath.disabled = isBusy;
  elements.selectJavaPath.disabled = isBusy;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderPathValue(label, value, className = '') {
  const safeValue = value || 'Not found';
  const classes = ['collapsed-path', className].filter(Boolean).join(' ');
  return `
    <button class="${classes}" type="button" data-path-cell="true" data-expanded="false" data-fullpath="${escapeHtml(safeValue)}">
      <span class="collapsed-label">${label}</span>
      <span class="collapsed-value">${escapeHtml(safeValue)}</span>
    </button>
  `;
}

function bindCollapsedPathCells(scope = document) {
  const pathCells = scope.querySelectorAll('[data-path-cell="true"]');
  for (const cell of pathCells) {
    cell.addEventListener('click', () => {
      const expanded = cell.dataset.expanded === 'true';
      cell.dataset.expanded = expanded ? 'false' : 'true';
    });
  }
}

// In non-verbose mode, suppress low-level CLI output and debug lines.
// Verbose-only: [debug], [timing] prefixed lines and lines coming from vendor/CLI subprocesses.
function isVerboseOnly(line, level) {
  if (level === 'debug') return true;
  const lower = String(line).toLowerCase();
  if (lower.startsWith('[debug]') || lower.startsWith('[timing]')) return true;
  // Raw vendor tool and CubeProgrammer CLI output
  if (lower.startsWith('[vendor]') || lower.startsWith('[vendor err]')) return true;
  if (lower.startsWith('[cube]') || lower.startsWith('[cube err]')) return true;
  // Command echo lines: "Mass erase: /path...", "Bootloader flash: /path..."
  // These contain the full CLI invocation path; skip them in non-verbose mode.
  if (lower.includes('stm32_programmer_cli') || lower.includes('stm32cubeprogrammer')) return true;
  return false;
}

// Non-verbose friendly labels for each stage transition.
// One line is printed when a stage starts (running) and one when it finishes (done/error).
const STAGE_LABELS = {
  Preflight:             { running: 'Checking prerequisites\u2026',           done: 'Preflight checks passed.' },
  'Bootloader Flash':    { running: 'Bootloader flash sequence starting\u2026', done: null }, // covered by sub-stage
  'Flashing Bootloader': { running: 'Flashing bootloader\u2026',               done: 'Bootloader flashed successfully.' },
  'Legacy Upgrade':      { running: 'Running legacy firmware updater\u2026',   done: 'Legacy upgrade complete.' },
  'Recent Upgrade':      { running: 'Running recent firmware updater\u2026',   done: 'Recent upgrade complete.' },
  'Option Bytes':        { running: 'Writing option bytes\u2026',               done: 'Option bytes written.' },
  Finished:              { running: null,                                       done: 'All done! Cloning flow complete.' },
};

function appendStageLog(name, status) {
  if (state.verboseLogs) return; // verbose mode: orchestrator log() calls already cover this
  const entry = STAGE_LABELS[name];
  if (!entry) return; // internal stages (USB Replug n) not shown
  const label = entry[status];
  if (!label) return;
  const stamp = new Date().toLocaleTimeString();
  elements.logOutput.textContent += `[${stamp}] ${label}\n`;
  elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
}


function friendlyErrorSuggestion(line) {
  const lower = String(line).toLowerCase();
  if (lower.includes('bulktransfererror') || lower.includes('bulk transfer error')) {
    return 'Try unplugging and replugging the ST-Link.';
  }
  if (lower.includes('no stm32 target') || lower.includes('unable to get core') || lower.includes('target device not found')) {
    return 'ST-Link not responding — replug it and retry.';
  }
  if (lower.includes('st-link error') || lower.includes('object has been destroyed')) {
    return 'ST-Link disconnected unexpectedly — replug and retry.';
  }
  if (lower.includes('timed out')) {
    return 'Operation timed out — check cable and replug if needed.';
  }
  return null;
}

let _lastErrorLogTime = 0;

function appendLog(line, level = 'info') {
  if (!state.verboseLogs && isVerboseOnly(line, level)) {
    return;
  }

  // In non-verbose mode, throttle error messages to 1/s and show an actionable suggestion.
  if (!state.verboseLogs && level === 'error') {
    const now = Date.now();
    if (now - _lastErrorLogTime < 1000) return;
    _lastErrorLogTime = now;
    const suggestion = friendlyErrorSuggestion(line);
    const stamp = new Date().toLocaleTimeString();
    elements.logOutput.textContent += `[${stamp}] [error] ${line}\n`;
    if (suggestion) {
      elements.logOutput.textContent += `[${stamp}] [hint]  ${suggestion}\n`;
    }
    elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
    return;
  }

  const stamp = new Date().toLocaleTimeString();
  elements.logOutput.textContent += `[${stamp}] [${level}] ${line}\n`;
  elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
}

function setReplugDialog(visible, message = 'unplug and replug usb', title, countdown) {
  if (!elements.replugDialog) {
    return;
  }

  if (elements.replugDialogTitle && title != null) {
    elements.replugDialogTitle.textContent = title;
  }

  if (elements.replugDialogMessage) {
    elements.replugDialogMessage.textContent = message;
  }

  if (elements.replugDialogCountdown) {
    if (visible && countdown != null) {
      const label = countdown === 1 ? 'second' : 'seconds';
      elements.replugDialogCountdown.textContent =
        countdown > 0
          ? `Launching Legacy Programmer in ${countdown} ${label}…`
          : 'Launching Legacy Programmer now…';
      elements.replugDialogCountdown.classList.remove('hidden');
    } else {
      elements.replugDialogCountdown.classList.add('hidden');
    }
  }

  elements.replugDialog.classList.toggle('hidden', !visible);
}

function resetProgress() {
  state.progress = {
    percent: 0,
    stageName: 'Idle',
    stageStatus: 'idle',
    detail: 'Waiting for command.',
  };
  renderProgress();
}

function renderProgress() {
  elements.progressFill.style.width = `${state.progress.percent}%`;
  elements.progressLabel.textContent = state.progress.stageName;
  elements.progressLabel.className = `status-chip ${state.progress.stageStatus}`;
  elements.progressDetail.textContent = state.progress.detail || 'Waiting for command.';
  // Turn progress bar red when in error state
  elements.progressFill.classList.toggle('progress-fill--error', state.progress.stageStatus === 'error');
}

function renderStages() {
  elements.stageList.innerHTML = '';

  for (const name of defaultStages) {
    const stage = state.stages.get(name) || { status: 'idle', detail: 'Waiting.' };
    const card = document.createElement('section');
    card.className = `stage-card ${stage.status}`;

    const heading = document.createElement('div');
    heading.className = 'stage-head';
    heading.innerHTML = `<strong>${name}</strong><span>${stage.status}</span>`;

    const detail = document.createElement('p');
    detail.textContent = stage.detail || 'Waiting.';

    card.append(heading, detail);
    elements.stageList.append(card);
  }
}

function renderPreflight(result) {
  const fileRows = Object.entries(result.files)
    .map(([name, ok]) => `<li><span>${name}</span><strong>${ok ? 'OK' : 'Missing'}</strong></li>`)
    .join('');

  const warnings = result.warnings.length
    ? result.warnings.map((item) => `<li>${item}</li>`).join('')
    : '<li>No warnings.</li>';

  elements.preflightSummary.innerHTML = `
    <div class="summary-block">
      <span>Platform</span>
      <strong>${result.platform}</strong>
    </div>
    <div class="summary-block">
      <span>CubeProgrammer CLI</span>
      ${renderPathValue('CLI', result.cubeProgrammerPath, 'monitor-path')}
    </div>
    <div class="summary-block">
      <span>Java</span>
      ${renderPathValue('Java', result.javaPath, 'monitor-path')}
    </div>
    <div class="summary-block">
      <span>Legacy updater</span>
      ${renderPathValue('Legacy', result.legacyToolPath, 'monitor-path')}
    </div>
    <div class="summary-block">
      <span>Recent updater</span>
      ${renderPathValue('Recent', result.recentToolPath, 'monitor-path')}
    </div>
    <div class="summary-list">
      <h3>Bundled files</h3>
      <ul>${fileRows}</ul>
    </div>
    <div class="summary-list warnings">
      <h3>Warnings</h3>
      <ul>${warnings}</ul>
    </div>
  `;

  elements.platformBadge.textContent = result.platform;
  elements.legacyToolPath.innerHTML = `
    <span class="collapsed-label">Legacy</span>
    <span class="collapsed-value">${escapeHtml(result.legacyToolPath || 'Not found')}</span>
  `;
  elements.recentToolPath.innerHTML = `
    <span class="collapsed-label">Recent</span>
    <span class="collapsed-value">${escapeHtml(result.recentToolPath || 'Not found')}</span>
  `;
  elements.legacyToolPath.dataset.pathCell = 'true';
  elements.recentToolPath.dataset.pathCell = 'true';
  elements.legacyToolPath.dataset.fullpath = result.legacyToolPath || 'Not found';
  elements.recentToolPath.dataset.fullpath = result.recentToolPath || 'Not found';
  elements.legacyToolPath.dataset.expanded = 'false';
  elements.recentToolPath.dataset.expanded = 'false';
  bindCollapsedPathCells(elements.preflightSummary);
}

function syncDetectedInput(input, nextValue, key) {
  const previousDetected = state.detectedPaths[key] || '';
  const currentValue = input.value.trim();
  const shouldReplace = !currentValue || currentValue === previousDetected;

  state.detectedPaths[key] = nextValue || '';
  if (shouldReplace) {
    input.value = nextValue || '';
  }
}

function loadDefaults(defaults) {
  elements.cubeProgrammerPath.value = defaults.cubeProgrammerPath || '';
  elements.javaPath.value = defaults.javaPath || '';
  elements.swdFrequencyKhz.value = defaults.swdFrequencyKhz;
  elements.optionBytesCommand.value = defaults.optionBytesCommand;
  elements.autoDriveVendorTools.checked = defaults.autoDriveVendorTools;
  elements.legacyToolPath.innerHTML = `
    <span class="collapsed-label">Legacy</span>
    <span class="collapsed-value">${escapeHtml(defaults.detectedLegacyTool || 'Not found')}</span>
  `;
  elements.recentToolPath.innerHTML = `
    <span class="collapsed-label">Recent</span>
    <span class="collapsed-value">${escapeHtml(defaults.detectedRecentTool || 'Not found')}</span>
  `;
  elements.legacyToolPath.dataset.pathCell = 'true';
  elements.recentToolPath.dataset.pathCell = 'true';
  elements.legacyToolPath.dataset.fullpath = defaults.detectedLegacyTool || 'Not found';
  elements.recentToolPath.dataset.fullpath = defaults.detectedRecentTool || 'Not found';
  elements.legacyToolPath.dataset.expanded = 'false';
  elements.recentToolPath.dataset.expanded = 'false';
  state.detectedPaths.cubeProgrammerPath = defaults.cubeProgrammerPath || '';
  state.detectedPaths.javaPath = defaults.javaPath || '';
}

async function choosePath(kind) {
  const currentValue = kind === 'cube' ? elements.cubeProgrammerPath.value.trim() : elements.javaPath.value.trim();
  const response = await window.clonerApi.selectPath({
    title: kind === 'cube' ? 'Select STM32CubeProgrammer CLI' : 'Select Java runtime',
    defaultPath: currentValue,
    properties: ['openFile'],
  });

  if (!response.ok || response.canceled) {
    return;
  }

  if (kind === 'cube') {
    elements.cubeProgrammerPath.value = response.path;
  } else {
    elements.javaPath.value = response.path;
  }

  await refreshEnvironment();
}

async function refreshEnvironment() {
  appendLog('Refreshing preflight checks.');
  const result = await window.clonerApi.checkEnvironment(getConfig());
  syncDetectedInput(elements.cubeProgrammerPath, result.cubeProgrammerPath, 'cubeProgrammerPath');
  syncDetectedInput(elements.javaPath, result.javaPath, 'javaPath');
  renderPreflight(result);
}

async function bootstrap() {
  const defaults = await window.clonerApi.getDefaultConfig();
  loadDefaults(defaults);

  for (const name of defaultStages) {
    state.stages.set(name, { status: 'idle', detail: 'Waiting.' });
  }

  renderStages();
  renderProgress();
  await refreshEnvironment();
}

window.clonerApi.onFlowEvent((payload) => {
  if (payload.type === 'log') {
    appendLog(payload.message, payload.level);
    return;
  }

  if (payload.type === 'stage') {
    state.stages.set(payload.name, {
      status: payload.status,
      detail: payload.detail,
    });
    appendStageLog(payload.name, payload.status);
    renderStages();
    return;
  }

  if (payload.type === 'progress') {
    state.progress = {
      percent: payload.percent,
      stageName: payload.stageName,
      stageStatus: payload.stageStatus,
      detail: payload.detail,
    };
    renderProgress();
    return;
  }

  if (payload.type === 'replugPrompt') {
    setReplugDialog(
      Boolean(payload.visible),
      payload.message || 'unplug and replug usb',
      payload.title,
      payload.countdown,
    );
  }
});

const verboseToggleEl = document.querySelector('#verboseToggle');
if (verboseToggleEl) {
  verboseToggleEl.addEventListener('click', () => {
    state.verboseLogs = !state.verboseLogs;
    verboseToggleEl.classList.toggle('active', state.verboseLogs);
    verboseToggleEl.setAttribute('aria-pressed', String(state.verboseLogs));
  });
}

elements.refreshButton.addEventListener('click', async () => {
  await refreshEnvironment();
});

elements.selectCubeProgrammerPath.addEventListener('click', async () => {
  await choosePath('cube');
});

elements.selectJavaPath.addEventListener('click', async () => {
  await choosePath('java');
});

elements.runFlowButton.addEventListener('click', async () => {
  setBusy(true);
  elements.logOutput.textContent = '';
  resetProgress();

  for (const name of defaultStages) {
    state.stages.set(name, { status: 'idle', detail: 'Waiting.' });
  }
  renderStages();

  try {
    const result = await window.clonerApi.runFlow(getConfig());
    if (!result.ok && !result.cancelled) {
      appendLog(result.error || 'Flow failed.', 'error');
    }
    if (result.cancelled) {
      appendLog('Flow cancelled by user.', 'warn');
    }
  } catch (error) {
    appendLog(error.message, 'error');
  } finally {
    setReplugDialog(false);
    setBusy(false);
    await refreshEnvironment();
  }
});

elements.runOptionBytesButton.addEventListener('click', async () => {
  setBusy(true);
  elements.logOutput.textContent = '';
  resetProgress();

  for (const name of defaultStages) {
    state.stages.set(name, { status: 'idle', detail: 'Waiting.' });
  }
  renderStages();

  try {
    const result = await window.clonerApi.runOptionBytesOnly(getConfig());
    if (!result.ok && !result.cancelled) {
      appendLog(result.error || 'Option-byte-only run failed.', 'error');
    }
    if (result.cancelled) {
      appendLog('Option-byte-only run cancelled by user.', 'warn');
    }
  } catch (error) {
    appendLog(error.message, 'error');
  } finally {
    setReplugDialog(false);
    setBusy(false);
    await refreshEnvironment();
  }
});

bootstrap();

bindCollapsedPathCells();