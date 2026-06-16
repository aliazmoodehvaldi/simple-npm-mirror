const express = require('express');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const helmet = require('helmet');
const crypto = require('crypto');
const requestWithRedirect = require('./https');

const app = express();
const PORT = 4873;

const REGISTRIES = [
  'https://registry.npmjs.com/',
  'https://mirror2.chabokan.net/npm',
  'https://hub.megan.ir/npm',
  'https://package-mirror.liara.ir/repository/npm',
  'https://mirrors.pardisco.co/npm/',
  'https://edge41.10.ir.cdn.ir/repository/npm/',
  'https://npm.jamko.ir',
  'https://archive.ito.gov.ir/npm',
  'https://mirror-npm.runflare.com',
];

const OWN_REGISTRY = process.env.OWN_NPM_URL;

function buildTarballUrl(host, pkg, version) {
  const cleanHost = host.replace(/\/$/, '');
  const cleanPkg = pkg.replace(/^\//, '');
  const fileName = `${cleanPkg.split('/').pop()}-${version}.tgz`;
  return `${cleanHost}/${cleanPkg}/-/${fileName}`;
}

function extractPkgAndVersionFromUrl(urlPath) {
  const patterns = [
    /\/\/(@[^\/]+\/[^\/]+)\/-\/(.+?)\.tgz$/,
    /\/(@[^\/]+\/[^\/]+)\/-\/(.+?)\.tgz$/,
    /\/\/([^\/]+)\/-\/(.+?)\.tgz$/,
    /\/([^\/]+)\/-\/(.+?)\.tgz$/
  ];
  
  for (const pattern of patterns) {
    const match = urlPath.match(pattern);
    if (match) {
      const pkg = match[1];
      const fileName = match[2];
      const versionMatch = fileName.match(/(\d+\.\d+\.\d+(?:-[^\/]+)?)$/);
      if (versionMatch) {
        return { pkg, version: versionMatch[1] };
      }
    }
  }
  return null;
}

const PKG_DIR = path.join(__dirname, 'packages');

fs.mkdirSync(PKG_DIR, { recursive: true });

function safePkg(pkg) {
  return pkg.replace(/(\.\.|^\/)/g, '');
}

function pkgPath(pkg) {
  return path.join(PKG_DIR, safePkg(pkg));
}

function metaPackagePath(pkg) {
  return path.join(pkgPath(pkg), 'package.json');
}

function tarballPath(pkg, version) {
  return path.join(pkgPath(pkg), `${version}.tgz`);
}

function verifyIntegrity(file, integrity) {
  if (!integrity) return true;

  try {
    const match = integrity.match(/^sha(512|256|384|1)-(.+)$/);
    if (!match) {
      return false;
    }

    const [, bits, expected] = match;
    const algo = `sha${bits}`;

    if (!fs.existsSync(file)) return false;

    const data = fs.readFileSync(file);
    if (data.length === 0) return false;

    const hash = crypto.createHash(algo).update(data).digest('base64');

    return hash === expected;
  } catch (e) {
    return false;
  }
}

async function fetchJSONFromRegistry(registry, pkg) {
  const url = new URL(`${registry}/${pkg}`);
  
  try {
    const res = await requestWithRedirect({
      protocol: url.protocol.replace(':', ''),
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { accept: 'application/json' },
      timeout: 10000
    });

    if (!res || res.error) return null;

    if (Buffer.isBuffer(res)) {
      try {
        return JSON.parse(res.toString());
      } catch (_) {
        return null;
      }
    }

    if (typeof res === 'string') {
      try {
        return JSON.parse(res);
      } catch (_) {
        return null;
      }
    }

    return res;
  } catch (error) {
    return null;
  }
}

async function fetchSpecificVersionFromRegistry(registry, pkg, version) {
  try {
    const fullMetadata = await fetchJSONFromRegistry(registry, pkg);
    
    if (fullMetadata && fullMetadata.versions && fullMetadata.versions[version]) {
      return {
        versionData: fullMetadata.versions[version],
        fullMetadata: fullMetadata
      };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

async function findVersionInAllRegistries(pkg, version) {
  let bestResult = null;
  
  for (const registry of REGISTRIES) {
    const result = await fetchSpecificVersionFromRegistry(registry, pkg, version);
    
    if (result) {
      if (!bestResult) {
        bestResult = result;
      }
    }
  }
  
  return bestResult;
}

async function updateMetadataWithVersion(pkg, version, versionData) {
  const metaPath = metaPackagePath(pkg);
  let metadata = { versions: {} };
  
  if (fs.existsSync(metaPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch (error) {
      metadata = { versions: {} };
    }
  }
  
  if (!metadata.versions) {
    metadata.versions = {};
  }
  
  metadata.versions[version] = versionData;
  
  if (metadata.versions[version].dist) {
    metadata.versions[version].dist.tarball = buildTarballUrl(OWN_REGISTRY, pkg, version);
  }
  
  fs.writeFileSync(metaPath, JSON.stringify(metadata));
  
  return metadata;
}

async function fetchAllMetadata(pkg) {
  const tasks = REGISTRIES.map(r => fetchJSONFromRegistry(r, pkg));
  const list = await Promise.all(tasks);
  return list.filter(Boolean);
}

function mergeMetadata(list) {
  function isObject(value) {
    return value !== null && typeof value === 'object';
  }

  function deepMerge(target, source) {
    if (source === null || source === undefined) {
      return target !== undefined ? target : null;
    }

    if (target === null || target === undefined) {
      target = isObject(source) ? (Array.isArray(source) ? [] : {}) : source;
    }

    if (!isObject(source)) {
      return source;
    }

    if (Array.isArray(source)) {
      if (!Array.isArray(target)) {
        target = [];
      }
      for (const item of source) {
        if (isObject(item) && !Array.isArray(item) && item !== null) {
          const existingIndex = target.findIndex(t => 
            isObject(t) && t.version === item.version
          );
          if (existingIndex >= 0) {
            target[existingIndex] = deepMerge(target[existingIndex], item);
          } else {
            target.push(deepMerge(undefined, item));
          }
        } else {
          if (!target.includes(item)) {
            target.push(deepMerge(undefined, item));
          }
        }
      }
      return target;
    }

    const result = { ...(isObject(target) ? target : {}) };
    for (const key of Reflect.ownKeys(source)) {
      const sourceVal = source[key];
      const targetVal = result[key];
      
      if (isObject(sourceVal)) {
        result[key] = deepMerge(targetVal, sourceVal);
      } else {
        if (sourceVal !== null && sourceVal !== undefined) {
          result[key] = sourceVal;
        }
      }
    }
    return result;
  }

  if (!list || list.length === 0) {
    return {};
  }

  let data = {};
  for (const meta of list) {
    if (meta && typeof meta === 'object') {
      data = deepMerge(data, meta);
    }
  }

  return data;
}

async function getFileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', data => hash.update(data));
    stream.on('end', () => {
      resolve(`sha512-${hash.digest('base64')}`);
    });
    stream.on('error', () => resolve(null));
  });
}

async function downloadTarballOnDemand(pkg, version, dist, maxRetries = 3) {
  const dest = tarballPath(pkg, version);
  
  if (fs.existsSync(dest)) {
    if (verifyIntegrity(dest, dist.integrity)) {
      return true;
    } else {
      fs.unlinkSync(dest);
    }
  }

  fs.mkdirSync(pkgPath(pkg), { recursive: true });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    for (const registry of REGISTRIES) {
      try {
        const tarballUrl = new URL(dist.tarball);
        const registryUrl = new URL(registry);
        
        tarballUrl.host = registryUrl.host;
        tarballUrl.protocol = registryUrl.protocol;
        
        const tmp = dest + `.tmp.${attempt}`;
        
        const result = await requestWithRedirect({
          protocol: tarballUrl.protocol.replace(':', ''),
          hostname: tarballUrl.hostname,
          path: tarballUrl.pathname + tarballUrl.search,
          method: 'GET',
          outputPath: tmp,
          timeout: 30000,
          headers: {
            'Accept-Encoding': 'identity',
            'User-Agent': 'npm-mirror/1.0.0'
          }
        });

        if (result && !result.error && fs.existsSync(tmp)) {
          const stat = fs.statSync(tmp);
          if (stat.size === 0) {
            fs.unlinkSync(tmp);
            continue;
          }
          
          if (verifyIntegrity(tmp, dist.integrity)) {
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
            fs.renameSync(tmp, dest);
            return true;
          } else {
            fs.unlinkSync(tmp);
          }
        }
        
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        
      } catch (error) {
        if (fs.existsSync(dest + `.tmp.${attempt}`)) 
          fs.unlinkSync(dest + `.tmp.${attempt}`);
      }
    }
    
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  
  return false;
}

async function rebuildMetadataOnError(pkg, host) {
  const metaPath = metaPackagePath(pkg);
  if (fs.existsSync(metaPath)) {
    fs.unlinkSync(metaPath);
  }
  
  const pkgDir = pkgPath(pkg);
  if (fs.existsSync(pkgDir)) {
    fs.rmSync(pkgDir, { recursive: true, force: true });
  }
  
  return await buildMetadata(pkg, host);
}

async function buildMetadata(pkg, host) {
  const list = await fetchAllMetadata(pkg);
  if (!list.length) throw new Error('not found');

  const merged = mergeMetadata(list);

  fs.mkdirSync(pkgPath(pkg), { recursive: true });

  for (const v of Object.keys(merged.versions)) {
    const meta = merged.versions[v];
    if (meta.dist) {
      meta.dist.tarball = buildTarballUrl(host, pkg, v);
    }
  }

  fs.writeFileSync(metaPackagePath(pkg), JSON.stringify(merged));

  return merged;
}

async function checkAndUpdateMetadataOnly(pkg) {
  const metaPath = metaPackagePath(pkg);
  
  if (!fs.existsSync(metaPath)) {
    return 0;
  }
  
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (error) {
    return 0;
  }
  
  const freshMetadata = await fetchAllMetadata(pkg);
  if (!freshMetadata.length) {
    return 0;
  }
  
  const mergedFresh = mergeMetadata(freshMetadata);
  let updatedCount = 0;
  
  for (const [version, versionData] of Object.entries(mergedFresh.versions || {})) {
    if (!metadata.versions[version]) {
      metadata.versions[version] = versionData;
      
      if (metadata.versions[version].dist) {
        metadata.versions[version].dist.tarball = buildTarballUrl(OWN_REGISTRY, pkg, version);
      }
      
      updatedCount++;
    }
  }
  
  if (updatedCount > 0) {
    fs.writeFileSync(metaPath, JSON.stringify(metadata));
  }
  
  return updatedCount;
}

function getAllPackages(dir) {
  if (!fs.existsSync(dir)) return [];
  
  const items = fs.readdirSync(dir);
  let packages = [];
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    if (!fs.statSync(fullPath).isDirectory()) {
      continue;
    }
    
    if (item.startsWith('@')) {
      const subItems = fs.readdirSync(fullPath);
      for (const subItem of subItems) {
        const subPath = path.join(fullPath, subItem);
        if (fs.statSync(subPath).isDirectory()) {
          const metaPath = path.join(subPath, 'package.json');
          if (fs.existsSync(metaPath)) {
            packages.push(`${item}/${subItem}`);
          }
        }
      }
    } else {
      const metaPath = path.join(fullPath, 'package.json');
      if (fs.existsSync(metaPath)) {
        packages.push(item);
      }
    }
  }
  
  return packages;
}

async function scanAllPackagesAndUpdate() {
  console.log('Starting daily background scan for new versions...');
  
  if (!fs.existsSync(PKG_DIR)) {
    console.log('Packages directory not found');
    return;
  }
  
  const packages = getAllPackages(PKG_DIR);
  let total = 0;
  let updated = 0;
  
  for (const pkg of packages) {
    total++;
    console.log(`Checking ${pkg}...`);
    
    try {
      const updatedCount = await checkAndUpdateMetadataOnly(pkg);
      if (updatedCount > 0) {
        updated++;
      }
    } catch (error) {
      console.error(`Error updating ${pkg}:`, error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`Background scan completed. Checked ${total} packages, updated ${updated} packages.`);
}

async function getMetadata(pkg, host) {
  const metaPath = metaPackagePath(pkg);
  
  if (!fs.existsSync(metaPath)) {
    return await buildMetadata(pkg, host);
  }

  return JSON.parse(fs.readFileSync(metaPath).toString());
}

function sendTarball(res, filePath) {
  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Encoding', 'identity');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  
  const stream = fs.createReadStream(filePath);
  stream.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream error' });
    }
  });
  stream.pipe(res);
}

