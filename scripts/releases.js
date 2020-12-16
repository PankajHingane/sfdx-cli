#!/usr/bin/env node

/* eslint-disable no-console */
/* eslint-disable no-process-exit */

const fs = require('fs');
const http = require('http');
const { URL } = require('url');

const file = process.argv[2];
const s3Endpoint = process.argv[3];
const s3Bucket = process.argv[4];
const s3Folder = process.argv[5];
const s3Url = new URL(`${s3Endpoint}/${s3Bucket}/${s3Folder}/releases.json`);
const version = process.argv[6];
const channel = process.argv[7];

// roughly 6 months worth of release history
const maxEntries = 30;
const maxAgeDays = 120;

if (!file || !s3Endpoint || !s3Bucket || !s3Folder || !version || !channel) {
  console.error('Usage: %s <out file> <endpoint> <bucket> <folder> <version> <channel>', process.argv[1]);
  process.exit(1);
}

async function fetchReleases(url = s3Url) {
  console.log('Fetching releases.json from %s', url);
  return new Promise((resolve) => {
    return http.get(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
      },
      function (response) {
        const generateDefault = (reason) => {
          console.warn('Fetch failed, using default: %s', reason);
          // return a default json object with which we will prime a new releases file
          return resolve({ stable: [] });
        };
        if (response.statusCode !== 200) {
          if (response.statusCode === 301) {
            console.log('Following redirect');
            return fetchReleases(new URL(response.headers.location));
          }
          return generateDefault(response.statusCode);
        }
        let body = '';
        response.on('data', (d) => (body += d));
        response.on('end', () => resolve(JSON.parse(body)));
        response.on('error', generateDefault);
      }
    );
  });
}

async function updateReleases() {
  const json = await fetchReleases();
  pruneChannels(json);
  if (!json[channel]) json[channel] = [];
  const lastDash = version.lastIndexOf('-');
  if (lastDash < 0) throw new Error('Unexpected version format: ' + version);
  json[channel].push({
    main: version.slice(0, lastDash),
    hash: version.slice(lastDash + 1),
    date: new Date().toISOString(),
  });
  fs.writeFileSync(file, JSON.stringify(json, null, 2));
  console.log('Wrote %s', file);
}

function pruneChannels(json) {
  Object.keys(json).forEach((channel) => {
    json[channel] = pruneByAge(json[channel]);
    json[channel] = pruneByLength(json[channel]);
    json[channel] = pruneByUniqueness(json[channel]);
  });
}

function pruneByAge(list) {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return list.filter((entry) => entry.date && new Date(entry.date).getTime() > cutoff);
}

function pruneByLength(list) {
  if (list.length >= maxEntries) list = list.slice(1);
  return list;
}

function pruneByUniqueness(list) {
  const seen = {};
  return list
    .reverse()
    .filter((el) => {
      const version = el.main + '-' + el.hash;
      if (seen[version]) return false;
      seen[version] = true;
      return true;
    })
    .reverse();
}

updateReleases().catch((err) => {
  console.error(err.stack);
  process.exitCode = 1;
});
