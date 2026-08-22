import { app, BrowserWindow, Menu, shell } from 'electron'
import path from 'path'
import { writeFileSync } from 'fs'
import { SettingsManager } from './services/settings'
import { LibraryManager } from './services/library'
import { GitService } from './services/git'
import { LinksManager } from './services/links'
import { IpcRegistrar } from './ipc'

let mainWindow: BrowserWindow | null = null
let ipcRegistrar: IpcRegistrar | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Trove Skills',
    frame: false, // 无边框窗口，标题栏与窗口按钮由应用内实现
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 冒烟截图（内部验证用）：设置 TROVE_SMOKE_SHOT=输出路径 时，启动后自动截图退出
  const smokeShot = process.env['TROVE_SMOKE_SHOT']
  if (smokeShot) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void mainWindow?.webContents.capturePage().then((img) => {
          if (img) writeFileSync(smokeShot, img.toPNG())
          app.quit()
        })
      }, 2600)
    })
  }

  // 最大化状态变化推送给渲染进程（标题栏按钮图标切换）
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximize-changed', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximize-changed', false)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: 'GitHub / 使用说明',
          click: () => void shell.openExternal('https://github.com/')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  const settings = new SettingsManager(userData)
  const library = new LibraryManager(
    async () => (await settings.load()).skillsDir,
    path.join(userData, 'library-index.json')
  )
  const git = new GitService(async () => (await settings.load()).gitPath)
  const links = new LinksManager(() => userData)
  ipcRegistrar = new IpcRegistrar(settings, library, git, links, path.join(userData, 'tmp'))
  ipcRegistrar.register()

  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void ipcRegistrar?.cleanupAllPreviews()
})