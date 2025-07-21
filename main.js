const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, shell, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const simpleGit = require('simple-git');
const axios = require('axios');
const os = require('os');

// GPU optimizasyonları
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('--disable-gpu');
app.commandLine.appendSwitch('--no-sandbox');
app.commandLine.appendSwitch('--max-old-space-size=256');

class GitAutoSync {
    constructor() {
        this.mainWindow = null;
        this.tray = null;
        this.config = null;
        this.isRunning = false;
        this.syncInterval = null;
        this.projectScanInterval = null;
        this.debounceTimers = new Map();
        this.isQuitting = false;

        // Network status tracking
        this.networkStatus = {
            isOnline: true,
            lastCheck: Date.now()
        };

        // Transfer statistics - simplified
        this.transferStats = {
            totalFiles: 0,
            uploadSpeed: 0,
            currentFile: '',
            uploadedFiles: 0
        };

        // Optimized tracking - ONLY folder modification times
        this.projectStates = new Map();
        this.syncQueue = new Set();

        // Status tracking - optimized
        this.stats = {
            totalProjects: 0,
            completedProjects: 0,
            failedProjects: 0,
            startTime: null,
            currentProject: null,
            currentPath: null
        };

        this.status = {
            phase: 'idle',
            message: 'Hazır',
            progress: 0,
            isRunning: false,
            isSyncing: false,
            projects: new Map(),
            networkStatus: this.networkStatus,
            transferStats: this.transferStats,
            currentPath: null
        };

        // Default ignored patterns
        this.defaultIgnoredPatterns = [
            '**/node_modules/**',
            '**/.git/**',
            '**/.vscode/**',
            '**/.idea/**',
            '**/dist/**',
            '**/build/**',
            '**/.next/**',
            '**/.cache/**',
            '**/*.tmp',
            '**/*.temp',
            '**/.env',
            '**/.env.*',
            '**/logs/**',
            '**/*.log',
            '**/coverage/**',
            '**/__pycache__/**',
            '**/*.pyc',
            '**/target/**',
            '**/bin/**',
            '**/obj/**'
        ];

        this.configPath = path.join(require('os').homedir(), '.gitautosync', 'config.json');
        this.configDir = path.dirname(this.configPath);

        this.setupIPC();
        this.startNetworkMonitoring();
    }

    // Network durumu izleme
    startNetworkMonitoring() {
        setInterval(async () => {
            try {
                await axios.get('https://github.com', { timeout: 5000 });
                this.networkStatus.isOnline = true;
            } catch (error) {
                this.networkStatus.isOnline = false;
            }
            this.networkStatus.lastCheck = Date.now();
        }, 10000);
    }

