const { ipcRenderer, shell } = require('electron');

class GitAutoSyncRenderer {
    constructor() {
        this.config = null;
        this.isRunning = false;
        this.currentStatus = null;

        // Optimized update throttling
        this.lastUpdateTime = 0;
        this.updateThrottle = 1000; // 1 second

        // Performance tracking
        this.startTime = Date.now();

        this.defaultIgnoredPatterns = [
            '**/node_modules/**', '**/.git/**', '**/.vscode/**',
            '**/.idea/**', '**/dist/**', '**/build/**', '**/.next/**',
            '**/.cache/**', '**/*.tmp', '**/*.temp', '**/.env',
            '**/.env.*', '**/logs/**', '**/*.log', '**/coverage/**',
            '**/__pycache__/**', '**/*.pyc', '**/target/**',
            '**/bin/**', '**/obj/**'
        ];

        this.elements = this.initializeElements();
        this.folders = [];
        this.ignoredPatterns = [...this.defaultIgnoredPatterns];

        // Optimized log handling
        this.logBuffer = [];
        this.maxLogs = 500;

        this.init();
    }

    initializeElements() {
        const elements = {};
        const elementIds = [
            'toggle-btn', 'manual-sync-btn', 'settings-btn', 'clear-log-btn',
            'github-btn', 'hide-btn', 'log-container', 'setup-modal',
            'status-badge', 'main-status-title', 'main-status-subtitle',
            'memory-usage', 'uptime', 'project-count', 'progress-circle',
            'progress-text', 'total-projects', 'queued-projects',
            'completed-projects', 'failed-projects', 'projects-panel',
            'projects-list', 'projects-count-badge', 'network-status',
            'github-user-display', 'github-username', 'current-path',
            'current-path-text', 'transfer-stats-panel', 'transfer-total-files',
            'transfer-uploaded-files', 'transfer-current-file', 'transfer-speed',
            'username', 'token', 'folder-list', 'system-tray',
            'add-folder-btn', 'token-help', 'cancel-setup', 'save-setup',
            'ignored-patterns-list', 'new-pattern', 'add-pattern-btn',
            'reset-patterns-btn'
        ];

        elementIds.forEach(id => {
            elements[id] = document.getElementById(id);
        });

        return elements;
    }

    async init() {
        await this.loadConfig();
        this.bindEvents();
        this.setupIPC();
        this.startStatusUpdates();
        this.startPerformanceMonitoring();

        // Optimized log flushing
        setInterval(() => {
            this.flushLogBuffer();
        }, 1000);

        if (!this.config) {
            this.showSetupModal();
        } else {
            this.updateUI();
        }
    }

    async loadConfig() {
        try {
            this.config = await ipcRenderer.invoke('get-config');
            if (this.config && this.config.ignoredPatterns) {
                this.ignoredPatterns = [...this.config.ignoredPatterns];
            }
        } catch (error) {
            console.error('Config yükleme hatası:', error);
        }
    }

