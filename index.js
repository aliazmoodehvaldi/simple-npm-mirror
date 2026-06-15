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
  if (!integrity) return false;

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
    metadata.versions[version].dist.tarball = `${OWN_REGISTRY}/${pkg}/-/${pkg.split('/').pop()}-${version}.tgz`;
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

  function deepMerge(target, source, seen = new WeakMap()) {
    if (!isObject(source)) return source;

    if (seen.has(source)) {
      return seen.get(source);
    }

    let result;

    if (Array.isArray(source)) {
      result = Array.isArray(target) ? [...target] : [];
      seen.set(source, result);

      for (const item of source) {
        result.push(deepMerge(undefined, item, seen));
      }
      return result;
    }

    if (source instanceof Date) {
      return new Date(source.getTime());
    }

    if (source instanceof Map) {
      result = new Map(target instanceof Map ? target : []);
      seen.set(source, result);

      for (const [key, value] of source.entries()) {
        result.set(key, deepMerge(result.get(key), value, seen));
      }
      return result;
    }

    if (source instanceof Set) {
      result = new Set(target instanceof Set ? target : []);
      seen.set(source, result);

      for (const value of source.values()) {
        result.add(deepMerge(undefined, value, seen));
      }
      return result;
    }

    result = { ...(isObject(target) ? target : {}) };
    seen.set(source, result);

    for (const key of Reflect.ownKeys(source)) {
      const sourceVal = source[key];
      const targetVal = result[key];

      if (isObject(sourceVal)) {
        result[key] = deepMerge(targetVal, sourceVal, seen);
      } else {
        result[key] = sourceVal;
      }
    }

    return result;
  }

  let data = {};

  for (const meta of list) {
    data = deepMerge(data, meta);
  }

  return data;
}

async function ensureTarballWithPriority(pkg, version, dist) {
  const dest = tarballPath(pkg, version);
  
  if (fs.existsSync(dest) && verifyIntegrity(dest, dist.integrity)) {
    return true;
  }

  for (const registry of REGISTRIES) {
    try {
      const tarballUrl = new URL(dist.tarball);
      const registryUrl = new URL(registry);
      tarballUrl.host = registryUrl.host;
      tarballUrl.protocol = registryUrl.protocol;
      
      const tmp = dest + '.tmp';
      
      const result = await requestWithRedirect({
        protocol: tarballUrl.protocol.replace(':', ''),
        hostname: tarballUrl.hostname,
        path: tarballUrl.pathname + tarballUrl.search,
        method: 'GET',
        outputPath: tmp,
        timeout: 30000
      });

      if (result && !result.error && fs.existsSync(tmp)) {
        if (verifyIntegrity(tmp, dist.integrity)) {
          fs.renameSync(tmp, dest);
          return true;
        }
      }
      
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      
    } catch (error) {
      if (fs.existsSync(dest + '.tmp')) fs.unlinkSync(dest + '.tmp');
    }
  }
  
  return false;
}

async function ensureTarball(pkg, version, dist) {
  return await ensureTarballWithPriority(pkg, version, dist);
}

async function buildMetadata(pkg, host) {
  const list = await fetchAllMetadata(pkg);
  if (!list.length) throw new Error('not found');

  const merged = mergeMetadata(list);

  fs.mkdirSync(pkgPath(pkg), { recursive: true });

  for (const v of Object.keys(merged.versions)) {
    const meta = merged.versions[v];
    if (meta.dist) {
      meta.dist.tarball = `${host}/${pkg}/-/${pkg.split('/').pop()}-${v}.tgz`;
    }
  }

  fs.writeFileSync(metaPackagePath(pkg), JSON.stringify(merged));

  for (const v of Object.keys(merged.versions)) {
    const meta = merged.versions[v];
    if (meta.dist && meta.dist.tarball) {
      await ensureTarball(pkg, v, meta.dist);
    }
  }

  return merged;
}

async function getMetadata(pkg, host) {
  const metaPath = metaPackagePath(pkg);
  
  if (!fs.existsSync(metaPath)) {
    return await buildMetadata(pkg, host);
  }

  let metadata = JSON.parse(fs.readFileSync(metaPath).toString());
  
  const freshMetadata = await fetchAllMetadata(pkg);
  if (freshMetadata.length > 0) {
    const mergedFresh = mergeMetadata(freshMetadata);
    
    let hasNewVersions = false;
    for (const [version, meta] of Object.entries(mergedFresh.versions || {})) {
      if (!metadata.versions[version]) {
        metadata.versions[version] = meta;
        hasNewVersions = true;
      }
    }
    
    if (hasNewVersions) {
      for (const version of Object.keys(metadata.versions)) {
        if (metadata.versions[version].dist) {
          metadata.versions[version].dist.tarball = `${host}/${pkg}/-/${pkg.split('/').pop()}-${version}.tgz`;
        }
      }
      
      fs.writeFileSync(metaPath, JSON.stringify(metadata));
      
      for (const [version, meta] of Object.entries(metadata.versions)) {
        if (meta.dist && meta.dist.tarball && !fs.existsSync(tarballPath(pkg, version))) {
          await ensureTarball(pkg, version, meta.dist);
        }
      }
    }
  }
  
  return metadata;
}

