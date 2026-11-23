"use strict";

const REPOSITORY = "popoone1/Capitol-Stock-Management";
const INSTALLER_PREFIX = "Capitol-Stock-Management-Setup-";
const INSTALLER_SUFFIX = ".exe";
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
let cachedRelease = null;
let cacheExpiresAt = 0;
let pendingRelease = null;

function parseLatestRelease(release) {
  const tag = String(release?.tag_name || "");
  const version = tag.replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+$/.test(version) || release.draft || release.prerelease) {
    throw new Error("The latest GitHub release has an invalid or unsupported version.");
  }
  const installerName = `${INSTALLER_PREFIX}${version}${INSTALLER_SUFFIX}`;
  const installer = release.assets?.find(asset => asset.name === installerName);
  if (!installer || !Number.isSafeInteger(installer.size) || installer.size <= 0 ||
      installer.size > 512 * 1024 * 1024) {
    throw new Error(`The latest release does not contain a valid ${installerName} installer.`);
  }
  if (!/^sha256:[a-f0-9]{64}$/i.test(installer.digest || "")) {
    throw new Error("The latest release installer is missing its GitHub SHA-256 digest.");
  }
  const downloadUrl = new URL(installer.browser_download_url);
  if (downloadUrl.protocol !== "https:" || downloadUrl.hostname !== "github.com" ||
      !downloadUrl.pathname.startsWith(`/popoone1/Capitol-Stock-Management/releases/download/${tag}/`)) {
    throw new Error("The latest release installer URL is invalid.");
  }
  return {
    version,
    tag,
    installerName,
    size: installer.size,
    digest: installer.digest.toLowerCase(),
    downloadUrl: downloadUrl.href,
    releaseUrl: `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`,
    publishedAt: release.published_at || "",
  };
}

async function getLatestRelease() {
  if (cachedRelease && Date.now() < cacheExpiresAt) return cachedRelease;
  if (pendingRelease) return pendingRelease;
  pendingRelease = (async () => {
    const response = await fetch(RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Capitol-Stock-Management",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error(`GitHub release check failed (${response.status}).`);
    }
    const release = parseLatestRelease(await response.json());
    cachedRelease = release;
    cacheExpiresAt = Date.now() + 5 * 60 * 1000;
    return release;
  })();
  try {
    return await pendingRelease;
  } finally {
    pendingRelease = null;
  }
}

function compareVersions(first, second) {
  const left = String(first).replace(/^v/i, "").split(".").map(part => Number.parseInt(part, 10) || 0);
  const right = String(second).replace(/^v/i, "").split(".").map(part => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

module.exports = { compareVersions, getLatestRelease, parseLatestRelease };
