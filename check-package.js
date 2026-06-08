
const fs = require('fs');
const path = require('path');
const https = require('https');

const REGISTRY = process.env.OWN_NPM_URL;

function readPackageJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function checkPackage(pkg, version) {
  return new Promise(resolve => {
    const url = `${REGISTRY}/${encodeURIComponent(pkg)}`;

    https
      .get(url, res => {
        if (res.statusCode !== 200) {
          return resolve({
            pkg,
            version,
            exists: false,
          });
        }

        let data = '';

        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);

            const versions = json.versions || {};
            const exists = !!versions[version];

            resolve({
              pkg,
              version,
              exists,
            });
          } catch {
            resolve({
              pkg,
              version,
              exists: false,
            });
          }
        });
      })
      .on('error', () => {
        resolve({
          pkg,
          version,
          exists: false,
        });
      });
  });
}

async function checkAll(packageFile) {
  const pkg = readPackageJson(packageFile);

  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  const entries = Object.entries(deps);

  for (const [name, version] of entries) {
    const cleanVersion = version.replace(/^[\^~]/, '');

    const result = await checkPackage(name, cleanVersion);

    if (result.exists) {
      console.log(`✅ ${name}@${cleanVersion} exists`);
    } else {
      console.log(`❌ ${name}@${cleanVersion} NOT found`);
    }
  }
}

const file = process.argv[2] || path.join(process.cwd(), 'package.json');

checkAll(file);
