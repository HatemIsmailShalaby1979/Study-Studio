# Offline Setup Guide

> **This guide is governed by [Constitution 000](../../../constitution.me) — the single source of truth.**
> "Never rely on borrowed conviction; earn genuine conviction through deep understanding."
> Offline operation is not a convenience — it is the architectural expression of the principle that trust is built through transparent and honest reasoning. When the AI runs on your machine, there is nothing hidden.

This guide covers setting up Study Studio for 100% offline operation on a machine with no internet access.

## Prerequisites (Offline)

- Node.js v18.17+ (installer downloaded separately)
- Rust toolchain (for Tauri desktop build)
- Ollama installer for your platform

## Installation Steps

### 1. Install Ollama

Download the installer from a machine with internet:
- **Windows**: [ollama.com/download](https://ollama.com/download) (OllamaSetup.exe)
- **macOS**: `brew install ollama` or download from ollama.com
- **Linux**: `curl -fsSL https://ollama.com/install.sh | sh`

Transfer the installer via USB and install.

### 2. Pull Models (Online)

On a machine with internet:
```bash
ollama pull qwen3:8b
ollama pull llama3.2:3b
```

Models are stored at:
- **Windows**: `C:\Users\<user>\.ollama\models`
- **macOS/Linux**: `~/.ollama/models/`

Copy the `.ollama/models` directory to the offline machine.

### 3. Install Node.js + Rust

Transfer and install Node.js and Rust from offline installers.

### 4. Clone and Setup

```bash
git clone https://github.com/HatemShelby/study-studio.git
cd study-studio
npm install
npm run tauri:build
```

### 5. Run

```bash
ollama serve  # Start AI engine
npm run tauri:dev  # Launch app
```

## Verifying Offline Operation

1. Disconnect the machine from all networks
2. Start Ollama: `ollama serve`
3. Start Study Studio: `npm run tauri:dev`
4. Generate a lesson — it should work without any network access
5. Check that no external URLs are called (developer tools → Network tab)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Ollama won't start | Check `ollama serve` output for port conflicts |
| No models available | Run `ollama list` to verify models exist |
| Out of memory | Use smaller model: `ollama run llama3.2:3b` |
| Slow generation | Enable GPU acceleration in Ollama settings |
| Tauri build fails | Ensure Rust is up to date: `rustup update` |
