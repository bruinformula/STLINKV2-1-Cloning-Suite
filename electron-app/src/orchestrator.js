const fs = require('fs');
const path = require('path');
const { runProcess, runUpgradeTool } = require('./vendor-tools');

const repoRoot = path.resolve(__dirname, '..', '..');

const APP_FILES = {
  bootloader: path.join(repoRoot, 'Unprotected-2-1-Bootloader.bin'),
  legacyJar: path.join(
    repoRoot,
    'stsw-link007 - Legacy Programmer',
    'AllPlatforms',
    'STLinkUpgrade.jar'
  ),
  recentJar: path.join(
    repoRoot,
    'stsw-link007 - Most Recent Programmer',
    'stsw-link007',
    'AllPlatforms',
    'STLinkUpgrade.jar'
  ),
  legacyWindowsExe: path.join(
    repoRoot,
    'stsw-link007 - Legacy Programmer',
    'Windows',
    'ST-LinkUpgrade.exe'
  ),
  recentWindowsExe: path.join(
    repoRoot,
    'stsw-link007 - Most Recent Programmer',
    'stsw-link007',
    'Windows',
    'ST-LinkUpgrade.exe'
  ),
};

function toolRequiresJava(tool) {
  return process.platform !== 'win32' || !exists(tool.exePath);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateProgress(name, status) {
  const checkpoints = {
    Preflight: 10,
    'Bootloader Flash': 20,
    'Flashing Bootloader': 30,
    'USB Replug 1': 43,
    'Legacy Upgrade': 55,
    'USB Replug 2': 67,
    'Recent Upgrade': 80,
    'USB Replug 3': 89,
    'Option Bytes': 92,
    Finished: 100,
  };

  if (status === 'done') {
    return checkpoints[name] || 100;
  }

  if (status === 'running') {
    return Math.max((checkpoints[name] || 0) - 8, 4);
  }

  if (status === 'error') {
    return checkpoints[name] || 0;
  }

  return 0;
}

function emitProgress(mainWindow, name, status, detail = '') {
  send(mainWindow, {
    type: 'progress',
    percent: calculateProgress(name, status),
    stageName: name,
    stageStatus: status,
    detail,
    time: new Date().toLocaleTimeString(),
  });
}

function getBaseConfig() {
  return {
    javaPath: '',
    cubeProgrammerPath: '',
    swdFrequencyKhz: '4000',
    autoDriveVendorTools: process.platform === 'darwin',
    optionBytesCommand: 'nSWBOOT0=0',
  };
}

async function getDefaultConfig() {
  const tools = getToolDescriptors();
  const env = await checkEnvironment({});

  return {
    ...getBaseConfig(),
    javaPath: env.javaPath,
    cubeProgrammerPath: env.cubeProgrammerPath,
    detectedLegacyTool:
      process.platform === 'win32' && exists(tools.legacy.exePath)
        ? tools.legacy.exePath
        : tools.legacy.jarPath,
    detectedRecentTool:
      process.platform === 'win32' && exists(tools.recent.exePath)
        ? tools.recent.exePath
        : tools.recent.jarPath,
  };
}

function exists(targetPath) {
  return Boolean(targetPath) && fs.existsSync(targetPath);
}

function platformNativeDir(basePath, variant) {
  if (process.platform === 'darwin') {
    if (process.arch === 'arm64' && variant === 'recent') {
      return path.join(basePath, 'native', 'mac_x64_arm64');
    }

    return path.join(basePath, 'native', 'mac_x64');
  }

  if (process.platform === 'win32') {
    return path.join(basePath, 'native', process.arch === 'x64' ? 'win_x64' : 'win_x86');
  }

  return path.join(basePath, 'native', process.arch === 'x64' ? 'linux_x64' : 'linux_x86');
}

function getToolDescriptors() {
  const legacyBase = path.join(repoRoot, 'stsw-link007 - Legacy Programmer', 'AllPlatforms');
  const recentBase = path.join(
    repoRoot,
    'stsw-link007 - Most Recent Programmer',
    'stsw-link007',
    'AllPlatforms'
  );

  return {
    legacy: {
      kind: 'legacy',
      jarPath: APP_FILES.legacyJar,
      exePath: APP_FILES.legacyWindowsExe,
      nativeDir: platformNativeDir(legacyBase, 'legacy'),
      forceIntelRuntime: process.platform === 'darwin',
      manualInstructions:
        'If the legacy updater does not continue by itself, click Device Connect, choose the profile with STM32 and two plus signs, then confirm Yes.',
    },
    recent: {
      kind: 'recent',
      jarPath: APP_FILES.recentJar,
      exePath: APP_FILES.recentWindowsExe,
      nativeDir: platformNativeDir(recentBase, 'recent'),
      forceIntelRuntime: false,
      manualInstructions:
        'If the recent updater does not continue by itself, click Device Connect, dismiss the warning with OK if needed, click Device Connect again, then confirm Yes >>>.',
    },
  };
}

async function which(command) {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = await runProcess(lookup, [command]);
    if (result.code === 0) {
      return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
    }
  } catch (_error) {
    return '';
  }

  return '';
}

