"use strict";

const assert = require("node:assert/strict");
const { parseLatestRelease, compareVersions } = require("../release-api");

const installerName = "Capitol-Stock-Management-Setup-1.0.7.exe";
const release = parseLatestRelease({
  tag_name: "v1.0.7",
  draft: false,
  prerelease: false,
  published_at: "2026-11-23T12:00:00Z",
  assets: [{
    name: installerName,
    size: 141_000_000,
    digest: `sha256:${"a".repeat(64)}`,
    browser_download_url: `https://github.com/popoone1/Capitol-Stock-Management/releases/download/v1.0.7/${installerName}`,
  }],
});

assert.equal(release.version, "1.0.7");
assert.equal(release.installerName, installerName);
assert.equal(release.size, 141_000_000);
assert.equal(compareVersions("1.0.6", release.version), -1);
assert.equal(compareVersions("1.0.7", release.version), 0);
assert.throws(() => parseLatestRelease({
  tag_name: "v1.0.7",
  assets: [{
    name: installerName,
    size: 12,
    digest: `sha256:${"a".repeat(64)}`,
    browser_download_url: "https://evil.example/installer.exe",
  }],
}), /installer URL is invalid/);
assert.throws(() => parseLatestRelease({
  tag_name: "v1.0.7",
  assets: [{
    name: installerName,
    size: 12,
    browser_download_url: `https://github.com/popoone1/Capitol-Stock-Management/releases/download/v1.0.7/${installerName}`,
  }],
}), /missing its GitHub SHA-256 digest/);

console.log("GitHub desktop release metadata checks passed.");