    logMessage(message) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ${message}`);
    }

    setupIPC() {
        const handlers = ['get-config', 'save-config', 'select-folder', 'start-manual-sync', 'toggle-sync', 'get-status'];
        handlers.forEach(handler => ipcMain.removeAllListeners(handler));

        ipcMain.handle('get-config', async () => this.config);
        ipcMain.handle('save-config', async (event, config) => {
            const success = await this.saveConfig(config);
            if (success) this.restartAutoSync();
            return success;
        });
        ipcMain.handle('select-folder', async (event) => {
            try {
                if (!this.mainWindow || this.mainWindow.isDestroyed()) return null;
                const result = await dialog.showOpenDialog(this.mainWindow, {
                    properties: ['openDirectory'],
                    title: 'Proje Klasörü Seçin',
                    buttonLabel: 'Seç'
                });
                return result.canceled ? null : result.filePaths[0];
            } catch (error) {
                this.logMessage('❌ Dialog hatası: ' + error.message);
                return null;
            }
        });
        ipcMain.handle('start-manual-sync', async () => this.manualSync());
        ipcMain.handle('toggle-sync', async (event, start) => {
            if (start) this.startAutoSync();
            else this.stopAutoSync();
            return true;
        });
        ipcMain.handle('get-status', async () => this.getDetailedStatus());
    }

    // In the GitAutoSync constructor, modify the createMainWindow call
    async init() {
        try {
            await fs.ensureDir(this.configDir);
            const hasExistingConfig = await this.loadConfig();

            // Pass whether this is first run to createMainWindow
            this.createMainWindow(!hasExistingConfig);
            await this.createTray();

            this.logMessage('🚀 GitAutoSync başarıyla başlatıldı');

            // Show notification based on first run or not
            if (!hasExistingConfig) {
                this.showNotification('GitHubAutoSync', '🚀 İlk kurulum için ayarları yapılandırın');
            } else {
                this.showNotification('GitHubAutoSync', '🚀 Uygulama başarıyla başlatıldı ve arkaplanda çalışmaya başladı!');
            }

            if (this.config) {
                // Otomatik başlatma
                setTimeout(() => this.startAutoSync(), 2000);
            }
        } catch (error) {
            this.logMessage('❌ Başlatma hatası: ' + error.message);
        }
    }

// Modify the loadConfig method to return boolean
    async loadConfig() {
        try {
            if (await fs.pathExists(this.configPath)) {
                const data = await fs.readFile(this.configPath, 'utf8');
                this.config = JSON.parse(data);
                if (!this.config.ignoredPatterns) {
                    this.config.ignoredPatterns = [...this.defaultIgnoredPatterns];
                }
                this.logMessage('📋 Config yüklendi');
                return true; // Config exists
            }
        } catch (error) {
            this.logMessage('❌ Config yükleme hatası: ' + error.message);
        }
        return false; // Config doesn't exist
    }

// Modify createMainWindow to accept a parameter
    createMainWindow(showOnFirstRun = false) {
        this.mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: false,
                webSecurity: true
            },
            show: showOnFirstRun, // Show immediately if first run, otherwise hide
            autoHideMenuBar: true,
            title: 'GitHubAutoSync',
            icon: this.getTrayIcon(),
            center: true, // Center the window when showing
            alwaysOnTop: showOnFirstRun // Bring to front on first run
        });

        this.mainWindow.loadFile('renderer.html');

        if (process.argv.includes('--dev')) {
            this.mainWindow.webContents.openDevTools();
        }

        // If this is first run, ensure window is focused after loading
        if (showOnFirstRun) {
            this.mainWindow.once('ready-to-show', () => {
                this.mainWindow.show();
                this.mainWindow.focus();
                // Remove always on top after focusing
                setTimeout(() => {
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.setAlwaysOnTop(false);
                    }
                }, 1000);
            });
        }

        this.mainWindow.on('close', (event) => {
            if (!this.isQuitting) {
                event.preventDefault();
                this.mainWindow.hide();

                // Different notification based on whether it's first run
                if (!this.config) {
                    this.showNotification('GitHubAutoSync', 'Kurulum tamamlanmadı! Sistem tepsisinden tekrar açabilirsiniz.');
                } else {
                    this.showNotification('GitHubAutoSync', 'Uygulama sistem tepsisinde çalışmaya devam ediyor.');
                }
            }
        });

        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });
    }

    async saveConfig(config) {
        try {
            if (!config.ignoredPatterns) {
                config.ignoredPatterns = [...this.defaultIgnoredPatterns];
            }
            await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
            this.config = config;
            this.logMessage('💾 Config kaydedildi');
            return true;
        } catch (error) {
            this.logMessage('❌ Config kaydetme hatası: ' + error.message);
            return false;
        }
    }
    // Tray icon dosya yolunu döndür
    getTrayIcon() {
        let iconName = 'icon.png';

        // Platform-specific icon handling
        if (process.platform === 'win32') {
            iconName = 'icon.ico';
        } else if (process.platform === 'darwin') {
            iconName = 'iconTemplate.png';
        }

        const iconPath = path.join(__dirname, 'assets', 'icons', iconName);

        // Icon dosyası var mı kontrol et
        if (fs.pathExistsSync(iconPath)) {
            return nativeImage.createFromPath(iconPath);
        }

        // Fallback: Basit bir icon oluştur
        return nativeImage.createFromBuffer(Buffer.from(
            '89504E470D0A1A0A0000000D494844520000001000000010080200000090916836000000017352474200AECE1CE90000000467414D410000B18F0BFC6105000000097048597300000EC300000EC301C76FA864000000354944415478DAB592410E00200C03AD3BDF47B80F605D4E14F98A4F6A6B8F0F8F0F5B0F0F4F0F3F0F1F0F8F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F000000FFFF03009C8D36260000000049454E44AE426082', 'hex'
        ));
    }

    // Notification icon'u için ayrı fonksiyon
    getNotificationIcon() {
        // Bildirim için daha büyük boyutlu icon kullan
        let iconName = 'icon.png';

        if (process.platform === 'win32') {
            iconName = 'icon.ico';
        } else if (process.platform === 'darwin') {
            iconName = 'icon.png'; // macOS için PNG kullan
        }

        const iconPath = path.join(__dirname, 'assets', 'icons', iconName);

        if (fs.pathExistsSync(iconPath)) {
            return nativeImage.createFromPath(iconPath);
        }

        return this.getTrayIcon(); // Fallback
    }

    async createTray() {
        try {
            const trayIcon = this.getTrayIcon();
            this.tray = new Tray(trayIcon);
            this.updateTrayMenu();
            this.tray.setToolTip('GitHubAutoSync');

            this.tray.on('click', () => {
                if (this.mainWindow && this.mainWindow.isVisible()) {
                    this.mainWindow.hide();
                } else if (this.mainWindow) {
                    this.mainWindow.show();
                    this.mainWindow.focus();
                }
            });

            this.logMessage('📍 System tray oluşturuldu');
        } catch (error) {
            this.logMessage('❌ Tray oluşturma hatası: ' + error.message);
        }
    }

    updateTrayMenu() {
        if (!this.tray) return;

        const networkStatusText = this.networkStatus.isOnline ? '🟢 Çevrimiçi' : '🔴 Çevrimdışı';
        const currentPathText = this.status.currentPath ?
            `📂 ${path.basename(this.status.currentPath)}` : '📂 Klasör yok';

        const template = [
            { label: 'GitHubAutoSync', enabled: false },
            { type: 'separator' },
            { label: networkStatusText, enabled: false },
            { label: `Durum: ${this.status.message}`, enabled: false },
            { label: `Projeler: ${this.status.projects.size}`, enabled: false },
            { label: currentPathText, enabled: false },
            { type: 'separator' },
            {
                label: this.isRunning ? '⏸️ Durdur' : '▶️ Başlat',
                click: () => {
                    if (this.isRunning) this.stopAutoSync();
                    else this.startAutoSync();
                }
            },
            {
                label: '🔄 Manuel Sync',
                click: () => this.manualSync(),
                enabled: !!this.config && !this.status.isSyncing
            },
            {
                label: '📊 Detayları Göster',
                click: () => {
                    if (this.mainWindow) {
                        this.mainWindow.show();
                        this.mainWindow.focus();
                    }
                }
            },
            { type: 'separator' },
            { label: '🚪 Çıkış', click: () => { this.isQuitting = true; app.quit(); } }
        ];

        const contextMenu = Menu.buildFromTemplate(template);
        this.tray.setContextMenu(contextMenu);
    }

    updateStatus(phase, message, progress = 0, extra = {}) {
        this.status = {
            ...this.status,
            phase,
            message,
            progress: Math.min(100, Math.max(0, progress)),
            isRunning: this.isRunning,
            isSyncing: this.status.isSyncing,
            networkStatus: this.networkStatus,
            transferStats: this.transferStats,
            currentPath: this.stats.currentPath,
            ...extra
        };

        this.sendStatus();
        this.updateTrayMenu();

        if (this.tray) {
            this.tray.setToolTip(`GitHubAutoSync - ${message}`);
        }
    }

    sendStatus() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('status-update', this.getDetailedStatus());
        }
    }

    // YENİ: Yeni proje tarama fonksiyonu
    async scanForNewProjects() {
        if (!this.config?.watchPaths || this.status.isSyncing) return;

        const watchPaths = this.config.watchPaths || [];
        let newProjectsFound = 0;

        for (const watchPath of watchPaths) {
            if (!(await fs.pathExists(watchPath))) continue;

            try {
                const items = await fs.readdir(watchPath);

                for (const item of items) {
                    const projectPath = path.join(watchPath, item);

                    // Zaten bilinen bir proje mi?
                    if (this.status.projects.has(projectPath)) continue;

                    try {
                        const stat = await fs.stat(projectPath);
                        if (!stat.isDirectory()) continue;

                        const gitPath = path.join(projectPath, '.git');
                        const hasGitRepo = await fs.pathExists(gitPath);

                        // Get folder modification time
                        const folderStat = await fs.stat(projectPath);
                        const mtime = folderStat.mtime.getTime();

                        const project = {
                            name: item,
                            path: projectPath,
                            lastModified: mtime,
                            lastCheck: new Date().toISOString(),
                            hasGitRepo: hasGitRepo,
                            status: hasGitRepo ? 'ready' : 'needs-repo',
                            message: hasGitRepo ? 'Yeni proje algılandı' : 'Git repository gerekiyor',
                            progress: 0,
                            currentOperation: ''
                        };

                        this.projectStates.set(projectPath, { mtime, lastCheck: Date.now() });
                        this.status.projects.set(projectPath, project);
                        newProjectsFound++;

                        if (hasGitRepo) {
                            this.sendLog(`📁 Yeni Git projesi algılandı: ${item}`, 'info');
                        } else {
                            this.sendLog(`📁 Yeni proje algılandı (repo gerekiyor): ${item}`, 'warning');
                            // Add to queue immediately for repo creation
                            this.syncQueue.add(projectPath);
                        }

                    } catch (projectError) {
                        // Hata durumunda sessizce devam et
                    }
                }

            } catch (error) {
                // Hata durumunda sessizce devam et
            }
        }

        if (newProjectsFound > 0) {
            this.stats.totalProjects = this.status.projects.size;
            this.sendLog(`✨ ${newProjectsFound} yeni proje algılandı ve izlemeye alındı!`, 'success');
            this.showNotification('GitHubAutoSync', `${newProjectsFound} yeni proje algılandı ve izlemeye alındı!`);
        }
    }

    // OPTIMIZED: Lightweight folder monitoring
    async startFolderMonitoring() {
        if (!this.config?.watchPaths) return;

        this.updateStatus('monitoring', 'Klasör değişiklikleri izleniyor...', 0);

        // Check folder modifications every 5 seconds
        this.syncInterval = setInterval(async () => {
            await this.checkFolderModifications();
        }, 5000);

        // YENİ: Yeni proje tarama - her 30 saniyede bir
        this.projectScanInterval = setInterval(async () => {
            await this.scanForNewProjects();
        }, 30000);

        this.sendLog('👁️ Klasör izleme ve yeni proje tarama başlatıldı', 'info');
    }

    async checkFolderModifications() {
        if (this.status.isSyncing) return;

        let totalProjects = 0;
        let processedProjects = 0;

        for (const [projectPath, projectState] of this.projectStates.entries()) {
            totalProjects++;
        }

        for (const [projectPath, projectState] of this.projectStates.entries()) {
            try {
                if (!(await fs.pathExists(projectPath))) {
                    // Proje silinmişse listeden kaldır
                    this.projectStates.delete(projectPath);
                    this.status.projects.delete(projectPath);
                    this.sendLog(`❌ Proje kaldırıldı: ${path.basename(projectPath)}`, 'warning');
                    continue;
                }

                const projectName = path.basename(projectPath);
                processedProjects++;
                const checkProgress = Math.round((processedProjects / totalProjects) * 100);

                // Update current path being checked
                this.stats.currentPath = projectPath;

                // Update status with current checking info
                this.updateStatus('monitoring',
                    `Değişiklikler inceleniyor: ${projectName} (${checkProgress}%)`,
                    checkProgress);

                const folderStat = await fs.stat(projectPath);
                const currentMtime = folderStat.mtime.getTime();

                // Check if it has .git directory
                const gitPath = path.join(projectPath, '.git');
                const hasGitRepo = await fs.pathExists(gitPath);

                // Update project info
                const project = this.status.projects.get(projectPath);
                if (project) {
                    project.hasGitRepo = hasGitRepo;
                    project.lastCheck = new Date().toISOString();

                    if (!hasGitRepo) {
                        project.status = 'needs-repo';
                        project.message = 'Git repository gerekiyor';
                        this.debouncedQueueAdd(projectPath);
                    } else if (currentMtime > projectState.mtime) {
                        project.lastModified = currentMtime;
                        project.status = 'changed';
                        project.message = 'Değişiklikler algılandı';
                        this.debouncedQueueAdd(projectPath);
                    } else {
                        project.status = 'ready';
                        project.message = 'Güncel';
                    }
                }

                // Only update mtime if folder actually changed
                if (currentMtime > projectState.mtime) {
                    this.projectStates.set(projectPath, {
                        mtime: currentMtime,
                        lastCheck: Date.now()
                    });
                }

                // Small delay to prevent blocking
                await new Promise(resolve => setTimeout(resolve, 50));

            } catch (error) {
                this.sendLog(`❌ Klasör kontrol hatası: ${error.message}`, 'error');
            }
        }

        // Clear current path when done
        this.stats.currentPath = null;

        // Update status back to monitoring when done
        this.updateStatus('monitoring', 'Klasör değişiklikleri izleniyor...', 0);
    }

    // scanProjects fonksiyonunu güncelleyin - boyut hesaplama kaldırıldı
    async scanProjects() {
        this.updateStatus('scanning', 'Projeler taranıyor...', 0);
        this.sendLog('🔍 Proje taraması başlatıldı...', 'info');

        const watchPaths = this.config.watchPaths || [];
        let projectCount = 0;
        let totalItems = 0;
        let processedItems = 0;

        // First count total items
        for (const watchPath of watchPaths) {
            this.stats.currentPath = watchPath;
            if (await fs.pathExists(watchPath)) {
                try {
                    const items = await fs.readdir(watchPath);
                    totalItems += items.length;
                } catch (error) {
                    // Skip if can't read directory
                }
            }
        }

        for (const watchPath of watchPaths) {
            this.stats.currentPath = watchPath;

            if (!(await fs.pathExists(watchPath))) {
                this.sendLog(`⚠️ Klasör bulunamadı: ${watchPath}`, 'warning');
                continue;
            }

            try {
                const items = await fs.readdir(watchPath);

                for (const item of items) {
                    processedItems++;
                    const scanProgress = Math.round((processedItems / totalItems) * 100);

                    const projectPath = path.join(watchPath, item);
                    this.stats.currentPath = projectPath;

                    this.updateStatus('scanning',
                        `Taranıyor: ${item} (${scanProgress}%)`,
                        scanProgress);

                    try {
                        const stat = await fs.stat(projectPath);
                        if (!stat.isDirectory()) continue;

                        const gitPath = path.join(projectPath, '.git');
                        const hasGitRepo = await fs.pathExists(gitPath);

                        // Get folder modification time - boyut hesaplama kaldırıldı
                        const folderStat = await fs.stat(projectPath);
                        const mtime = folderStat.mtime.getTime();

                        const project = {
                            name: item,
                            path: projectPath,
                            lastModified: mtime,
                            lastCheck: new Date().toISOString(),
                            hasGitRepo: hasGitRepo,
                            status: hasGitRepo ? 'ready' : 'needs-repo',
                            message: hasGitRepo ? 'Hazır' : 'Git repository gerekiyor',
                            progress: 0,
                            currentOperation: ''
                        };

                        this.projectStates.set(projectPath, { mtime, lastCheck: Date.now() });
                        this.status.projects.set(projectPath, project);
                        projectCount++;

                        if (hasGitRepo) {
                            this.sendLog(`📁 Git projesi eklendi: ${item}`, 'info');
                        } else {
                            this.sendLog(`📁 Proje eklendi (repo gerekiyor): ${item}`, 'warning');
                            // Add to queue immediately for repo creation
                            this.syncQueue.add(projectPath);
                        }

                    } catch (projectError) {
                        this.sendLog(`❌ Proje kontrol hatası (${item}): ${projectError.message}`, 'error');
                    }

                    // Small delay
                    await new Promise(resolve => setTimeout(resolve, 50));
                }

            } catch (error) {
                this.sendLog(`❌ Klasör okuma hatası (${watchPath}): ${error.message}`, 'error');
            }
        }

        this.stats.totalProjects = projectCount;
        this.stats.currentPath = null;
        this.updateStatus('ready', `${projectCount} proje tarandı`, 100);
        this.sendLog(`✅ ${projectCount} proje başarıyla tarandı`, 'success');

        return projectCount;
    }

    // processQueue fonksiyonunu güncelleyin - simplified transfer stats
    async processQueue() {
        if (this.status.isSyncing || this.syncQueue.size === 0) return;

        this.status.isSyncing = true;
        const projectPaths = Array.from(this.syncQueue);
        this.syncQueue.clear();

        this.stats = {
            ...this.stats,
            startTime: Date.now(),
            completedProjects: 0,
            failedProjects: 0,
            totalProjects: projectPaths.length
        };

        // Reset transfer stats - simplified
        this.transferStats = {
            totalFiles: 0,
            uploadSpeed: 0,
            currentFile: '',
            uploadedFiles: 0
        };

        this.updateStatus('syncing', 'Senkronizasyon başlatılıyor...', 0);
        this.sendLog(`🔄 ${projectPaths.length} proje senkronize ediliyor...`, 'info');

        for (let i = 0; i < projectPaths.length; i++) {
            const projectPath = projectPaths[i];
            const projectName = path.basename(projectPath);

            this.stats.currentProject = projectName;
            this.stats.currentPath = projectPath;

            // Her projenin başlangıç progress değeri
            const baseProgress = (i / projectPaths.length) * 100;

            this.updateStatus('syncing', `Senkronize ediliyor: ${projectName} (${i+1}/${projectPaths.length})`, baseProgress);

            // Update project status
            const project = this.status.projects.get(projectPath);
            if (project) {
                project.status = 'syncing';
                project.currentOperation = 'Başlatılıyor...';
                project.progress = 0;
            }

            this.sendStatus();

            // Proje senkronizasyonu ve progress callback ile
            const success = await this.syncProjectWithProgress(projectPath, projectName, i, projectPaths.length);

            if (success) {
                this.stats.completedProjects++;
                this.transferStats.uploadedFiles++;
                // Proje tamamlandığında tam progress değeri
                const completedProgress = ((i + 1) / projectPaths.length) * 100;
                this.updateStatus('syncing', `Tamamlandı: ${projectName} (${i+1}/${projectPaths.length})`, completedProgress);

                if (project) {
                    project.status = 'synced';
                    project.lastCheck = new Date().toISOString();
                    project.message = 'Başarıyla senkronize edildi';
                    project.progress = 100;
                    project.currentOperation = 'Tamamlandı';
                }
            } else {
                this.stats.failedProjects++;
                if (project) {
                    project.status = 'error';
                    project.message = 'Senkronizasyon hatası';
                    project.progress = 0;
                    project.currentOperation = 'Hata oluştu';
                }
            }

            // Small delay to prevent UI blocking
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const duration = Math.round((Date.now() - this.stats.startTime) / 1000);

        this.updateStatus('monitoring', 'Senkronizasyon tamamlandı', 100);

        this.sendLog(`✅ Senkronizasyon tamamlandı! ${this.stats.completedProjects}/${this.stats.totalProjects} proje başarılı (${duration}s)`, 'success');

        this.showNotification('GitHubAutoSync',
            `${this.stats.completedProjects} proje başarıyla senkronize edildi! (${duration}s)`);

        this.status.isSyncing = false;
        this.stats.currentProject = null;
        this.stats.currentPath = null;

        setTimeout(() => {
            this.updateStatus('monitoring', 'Klasör değişiklikleri izleniyor...', 0);
        }, 2000);
    }

    // Simplified sync function
    async syncProjectWithProgress(projectPath, projectName, projectIndex, totalProjects) {
        const project = this.status.projects.get(projectPath);
        const startTime = Date.now();

        // Progress callback fonksiyonu
        const updateProgressCallback = (operation, projectProgress) => {
            // Upload hızı hesaplama - simplified
            if (this.transferStats.uploadedFiles > 0) {
                const elapsedSeconds = (Date.now() - startTime) / 1000;
                this.transferStats.uploadSpeed = this.transferStats.uploadedFiles / elapsedSeconds;
            }

            // Proje bazlı progress güncelleme
            if (project) {
                project.currentOperation = operation;
                project.progress = Math.round(projectProgress * 10) / 10;
                this.sendStatus();
            }

            // Genel progress hesaplama
            const baseProgress = (projectIndex / totalProjects) * 100;
            const projectContribution = (1 / totalProjects) * 100;
            const currentProjectProgress = (projectProgress / 100) * projectContribution;
            const overallProgress = baseProgress + currentProjectProgress;

            const roundedProgress = Math.round(overallProgress * 10) / 10;

            // Transfer bilgilerini güncelle - simplified
            const speedText = this.transferStats.uploadSpeed > 0 ?
                ` (${this.transferStats.uploadSpeed.toFixed(1)} proje/s)` : '';

            this.updateStatus('syncing',
                `${operation} - ${projectName}${speedText}`,
                roundedProgress
            );
        };

        try {
            updateProgressCallback('Klasör kontrol ediliyor...', 5.0);

            if (!(await fs.pathExists(projectPath))) {
                this.sendLog(`❌ Proje klasörü bulunamadı: ${projectPath}`, 'error');
                return false;
            }

            this.transferStats.currentFile = projectName;

            const repoName = this.sanitizeRepoName(projectName);
            updateProgressCallback('GitHub repository kontrol ediliyor...', 15.0);

            // Network kontrolü
            if (!this.networkStatus.isOnline) {
                updateProgressCallback('Ağ bağlantısı yok', 0);
                this.sendLog(`❌ Ağ bağlantısı yok (${repoName})`, 'error');
                return false;
            }

            // Check if repository exists
            let repoExists = false;
            try {
                repoExists = await this.checkGitHubRepo(repoName);
            } catch (error) {
                this.sendLog(`❌ GitHub bağlantı hatası (${repoName}): ${error.message}`, 'error');
                updateProgressCallback('GitHub bağlantı hatası', 0);
                return false;
            }

            // Create repository if it doesn't exist
            if (!repoExists) {
                updateProgressCallback('GitHub repository oluşturuluyor...', 25.0);
                this.sendLog(`📦 Repository oluşturuluyor: ${repoName}`, 'info');
                try {
                    await this.createGitHubRepo(repoName);
                    this.sendLog(`✅ Repository oluşturuldu: ${repoName}`, 'success');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    updateProgressCallback('Repository oluşturuldu', 35.0);
                } catch (error) {
                    this.sendLog(`❌ Repository oluşturulamadı (${repoName}): ${error.message}`, 'error');
                    updateProgressCallback('Repository oluşturma hatası', 0);
                    return false;
                }
            } else {
                updateProgressCallback('Repository mevcut', 35.0);
            }

            updateProgressCallback('Git repository kontrol ediliyor...', 45.0);

            // Git operations
            const git = simpleGit(projectPath);

            let isRepo = false;
            try {
                isRepo = await git.checkIsRepo();
            } catch (error) {
                isRepo = false;
            }

            if (!isRepo) {
                updateProgressCallback('Yerel Git repository başlatılıyor...', 55.0);
                this.sendLog(`🔧 Git repository başlatılıyor: ${repoName}`, 'info');
                try {
                    await this.initGitRepo(git, repoName, projectPath);
                    updateProgressCallback('Git repository başlatıldı', 65.0);
                    if (project) {
                        project.hasGitRepo = true;
                    }
                } catch (error) {
                    this.sendLog(`❌ Git repo başlatma hatası (${repoName}): ${error.message}`, 'error');
                    updateProgressCallback('Git başlatma hatası', 0);
                    return false;
                }
            } else {
                updateProgressCallback('Git repository mevcut', 65.0);
            }

            updateProgressCallback('Remote URL güncelleniyor...', 70.0);

            // Setup remote
            try {
                await git.removeRemote('origin').catch(() => {});
                const encodedRepoName = encodeURIComponent(repoName);
                const remoteUrl = `https://${this.config.token}@github.com/${this.config.username}/${encodedRepoName}.git`;
                await git.addRemote('origin', remoteUrl);
                updateProgressCallback('Remote URL güncellendi', 75.0);
            } catch (error) {
                this.sendLog(`⚠️ Remote URL güncellenemedi (${repoName}): ${error.message}`, 'warning');
                updateProgressCallback('Remote URL uyarısı', 75.0);
            }

            updateProgressCallback('Değişiklikler kontrol ediliyor...', 80.0);

            // Check for changes and commit
            let hasChanges = false;
            let changedFileCount = 0;
            try {
                const status = await git.status();
                hasChanges = status.files.length > 0;
                changedFileCount = status.files.length;

                if (hasChanges) {
                    this.transferStats.totalFiles += changedFileCount;
                    updateProgressCallback(`${changedFileCount} dosya commit ediliyor...`, 85.0);
                    this.sendLog(`📝 ${changedFileCount} dosya değişikliği commit ediliyor: ${repoName}`, 'info');
                    await git.add('.');
                    await git.commit(`Auto sync - ${new Date().toLocaleString('tr-TR')}`);
                    updateProgressCallback('Değişiklikler commit edildi', 90.0);
                } else {
                    updateProgressCallback('Değişiklik bulunamadı', 85.0);
                }
            } catch (error) {
                this.sendLog(`❌ Commit hatası (${repoName}): ${error.message}`, 'error');
                updateProgressCallback('Commit hatası', 0);
                return false;
            }

            updateProgressCallback('GitHub\'a yükleniyor...', 95.0);

            // Push changes
            try {
                await git.push('origin', 'main');
                if (hasChanges) {
                    this.sendLog(`✅ Başarıyla senkronize edildi: ${repoName} (${changedFileCount} dosya yüklendi)`, 'success');
                    updateProgressCallback('Başarıyla tamamlandı', 100.0);
                } else {
                    this.sendLog(`ℹ️ Değişiklik yok: ${repoName}`, 'info');
                    updateProgressCallback('Değişiklik yok - Güncel', 100.0);
                }
            } catch (pushError) {
                if (pushError.message.includes('upstream') || pushError.message.includes('no upstream')) {
                    try {
                        updateProgressCallback('İlk yükleme yapılıyor...', 98.0);
                        await git.push(['-u', 'origin', 'main']);
                        this.sendLog(`✅ İlk push tamamlandı: ${repoName}`, 'success');
                        updateProgressCallback('İlk yükleme tamamlandı', 100.0);
                    } catch (upstreamError) {
                        this.sendLog(`❌ Push hatası (${repoName}): ${upstreamError.message}`, 'error');
                        updateProgressCallback('Yükleme hatası', 0);
                        return false;
                    }
                } else {
                    this.sendLog(`❌ Push hatası (${repoName}): ${pushError.message}`, 'error');
                    updateProgressCallback('Yükleme hatası', 0);
                    return false;
                }
            }

            return true;

        } catch (error) {
            this.sendLog(`❌ ${projectName} genel hatası: ${error.message}`, 'error');
            updateProgressCallback('Genel hata oluştu', 0);

            if (project) {
                project.error = error.message;
            }

            return false;
        }
    }

    getDetailedStatus() {
        return {
            ...this.status,
            stats: this.stats,
            config: this.config ? { username: this.config.username } : null,
            projects: Array.from(this.status.projects.entries()).map(([path, project]) => ({
                name: project.name,
                path: path,
                status: project.status,
                message: project.message || '',
                lastCheck: project.lastCheck,
                lastModified: project.lastModified,
                hasGitRepo: project.hasGitRepo || false,
                progress: project.progress || 0,
                currentOperation: project.currentOperation || '',
                error: project.error || null
            })),
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime()
        };
    }

    debouncedQueueAdd(projectPath) {
        const projectName = path.basename(projectPath);

        if (this.debounceTimers.has(projectPath)) {
            clearTimeout(this.debounceTimers.get(projectPath));
        }

        const timer = setTimeout(() => {
            this.syncQueue.add(projectPath);
            this.debounceTimers.delete(projectPath);

            const project = this.status.projects.get(projectPath);
            if (project) {
                project.status = 'queued';
            }

            this.sendLog(`📝 Değişiklik algılandı: ${projectName}`, 'warning');
            this.sendStatus();
        }, 3000);

        this.debounceTimers.set(projectPath, timer);
    }

    async startAutoSync() {
        if (!this.config || this.isRunning) return;

        this.isRunning = true;
        this.updateStatus('initializing', 'Sistem başlatılıyor...', 0);
        this.sendLog('🚀 Otomatik sync başlatıldı', 'success');

        try {
            const projectCount = await this.scanProjects();
            if (projectCount > 0) {
                await this.startFolderMonitoring();
                this.startSyncProcessor();
                this.updateStatus('monitoring', 'Klasör değişiklikleri izleniyor...', 0);
                this.showNotification('GitHubAutoSync', `${projectCount} proje izlemeye alındı!`);
            } else {
                this.updateStatus('idle', 'Proje bulunamadı', 0);
                this.sendLog('⚠️ İzlenecek Git projesi bulunamadı', 'warning');
            }

        } catch (error) {
            this.sendLog(`❌ Başlatma hatası: ${error.message}`, 'error');
            this.stopAutoSync();
        }
    }

    startSyncProcessor() {
        const processInterval = setInterval(async () => {
            if (this.syncQueue.size > 0 && !this.status.isSyncing) {
                await this.processQueue();
            }
        }, 10000);

        this.processInterval = processInterval;
    }

    stopAutoSync() {
        this.isRunning = false;

        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }

        // YENİ: Proje tarama intervalini durdur
        if (this.projectScanInterval) {
            clearInterval(this.projectScanInterval);
            this.projectScanInterval = null;
        }

        if (this.processInterval) {
            clearInterval(this.processInterval);
            this.processInterval = null;
        }

        this.debounceTimers.forEach(timer => clearTimeout(timer));
        this.debounceTimers.clear();

        this.syncQueue.clear();
        this.projectStates.clear();
        this.status.projects.clear();
        this.status.isSyncing = false;
        this.stats.currentPath = null;

        if (global.gc) {
            global.gc();
        }

        this.updateStatus('idle', 'Durduruldu', 0);
        this.sendLog('⏸️ Otomatik senkronizasyon durduruldu', 'warning');
    }

    restartAutoSync() {
        this.stopAutoSync();
        if (this.config) {
            setTimeout(() => {
                this.startAutoSync();
            }, 1000);
        }
    }

    async manualSync() {
        if (!this.config) {
            this.sendLog('❌ Konfigürasyon bulunamadı!', 'error');
            return;
        }

        if (this.status.isSyncing) {
            this.sendLog('⚠️ Senkronizasyon zaten devam ediyor!', 'warning');
            return;
        }

        this.sendLog('🔄 Manuel senkronizasyon başlatıldı...', 'info');

        for (const projectPath of this.status.projects.keys()) {
            this.syncQueue.add(projectPath);
        }

        await this.processQueue();
    }

    showNotification(title, body) {
        if (Notification.isSupported()) {
            try {
                const notificationOptions = {
                    title: title,
                    body: body,
                    silent: false, // Ses ile bildirim
                    icon: this.getNotificationIcon()
                };

                const notification = new Notification(notificationOptions);
                notification.show();

                this.logMessage(`📢 Bildirim gösterildi: ${title} - ${body}`);
            } catch (error) {
                this.logMessage('❌ Bildirim gösterilemedi: ' + error.message);
            }
        } else {
            this.logMessage('⚠️ Bildirimler desteklenmiyor');
        }
    }

    sanitizeRepoName(name) {
        return name
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9\-_.]/g, '')
            .replace(/^[-_.]+|[-_.]+$/g, '')
            .substring(0, 100);
    }

    async initGitRepo(git, repoName, projectPath) {
        try {
            await git.init();
            await git.addConfig('user.name', this.config.username);
            await git.addConfig('user.email', `${this.config.username}@users.noreply.github.com`);

            const gitignoreContent = this.config.ignoredPatterns.join('\n');
            const gitignorePath = path.join(projectPath, '.gitignore');
            await fs.writeFile(gitignorePath, gitignoreContent);

            await git.add('.');
            await git.commit('Initial commit - Auto sync setup');
            await git.branch(['-M', 'main']);

            const encodedRepoName = encodeURIComponent(repoName);
            await git.addRemote('origin', `https://${this.config.token}@github.com/${this.config.username}/${encodedRepoName}.git`);

        } catch (error) {
            throw new Error(`Git repo başlatma hatası: ${error.message}`);
        }
    }

    async checkGitHubRepo(repoName) {
        try {
            const encodedRepoName = encodeURIComponent(repoName);
            const response = await axios.get(`https://api.github.com/repos/${this.config.username}/${encodedRepoName}`, {
                headers: {
                    'Authorization': `token ${this.config.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'GitAutoSync/2.0'
                },
                timeout: 10000
            });

            return response.status === 200;
        } catch (error) {
            if (error.response?.status === 404) {
                return false;
            }
            throw new Error(`GitHub API hatası: ${error.message}`);
        }
    }

    async createGitHubRepo(repoName) {
        try {
            const response = await axios.post('https://api.github.com/user/repos', {
                name: repoName,
                private: true,
                description: `Auto-synced project - ${new Date().toLocaleDateString('tr-TR')}`,
                auto_init: false,
                has_issues: false,
                has_projects: false,
                has_wiki: false
            }, {
                headers: {
                    'Authorization': `token ${this.config.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'GitAutoSync/2.0'
                },
                timeout: 15000
            });

            return response.status === 201;

        } catch (error) {
            if (error.response?.status === 422) {
                return true;
            }

            if (error.response?.status === 401) {
                throw new Error('GitHub token geçersiz. Token\'ın "repo" yetkisine sahip olduğundan emin olun.');
            }

            if (error.response?.status === 403) {
                throw new Error('GitHub API rate limit aşıldı.');
            }

            throw new Error(`Repository oluşturma hatası: ${error.response?.data?.message || error.message}`);
        }
    }

    sendLog(message, type = 'info') {
        const logData = {
            message,
            type,
            timestamp: new Date()
        };

        console.log(`[${type.toUpperCase()}] ${message}`);

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            try {
                this.mainWindow.webContents.send('log', logData);
            } catch (error) {
                console.error('Log gönderme hatası:', error.message);
            }
        }
    }
}

