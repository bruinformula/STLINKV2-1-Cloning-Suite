const path = require('path');
const { spawn } = require('child_process');

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      options.onOutput?.(text, 'stdout');
    });

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      options.onOutput?.(text, 'stderr');
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function launchProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    detached: false,
  });

  child.stdout?.on('data', (chunk) => {
    options.onOutput?.(chunk.toString(), 'stdout');
  });

  child.stderr?.on('data', (chunk) => {
    options.onOutput?.(chunk.toString(), 'stderr');
  });

  return child;
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
}

function macScriptLines(lines) {
  const args = [];
  for (const line of lines) {
    args.push('-e', line);
  }
  return args;
}

async function clickButtonIfPresent(buttonName) {
  return runProcess(
    'osascript',
    macScriptLines([
      'tell application "System Events"',
      'tell first application process whose frontmost is true',
      'if exists window 1 then',
      `if exists button "${buttonName}" of window 1 then click button "${buttonName}" of window 1`,
      'end if',
      'end tell',
      'end tell',
    ])
  );
}

async function chooseLegacyProfile() {
  return runProcess(
    'osascript',
    macScriptLines([
      'tell application "System Events"',
      'tell first application process whose frontmost is true',
      'if exists window 1 then',
      'tell window 1',
      'if exists pop up button 1 then',
      'click pop up button 1',
      'delay 1',
      'repeat with itemRef in menu items of menu 1 of pop up button 1',
      'set itemName to name of itemRef',
      'if itemName contains "STM32" and itemName contains "+" then',
      'click itemRef',
      'exit repeat',
      'end if',
      'end repeat',
      'end if',
      'end tell',
      'end if',
      'end tell',
      'end tell',
    ])
  );
}

async function automateLegacyMac(log) {
  log('Attempting best-effort macOS UI automation for the legacy updater.');
  await delay(3500);
  await clickButtonIfPresent('Device Connect');
  await delay(2500);
  await chooseLegacyProfile();
  await delay(1200);
  await clickButtonIfPresent('Device Connect');
  await delay(1000);
  await clickButtonIfPresent('Yes');
  await delay(1000);
  await clickButtonIfPresent('Yes >>>');
}

async function automateRecentMac(log) {
  log('Attempting best-effort macOS UI automation for the recent updater.');
  await delay(3500);
  await clickButtonIfPresent('Device Connect');
  await delay(1500);
  await clickButtonIfPresent('OK');
  await delay(1500);
  await clickButtonIfPresent('Device Connect');
  await delay(1500);
  await clickButtonIfPresent('Yes');
  await delay(1000);
  await clickButtonIfPresent('Yes >>>');
}

function buildMacosEnv() {
  // Electron on macOS gets a stripped PATH from launchd. Enrich it so java
  // subprocesses can find system libraries and their own helpers.
  const extraDirs = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  const existing = (process.env.PATH || '').split(':').filter(Boolean);
  const merged = [...new Set([...existing, ...extraDirs])].join(':');
  return { ...process.env, PATH: merged };
}

function getJavaLaunch(tool, config) {
  const needsRosetta =
    process.platform === 'darwin' &&
    process.arch === 'arm64' &&
    tool.forceIntelRuntime;

  // Detect whether the detected java binary itself is x86_64 or ARM64.
  // If it is ARM64 and we need Rosetta, wrap with arch -x86_64.
  // We pass the full javaPath so we never rely on PATH to find java.
  if (needsRosetta) {
    return {
      command: '/usr/bin/arch',
      args: [
        '-x86_64',
        config.javaPath,
        `-Djava.library.path=${tool.nativeDir}`,
        '-jar',
        tool.jarPath,
      ],
      env: buildMacosEnv(),
    };
  }

  return {
    command: config.javaPath,
    args: [
      `-Djava.library.path=${tool.nativeDir}`,
      '-jar',
      tool.jarPath,
    ],
    env: process.platform === 'darwin' ? buildMacosEnv() : undefined,
  };
}

function getMacCliJavaLaunch(tool, config) {
  const launch = getJavaLaunch(tool, config);
  const commandParts = [launch.command, ...launch.args].map(shellEscape).join(' ');

  return {
    command: '/bin/zsh',
    args: ['-lc', commandParts],
    env: launch.env,
    debugCommand: commandParts,
  };
}

async function runUpgradeTool(tool, config, log) {
  if (process.platform === 'win32' && tool.exePath) {
    log(`[debug] launching Windows updater executable ${tool.exePath}`, 'debug');
    const child = launchProcess(tool.exePath, [], {
      cwd: path.dirname(tool.exePath),
      onOutput: (text, stream) => {
        const prefix = stream === 'stderr' ? '[vendor err]' : '[vendor]';
        const trimmed = text.trim();
        if (trimmed) {
          log(`${prefix} ${trimmed}`);
        }
      },
    });

    return waitForExit(child);
  }

  const launch = process.platform === 'darwin'
    ? getMacCliJavaLaunch(tool, config)
    : getJavaLaunch(tool, config);
  log(
    `[debug] java launch: ${launch.debugCommand || `${launch.command} ${launch.args.slice(0, 2).join(' ')} ...`} (jar: ${path.basename(tool.jarPath)})`
  );
  const child = launchProcess(launch.command, launch.args, {
    cwd: path.dirname(tool.jarPath),
    env: launch.env,
    onOutput: (text, stream) => {
      const prefix = stream === 'stderr' ? '[vendor err]' : '[vendor]';
      const trimmed = text.trim();
      if (trimmed) {
        log(`${prefix} ${trimmed}`);
      }
    },
  });

  if (process.platform === 'darwin' && config.autoDriveVendorTools) {
    try {
      if (tool.kind === 'legacy') {
        log('Skipping legacy UI auto-click automation on macOS; running legacy updater in manual mode for reliability.');
      }

      if (tool.kind === 'recent') {
        await automateRecentMac(log);
      }
    } catch (error) {
      log(`Vendor UI automation failed: ${error.message}`);
    }
  }

  return waitForExit(child);
}

module.exports = {
  runProcess,
  runUpgradeTool,
};