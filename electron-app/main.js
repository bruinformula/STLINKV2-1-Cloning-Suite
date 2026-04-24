const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const {
  checkEnvironment,
  runCloningFlow,
  runOptionBytesOnlyFlow,
  getDefaultConfig,
} = require('./src/orchestrator');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: '#d6dde8',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: process.platform === 'win32',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('config:defaults', async () => getDefaultConfig());

ipcMain.handle('env:check', async (_event, config) => {
  return checkEnvironment(config || {});
});

ipcMain.handle('flow:run', async (_event, config) => {
  return runCloningFlow({
    config: config || {},
    dialog,
    mainWindow,
  });
});

ipcMain.handle('flow:runOptionBytesOnly', async (_event, config) => {
  return runOptionBytesOnlyFlow({
    config: config || {},
    dialog,
    mainWindow,
  });
});

ipcMain.handle('shell:openPath', async (_event, targetPath) => {
  if (!targetPath) {
    return { ok: false, error: 'No path provided.' };
  }

  try {
    const openedError = await shell.openPath(targetPath);
    return {
      ok: openedError === '',
      error: openedError || null,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('shell:selectPath', async (_event, options = {}) => {
  try {
    const response = await dialog.showOpenDialog(mainWindow, {
      title: options.title || 'Select file',
      defaultPath: options.defaultPath || undefined,
      properties: options.properties || ['openFile'],
      filters: options.filters || [],
    });

    if (response.canceled || !response.filePaths.length) {
      return { ok: false, canceled: true };
    }

    return { ok: true, path: response.filePaths[0] };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});