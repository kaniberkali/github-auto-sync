# 🚀 GitHub Auto Sync

**An intelligent desktop application that automatically syncs your local projects to GitHub repositories with real-time monitoring and optimization.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/kaniberkali/github-auto-sync)
[![Version](https://img.shields.io/badge/Version-2.1.0-green)](https://github.com/kaniberkali/github-auto-sync/releases)

<img width="1920" height="1032" alt="githubautosync" src="https://github.com/user-attachments/assets/7117127b-cd0c-492e-bbd4-7bf13bd12c22" />

## ✨ Features

### 🔄 **Automatic Synchronization**
- **Real-time folder monitoring** with optimized change detection
- **Automatic new project discovery** - detects Git projects in your specified directories
- **Smart debouncing** to prevent unnecessary syncs during active development
- **Batch processing** for efficient multi-project synchronization

### 🎯 **Intelligent Project Management**
- **Auto-repository creation** on GitHub for new projects
- **Git repository initialization** for non-Git projects
- **Configurable ignore patterns** (node_modules, .env, build files, etc.)
- **Project status tracking** with detailed progress information

### 🖥️ **User Experience**
- **System tray integration** - runs quietly in the background
- **Real-time progress monitoring** with transfer statistics
- **Beautiful, responsive UI** with modern design
- **Comprehensive logging** with color-coded message types
- **Network status monitoring** and offline handling

### 🛡️ **Security & Reliability**
- **GitHub Personal Access Token** authentication
- **Private repository creation** by default
- **Secure credential storage**
- **Memory-optimized performance**
- **Error handling and retry mechanisms**

## 📦 Installation

### Option 1: Download Pre-built Binaries
1. Go to the [Releases](https://github.com/kaniberkali/github-auto-sync/releases) page
2. Download the appropriate version for your operating system:
  - **Windows**: `GitHubAutoSync-Setup-2.1.0.exe`
  - **macOS**: `GitHubAutoSync-2.1.0.dmg`
  - **Linux**: `GitHubAutoSync-2.1.0.AppImage` or `GitHubAutoSync_2.1.0_amd64.deb`

### Option 2: Build from Source
```bash
# Clone the repository
git clone https://github.com/kaniberkali/github-auto-sync.git
cd github-auto-sync

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