async function metadataCallback({ res, pkg, checkExist, next, req }) {
  if (checkExist) {
    return res.status(200).json({ exist: fs.existsSync(metaPackagePath(pkg)) });
  }

  const meta = await getMetadata(pkg, OWN_REGISTRY);

  if (!meta) {
    return res.status(404).json({ error: 'Package not found' });
  }

  res.setHeader('Content-Type', 'application/json');

  try {
    const json = JSON.stringify(meta);
    JSON.parse(json);

    if ((req.headers['accept-encoding'] || '').includes('gzip')) {
      res.setHeader('Content-Encoding', 'gzip');
      zlib.gzip(json, (err, gz) => {
        if (err) return next();
        res.end(gz);
      });
    } else {
      res.end(json);
    }
  } catch (err) {
    try {
      await rebuildMetadataOnError(pkg, OWN_REGISTRY);
      const newMeta = await getMetadata(pkg, OWN_REGISTRY);
      const newJson = JSON.stringify(newMeta);
      res.end(newJson);
    } catch (rebuildErr) {
      return res.status(500).json({ error: 'Failed to generate valid metadata' });
    }
  }
}

async function tarballCallback({ res, pkg, file, checkExist, next }) {
  const throwErr = (code, error) => {
    res.status(code).json({ code, error });
  };

  const versionMatch = file.match(/(\d+\.\d+\.\d+(?:-[^\/]+)?)\.tgz/);

  if (!versionMatch) {
    return throwErr(400, 'Invalid tarball filename format');
  }

  const version = versionMatch[1];
  const p = tarballPath(pkg, version);

  if (checkExist) {
    const exists = fs.existsSync(p);
    return res.status(200).json({ exist: exists });
  }

  if (fs.existsSync(p)) {
    let meta = null;
    try {
      const metadata = JSON.parse(fs.readFileSync(metaPackagePath(pkg), 'utf8'));
      meta = metadata?.versions?.[version] ?? {};
      
      if (verifyIntegrity(p, meta?.dist?.integrity)) {
        return sendTarball(res, p);
      } else {
        fs.unlinkSync(p);
      }
    } catch (_) {
    }
  }

  let meta = null;
  const metaPath = metaPackagePath(pkg);
  
  if (!fs.existsSync(metaPath)) {
    try {
      await buildMetadata(pkg, OWN_REGISTRY);
    } catch (error) {
      return throwErr(404, `Package ${pkg} not found and metadata build failed: ${error.message}`);
    }
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta = metadata?.versions?.[version] ?? null;
  } catch (error) {
    try {
      await rebuildMetadataOnError(pkg, OWN_REGISTRY);
      const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      meta = metadata?.versions?.[version] ?? null;
    } catch (_) {
      return throwErr(404, `Package ${pkg} or version ${version} not found`);
    }
  }

  if (!meta || !meta.dist || !meta.dist.tarball) {
    return throwErr(404, 'Tarball distribution information not found');
  }

  const downloaded = await downloadTarballOnDemand(pkg, version, meta.dist);
  if (!downloaded) {
    return throwErr(500, 'Failed to download tarball from all registries');
  }

  if (!fs.existsSync(p)) {
    return throwErr(404, 'Tarball not found after download attempt');
  }

  if (!verifyIntegrity(p, meta.dist.integrity)) {
    fs.unlinkSync(p);
    return throwErr(404, 'Tarball integrity check failed after download');
  }

  sendTarball(res, p);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }));

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'favicon.ico'));
});