async function detectJavaPath(overrides) {
  if (exists(overrides.javaPath)) {
    return overrides.javaPath;
  }

  // On macOS, prioritise finding an x86_64-capable Java first (needed for Rosetta legacy tool)
  if (process.platform === 'darwin') {
    // 1. Try to find an x86_64 JDK via java_home (works for Oracle/Apple/Azul etc.)
    try {
      const r = await runProcess('/usr/libexec/java_home', ['-a', 'x86_64']);
      if (r.code === 0) {
        const candidate = path.join(r.stdout.trim(), 'bin', 'java');
        if (exists(candidate)) {
          return candidate;
        }
      }
    } catch (_e) { /* not available */ }

    // 2. Homebrew x86 OpenJDK (installed under Rosetta homebrew at /usr/local)
    const x86HombrewJava = '/usr/local/opt/openjdk/bin/java';
    if (exists(x86HombrewJava)) return x86HombrewJava;

    // 3. Any JDK via java_home (may be ARM64, but worth trying)
    try {
      const r = await runProcess('/usr/libexec/java_home', []);
      if (r.code === 0) {
        const candidate = path.join(r.stdout.trim(), 'bin', 'java');
        if (exists(candidate)) {
          return candidate;
        }
      }
    } catch (_e) { /* not available */ }

    // 4. Homebrew ARM64 OpenJDK
    const armHombrewJava = '/opt/homebrew/opt/openjdk/bin/java';
    if (exists(armHombrewJava)) return armHombrewJava;

    // 5. Common fixed locations
    for (const p of [
      '/usr/bin/java',
      '/usr/local/bin/java',
      '/opt/homebrew/bin/java',
    ]) {
      if (exists(p)) return p;
    }

    return '';
  }

  const onPath = await which(process.platform === 'win32' ? 'java.exe' : 'java');
  if (onPath) {
    return onPath;
  }

  return '';
}

async function detectCubeProgrammerPath(overrides) {
  if (exists(overrides.cubeProgrammerPath)) {
    return overrides.cubeProgrammerPath;
  }

  const onPath = await which(process.platform === 'win32' ? 'STM32_Programmer_CLI.exe' : 'STM32_Programmer_CLI');
  if (onPath) {
    return onPath;
  }

  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/STMicroelectronics/STM32CubeProgrammer/STM32CubeProgrammer.app/Contents/MacOs/bin/STM32_Programmer_CLI',
        '/Applications/STMicroelectronics/STM32Cube/STM32CubeProgrammer/STM32CubeProgrammer.app/Contents/MacOs/bin/STM32_Programmer_CLI',
      ]
    : process.platform === 'win32'
      ? [
          'C:\\Program Files\\STMicroelectronics\\STM32Cube\\STM32CubeProgrammer\\bin\\STM32_Programmer_CLI.exe',
          'C:\\Program Files\\STMicroelectronics\\STM32CubeProgrammer\\bin\\STM32_Programmer_CLI.exe',
        ]
      : [
          '/usr/local/bin/STM32_Programmer_CLI',
          '/opt/st/stm32cubeprogrammer/bin/STM32_Programmer_CLI',
        ];

  return candidates.find(exists) || '';
}

