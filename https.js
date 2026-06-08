// NPM Modules
const querystring = require('querystring');
const https = require('https');
const { URL } = require('url');
const http = require('http');
const fs = require('fs');

/**
 * Makes an HTTPS request with the provided options.
 * @param {Object} obj - The object containing request parameters.
 * @param {String} obj.hostname - The hostname of the server (e.g., www.google.com, etc.).
 * @param {String} obj.path - The path of the request.
 * @param {'DELETE' | 'PATCH' | 'POST' | 'GET' | 'PUT'} obj.method - The HTTP method (e.g., 'GET', 'POST', etc.).
 * @param {Object} obj.headers - The request headers.
 * @param {Object} obj.body - The request body.
 * @param {String} [obj.outputPath] - If provided, will save response to this file path (for downloads).
 * @param {Number} redirectCount
 * @return {Promise<Object>} - A promise that resolves with the response data or file path if outputPath was provided.
 */
module.exports = function requestWithRedirect(obj, redirectCount = 0) {
  const MAX_REDIRECTS = 5;
  const REQUEST_TIMEOUT = 30000; // 30 seconds

  return new Promise(resolve => {
    let settled = false;
    const done = result => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const methodsAllowingBody = ['POST', 'PUT', 'PATCH', 'DELETE'];
    const isDownload = Boolean(obj?.outputPath);
    const protocol = obj?.protocol === 'http' ? 'http' : 'https';
    const client = protocol === 'http' ? http : https;

    let postData;
    const contentType = obj?.headers?.['Content-Type'] || '';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      postData =
        typeof obj?.body === 'object'
          ? querystring.stringify(obj.body)
          : obj.body;
    } else {
      postData = JSON.stringify(obj?.body ?? {});
      obj.headers = {
        ...(obj?.headers ?? {}),
        'Content-Type': 'application/json; charset=UTF-8',
        accept: isDownload ? '*/*' : 'application/json',
      };
    }

    const options = {
      port: obj.port || (protocol === 'http' ? 80 : 443),
      hostname: obj.hostname,
      path: obj.path,
      method: obj.method,
      headers: {
        'cache-control': 'no-cache',
        ...(methodsAllowingBody.includes(obj.method?.toUpperCase())
          ? { 'Content-Length': Buffer.byteLength(postData, 'utf8') }
          : {}),
        ...(obj?.headers ?? {}),
      },
    };

    const req = client.request(options);

    // HARD TIMEOUT (total request time)
    const hardTimeout = setTimeout(() => {
      req.destroy(new Error('Request timeout'));
    }, REQUEST_TIMEOUT);

    req.on('response', res => {
      // ===== REDIRECT =====
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        clearTimeout(hardTimeout);

        if (redirectCount >= MAX_REDIRECTS) {
          return done({ error: 'Too many redirects' });
        }

        const location = res.headers.location;
        if (!location) {
          return done({ error: 'Redirect location missing' });
        }

        try {
          const redirectUrl = new URL(
            location.startsWith('http')
              ? location
              : `${obj.protocol}://${obj.hostname}${location}`,
          );

          return done(
            requestWithRedirect(
              {
                ...obj,
                hostname: redirectUrl.hostname,
                path: redirectUrl.pathname + redirectUrl.search,
                protocol: redirectUrl.protocol.slice(0, -1),
              },
              redirectCount + 1,
            ),
          );
        } catch {
          return done({ error: 'Invalid redirect URL' });
        }
      }

      // ===== DOWNLOAD MODE =====
      if (isDownload) {
        const file = fs.createWriteStream(obj.outputPath);

        const cleanup = error => {
          clearTimeout(hardTimeout);
          res.destroy();
          file.destroy();
          fs.unlink(obj.outputPath, () => {});
          done({ error });
        };

        res.on('aborted', () => cleanup('Download aborted'));
        res.on('error', err => cleanup(err.message));
        file.on('error', err => cleanup(err.message));

        file.on('finish', () => {
          clearTimeout(hardTimeout);
          file.close(() => {
            done({
              filePath: obj.outputPath,
              statusCode: res.statusCode,
            });
          });
        });

        res.pipe(file);
        return;
      }

      // ===== NORMAL RESPONSE =====
      let data = '';
      const chunks = [];

      if (res.headers['content-type']?.includes('application/json')) {
        res.setEncoding('utf8');
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          clearTimeout(hardTimeout);
          try {
            done(JSON.parse(data));
          } catch {
            done(data);
          }
        });
      } else {
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          clearTimeout(hardTimeout);
          done(Buffer.concat(chunks));
        });
      }
    });

    req.on('error', err => {
      clearTimeout(hardTimeout);
      done({ error: err.message });
    });

    if (methodsAllowingBody.includes(obj.method?.toUpperCase())) {
      req.write(postData);
    }

    req.end();
  });
};