app.post('/-/npm/v1/security/advisories/bulk', (req, res) => {
  res.status(200).json({});
});

app.get('//@:scope/:name/-/:file', async (req, res, next) => {
  try {
    const pkg = `@${req.params.scope}/${req.params.name}`;
    const file = req.params.file;
    const checkExist = req.query?.checkExist ?? false;
    await tarballCallback({ res, pkg, file, checkExist, next });
  } catch (_) {
    next();
  }
});

app.get('/@:scope/:name/-/:file', async (req, res, next) => {
  try {
    const pkg = `@${req.params.scope}/${req.params.name}`;
    const file = req.params.file;
    const checkExist = req.query?.checkExist ?? false;
    await tarballCallback({ res, pkg, file, checkExist, next });
  } catch (_) {
    next();
  }
});

app.get('//@:scope/:name', async (req, res, next) => {
  try {
    const pkg = `@${req.params.scope}/${req.params.name}`;
    const checkExist = req.query?.checkExist ?? false;
    await metadataCallback({ res, pkg, checkExist, next, req });
  } catch (_) {
    next();
  }
});

app.get('/@:scope/:name', async (req, res, next) => {
  try {
    const pkg = `@${req.params.scope}/${req.params.name}`;
    const checkExist = req.query?.checkExist ?? false;
    await metadataCallback({ res, pkg, checkExist, next, req });
  } catch (_) {
    next();
  }
});