function send(mainWindow, payload) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const contents = mainWindow.webContents;
    if (!contents || contents.isDestroyed()) {
      return;
    }

    contents.send('flow:event', payload);
  } catch (_error) {
    // Ignore UI channel errors if the window is closing/destroyed.
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripAnsi(input) {
  if (!input) {
    return '';
  }

  return String(input).replace(/\u001B\[[0-9;]*m/g, '');
}

function normalizeWorkflowErrorMessage(error) {
  const raw = stripAnsi(error?.message || String(error || '')).trim();
  const lower = raw.toLowerCase();

  if (lower.includes('object has been destroyed')) {
    return 'ST-Link unplugged or app window was closed while running. Replug ST-Link and run again.';
  }

  if (
    lower.includes('no stm32 target found') ||
    lower.includes('unable to get core id') ||
    lower.includes('target device not found') ||
    lower.includes('st-link error')
  ) {
    return 'ST-Link unplugged or target not ready. Replug/power the board and try again.';
  }

  return raw || 'Unknown workflow error.';
}

function isBulkTransferError(error) {
  const raw = stripAnsi(error?.message || String(error || '')).toLowerCase();
  return (
    raw.includes('bulktransfererror') ||
    raw.includes('bulk transfer error') ||
    raw.includes('libusb_bulk_transfer')
  );
}

function normalizeConfig(raw, resolved) {
  const tools = getToolDescriptors();

  return {
    ...getBaseConfig(),
    ...raw,
    javaPath: resolved.javaPath,
    cubeProgrammerPath: resolved.cubeProgrammerPath,
    detectedLegacyTool:
      process.platform === 'win32' && exists(tools.legacy.exePath)
        ? tools.legacy.exePath
        : tools.legacy.jarPath,
    detectedRecentTool:
      process.platform === 'win32' && exists(tools.recent.exePath)
        ? tools.recent.exePath
        : tools.recent.jarPath,
  };
}

async function checkEnvironment(config = {}) {
  const [javaPath, cubeProgrammerPath] = await Promise.all([
    detectJavaPath(config),
    detectCubeProgrammerPath(config),
  ]);

  const tools = getToolDescriptors();

  return {
    platform: `${process.platform}/${process.arch}`,
    repoRoot,
    javaPath,
    cubeProgrammerPath,
    legacyToolPath:
      process.platform === 'win32' && exists(tools.legacy.exePath)
        ? tools.legacy.exePath
        : tools.legacy.jarPath,
    recentToolPath:
      process.platform === 'win32' && exists(tools.recent.exePath)
        ? tools.recent.exePath
        : tools.recent.jarPath,
    files: {
      bootloader: exists(APP_FILES.bootloader),
      legacyJar: exists(APP_FILES.legacyJar),
      recentJar: exists(APP_FILES.recentJar),
      legacyNative: exists(tools.legacy.nativeDir),
      recentNative: exists(tools.recent.nativeDir),
      legacyWindowsExe: exists(APP_FILES.legacyWindowsExe),
      recentWindowsExe: exists(APP_FILES.recentWindowsExe),
    },
    warnings: buildWarnings({ javaPath, cubeProgrammerPath, tools }),
  };
}

function buildWarnings({ javaPath, cubeProgrammerPath, tools }) {
  const warnings = [];

  if (!javaPath && (toolRequiresJava(tools.legacy) || toolRequiresJava(tools.recent))) {
    warnings.push('Java was not detected. The legacy and recent ST updaters need it on macOS and Linux.');
  }

  if (!cubeProgrammerPath) {
    warnings.push('STM32CubeProgrammer CLI was not detected. The bootloader flash and final option-byte step will not run.');
  }

  if (!exists(tools.legacy.jarPath) && !exists(tools.legacy.exePath)) {
    warnings.push('The legacy ST updater is missing from the repo.');
  }

  if (!exists(tools.recent.jarPath) && !exists(tools.recent.exePath)) {
    warnings.push('The recent ST updater is missing from the repo.');
  }

  if (process.platform === 'darwin' && process.arch === 'arm64' && !exists(tools.legacy.nativeDir)) {
    warnings.push('The legacy updater has no native Apple Silicon library. Expect Rosetta or Intel Java requirements.');
  }

  return warnings;
}

async function runCubeCommand(commandPath, args, log, stageName) {
  log(`[debug] stage=${stageName}`, 'debug');
  log(`[debug] cwd=${repoRoot}`, 'debug');
  log(`[debug] commandPath=${commandPath}`, 'debug');
  log(`[debug] commandPathExists=${exists(commandPath)}`, 'debug');
  log(`${stageName}: ${commandPath} ${args.join(' ')}`);

  const result = await runProcess(commandPath, args, {
    cwd: repoRoot,
    onOutput: (text, stream) => {
      const prefix = stream === 'stderr' ? '[cube err]' : '[cube]';
      const trimmed = text.trim();
      if (trimmed) {
        log(`${prefix} ${trimmed}`);
      }
    },
  });

  log(`[debug] ${stageName} exitCode=${result.code}`, 'debug');
  if (result.stdout?.trim()) {
    log(`[debug] ${stageName} full stdout:\n${result.stdout.trim()}`, 'debug');
  }
  if (result.stderr?.trim()) {
    log(`[debug] ${stageName} full stderr:\n${result.stderr.trim()}`, 'debug');
  }

  if (result.code !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || 'No command output captured.';
    throw new Error(`${stageName} failed with exit code ${result.code}. CLI output: ${detail}`);
  }
}

function parseStlinkProbesFromOutput(outputText) {
  const sections = outputText.split(/ST[-\s]?LINK\s+Probe\s+\d+\s*:/gi).slice(1);
  const parsedFromSections = sections
    .map((section, index) => {
      const serialMatch = section.match(/(?:ST-LINK SN|Serial Number)\s*:\s*([^\r\n]+)/i);
      const accessPortMatch = section.match(/Access Port Number:\s*(\d+)/i);
      return {
        index,
        serialNumber: serialMatch?.[1]?.trim() || '',
        accessPort: accessPortMatch ? Number.parseInt(accessPortMatch[1], 10) : null,
      };
    })
    .filter((probe) => probe.serialNumber || Number.isInteger(probe.accessPort));

  if (parsedFromSections.length > 0) {
    return parsedFromSections;
  }

  // Fallback: some STM32CubeProgrammer builds print serials without parseable probe blocks.
  const rawSerialRegex = /ST-LINK SN\s*:\s*([^\r\n]+)/gi;
  const fallback = [];
  const seen = new Set();
  let match = rawSerialRegex.exec(outputText);

  while (match) {
    const serial = (match[1] || '').trim();
    if (serial && !seen.has(serial)) {
      seen.add(serial);
      fallback.push({
        index: fallback.length,
        serialNumber: serial,
        accessPort: null,
      });
    }

    match = rawSerialRegex.exec(outputText);
  }

  return fallback;
}

async function getProbeSnapshot(config, log, options = {}) {
  const verbose = options.verbose !== false;
  if (verbose) {
    log('[debug] listing connected probes with -l', 'debug');
  }

  const runOptions = { cwd: repoRoot };
  if (verbose) {
    runOptions.onOutput = (text, stream) => {
      const prefix = stream === 'stderr' ? '[cube err]' : '[cube]';
      const trimmed = text.trim();
      if (trimmed) {
        log(`${prefix} ${trimmed}`);
      }
    };
  }

  const result = await runProcess(config.cubeProgrammerPath, ['-l'], runOptions);

  if (verbose) {
    log(`[debug] probe-list exitCode=${result.code}`, 'debug');
    if (result.stdout?.trim()) {
      log(`[debug] probe-list full stdout:\n${result.stdout.trim()}`, 'debug');
    }
    if (result.stderr?.trim()) {
      log(`[debug] probe-list full stderr:\n${result.stderr.trim()}`, 'debug');
    }
  }

  const probes = result.code === 0 ? parseStlinkProbesFromOutput(result.stdout || '') : [];
  const joinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
  const hasErrorText = /\berror\b/i.test(joinedOutput);
  const probeIds = probes.map((probe) => probeIdentity(probe));

  if (!verbose) {
    log(
      `[debug] probe-list poll: exit=${result.code} count=${probes.length} hasErrorText=${hasErrorText} ids=${probeIds.join(', ') || 'none'}`,
      'debug'
    );
  }

  return {
    exitCode: result.code,
    probes,
    hasErrorText,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

async function listStlinkProbes(config, log, options = {}) {
  const snapshot = await getProbeSnapshot(config, log, options);
  return snapshot.probes;
}

function probeIdentity(probe) {
  if (probe.serialNumber) {
    return `sn:${probe.serialNumber}`;
  }

  if (Number.isInteger(probe.accessPort)) {
    return `ap:${probe.accessPort}`;
  }

  return `idx:${probe.index}`;
}

function toProbeIdentitySet(probes) {
  return new Set((probes || []).map(probeIdentity));
}

async function waitForUsbReplug(
  config,
  log,
  baselineProbes,
  waitLabel,
  timeoutMs = 180000,
  options = {}
) {
  const baseline = baselineProbes || [];
  const baselineSet = toProbeIdentitySet(baseline);
  const startTime = Date.now();
  let sawDisconnect = baseline.length === 0;
  let tick = 0;
  const requireNewDevice = Boolean(options.requireNewDevice);
  const settleDelayMs = Number.isInteger(options.settleDelayMs) ? options.settleDelayMs : 0;

  log(
    `[debug] waiting for new USB device ${waitLabel}; baseline=${JSON.stringify(baseline)}`,
    'debug'
  );

  while (Date.now() - startTime < timeoutMs) {
    tick += 1;
    const snapshot = await getProbeSnapshot(config, log, { verbose: false });
    const probes = snapshot.probes;
    const currentSet = toProbeIdentitySet(probes);
    const baselineIds = [...baselineSet];
    const currentIds = [...currentSet];
    const newIds = currentIds.filter((id) => !baselineSet.has(id));

    log(
      `[debug] replug poll (${waitLabel}) tick=${tick} baseline=[${baselineIds.join(', ') || 'none'}] current=[${currentIds.join(', ') || 'none'}] new=[${newIds.join(', ') || 'none'}] disconnectSeen=${sawDisconnect} hasErrorText=${snapshot.hasErrorText}`,
      'debug'
    );

    const hasNewDevice = probes.some((probe) => !baselineSet.has(probeIdentity(probe)));
    if (hasNewDevice) {
      log(`[debug] new USB device detected (${waitLabel}): new ST-Link device observed.`, 'debug');
      if (settleDelayMs > 0) {
        log(`[debug] new USB device detected (${waitLabel}): settling for ${settleDelayMs} ms.`, 'debug');
        await delay(settleDelayMs);
      }
      return probes;
    }

    if (requireNewDevice) {
      await delay(1000);
      continue;
    }

    if (!sawDisconnect && baselineSet.size > 0) {
      const stillSeesBaseline = probes.some((probe) => baselineSet.has(probeIdentity(probe)));
      if (!stillSeesBaseline || probes.length === 0) {
        sawDisconnect = true;
        log(`[debug] USB disconnect observed (${waitLabel}).`, 'debug');
      }
    }

    if (sawDisconnect && probes.length > 0 && currentSet.size > 0) {
      log(`[debug] USB reconnect observed (${waitLabel}).`, 'debug');
      return probes;
    }

    if (tick % 5 === 0) {
      log(`[debug] still waiting for a new USB device (${waitLabel})...`, 'debug');
    }

    await delay(1000);
  }

  throw new Error(`Timed out waiting for a new USB device (${waitLabel}).`);
}

async function waitForHealthyStlink(config, log, timeoutMs = 180000) {
  const startedAt = Date.now();
  let tick = 0;

  log('[debug] waiting for ST-Link probe to clear error state before starting workflow', 'debug');

  while (Date.now() - startedAt < timeoutMs) {
    tick += 1;
    const snapshot = await getProbeSnapshot(config, log, { verbose: false });
    const probes = snapshot.probes;

    const ready = snapshot.exitCode === 0 && probes.length > 0 && !snapshot.hasErrorText;
    if (ready) {
      log(
        `[debug] ST-Link ready at tick=${tick}; probes=${probes.map((probe) => probeIdentity(probe)).join(', ')}`,
        'debug'
      );
      return probes;
    }

    const reasonParts = [];
    if (snapshot.exitCode !== 0) {
      reasonParts.push(`exit=${snapshot.exitCode}`);
    }
    if (probes.length === 0) {
      reasonParts.push('no probes');
    }
    if (snapshot.hasErrorText) {
      reasonParts.push('contains "error" text');
    }

    log(
      `[debug] ST-Link not ready (tick=${tick}): ${reasonParts.join(', ') || 'unknown reason'}`,
      'debug'
    );

    await delay(1000);
  }

  throw new Error('Timed out waiting for ST-Link to be ready (probe list still reports an error state).');
}

async function attemptHostUsbRefresh(config, log) {
  log('[debug] attempting host-side USB refresh before USB Replug 1', 'debug');

  try {
    if (process.platform === 'darwin') {
      // macOS does not provide a stable built-in non-privileged command to hard-reset one USB port.
      // Best-effort: trigger USB tree query and CubeProgrammer probe rescan to refresh user-space state.
      await runProcess('/usr/sbin/system_profiler', ['SPUSBDataType'], { cwd: repoRoot });
      await runProcess(config.cubeProgrammerPath, ['-l'], { cwd: repoRoot });
      log('[debug] macOS USB refresh completed (query + probe rescan).', 'debug');
      return;
    }

    if (process.platform === 'win32') {
      // Best-effort device re-enumeration request.
      await runProcess('pnputil', ['/scan-devices'], { cwd: repoRoot });
      await runProcess(config.cubeProgrammerPath, ['-l'], { cwd: repoRoot });
      log('[debug] Windows USB refresh completed (pnputil scan + probe rescan).', 'debug');
      return;
    }

    // Linux best-effort fallback without requiring root-only usbreset tooling.
    await runProcess('udevadm', ['trigger', '--subsystem-match=usb'], { cwd: repoRoot });
    await runProcess(config.cubeProgrammerPath, ['-l'], { cwd: repoRoot });
    log('[debug] Linux USB refresh completed (udev trigger + probe rescan).', 'debug');
  } catch (error) {
    log(`[debug] host-side USB refresh failed (non-fatal): ${error.message}`, 'debug');
  }
}

async function waitForStableStlinkSnapshot(
  config,
  log,
  waitLabel,
  timeoutMs = 30000,
  requiredConsecutiveMatches = 3
) {
  const startedAt = Date.now();
  let tick = 0;
  let lastKey = '';
  let streak = 0;

  log(
    `[debug] waiting for stable ST-Link snapshot (${waitLabel}); requires ${requiredConsecutiveMatches} consecutive matches`,
    'debug'
  );

  while (Date.now() - startedAt < timeoutMs) {
    tick += 1;
    const snapshot = await getProbeSnapshot(config, log, { verbose: false });
    const ids = snapshot.probes.map((probe) => probeIdentity(probe)).sort();
    const key = `${snapshot.exitCode}|${snapshot.hasErrorText}|${ids.join(',')}`;
    const healthy = snapshot.exitCode === 0 && !snapshot.hasErrorText && ids.length > 0;

    if (healthy && key === lastKey) {
      streak += 1;
    } else if (healthy) {
      streak = 1;
    } else {
      streak = 0;
    }

    lastKey = key;

    log(
      `[debug] stabilization poll (${waitLabel}) tick=${tick} healthy=${healthy} streak=${streak}/${requiredConsecutiveMatches} ids=${ids.join(', ') || 'none'}`,
      'debug'
    );

    if (streak >= requiredConsecutiveMatches) {
      log(`[debug] ST-Link snapshot stabilized (${waitLabel}).`, 'debug');
      return snapshot.probes;
    }

    await delay(1000);
  }

  throw new Error(`Timed out waiting for stable ST-Link snapshot (${waitLabel}).`);
}

function buildOptionByteTargets(config, probes) {
  const targets = [];
  const seen = new Set();

  const addTarget = (label, portArg) => {
    if (!portArg || seen.has(portArg)) {
      return;
    }

    seen.add(portArg);
    targets.push({ label, portArg });
  };

  const sortedProbes = [...probes].sort((left, right) => {
    const leftValue = Number.isInteger(left.accessPort) ? left.accessPort : -1;
    const rightValue = Number.isInteger(right.accessPort) ? right.accessPort : -1;
    return rightValue - leftValue;
  });

  addTarget('default ST-Link SWD', 'port=SWD');

  for (const probe of sortedProbes) {
    if (Number.isInteger(probe.index)) {
      addTarget(`SWD index ${probe.index}`, `port=SWD index=${probe.index}`);
    }

    if (probe.serialNumber) {
      addTarget(`SWD serial ${probe.serialNumber}`, `port=SWD sn=${probe.serialNumber}`);
    }
  }

  for (const probe of sortedProbes) {
    if (Number.isInteger(probe.accessPort)) {
      addTarget(`auto usb${probe.accessPort}`, `port=usb${probe.accessPort}`);
      addTarget(`legacy USB${probe.accessPort}`, `port=USB${probe.accessPort}`);
    }
  }

  addTarget('hardcoded fallback', 'port=USB1');

  return targets;
}

async function flashBootloader(config, log) {
  const connectArgs = ['-c', `port=SWD`, `freq=${config.swdFrequencyKhz}`];
  await runCubeCommand(
    config.cubeProgrammerPath,
    [...connectArgs, '-e', 'all'],
    log,
    'Mass erase'
  );
  await runCubeCommand(
    config.cubeProgrammerPath,
    [...connectArgs, '-w', APP_FILES.bootloader, '0x08000000', '-v'],
    log,
    'Bootloader flash'
  );
}

async function flashBootloaderWithRetry(config, log) {
  let attempt = 0;
  let lastNoTargetWarningAttempt = -1;

  // Requested behavior: keep retrying first-stage CubeProgrammer operations until they succeed.
  while (true) {
    attempt += 1;
    log(`[debug] bootloader flash attempt=${attempt}`, 'debug');

    try {
      if (lastNoTargetWarningAttempt !== -1) {
        log('Target MCU detected — starting bootloader flash…');
      }
      await flashBootloader(config, log);
      if (attempt > 1) {
        log(`Bootloader flash succeeded on attempt ${attempt}.`);
      }
      return;
    } catch (error) {
      const msg = stripAnsi(error.message || String(error)).toLowerCase();
      const isNoTarget =
        msg.includes('no stm32 target found') ||
        msg.includes('unable to get core') ||
        msg.includes('target device not found') ||
        msg.includes('target connection failed') ||
        msg.includes('unable to connect') ||
        msg.includes('no target connected');

      if (isNoTarget) {
        // Only print this warning once per group of consecutive no-target failures
        // to avoid flooding the non-verbose log.
        if (attempt !== lastNoTargetWarningAttempt + 1 || lastNoTargetWarningAttempt === -1) {
          log(
            'ST-Link detected but no target MCU found — check that the SWD wires are connected and the target board is powered. Retrying…',
            'warn'
          );
        }
        lastNoTargetWarningAttempt = attempt;
      } else {
        log(
          `Bootloader flash attempt ${attempt} failed; retrying in 1 second. Reason: ${error.message}`,
          'info'
        );
      }
      await delay(1000);
    }
  }
}

async function applyOptionBytes(config, log) {
  log(`[debug] optionBytesCommand=${config.optionBytesCommand}`, 'debug');
  const probes = await listStlinkProbes(config, log);
  log(`[debug] parsed ST-Link probes=${JSON.stringify(probes)}`, 'debug');

  const targets = buildOptionByteTargets(config, probes);
  log(
    `[debug] option-byte target candidates=${targets.map((target) => target.portArg).join(', ') || 'none'}`,
    'debug'
  );

  let lastError = null;

  for (const target of targets) {
    log(`[debug] trying option-byte target ${target.label}: ${target.portArg}`, 'debug');
    try {
      await runCubeCommand(
        config.cubeProgrammerPath,
        ['-c', target.portArg, '-ob', config.optionBytesCommand],
        log,
        `Option-byte update (${target.label})`
      );
      return;
    } catch (error) {
      lastError = error;
      log(`[debug] target failed ${target.portArg}: ${error.message}`, 'debug');
    }
  }

  throw lastError(
    lastError?.message || 'Option-byte update failed before any port target could be attempted.'
  );
}

async function runVendorStage(tool, config, dialog, log) {
  log(`Launching the ${tool.kind} updater. ${tool.manualInstructions}`);

  const exitCode = await runUpgradeTool(tool, config, log);
  if (exitCode !== 0) {
    throw new Error(`${tool.kind} updater exited with code ${exitCode}.`);
  }
}

async function runCloningFlow({ config: rawConfig, dialog, mainWindow, bulkTransferRetryCount = 0 }) {
  const env = await checkEnvironment(rawConfig || {});
  const config = normalizeConfig(rawConfig || {}, env);
  const tools = getToolDescriptors();
  const maxBulkTransferRetries = 3;

  const log = (message, level = 'info') => {
    const printable = `[${level}] ${message}`;
    if (level === 'error') {
      console.error(printable);
    } else {
      console.log(printable);
    }

    send(mainWindow, {
      type: 'log',
      level,
      message,
      time: new Date().toLocaleTimeString(),
    });
  };

  const stage = (name, status, detail = '') => {
    emitProgress(mainWindow, name, status, detail);
    send(mainWindow, {
      type: 'stage',
      name,
      status,
      detail,
      time: new Date().toLocaleTimeString(),
    });
  };

  try {
    stage('Preflight', 'running', 'Checking local prerequisites.');

    if (!env.files.bootloader || !env.files.legacyJar || !env.files.recentJar) {
      throw new Error('Repo files are missing. Re-clone the suite or restore the bundled binaries.');
    }

    if (!config.javaPath && (toolRequiresJava(tools.legacy) || toolRequiresJava(tools.recent))) {
      throw new Error('Java was not found. Install Java and retry, or set a custom Java path in the app.');
    }

    if (!config.cubeProgrammerPath) {
      throw new Error('STM32CubeProgrammer CLI was not found. Install STM32CubeProgrammer and retry, or set the CLI path in the app.');
    }

    stage('Preflight', 'running', 'Waiting for ST-Link to report ready (no error).');
    const probesBeforeFlash = await waitForHealthyStlink(config, log);

    stage('Preflight', 'done', 'Prerequisites look usable.');

    log(`[debug] baseline probes before flash=${JSON.stringify(probesBeforeFlash)}`, 'debug');

    stage('Bootloader Flash', 'running', 'Starting the bootloader flash sequence.');
    stage('Flashing Bootloader', 'running', 'Erasing the MCU and writing the bootloader (auto-retry until success).');
    const tBootloaderStart = Date.now();
    await flashBootloaderWithRetry(config, log);
    const tBootloaderDone = Date.now();
    stage('Flashing Bootloader', 'done', 'Bootloader programmed and verified.');
    stage('Bootloader Flash', 'done', 'Bootloader stage complete.');
    log(`[timing] bootloader flash took ${tBootloaderDone - tBootloaderStart}ms`, 'debug');

    // Pre-emptive launch strategy: start legacy DURING USB re-enumeration window, not after.
    // The legacy updater's JNI USB library must catch the hot-plug event while USB is still
    // transitioning. If we run system_profiler / CubeProgrammer -l first, enumeration fully
    // settles before the JNI lib initialises and legacy never sees a "new device" event —
    // requiring a manual Device Refresh. A short fixed grace period (USB detach takes ~300ms)
    // is enough to ensure the device has fully detached before JNI opens its USB context,
    // without waiting for the re-enumeration to complete.
    log('[timing] waiting 10s grace for USB re-enumeration after bootloader flash', 'debug');
    {
      const countdownSeconds = 10;
      send(mainWindow, {
        type: 'replugPrompt',
        visible: true,
        title: 'Plug In USB Cable',
        message: 'Bootloader flashed successfully. Plug the USB cable back into the device.',
        countdown: countdownSeconds,
      });
      for (let s = countdownSeconds - 1; s >= 0; s--) {
        await delay(1000);
        send(mainWindow, {
          type: 'replugPrompt',
          visible: true,
          title: 'Plug In USB Cable',
          message: 'Bootloader flashed successfully. Plug the USB cable back into the device.',
          countdown: s,
        });
      }
      send(mainWindow, { type: 'replugPrompt', visible: false });
    }
    const tLegacyLaunch = Date.now();
    log(`[timing] launching legacy updater at T+${tLegacyLaunch - tBootloaderDone}ms after bootloader done`, 'debug');

    stage('Legacy Upgrade', 'running', 'Launching the legacy updater.');
    try {
      // No STM32CubeProgrammer polling while legacy is running — concurrent CLI access
      // can contend for the ST-Link port on macOS and cause enumeration failures.
      await runVendorStage(tools.legacy, config, dialog, log);
    } catch (legacyError) {
      throw legacyError;
    }
    const tLegacyDone = Date.now();
    log(`[timing] legacy updater exited after ${tLegacyDone - tLegacyLaunch}ms`, 'debug');
    stage('Legacy Upgrade', 'done', 'Legacy ST firmware stage completed.');

    // Run host USB refresh AFTER legacy exits so CubeProgrammer isn't competing with legacy.
    await attemptHostUsbRefresh(config, log);

    stage('USB Replug 1', 'running', 'Verifying ST-Link is visible after legacy updater closes.');
    const tStabilizeStart = Date.now();
    await waitForStableStlinkSnapshot(
      config,
      log,
      'after legacy updater closes',
      45000,
      3
    );
    log(`[timing] ST-Link stabilized after legacy in ${Date.now() - tStabilizeStart}ms`, 'debug');
    stage('USB Replug 1', 'done', 'ST-Link detected after legacy stage.');

    stage('USB Replug 2', 'done', 'Skipped: no replug wait required before recent updater.');

    stage('Recent Upgrade', 'running', 'Opening the newest ST updater stage.');
    await runVendorStage(tools.recent, config, dialog, log);
    stage('Recent Upgrade', 'done', 'Recent ST firmware stage completed.');

    stage('USB Replug 3', 'done', 'Skipped: no replug wait required before option-byte step.');

    stage('Option Bytes', 'running', 'Applying the nSWBOOT0 change through STM32CubeProgrammer CLI.');
    await applyOptionBytes(config, log);
    stage('Option Bytes', 'done', 'Option-byte write completed.');

    stage('Finished', 'done', 'The automated flow has completed.');
    log(
      'Cloning flow complete. Verify the cloned unit in STM32CubeProgrammer and confirm USB exposes STLink, VCP, and the UNDEFINED mass-storage device.'
    );

    return { ok: true };
  } catch (error) {
    if (isBulkTransferError(error) && bulkTransferRetryCount < maxBulkTransferRetries) {
      const nextAttempt = bulkTransferRetryCount + 1;
      const retriesLeft = maxBulkTransferRetries - bulkTransferRetryCount;

      log(
        `BulkTransferError detected. Restarting cloning flow in 3 seconds (attempt ${nextAttempt}/${maxBulkTransferRetries}, retries left: ${retriesLeft - 1}).`,
        'error'
      );
      stage('Preflight', 'running', 'BulkTransferError detected. Auto-restarting in 3 seconds...');
      await delay(3000);

      return runCloningFlow({
        config: rawConfig,
        dialog,
        mainWindow,
        bulkTransferRetryCount: nextAttempt,
      });
    }

    const friendly = normalizeWorkflowErrorMessage(error);
    stage('Failed', 'error', friendly);
    log(friendly, 'error');
    await dialog.showErrorBox('Cloning flow failed', friendly);
    return { ok: false, error: friendly };
  }
}

async function runOptionBytesOnlyFlow({ config: rawConfig, dialog, mainWindow }) {
  const env = await checkEnvironment(rawConfig || {});
  const config = normalizeConfig(rawConfig || {}, env);

  const log = (message, level = 'info') => {
    const printable = `[${level}] ${message}`;
    if (level === 'error') {
      console.error(printable);
    } else {
      console.log(printable);
    }

    send(mainWindow, {
      type: 'log',
      level,
      message,
      time: new Date().toLocaleTimeString(),
    });
  };

  const stage = (name, status, detail = '') => {
    emitProgress(mainWindow, name, status, detail);
    send(mainWindow, {
      type: 'stage',
      name,
      status,
      detail,
      time: new Date().toLocaleTimeString(),
    });
  };

  try {
    stage('Preflight', 'running', 'Checking STM32CubeProgrammer CLI availability.');

    if (!config.cubeProgrammerPath) {
      throw new Error('STM32CubeProgrammer CLI was not found. Install STM32CubeProgrammer and retry, or set the CLI path in the app.');
    }

    stage('Preflight', 'done', 'CubeProgrammer CLI detected.');

    stage('Option Bytes', 'running', 'Applying option-byte command through STM32CubeProgrammer CLI.');
    await applyOptionBytes(config, log);
    stage('Option Bytes', 'done', 'Option-byte write completed.');

    stage('Finished', 'done', 'Option-byte-only flow completed.');
    log('Option-byte-only run completed successfully.');

    return { ok: true };
  } catch (error) {
    const friendly = normalizeWorkflowErrorMessage(error);
    stage('Failed', 'error', friendly);
    log(friendly, 'error');
    await dialog.showErrorBox('Option-byte-only run failed', friendly);
    return { ok: false, error: friendly };
  }
}

module.exports = {
  checkEnvironment,
  getDefaultConfig,
  runCloningFlow,
  runOptionBytesOnlyFlow,
};