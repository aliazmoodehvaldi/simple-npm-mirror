# 📦 NPM Mirror

> 🚀 A powerful, self-hosted NPM registry mirror with automatic caching, multi-registry failover, and intelligent package management

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-ISC-blue)](LICENSE)
[![Express](https://img.shields.io/badge/express-4.21.2-000000)](https://expressjs.com)

---

## 🌟 Overview

**NPM Mirror** is a sophisticated caching proxy server that sits between your development environment and the public NPM registry. It intelligently aggregates multiple upstream registries, automatically fetches missing packages on-demand, and serves them with cryptographic integrity verification.

Perfect for:
- 🏢 **Enterprise environments** with restricted internet access
- 🌍 **Teams in regions** with slow or unreliable NPM registry access
- 🔒 **Air-gapped systems** needing a local package cache
- ⚡ **High-performance CI/CD pipelines** requiring fast package downloads

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🔄 **Multi-Registry Failover** | Automatically tries 9+ upstream registries; if one fails, another takes over |
| 💾 **Intelligent On-Demand Caching** | Downloads and caches packages only when first requested |
| 🔒 **Cryptographic Verification** | Validates all tarballs using SHA1/SHA512 integrity hashes |
| 🗜️ **Gzip Compression** | Serves compressed metadata for faster network transfers |
| 📁 **Full Scoped Package Support** | Handles `@scope/package` naming conventions flawlessly |
| 📋 **Batch Download Tool** | Extract and pre-fetch all dependencies from `package-lock.json` |
| ☁️ **Remote Deployment Scripts** | Deploy cached packages to production servers with ease |
| 🛡️ **Helmet Security** | Production-ready security headers out of the box |

---

## 🏗️ Architecture Diagram

```
┌─────────────┐     ┌─────────────────────────────────────────────────┐
│   Client    │────▶│                NPM Mirror Server                │
│(npm install)│     │                  (Port 4873)                    │
└─────────────┘     └─────────────────────┬───────────────────────────┘
                                          │
                          ┌───────────────┴───────────────┐
                          │                               │
                          ▼                               ▼
                  ┌───────────────┐               ┌─────────────┐
                  │  Local Cache  │               │  Upstream   │
                  │  (packages/)  │               │ Registries  │
                  └───────────────┘               └─────────────┘
                                                         │
                                                         ▼
                                          ┌──────────────────────────┐
                                          │ • registry.npmjs.com     │
                                          │ • mirror2.chabokan.net   │
                                          │ • hub.megan.ir           │
                                          │ • package-mirror.liara.ir│
                                          │ • + 5 more mirrors       │
                                          └──────────────────────────┘
```

---

## 📂 Project Structure

```
📦 npm-mirror/
├── 📄 index.js              # 🎯 Main mirror server (Express.js)
├── 📄 https.js              # 🌐 HTTP/HTTPS client with redirect handling
├── 📄 check-package.js      # ✅ Verify package existence in registry
├── 📄 download-packages.js  # ⬇️ Batch download from package-lock.json
├── 📄 generate-registry.js  # 🔧 Generate local registry from node_modules
├── 📄 scripts.sh            # 🖥️ Interactive deployment assistant
├── 📄 move-packages.sh      # 📤 SCP upload with auto-retry logic
├── 📄 package.json          # 📦 Project dependencies
├── 📄 package-lock.json     # 🔒 Locked dependency tree
└── 📁 packages/             # 📁 Package cache directory (auto-created)
```

---

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/aliazmoodehvaldi/simple-npm-mirror.git
cd npm-mirror

# Install dependencies
npm install
```

### Environment Setup

```bash
# Set your own registry URL (optional)
export OWN_NPM_URL=http://localhost:4873
```

### Start the Server

```bash
# Production mode
npm start

# Development mode with auto-reload
npm run dev
```

> 🎉 Server runs at `http://localhost:4873`

### Configure NPM to Use Your Mirror

```bash
# Global configuration
npm config set registry http://localhost:4873

# Or use it for a single installation
npm install --registry=http://localhost:4873
```

---

## 🛠️ Tools & Utilities

### 1. Check Package Availability 🔍

Verify which packages from your `package.json` exist in the mirror:

```bash
node check-package.js [path/to/package.json]
```

**Output:**
```
✅ lodash@4.17.21 exists
❌ some-package@1.0.0 NOT found
```

### 2. Batch Download from package-lock.json ⬇️

Pre-fetch all dependencies listed in `package-lock.json`:

```bash
node download-packages.js
```

This will:
- 📖 Parse your `package-lock.json`
- 🔍 Scan all dependencies recursively
- 💾 Download missing packages to `./packages/`

### 3. Generate Registry from node_modules 🔧

Create a local registry from existing `node_modules`:

```bash
node generate-registry.js
```

Perfect for:
- 📦 Bootstrapping a mirror from an existing project
- 🔄 Migrating packages between environments

### 4. Deploy to Remote Server ☁️

Interactive deployment script for uploading cached packages:

```bash
chmod +x scripts.sh
./scripts.sh
```

**Menu Options:**
```
1) Upload packages      → Deploy to configured servers
2) Add server          → Store new server credentials
3) Exit                → Close the tool
```

**Features:**
- 🔑 Supports both SSH key and password authentication
- 📡 Multiplexed SSH connections for speed
- 🔄 Smart file skipping (won't re-upload existing files)
- 📝 Detailed logging

### 5. Direct SCP Upload with Retry 📤

Simple one-shot upload with automatic retries:

```bash
# Edit configuration in move-packages.sh first
./move-packages.sh
```

**Configurable options:**
- `LOCAL_DIR` - Source directory
- `REMOTE_USER` / `REMOTE_HOST` - Destination
- `MAX_RETRIES` - Retry attempts (default: 5)
- `RETRY_DELAY` - Delay between retries (default: 30s)

---

## 📡 API Reference

### Metadata Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/:pkg` | Get package metadata |
| `GET` | `/:scope/:name` | Get scoped package metadata |
| `GET` | `/:pkg?checkExist=true` | Check if package metadata is cached |

### Tarball Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/:pkg/-/:file.tgz` | Download package tarball |
| `GET` | `/:scope/:name/-/:file.tgz` | Download scoped package tarball |
| `GET` | `/:pkg/-/:file.tgz?checkExist=true` | Check if tarball is cached |

### Example Requests

```bash
# Get express metadata
curl http://localhost:4873/express

# Download express tarball
curl http://localhost:4873/express/-/express-4.21.2.tgz --output express.tgz

# Check if package exists in cache
curl "http://localhost:4873/lodash?checkExist=true"
```

---

## ⚙️ Configuration

### Upstream Registries

Edit `REGISTRIES` array in `index.js`:

```javascript
const REGISTRIES = [
  'https://registry.npmjs.com/',           // Official registry
  'https://mirror2.chabokan.net/npm',      // Community mirror
  'https://hub.megan.ir/npm',              // Regional mirror
  'https://mirror-npm.runflare.com',       // CDN mirror
  // Add your own mirrors here
];
```

### Server Configuration

```javascript
const PORT = 4873;              // Change server port
const OWN_REGISTRY = process.env.OWN_NPM_URL;  // Your public URL
```

### Cache Directory

```javascript
const PKG_DIR = path.join(__dirname, 'packages');  // Custom cache location
```

---

## 🔧 How It Works

### 📄 Metadata Flow

1. **Check Cache** → Look for `packages/<pkg>/package.json`
2. **Fetch from Upstream** → Query all registries in parallel
3. **Deep Merge** → Intelligently merge metadata from all sources
4. **Rewrite URLs** → Convert tarball URLs to point back to mirror
5. **Cache & Serve** → Store metadata and return to client

### 📦 Tarball Flow

1. **Check Cache** → Look for `packages/<pkg>/<version>.tgz`
2. **Verify Integrity** → Validate cached file with SHA512
3. **Download if Missing** → Try each upstream registry sequentially
4. **Verify Downloaded File** → Validate SHA integrity before caching
5. **Serve to Client** → Stream file with proper headers

### 🔐 Integrity Verification

Every tarball undergoes cryptographic verification:

```javascript
// SHA1 (shasum) for legacy compatibility
shasum: "abc123..."

// SHA512 (integrity field) for modern clients
integrity: "sha512-base64encodedhash=="
```

---

## 🐛 Troubleshooting

### Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| **ECONNREFUSED** | Check if server is running: `curl http://localhost:4873` |
| **Package not found** | Run `node download-packages.js` to pre-fetch |
| **Integrity mismatch** | Delete corrupted file from `packages/` and retry |
| **Permission denied (SSH)** | Check SSH key permissions: `chmod 600 your-key.pem` |
| **Slow downloads** | Add more upstream registries to `REGISTRIES` array |

### Debug Mode

```bash
# Run with verbose logging
NODE_DEBUG=http,https node index.js

# Watch mode for development
npm run dev
```

---

## 📋 Requirements

| Dependency | Version | Purpose |
|------------|---------|---------|
| **Node.js** | ≥ 18.0 | Runtime environment |
| **npm** | Latest | Package manager |
| **express** | 4.21.2 | Web server |
| **helmet** | 8.1.0 | Security headers |
| **ssh, scp** | Any | Remote deployment (optional) |
| **sshpass** | Any | Password auth for scripts (optional) |

---

## 🔒 Security Features

- ✅ **Helmet.js** - Secure HTTP headers
- ✅ **CORS Policy** - Cross-origin resource sharing enabled safely
- ✅ **Integrity Verification** - Cryptographic validation of all packages
- ✅ **Path Traversal Protection** - `safePkg()` function prevents directory traversal
- ✅ **No Arbitrary Code Execution** - `--ignore-scripts` flag during packing

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

1. 🍴 Fork the repository
2. 🌿 Create a feature branch (`git checkout -b feature/amazing`)
3. 💾 Commit your changes (`git commit -m 'Add amazing feature'`)
4. 📤 Push to the branch (`git push origin feature/amazing`)
5. 🎉 Open a Pull Request

---

## 📄 License

**ISC License** - Free to use, modify, and distribute.

---

## 👨‍💻 Author

| Name                   | Contact |
|------------------------|---------|
| **Ali Azmoodeh Valdi** | [treeroot.ir@gmail.com](mailto:treeroot.ir@gmail.com) |

---

## 🙏 Acknowledgments

- Thanks to all the mirror maintainers providing free NPM mirrors
- Built with ❤️ for the developer community

---

<p align="center">
  <img src="https://img.shields.io/badge/⭐-Star%20this%20repo-brightgreen?style=for-the-badge" alt="Star this repo">
</p>

<p align="center">
  <sub>⚡ Built for reliability. Cache once, serve forever. ⚡</sub>
</p>

<p align="center">
  <sub>Made with 💻 and ☕ by developers, for developers</sub>
</p>