app.use(helmet({ contentSecurityPolicy: false }));

app.use(helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }));

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'favicon.ico'));
});

app.post('/-/npm/v1/security/advisories/bulk', (req, res) => {
  res.status(200).json({});
});

async function metadataCallback({ res, pkg, checkExist, next, req }) {
  if (checkExist) {
    return res.status(200).json({ exist: fs.existsSync(metaPackagePath(pkg)) });
  }

  const meta = await getMetadata(pkg, OWN_REGISTRY);

  if (!meta) {
    return res.status(404).json({ error: 'Package not found' });
  }

  res.setHeader('Content-Type', 'application/json');

  const json = JSON.stringify(meta);

  if ((req.headers['accept-encoding'] || '').includes('gzip')) {
    res.setHeader('Content-Encoding', 'gzip');

    zlib.gzip(json, (err, gz) => {
      if (err) return next();
      res.end(gz);
    });
  } else {
    res.end(json);
  }
}

async function tarballCallback({ res, pkg, file, checkExist, next }) {
  const throwErr = (code, error) => {
    res.status(code).json({
      code,
      error,
    });
  };

  const versionMatch = file.match(/(\d+\.\d+\.\d+(?:-[^\/]+)?)\.tgz/);

  if (!versionMatch) {
    return throwErr(400, 'Invalid tarball filename format');
  }

  const version = versionMatch[1];

  const p = tarballPath(pkg, version);

  if (checkExist) {
    return res.status(200).json({ exist: fs.existsSync(p) });
  }

  if (!fs.existsSync(p)) {
    const metaPath = metaPackagePath(pkg);
    let meta = null;

    if (fs.existsSync(metaPath)) {
      try {
        const metaContent = fs.readFileSync(metaPath, 'utf8');
        const metadata = JSON.parse(metaContent);
        meta = metadata?.versions?.[version] ?? null;
      } catch (_) {
        meta = null;
      }
    }

    if (!meta) {
      const result = await findVersionInAllRegistries(pkg, version);
      
      if (result && result.versionData) {
        meta = result.versionData;
        await updateMetadataWithVersion(pkg, version, meta);
      } else {
        try {
          const buildResult = await buildMetadata(pkg, OWN_REGISTRY);
          meta = buildResult?.versions?.[version] ?? null;
        } catch (_) {
          return throwErr(
            404,
            `Package ${pkg} or version ${version} not found, and metadata build failed.`,
          );
        }
      }
    }

    if (meta && meta?.dist && meta?.dist?.tarball) {
      const downloaded = await ensureTarball(pkg, version, meta.dist);
      if (!downloaded) {
        return throwErr(500, 'Failed to download tarball');
      }
    } else {
      return throwErr(404, 'Tarball distribution information not found');
    }
  }

  if (!fs.existsSync(p)) {
    return throwErr(404, 'Tarball not found after download attempt');
  }

  let meta = null;
  try {
    const metadata = JSON.parse(fs.readFileSync(metaPackagePath(pkg), 'utf8'));
    meta = metadata?.versions?.[version] ?? {};
  } catch (_) {
    meta = {};
  }

  if (!verifyIntegrity(p, meta?.dist?.integrity)) {
    fs.unlinkSync(p);
    return throwErr(404, 'Tarball integrity check failed');
  }

  const stat = fs.statSync(p);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Encoding', 'identity');
  res.setHeader('Content-Length', stat.size);

  const stream = fs.createReadStream(p);

  stream.on('error', _ => {
    next();
  });

  stream.pipe(res);
}

app.get('/:pkg', async (req, res, next) => {
  try {
    const pkg = decodeURIComponent(req.params.pkg);
    const checkExist = req.query?.checkExist ?? false;
    await metadataCallback({ res, pkg, checkExist, next, req });
  } catch (_) {
    next();
  }
});

app.get('/:scope/:name', async (req, res, next) => {
  try {
    const pkg = decodeURIComponent(`${req.params.scope}/${req.params.name}`);
    const checkExist = req.query?.checkExist ?? false;
    await metadataCallback({ res, pkg, checkExist, next, req });
  } catch (_) {
    next();
  }
});

app.get('/:pkg/-/:file', async (req, res, next) => {
  try {
    const rawPkg = req.params.pkg;
    const pkg = decodeURIComponent(rawPkg);
    const file = req.params.file;
    const checkExist = req.query?.checkExist ?? false;
    await tarballCallback({ res, pkg, file, checkExist, next });
  } catch (_) {
    next();
  }
});

app.get('/:scope/:name/-/:file', async (req, res, next) => {
  try {
    const pkg = decodeURIComponent(`${req.params.scope}/${req.params.name}`);
    const file = req.params.file;
    const checkExist = req.query?.checkExist ?? false;
    await tarballCallback({ res, pkg, file, checkExist, next });
  } catch (_) {
    next();
  }
});

app.use((req, res) => {
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

app.listen(PORT, () => {
  console.log(`NPM Mirror running on port ${PORT}`);
});