// Global instance
let gitAutoSync;

// Auto-start functionality ve uygulama adı düzeltmesi
app.setAppUserModelId('GitHubAutoSync');
app.setName('GitHubAutoSync'); // Uygulama adını ayarla

// App events
app.whenReady().then(async () => {
    console.log('🚀 Electron hazır, GitAutoSync başlatılıyor...');
    gitAutoSync = new GitAutoSync();
    await gitAutoSync.init();

    // Linux için özel tray desteği
    if (process.platform === 'linux') {
        app.commandLine.appendSwitch('--enable-features', 'UseOzonePlatform');
        app.commandLine.appendSwitch('--ozone-platform', 'wayland');
    }
});

app.on('before-quit', () => {
    if (gitAutoSync) {
        gitAutoSync.isQuitting = true;
        gitAutoSync.stopAutoSync();
    }
});

app.on('window-all-closed', () => {
    // macOS'ta bile quit olsun çünkü tray'de çalışıyor
});

app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        gitAutoSync = new GitAutoSync();
        await gitAutoSync.init();
    }
});

// Auto-launch setup
app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath,
    name: 'GitHubAutoSync' // Uygulama adını burada da ayarla
});

// Enhanced error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Yakalanmamış hata:', error);
    if (gitAutoSync) {
        gitAutoSync.sendLog(`Sistem hatası: ${error.message}`, 'error');
    }
});

process.on('unhandledRejection', (error) => {
    console.error('❌ İşlenmemiş promise hatası:', error);
    if (gitAutoSync) {
        gitAutoSync.sendLog(`Promise hatası: ${error.message}`, 'error');
    }
});