    bindEvents() {
        // Main controls
        this.elements['toggle-btn'].addEventListener('click', () => this.toggleSync());
        this.elements['manual-sync-btn'].addEventListener('click', () => this.manualSync());
        this.elements['settings-btn'].addEventListener('click', () => this.showSetupModal(true));
        this.elements['clear-log-btn'].addEventListener('click', () => this.clearLogs());
        this.elements['github-btn'].addEventListener('click', () => this.openGitHub());
        this.elements['hide-btn'].addEventListener('click', () => window.close());

        // Setup modal
        this.elements['add-folder-btn'].addEventListener('click', () => this.addFolder());
        this.elements['token-help'].addEventListener('click', (e) => {
            e.preventDefault();
            shell.openExternal('https://github.com/settings/tokens/new?description=GitAutoSync&scopes=repo');
        });
        this.elements['cancel-setup'].addEventListener('click', () => this.hideSetupModal());
        this.elements['save-setup'].addEventListener('click', () => this.saveConfig());

        // Tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // Ignored patterns
        this.elements['add-pattern-btn'].addEventListener('click', () => this.addIgnoredPattern());
        this.elements['new-pattern'].addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addIgnoredPattern();
        });
        this.elements['reset-patterns-btn'].addEventListener('click', () => this.resetIgnoredPatterns());

        // Modal outside click
        this.elements['setup-modal'].addEventListener('click', (e) => {
            if (e.target === this.elements['setup-modal']) {
                this.hideSetupModal();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F5') {
                e.preventDefault();
                this.manualSync();
            }
        });
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tabName}-tab`).classList.add('active');
    }

    setupIPC() {
        // Log handling
        ipcRenderer.on('log', (event, data) => {
            this.logBuffer.push({
                message: data.message,
                type: data.type,
                timestamp: data.timestamp
            });
        });

        // Optimized status updates
        ipcRenderer.on('status-update', (event, status) => {
            const now = Date.now();
            if (now - this.lastUpdateTime < this.updateThrottle) {
                return;
            }
            this.lastUpdateTime = now;
            this.updateStatus(status);
        });
    }

    startStatusUpdates() {
        // Check status every 2 seconds
        setInterval(async () => {
            try {
                const status = await ipcRenderer.invoke('get-status');
                this.updateStatus(status);
            } catch (error) {
                console.error('Status güncelleme hatası:', error);
            }
        }, 2000);
    }

    startPerformanceMonitoring() {
        setInterval(() => {
            this.updatePerformanceInfo();
        }, 5000);
    }

    updatePerformanceInfo() {
        const now = Date.now();
        const uptime = Math.floor((now - this.startTime) / 1000);
        const uptimeText = this.formatUptime(uptime);

        if (this.elements['uptime']) {
            this.elements['uptime'].textContent = `Çalışma: ${uptimeText}`;
        }

        if (this.currentStatus?.memoryUsage) {
            const memMB = Math.round(this.currentStatus.memoryUsage.rss / 1024 / 1024);
            if (this.elements['memory-usage']) {
                this.elements['memory-usage'].textContent = `RAM: ${memMB} MB`;
            }
        }

        if (this.currentStatus?.projects) {
            const projectCount = this.currentStatus.projects.length;
            if (this.elements['project-count']) {
                this.elements['project-count'].textContent = `Projeler: ${projectCount}`;
            }
        }
    }

    formatUptime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}s ${minutes}d`;
        } else if (minutes > 0) {
            return `${minutes}d ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    updateStatus(status) {
        if (!status) return;
        this.currentStatus = status;

        this.updateMainStatus(status);
        this.updateNetworkStatus(status);
        this.updateGitHubUser(status);
        this.updateTransferStats(status);
        this.updateStatistics(status);
        this.updateProjectsList(status);
        this.updateProgressBar(status);
    }

    updateNetworkStatus(status) {
        if (!this.elements['network-status'] || !status.networkStatus) return;

        const isOnline = status.networkStatus.isOnline;
        const icon = isOnline ? 'fas fa-wifi network-online' : 'fas fa-wifi-slash network-offline';
        const text = isOnline ? 'Çevrimiçi' : 'Çevrimdışı';

        this.elements['network-status'].innerHTML = `
            <i class="${icon}"></i>
            ${text}
        `;
    }

    updateGitHubUser(status) {
        if (!status.config?.username) {
            if (this.elements['github-user-display']) {
                this.elements['github-user-display'].classList.add('hidden');
            }
            return;
        }

        if (this.elements['github-user-display'] && this.elements['github-username']) {
            this.elements['github-username'].textContent = status.config.username;
            this.elements['github-user-display'].classList.remove('hidden');
        }
    }

    // Simplified transfer stats update
    updateTransferStats(status) {
        if (!status.transferStats) return;

        const stats = status.transferStats;

        if (this.elements['transfer-total-files']) {
            this.elements['transfer-total-files'].textContent = stats.totalFiles || 0;
        }

        if (this.elements['transfer-uploaded-files']) {
            this.elements['transfer-uploaded-files'].textContent = stats.uploadedFiles || 0;
        }

        if (this.elements['transfer-current-file']) {
            this.elements['transfer-current-file'].textContent = stats.currentFile || '-';
        }

        if (this.elements['transfer-speed']) {
            const speed = stats.uploadSpeed || 0;
            this.elements['transfer-speed'].textContent = `${speed.toFixed(1)} proje/s`;
        }
    }

    updateMainStatus(status) {
        const phaseTexts = {
            'idle': 'Sistem Hazır',
            'scanning': 'Projeler Taranıyor',
            'monitoring': 'Klasörler İzleniyor',
            'syncing': 'Senkronizasyon Yapılıyor',
            'initializing': 'Başlatılıyor'
        };

        const subtitleTexts = {
            'idle': 'Klasör tabanlı optimized izleme',
            'scanning': 'Git projeleri keşfediliyor',
            'monitoring': 'Klasör değişiklikleri ve yeni projeler izleniyor',
            'syncing': `${status.stats?.completedProjects || 0}/${status.stats?.totalProjects || 0} proje işleniyor`,
            'initializing': 'Sistem bileşenleri hazırlanıyor'
        };

        if (this.elements['main-status-title']) {
            this.elements['main-status-title'].textContent = phaseTexts[status.phase] || status.phase;
        }

        if (this.elements['main-status-subtitle']) {
            this.elements['main-status-subtitle'].textContent = subtitleTexts[status.phase] || status.message;
        }

        // Current path display
        if (status.currentPath && this.elements['current-path']) {
            this.elements['current-path'].classList.remove('hidden');
            if (this.elements['current-path-text']) {
                const baseName = status.currentPath.split(/[\\/]/).pop();
                this.elements['current-path-text'].textContent = baseName || 'Bilinmiyor';
                this.elements['current-path-text'].title = status.currentPath;
            }
        } else if (this.elements['current-path']) {
            this.elements['current-path'].classList.add('hidden');
        }

        // Status badge
        let badgeText = 'Durduruldu';
        let badgeClass = 'status-idle';

        if (status.isRunning) {
            if (status.isSyncing) {
                badgeText = 'Senkronize Ediliyor';
                badgeClass = 'status-syncing';
            } else if (status.phase === 'monitoring') {
                badgeText = 'İzliyor';
                badgeClass = 'status-running';
            } else {
                badgeText = 'Çalışıyor';
                badgeClass = 'status-running';
            }
        }

        if (this.elements['status-badge']) {
            this.elements['status-badge'].textContent = badgeText;
            this.elements['status-badge'].className = `status-badge ${badgeClass}`;
        }

        // Update toggle button
        if (this.elements['toggle-btn']) {
            if (status.isRunning) {
                this.elements['toggle-btn'].innerHTML = '<i class="fas fa-pause"></i> Durdur';
                this.elements['toggle-btn'].className = 'btn btn-warning';
                this.isRunning = true;
            } else {
                this.elements['toggle-btn'].innerHTML = '<i class="fas fa-play"></i> Başlat';
                this.elements['toggle-btn'].className = 'btn btn-success';
                this.isRunning = false;
            }
        }
    }

    updateStatistics(status) {
        const stats = [
            { id: 'total-projects', value: status.projects?.length || 0 },
            { id: 'queued-projects', value: this.countProjectsByStatus(status.projects, ['queued']) },
            { id: 'completed-projects', value: status.stats?.completedProjects || 0 },
            { id: 'failed-projects', value: status.stats?.failedProjects || 0 }
        ];

        stats.forEach(stat => {
            if (this.elements[stat.id]) {
                this.elements[stat.id].textContent = stat.value;
            }
        });
    }

    countProjectsByStatus(projects, statuses) {
        if (!projects || !Array.isArray(projects)) return 0;
        return projects.filter(project => statuses.includes(project.status)).length;
    }

    updateProjectsList(status) {
        if (!this.elements['projects-list'] || !status.projects) return;

        const projects = status.projects;

        // Update count badge
        if (this.elements['projects-count-badge']) {
            this.elements['projects-count-badge'].textContent = `${projects.length} proje`;
        }

        if (projects.length === 0) {
            this.elements['projects-list'].innerHTML = `
                <div style="padding: 2rem; text-align: center; color: #7f8c8d;">
                    Henüz proje taranmadı
                </div>
            `;
            return;
        }

        const projectsHtml = projects.map(project => {
            const statusIcons = {
                'ready': 'fas fa-check-circle',
                'changed': 'fas fa-exclamation-circle',
                'queued': 'fas fa-clock',
                'syncing': 'fas fa-sync fa-spin',
                'synced': 'fas fa-check-double',
                'error': 'fas fa-times-circle',
                'needs-repo': 'fas fa-plus-circle'
            };

            const statusColors = {
                'ready': '#27ae60',
                'changed': '#f39c12',
                'queued': '#3498db',
                'syncing': '#e67e22',
                'synced': '#27ae60',
                'error': '#e74c3c',
                'needs-repo': '#9b59b6'
            };

            const icon = statusIcons[project.status] || 'fas fa-folder';
            const color = statusColors[project.status] || '#95a5a6';

            const lastCheckDate = new Date(project.lastCheck);
            const timeAgo = this.getTimeAgo(lastCheckDate);

            // Progress bar for syncing projects
            let progressHtml = '';
            if (project.status === 'syncing' && project.progress > 0) {
                const roundedProgress = Math.round((project.progress || 0) * 10) / 10;
                progressHtml = `
                    <div style="margin-top: 4px;">
                        <div style="background: #ecf0f1; border-radius: 6px; height: 4px; overflow: hidden;">
                            <div style="background: ${color}; height: 100%; width: ${roundedProgress}%; transition: width 0.5s ease-out;"></div>
                        </div>
                        <div style="font-size: 9px; color: #7f8c8d; margin-top: 2px;">
                            ${project.currentOperation} (${roundedProgress.toFixed(1)}%)
                        </div>
                    </div>
                `;
            }

            const repoStatusIcon = project.hasGitRepo
                ? '<i class="fas fa-code-branch" style="color: #27ae60;" title="Git repository mevcut"></i>'
                : '<i class="fas fa-exclamation-triangle" style="color: #f39c12;" title="Git repository gerekiyor"></i>';

            return `
                <div class="project-item">
                    <div class="project-icon">
                        <i class="${icon}" style="color: ${color};"></i>
                    </div>
                    <div>
                        <div class="project-name">
                            ${this.escapeHtml(project.name)}
                            ${repoStatusIcon}
                        </div>
                        <div class="project-path">${this.escapeHtml(this.truncatePath(project.path))}</div>
                        ${progressHtml}
                    </div>
                    <div class="project-status status-${project.status}">
                        ${this.getStatusText(project.status)}
                        ${project.message ? `<br><small>${project.message}</small>` : ''}
                    </div>
                    <div class="project-last-check">
                        Son kontrol:<br>
                        <strong>${timeAgo}</strong>
                    </div>
                    <div class="project-actions">
                        <button onclick="renderer.openProjectFolder('${project.path.replaceAll('\\', '\\\\')}')" 
                                style="background: #3498db; color: white;" title="Klasörü Aç">
                            <i class="fas fa-folder-open"></i>
                        </button>
                        <button onclick="renderer.openProjectGitHub('${project.name}')" 
                                style="background: #2c3e50; color: white;" title="GitHub'da Aç">
                            <i class="fab fa-github"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        this.elements['projects-list'].innerHTML = projectsHtml;
    }

    getStatusText(status) {
        const statusTexts = {
            'ready': 'Hazır',
            'changed': 'Değişti',
            'queued': 'Kuyrukta',
            'syncing': 'Sync',
            'synced': 'Senkron',
            'error': 'Hata',
            'needs-repo': 'Repo Gerekli'
        };
        return statusTexts[status] || status;
    }

    getTimeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMinutes < 1) return 'Şimdi';
        if (diffMinutes < 60) return `${diffMinutes} dk önce`;
        if (diffHours < 24) return `${diffHours} sa önce`;
        if (diffDays < 7) return `${diffDays} gün önce`;

        return date.toLocaleDateString('tr-TR');
    }

    truncatePath(fullPath, maxLength = 50) {
        if (fullPath.length <= maxLength) return fullPath;
        return '...' + fullPath.slice(-(maxLength - 3));
    }

    openProjectFolder(projectPath) {
        shell.openPath(projectPath);
    }

    openProjectGitHub(projectName) {
        if (this.config) {
            const repoName = this.sanitizeRepoName(projectName);
            shell.openExternal(`https://github.com/${this.config.username}/${repoName}`);
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

    updateProgressBar(status) {
        const progress = Math.round((status.progress || 0) * 10) / 10;
        const displayProgress = Math.min(100, Math.max(0, progress));

        // Circular progress
        const circumference = 2 * Math.PI * 35;
        const offset = circumference - (displayProgress / 100) * circumference;

        if (this.elements['progress-circle']) {
            this.elements['progress-circle'].style.strokeDashoffset = offset;
            this.elements['progress-circle'].style.transition = 'stroke-dashoffset 0.3s ease-out';
        }

        if (this.elements['progress-text']) {
            this.elements['progress-text'].textContent = `${displayProgress.toFixed(1)}%`;
        }
    }

    // Log handling
    flushLogBuffer() {
        if (this.logBuffer.length === 0) return;

        const logsToFlush = this.logBuffer.splice(0, 10);
        logsToFlush.forEach(logData => {
            this.addLogToDOM(logData.message, logData.type, logData.timestamp);
        });
    }

    addLogToDOM(message, type = 'info', timestamp = new Date()) {
        if (!this.elements['log-container']) return;

        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;

        const timeStr = timestamp.toLocaleTimeString();
        logEntry.innerHTML = `
            <span class="timestamp">[${timeStr}]</span>
            ${this.escapeHtml(message)}
        `;

        this.elements['log-container'].appendChild(logEntry);
        this.elements['log-container'].scrollTop = this.elements['log-container'].scrollHeight;

        // Limit logs
        const logEntries = this.elements['log-container'].children;
        while (logEntries.length > this.maxLogs) {
            this.elements['log-container'].removeChild(logEntries[0]);
        }
    }

    updateUI() {
        if (!this.config) return;

        this.elements['github-btn'].onclick = () => {
            shell.openExternal(`https://github.com/${this.config.username}`);
        };

        this.addLog(`👋 Hoş geldiniz, ${this.config.username}!`, 'success');
        this.addLog(`📁 İzlenen klasörler: ${this.config.watchPaths?.length || 0} adet`, 'info');
        this.addLog(`✨ Yeni projeler otomatik algılanıyor!`, 'success');
        this.addLog(`🚀 Optimized klasör izleme aktif!`, 'success');
    }

    // Setup modal methods
    showSetupModal(isEdit = false) {
        if (isEdit && this.config) {
            this.elements['username'].value = this.config.username || '';
            this.elements['token'].value = this.config.token || '';
            this.elements['system-tray'].checked = this.config.systemTray !== false;
            this.folders = [...(this.config.watchPaths || [])];
            this.ignoredPatterns = [...(this.config.ignoredPatterns || this.defaultIgnoredPatterns)];
        } else {
            this.elements['username'].value = '';
            this.elements['token'].value = '';
            this.elements['system-tray'].checked = true;
            this.folders = [];
            this.ignoredPatterns = [...this.defaultIgnoredPatterns];
        }

        this.updateFolderList();
        this.updateIgnoredPatternsList();
        this.elements['setup-modal'].classList.remove('hidden');
        this.elements['username'].focus();
    }

    hideSetupModal() {
        if (!this.config) {
            window.close();
            return;
        }
        this.elements['setup-modal'].classList.add('hidden');
    }

    async addFolder() {
        try {
            const folderPath = await ipcRenderer.invoke('select-folder');
            if (folderPath && !this.folders.includes(folderPath)) {
                this.folders.push(folderPath);
                this.updateFolderList();
            }
        } catch (error) {
            console.error('Klasör seçme hatası:', error);
        }
    }

    removeFolder(index) {
        this.folders.splice(index, 1);
        this.updateFolderList();
    }

    updateFolderList() {
        const listHtml = this.folders.map((folder, index) => `
            <div class="folder-item">
                <span title="${folder}">📁 ${folder}</span>
                <button type="button" onclick="renderer.removeFolder(${index})" 
                        style="background: #e74c3c; color: white; padding: 4px 8px; border: none; border-radius: 4px;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');

        this.elements['folder-list'].innerHTML = listHtml ||
            '<div style="color: #7f8c8d; text-align: center; padding: 20px;">Henüz klasör eklenmedi</div>';
    }

    addIgnoredPattern() {
        const pattern = this.elements['new-pattern'].value.trim();
        if (pattern && !this.ignoredPatterns.includes(pattern)) {
            this.ignoredPatterns.push(pattern);
            this.elements['new-pattern'].value = '';
            this.updateIgnoredPatternsList();
        }
    }

    removeIgnoredPattern(index) {
        this.ignoredPatterns.splice(index, 1);
        this.updateIgnoredPatternsList();
    }

    resetIgnoredPatterns() {
        if (confirm('Tüm özel desenler silinip varsayılan desenler yüklenecek. Emin misiniz?')) {
            this.ignoredPatterns = [...this.defaultIgnoredPatterns];
            this.updateIgnoredPatternsList();
        }
    }

    updateIgnoredPatternsList() {
        const listHtml = this.ignoredPatterns.map((pattern, index) => `
            <div class="pattern-item">
                <span style="font-family: 'Consolas', monospace; font-size: 12px;">
                    ${this.escapeHtml(pattern)}
                </span>
                <button type="button" onclick="renderer.removeIgnoredPattern(${index})"
                        style="background: #e74c3c; color: white; padding: 2px 6px; border: none; border-radius: 4px;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');

        this.elements['ignored-patterns-list'].innerHTML = listHtml ||
            '<div style="color: #7f8c8d; text-align: center; padding: 20px;">Hiç ihmal edilen desen yok</div>';
    }

    async saveConfig() {
        const username = this.elements['username'].value.trim();
        const token = this.elements['token'].value.trim();

        if (!username) {
            this.showError('GitHub kullanıcı adı gerekli!');
            this.elements['username'].focus();
            return;
        }

        if (!token) {
            this.showError('GitHub token gerekli!');
            this.elements['token'].focus();
            return;
        }

        if (this.folders.length === 0) {
            this.showError('En az bir klasör seçmelisiniz!');
            return;
        }

        const config = {
            username: username,
            token: token,
            watchPaths: [...this.folders],
            systemTray: this.elements['system-tray'].checked,
            ignoredPatterns: [...this.ignoredPatterns],
            version: "2.1.0"
        };

        try {
            const success = await ipcRenderer.invoke('save-config', config);
            if (success) {
                this.config = config;
                this.hideSetupModal();
                this.updateUI();
                this.addLog('✅ Konfigürasyon başarıyla kaydedildi ve optimized sistem aktif!', 'success');
            } else {
                this.showError('Konfigürasyon kaydedilemedi!');
            }
        } catch (error) {
            this.showError('Konfigürasyon kaydetme hatası: ' + error.message);
        }
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed; top: 20px; right: 20px;
            background: linear-gradient(135deg, #e74c3c, #c0392b);
            color: white; padding: 15px 20px; border-radius: 8px;
            box-shadow: 0 4px 20px rgba(231, 76, 60, 0.3);
            z-index: 10000; max-width: 400px;
        `;
        errorDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <i class="fas fa-exclamation-triangle"></i>
                <span>${message}</span>
            </div>
        `;

        document.body.appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 5000);
    }

    // Main actions
    async toggleSync() {
        if (this.isRunning) {
            await this.stopSync();
        } else {
            await this.startSync();
        }
    }

    async startSync() {
        try {
            await ipcRenderer.invoke('toggle-sync', true);
            this.addLog('🚀 Optimized otomatik senkronizasyon başlatıldı', 'success');
        } catch (error) {
            this.showError('Senkronizasyon başlatılamadı: ' + error.message);
        }
    }

    async stopSync() {
        try {
            await ipcRenderer.invoke('toggle-sync', false);
            this.addLog('⏸️ Otomatik senkronizasyon durduruldu', 'warning');
        } catch (error) {
            this.showError('Senkronizasyon durdurulamadı: ' + error.message);
        }
    }

    async manualSync() {
        if (!this.config) {
            this.showError('Önce kurulumu tamamlayın!');
            return;
        }

        try {
            this.elements['manual-sync-btn'].disabled = true;
            this.elements['manual-sync-btn'].innerHTML = '<i class="fas fa-spinner fa-spin"></i> Senkronize ediliyor...';

            await ipcRenderer.invoke('start-manual-sync');
            this.addLog('🔄 Manuel senkronizasyon başlatıldı - Tüm projeler kontrol edilecek', 'info');
        } catch (error) {
            this.showError('Manuel senkronizasyon hatası: ' + error.message);
        } finally {
            setTimeout(() => {
                this.elements['manual-sync-btn'].disabled = false;
                this.elements['manual-sync-btn'].innerHTML = '<i class="fas fa-sync"></i> Manuel Sync';
            }, 3000);
        }
    }

    clearLogs() {
        if (this.elements['log-container']) {
            this.elements['log-container'].innerHTML = '';
        }
        this.logBuffer = [];
        this.addLog('🗑️ Loglar temizlendi - Optimized izleme devam ediyor', 'info');
    }

    openGitHub() {
        if (this.config) {
            shell.openExternal(`https://github.com/${this.config.username}`);
        } else {
            shell.openExternal('https://github.com');
        }
    }

    addLog(message, type = 'info', timestamp = new Date()) {
        this.logBuffer.push({ message, type, timestamp });

        // Immediate flush for important messages
        if (type === 'error' || type === 'success') {
            this.flushLogBuffer();
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Global instance
window.renderer = new GitAutoSyncRenderer();