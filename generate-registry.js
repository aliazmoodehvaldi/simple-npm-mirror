const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = __dirname;
const OUTPUT = path.join(ROOT, 'packages');

fs.mkdirSync(OUTPUT, { recursive: true });

function sha1(file) {
  const data = fs.readFileSync(file);
  return crypto.createHash('sha1').update(data).digest('hex');
}

function sha512(file) {
  const data = fs.readFileSync(file);
  return 'sha512-' + crypto.createHash('sha512').update(data).digest('base64');
}

function scanAll(dir, list = []) {
  if (!fs.existsSync(dir)) return list;

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    if (!item.isDirectory()) continue;
    if (item.name.startsWith('.')) continue;

    const full = path.join(dir, item.name);

    if (item.name.startsWith('@')) {
      const scoped = fs.readdirSync(full, { withFileTypes: true });

      for (const s of scoped) {
        if (!s.isDirectory()) continue;

        const p = path.join(full, s.name);
        const pj = path.join(p, 'package.json');

        if (fs.existsSync(pj)) {
          const data = JSON.parse(fs.readFileSync(pj));

          list.push({
            name: data.name,
            version: data.version,
            dir: fs.realpathSync(p),
          });
        }

        scanAll(path.join(p, 'node_modules'), list);
      }

      continue;
    }

    const pj = path.join(full, 'package.json');

    if (fs.existsSync(pj)) {
      const data = JSON.parse(fs.readFileSync(pj));

      list.push({
        name: data.name,
        version: data.version,
        dir: fs.realpathSync(full),
      });
    }

    scanAll(path.join(full, 'node_modules'), list);
  }

  return list;
}

function resolveDeps(pkg) {
  return {
    dependencies: pkg.dependencies || {},
    optionalDependencies: pkg.optionalDependencies || {},
    peerDependencies: pkg.peerDependencies || {},
    peerDependenciesMeta: pkg.peerDependenciesMeta || {},
    devDependencies: pkg.devDependencies || {},
  };
}

function pack(pkg) {
  const outDir = path.join(OUTPUT, pkg.name);
  fs.mkdirSync(outDir, { recursive: true });

  try {
    execSync(
      `npm pack "${pkg.dir}" --ignore-scripts --pack-destination "${outDir}"`,
      { stdio: 'ignore' },
    );

    const files = fs.readdirSync(outDir);
    const tgz = files.find(f => f.endsWith('.tgz'));

    const tarball = path.join(outDir, tgz);

    const pj = JSON.parse(fs.readFileSync(path.join(pkg.dir, 'package.json')));

    const deps = resolveDeps(pj);

    const meta = {
      name: pj.name,
      version: pj.version,
      ...deps,
      engines: pj.engines,
      os: pj.os,
      cpu: pj.cpu,
      license: pj.license,
      dist: {
        shasum: sha1(tarball),
        integrity: sha512(tarball),
        tarball: tgz,
      },
    };

    fs.writeFileSync(
      path.join(outDir, pj.version + '.json'),
      JSON.stringify(meta, null, 2),
    );

    console.log('packed', pj.name);
  } catch {
    console.log('failed', pkg.name);
  }
}

const packages = scanAll(path.join(ROOT, 'node_modules'));

for (const pkg of packages) {
  pack(pkg);
}

console.log('done');