app.get('//:pkg/-/:file', async (req, res, next) => {
  try {
    const pkg = decodeURIComponent(req.params.pkg);
    const file = req.params.file;
    const checkExist = req.query?.checkExist ?? false;
    await tarballCallback({ res, pkg, file, checkExist, next });
  } catch (_) {
    next();
  }
});

app.get('/:pkg/-/:file', async (req, res, next) => {
  try {
    const pkg = decodeURIComponent(req.params.pkg);
    const file = req.params.file;
    const checkExist = req.query?.checkExist ?? false;
    await tarballCallback({ res, pkg, file, checkExist, next });
  } catch (_) {
    next();
  }
});

app.get('//:pkg', async (req, res, next) => {
  try {
    const pkg = decodeURIComponent(req.params.pkg);
    const checkExist = req.query?.checkExist ?? false;
    await metadataCallback({ res, pkg, checkExist, next, req });
  } catch (_) {
    next();
  }
});

app.get('/:pkg', async (req, res, next) => {
  try {
    const pkg = decodeURIComponent(req.params.pkg);
    const checkExist = req.query?.checkExist ?? false;
    await metadataCallback({ res, pkg, checkExist, next, req });
  } catch (_) {
    next();
  }
});

app.use((req, res) => {
  const extracted = extractPkgAndVersionFromUrl(req.path);
  if (extracted && extracted.pkg && extracted.version) {
    const p = tarballPath(extracted.pkg, extracted.version);
    if (fs.existsSync(p)) {
      return sendTarball(res, p);
    }
  }
  
  res.status(200).json({
    code: 200,
    message: 'Ready',
  });
});

app.use((err, req, res, next) => {
  res.status(500).json({
    code: 500,
    message: 'Internal Server Error',
  });
});

setInterval(() => {
  scanAllPackagesAndUpdate().catch(error => {
    console.error('Background scan error:', error);
  });
}, 24 * 60 * 60 * 1000);

scanAllPackagesAndUpdate().catch(error => {
  console.error('Initial background scan error:', error);
});

app.listen(PORT, () => {
  console.log(`NPM Mirror running on port ${PORT}`);
  console.log('Daily background scan scheduled (every 24 hours)');
});
