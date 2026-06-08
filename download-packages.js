const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUTPUT = path.join(ROOT, 'packages');

function extractAllPackagesComplete(lockfilePath) {
  if (!fs.existsSync(lockfilePath)) {
    throw new Error(`package-lock.json not found at ${lockfilePath}`);
  }

  const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  const allPackages = [];

  const dependencyTypes = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ];

  function addPackage(pkgInfo, type = 'unknown', depPath = '') {
    allPackages.push({
      name: pkgInfo.name,
      version: pkgInfo.version,
      type,
      path: depPath,
      resolved: pkgInfo.resolved || null,
      integrity: pkgInfo.integrity || null,
      peerDependency: pkgInfo.peerDependency || false,
      optional: pkgInfo.optional || false,
    });
  }

  if (lockfile.name && lockfile.version) {
    addPackage(
      {
        name: lockfile.name,
        version: lockfile.version,
      },
      'root',
      '',
    );
  }

  function scanDependencyType(depsObj, type, currentPath = '') {
    if (!depsObj || typeof depsObj !== 'object') return;

    for (const [depName, depData] of Object.entries(depsObj)) {
      if (!depData || typeof depData !== 'object') continue;

      const version = depData.version;
      if (!version) continue;

      addPackage(
        {
          name: depName,
          version,
          resolved: depData.resolved,
          integrity: depData.integrity,
          peerDependency: depData.peer,
          optional: depData.optional,
        },
        type,
        `${currentPath}${depName}`,
      );

      dependencyTypes.forEach(depType => {
        if (depData[depType]) {
          scanDependencyType(
            depData[depType],
            `${type}/${depType}`,
            `${currentPath}${depName}/`,
          );
        }
      });

      if (depData.requires) {
        for (const [reqName, reqVersions] of Object.entries(depData.requires)) {
          const reqVersion = Array.isArray(reqVersions)
            ? reqVersions[0]
            : reqVersions;

          if (reqVersion && typeof reqVersion === 'string') {
            addPackage(
              { name: reqName, version: reqVersion },
              `${type}/requires`,
              `${currentPath}${depName}/requires/${reqName}`,
            );
          }
        }
      }
    }
  }

  dependencyTypes.forEach(type => {
    if (lockfile[type]) {
      console.log(
        `🔍 Scanning ${type}: ${Object.keys(lockfile[type]).length} packages`,
      );
      scanDependencyType(lockfile[type], type, '');
    }
  });

  if (lockfile.packages) {
    console.log(
      `📦 Scanning packages object: ${Object.keys(lockfile.packages).length} entries`,
    );

    for (const [pkgPath, pkgData] of Object.entries(lockfile.packages)) {
      if (pkgPath === '' || !pkgData.version) continue;

      let name;

      if (pkgData.name) {
        name = pkgData.name;
      } else {
        const parts = pkgPath.split('/');
        name = parts[parts.length - 1];

        if (name.startsWith('@') && parts.length > 1) {
          const lastTwo = parts.slice(-2);
          name = lastTwo.join('/');
        }
      }

      addPackage(
        {
          name,
          version: pkgData.version,
          resolved: pkgData.resolved,
          integrity: pkgData.integrity,
        },
        'packages',
        pkgPath,
      );

      dependencyTypes.forEach(type => {
        if (pkgData[type]) {
          scanDependencyType(pkgData[type], `packages/${type}`, `${pkgPath}/`);
        }
      });
    }
  }

  console.log('\n📊 Summary:');
  console.log(`Total found: ${allPackages.length}`);

  return allPackages.sort((a, b) => {
    const typeOrder = {
      root: 0,
      dependencies: 1,
      devDependencies: 2,
      peerDependencies: 3,
      optionalDependencies: 4,
      packages: 5,
    };

    const typeA = typeOrder[a.type] || 99;
    const typeB = typeOrder[b.type] || 99;

    if (typeA === typeB) {
      return a.name.localeCompare(b.name);
    }

    return typeA - typeB;
  });
}

const https = require('./h');

function getOutputPath(pkg) {
  if (pkg.name.startsWith('@')) {
    const [scope, name] = pkg.name.split('/');
    const dir = path.join(OUTPUT, scope, name);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${pkg.version}.tgz`);
  }

  const dir = path.join(OUTPUT, pkg.name);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${pkg.version}.tgz`);
}

const OWN_REGISTRY = process.env.OWN_NPM_URL;

async function pack(pkg) {
  const pk = pkg.name.startsWith('@') ? pkg.name.split('/').pop() : pkg.name;

  const outputPath = getOutputPath(pkg);

  if (fs.existsSync(outputPath)) return;

  const response = await https({
    hostname: new URL(OWN_REGISTRY).host,
    path: `/${pkg.name}/-/${pk}-${pkg.version}.tgz?checkExist=true`,
  });

  console.log(pkg.name, pkg.version);
  

  if (response?.exist === false) {
    const a = await https({
      hostname: 'registry.npmjs.com',
      path: `/${pkg.name}/-/${pk}-${pkg.version}.tgz`,
      outputPath,
    });

    if (a?.error) {
      throw new Error(a.error);
    }
  } else {
    console.log(response);
  }
}

(async function () {
  const packages = extractAllPackagesComplete('package-lock.json');

  for (let i = 0; i < packages.length; i++) {
    try {
      await pack(packages[i]);
    } catch (err) {
      console.log(err);
      console.log('break at index:', i);
      break;
    }
  }

  console.log('done');
})();
