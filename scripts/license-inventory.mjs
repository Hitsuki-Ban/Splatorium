import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, "..");
const INVENTORY_PATH = "licenses/software-inventory.json";
const NOTICE_PATH = "third-party-licenses.md";
const BROWSER_LICENSE_PATH = "apps/web/dist/.vite/license.json";
const SERVER_PATH = "apps/server";

const MANIFEST_PATHS = [
  "package.json",
  "apps/web/package.json",
  "apps/server/package.json",
  "packages/shared/package.json",
];

const CURATED_CSS = [
  { name: "tailwindcss", version: "4.3.2", reason: "CSS generated from project Tailwind input" },
  { name: "tw-animate-css", version: "1.4.0", reason: "CSS imported into the browser stylesheet" },
];

const COPIED_SOURCES = [
  {
    name: "shadcn/ui",
    version: "source snapshot",
    declaredExpression: "MIT",
    licensePath: "licenses/copied-source/shadcn-ui-LICENSE.md",
    source: "https://github.com/shadcn-ui/ui/blob/6ea6856f5a1082d4d9c231559b6bc3ee73827493/LICENSE.md",
    sourceCommit: "6ea6856f5a1082d4d9c231559b6bc3ee73827493",
    retrievedAt: "2026-07-12",
    reason: "Project-owned component source derived from shadcn/ui; excluded from the 113 package-version union",
  },
];

// These exact npm packages declare MIT but omit the license file from their
// published tarball. The snapshots are pinned to primary upstream license text.
const PACKAGE_LICENSE_SNAPSHOTS = new Map([
  ["@react-three/fiber@9.6.1", {
    path: "licenses/copied-source/react-three-fiber-9.6.1-LICENSE",
    source: "https://github.com/pmndrs/react-three-fiber/blob/2a528745e9aa7c9e6cca41e404b59d45cf0d0cc7/LICENSE",
    sourceCommit: "2a528745e9aa7c9e6cca41e404b59d45cf0d0cc7",
    retrievedAt: "2026-07-12",
  }],
  ["react-remove-scroll-bar@2.3.8", {
    path: "licenses/copied-source/react-remove-scroll-bar-2.3.8-LICENSE",
    source: "https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE",
    sourceCommit: "8ca9ba5ea52de03308fe8ced94f7b159a44d28ff",
    retrievedAt: "2026-07-12",
  }],
]);

const RUNTIME_PLACEHOLDERS = [
  {
    name: "Node.js runtime",
    condition: "Not included in the Portable package. Place the Windows Node.js major version recorded in app/node/README.txt during setup.",
  },
  {
    name: "ComfyUI runtime and custom nodes",
    condition: "Not included in the Portable package. Provide a compatible ComfyUI installation during setup.",
  },
];

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readBytes(root, path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) fail(`Required license-audit input is missing: ${path}`);
  return readFileSync(absolute);
}

function readJson(root, path) {
  try {
    return JSON.parse(readBytes(root, path).toString("utf8"));
  } catch (error) {
    fail(`Invalid JSON in ${path}: ${error.message}`);
  }
}

function packageKey(value) {
  return `${value.name}@${value.version}`;
}

function comparePackage(a, b) {
  return packageKey(a).localeCompare(packageKey(b), "en");
}

function listDirectPackageRoots(pnpmRoot) {
  if (!existsSync(pnpmRoot)) fail(`pnpm virtual store is missing: ${pnpmRoot}`);
  const roots = [];
  for (const entry of readdirSync(pnpmRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    const entryRoot = realpathSync(join(pnpmRoot, entry.name));
    const modulesRoot = join(pnpmRoot, entry.name, "node_modules");
    if (!existsSync(modulesRoot)) continue;
    for (const child of readdirSync(modulesRoot, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      if (child.name.startsWith("@")) {
        const scopeRoot = join(modulesRoot, child.name);
        for (const scoped of readdirSync(scopeRoot, { withFileTypes: true })) {
          if (scoped.isDirectory() || scoped.isSymbolicLink()) {
            const candidate = join(scopeRoot, scoped.name);
            const location = relative(entryRoot, realpathSync(candidate));
            if (!location.startsWith("..") && !isAbsolute(location)) roots.push(candidate);
          }
        }
      } else {
        const candidate = join(modulesRoot, child.name);
        const location = relative(entryRoot, realpathSync(candidate));
        if (!location.startsWith("..") && !isAbsolute(location)) roots.push(candidate);
      }
    }
  }
  return roots;
}

function buildInstalledPackageIndex(pnpmRoot) {
  const index = new Map();
  for (const packageRoot of listDirectPackageRoots(pnpmRoot)) {
    const manifestPath = join(packageRoot, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") continue;
    const key = packageKey(manifest);
    if (!index.has(key)) index.set(key, { packageRoot, manifest });
  }
  return index;
}

function findCaseInsensitiveFile(packageRoot, exactNames) {
  const files = readdirSync(packageRoot, { withFileTypes: true }).filter((entry) => entry.isFile());
  for (const exactName of exactNames) {
    const match = files.find((entry) => entry.name.toLowerCase() === exactName.toLowerCase());
    if (match) return join(packageRoot, match.name);
  }
  return undefined;
}

function selectLicense(packageRoot, manifest) {
  let licenseFile;
  let selectedLicense = manifest.license;
  if (manifest.name === "rc" && manifest.version === "1.2.8") {
    licenseFile = findCaseInsensitiveFile(packageRoot, ["LICENSE.MIT"]);
    selectedLicense = "MIT";
  } else if (manifest.name === "expand-template" && manifest.version === "2.0.3") {
    licenseFile = findCaseInsensitiveFile(packageRoot, ["LICENSE"]);
    selectedLicense = "MIT";
  } else {
    licenseFile = findCaseInsensitiveFile(packageRoot, [
      "LICENSE",
      "LICENSE.md",
      "LICENSE.txt",
      "LICENCE",
      "LICENCE.md",
      "COPYING",
    ]);
  }
  if (typeof manifest.license !== "string" || manifest.license.length === 0) {
    fail(`${packageKey(manifest)} has no declared license expression`);
  }
  if (typeof selectedLicense !== "string" || selectedLicense.length === 0) {
    fail(`${packageKey(manifest)} has no selected license`);
  }
  if (!licenseFile) fail(`${packageKey(manifest)} has no recognized license file`);
  const textBytes = readFileSync(licenseFile);
  const noticeFile = findCaseInsensitiveFile(packageRoot, ["NOTICE", "NOTICE.md", "NOTICE.txt"]);
  const noticeBytes = noticeFile ? readFileSync(noticeFile) : undefined;
  return {
    declaredExpression: manifest.license,
    selectedLicense,
    textBytes,
    noticeBytes,
  };
}

function deployServer(root) {
  const serverRoot = join(root, SERVER_PATH);
  const directoryName = `.license-audit-${process.pid}-${Date.now()}`;
  const deployRoot = join(serverRoot, directoryName);
  try {
    const deployArgs = [
      "--filter",
      "@splatorium/server",
      "deploy",
      "--prod",
      "--legacy",
      directoryName,
    ];
    const [pnpmCommand, pnpmArgs] = process.platform === "win32"
      ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm", ...deployArgs]]
      : ["pnpm", deployArgs];
    execFileSync(
      pnpmCommand,
      pnpmArgs,
      { cwd: serverRoot, stdio: ["ignore", "ignore", "inherit"] },
    );
    const packageIndex = buildInstalledPackageIndex(join(deployRoot, "node_modules", ".pnpm"));
    packageIndex.delete("@splatorium/shared@0.0.1");
    for (const key of packageIndex.keys()) {
      if (key.startsWith("@splatorium/shared@")) packageIndex.delete(key);
    }
    return auditServer(packageIndex);
  } finally {
    rmSync(deployRoot, { recursive: true, force: true });
  }
}

function makeNoticeRecord(bytes) {
  return bytes ? { sha256: sha256(bytes), text: bytes.toString("utf8") } : null;
}

function auditBrowser(root, installedIndex) {
  const records = readJson(root, BROWSER_LICENSE_PATH);
  if (!Array.isArray(records) || records.length === 0) fail(`${BROWSER_LICENSE_PATH} must contain a non-empty array`);
  const seen = new Set();
  return records.map((record) => {
    if (!record || typeof record.name !== "string" || typeof record.version !== "string") {
      fail(`${BROWSER_LICENSE_PATH} contains a record without name/version`);
    }
    if (typeof record.identifier !== "string" || record.identifier.length === 0) {
      fail(`${packageKey(record)} is missing its license identifier in ${BROWSER_LICENSE_PATH}`);
    }
    const key = packageKey(record);
    if (seen.has(key)) fail(`Duplicate browser license record: ${key}`);
    seen.add(key);
    const installed = installedIndex.get(key);
    if (!installed) fail(`Browser package is absent from the installed pnpm store: ${key}`);
    const snapshot = PACKAGE_LICENSE_SNAPSHOTS.get(key);
    const selected = snapshot
      ? {
          declaredExpression: installed.manifest.license,
          selectedLicense: installed.manifest.license,
          textBytes: readBytes(root, snapshot.path),
          noticeBytes: undefined,
        }
      : selectLicense(installed.packageRoot, installed.manifest);
    if (selected.selectedLicense !== record.identifier) {
      fail(`${key} Vite identifier ${record.identifier} differs from selected package license ${selected.selectedLicense}`);
    }
    const textBytes = selected.textBytes;
    const noticeBytes = selected.noticeBytes;
    if (record.name === "lucide-react") {
      const lucideText = textBytes.toString("utf8");
      if (!lucideText.includes("Feather") || !lucideText.includes("Cole Bemis")) {
        fail("lucide-react license text must preserve the Feather icons / Cole Bemis attribution");
      }
    }
    return {
      name: record.name,
      version: record.version,
      scopes: ["browser"],
      declaredExpression: selected.declaredExpression,
      selectedLicense: record.identifier,
      additionalLicenses: record.name === "lucide-react" ? ["MIT (Feather-derived icons)"] : [],
      licenseSource: snapshot ? {
        path: snapshot.path,
        url: snapshot.source,
        commit: snapshot.sourceCommit,
        retrievedAt: snapshot.retrievedAt,
      } : null,
      licenseTextSha256: sha256(textBytes),
      noticeSha256: noticeBytes ? sha256(noticeBytes) : null,
      _licenseText: textBytes.toString("utf8"),
      _noticeText: noticeBytes?.toString("utf8"),
    };
  });
}

function auditServer(serverIndex) {
  const records = [];
  for (const { packageRoot, manifest } of serverIndex.values()) {
    const selected = selectLicense(packageRoot, manifest);
    records.push({
      name: manifest.name,
      version: manifest.version,
      scopes: ["server"],
      declaredExpression: selected.declaredExpression,
      selectedLicense: selected.selectedLicense,
      licenseTextSha256: sha256(selected.textBytes),
      noticeSha256: selected.noticeBytes ? sha256(selected.noticeBytes) : null,
      _licenseText: selected.textBytes.toString("utf8"),
      _noticeText: selected.noticeBytes?.toString("utf8"),
    });
  }
  return records.sort(comparePackage);
}

function mergePackages(browser, server) {
  const merged = new Map(browser.map((entry) => [packageKey(entry), entry]));
  for (const serverEntry of server) {
    const key = packageKey(serverEntry);
    const browserEntry = merged.get(key);
    if (!browserEntry) {
      merged.set(key, serverEntry);
      continue;
    }
    if (
      browserEntry.declaredExpression !== serverEntry.declaredExpression ||
      browserEntry.selectedLicense !== serverEntry.selectedLicense ||
      browserEntry.licenseTextSha256 !== serverEntry.licenseTextSha256 ||
      browserEntry.noticeSha256 !== serverEntry.noticeSha256
    ) {
      fail(`Browser/server license metadata differs for overlapping package ${key}`);
    }
    browserEntry.scopes.push("server");
  }
  return [...merged.values()].sort(comparePackage);
}

function auditCuratedCss(root, installedIndex) {
  const cssInput = readBytes(root, "apps/web/src/index.css").toString("utf8");
  for (const curated of CURATED_CSS) {
    if (!cssInput.includes(`@import "${curated.name}";`)) {
      fail(`Curated CSS package ${packageKey(curated)} is not imported by apps/web/src/index.css`);
    }
  }
  return CURATED_CSS.map((curated) => {
    const installed = installedIndex.get(packageKey(curated));
    if (!installed) fail(`Curated CSS package is not installed: ${packageKey(curated)}`);
    const selected = selectLicense(installed.packageRoot, installed.manifest);
    return {
      ...curated,
      scope: "css-input",
      declaredExpression: selected.declaredExpression,
      selectedLicense: selected.selectedLicense,
      licenseTextSha256: sha256(selected.textBytes),
      noticeSha256: selected.noticeBytes ? sha256(selected.noticeBytes) : null,
      _licenseText: selected.textBytes.toString("utf8"),
      _noticeText: selected.noticeBytes?.toString("utf8"),
    };
  });
}

function auditCopiedSources(root) {
  return COPIED_SOURCES.map((source) => {
    const bytes = readBytes(root, source.licensePath);
    return {
      ...source,
      scope: "copied-source",
      selectedLicense: source.declaredExpression,
      licenseTextSha256: sha256(bytes),
      noticeSha256: null,
      _licenseText: bytes.toString("utf8"),
    };
  });
}

function publicRecord(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith("_")));
}

function auditDino(root) {
  const licenseBytes = readBytes(root, "licenses/dinov3/LICENSE.md");
  const licenseText = licenseBytes.toString("utf8");
  const source = readJson(root, "licenses/dinov3/SOURCE.json");
  const digest = sha256(licenseBytes);
  if (source.licenseSha256 !== digest) {
    fail(`licenses/dinov3/SOURCE.json licenseSha256 does not match LICENSE.md: expected ${digest}`);
  }
  if (!licenseText.includes("August 14, 2025")) fail("DINOv3 license must contain the Meta August 14, 2025 date");
  if (!licenseText.includes("Built with DINOv3")) fail("DINOv3 license must contain the Built with DINOv3 clause");
  if (!licenseText.includes("Sections 5, 6 and 9 shall survive")) {
    fail("DINOv3 license must contain the Meta survival clause for Sections 5, 6 and 9");
  }
  if (licenseText.includes("August 19, 2025") || licenseText.includes("Sections 3, 4 and 7 shall survive")) {
    fail("DINOv3 license contains markers from the non-authoritative GitHub variant");
  }
  return { licenseBytes, licenseText, source, digest };
}

function buildInventory(root, audit) {
  const rootManifest = readJson(root, "package.json");
  if (rootManifest.version !== audit.version) {
    fail(`Audit source version ${audit.version} does not match package.json version ${rootManifest.version}`);
  }
  const installedIndex = buildInstalledPackageIndex(join(root, "node_modules", ".pnpm"));
  const browser = auditBrowser(root, installedIndex).sort(comparePackage);
  const server = deployServer(root);
  const packages = mergePackages(browser, server);
  const overlap = packages.filter((entry) => entry.scopes.length === 2);
  const css = auditCuratedCss(root, installedIndex);
  const copied = auditCopiedSources(root);
  const modelManifest = readJson(root, "comfy/models.json");
  if (!Array.isArray(modelManifest.files)) fail("comfy/models.json must contain files[]");
  const dino = auditDino(root);
  const manifestHashes = Object.fromEntries(MANIFEST_PATHS.map((path) => [path, sha256(readBytes(root, path))]));
  const lockfileSha256 = sha256(readBytes(root, "pnpm-lock.yaml"));
  const browserSourceSha256 = sha256(readBytes(root, BROWSER_LICENSE_PATH));
  const inventory = {
    schemaVersion: 2,
    audit: {
      date: audit.date,
      sourceVersion: audit.version,
      scope: {
        browser: `${BROWSER_LICENSE_PATH} generated by Vite build.license`,
        server: "pnpm --filter @splatorium/server deploy --prod --legacy; direct package roots under node_modules/.pnpm only",
        excluded: ["@splatorium/shared workspace package", "fixtures and non-package directories", "Node.js and ComfyUI runtimes"],
      },
      inputs: {
        manifestSha256: manifestHashes,
        lockfileSha256,
        browserLicenseJsonSha256: browserSourceSha256,
        modelManifestSha256: sha256(readBytes(root, "comfy/models.json")),
        dinoLicenseSha256: dino.digest,
        dinoSourceMetadataSha256: sha256(readBytes(root, "licenses/dinov3/SOURCE.json")),
      },
    },
    counts: {
      browser: browser.length,
      server: server.length,
      browserServerOverlap: overlap.length,
      serverOnly: server.length - overlap.length,
      packageVersions: packages.length,
      curatedCss: css.length,
      canonicalComponentVersions: packages.length + css.length,
      copiedSources: copied.length,
    },
    packages: packages.map(publicRecord),
    curatedCss: css.map(publicRecord),
    copiedSources: copied.map(publicRecord),
    modelFiles: modelManifest.files.map(({ role, sourceFile, targetPath, size, sha256: digest, licenseNote }) => ({
      role,
      sourceFile,
      targetPath,
      size,
      sha256: digest,
      licenseNote,
    })),
    runtimePlaceholders: RUNTIME_PLACEHOLDERS,
    dino: {
      notice: "Built with DINOv3.",
      authoritativeSource: dino.source.authoritativeSource,
      licensePath: "licenses/dinov3/LICENSE.md",
      licenseTextSha256: dino.digest,
    },
  };
  return { inventory, packages, css, copied, dinoText: dino.licenseText };
}

function table(rows, columns) {
  const header = `| ${columns.map(([label]) => label).join(" | ")} |`;
  const separator = `|${columns.map(() => "---").join("|")}|`;
  const body = rows.map((row) => `| ${columns.map(([, value]) => value(row)).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function inline(value) {
  return `\`${String(value).replaceAll("`", "\\`")}\``;
}

export function normalizeNoticeText(value) {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "");
}

function renderPackageRows(records) {
  return table(records, [
    ["Package", (entry) => inline(packageKey(entry))],
    ["Scope", (entry) => entry.scopes.join(" + ")],
    ["Declared", (entry) => inline(entry.declaredExpression)],
    ["Selected", (entry) => inline(entry.selectedLicense)],
    ["Additional", (entry) => entry.additionalLicenses?.length
      ? entry.additionalLicenses.map(inline).join(" + ")
      : "—"],
    ["Source", (entry) => entry.licenseSource
      ? `[snapshot](${entry.licenseSource.url})`
      : "npm package"],
    ["License SHA-256", (entry) => inline(entry.licenseTextSha256)],
    ["NOTICE SHA-256", (entry) => entry.noticeSha256 ? inline(entry.noticeSha256) : "—"],
  ]);
}

function renderFullNotices(records) {
  const groups = new Map();
  for (const record of records) {
    const key = record.licenseTextSha256;
    const existing = groups.get(key);
    if (existing) {
      if (existing.text !== record._licenseText) fail(`SHA-256 collision while grouping ${packageKey(record)}`);
      existing.components.push(record);
    } else {
      groups.set(key, { text: record._licenseText, components: [record] });
    }
  }
  const rendered = [];
  for (const [digest, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const labels = group.components.map((entry) => packageKey(entry)).sort((a, b) => a.localeCompare(b, "en"));
    rendered.push(
      `### ${labels.join(", ")}\n\nLicense text SHA-256: ${inline(digest)}\n\n\`\`\`text\n${normalizeNoticeText(group.text)}\n\`\`\``,
    );
  }
  const notices = records.filter((record) => record.noticeSha256);
  if (notices.length > 0) {
    rendered.push("## Complete NOTICE texts");
    for (const record of notices.sort(comparePackage)) {
      rendered.push(
        `### ${packageKey(record)} NOTICE\n\nNOTICE SHA-256: ${inline(record.noticeSha256)}\n\n\`\`\`text\n${normalizeNoticeText(record._noticeText)}\n\`\`\``,
      );
    }
  }
  return rendered.join("\n\n");
}

function renderMarkdown(result) {
  const { inventory, packages, css, copied, dinoText } = result;
  const browser = packages.filter((entry) => entry.scopes.includes("browser"));
  const overlap = packages.filter((entry) => entry.scopes.length === 2);
  const serverOnly = packages.filter((entry) => entry.scopes.length === 1 && entry.scopes[0] === "server");
  const modelRows = inventory.modelFiles;
  const cssAndCopied = [...css, ...copied];
  const completeRecords = [...packages, ...cssAndCopied];
  return `# Third-party licenses and model notices

This document is generated by \`scripts/license-inventory.mjs\`. Do not edit it by hand.

## Audit scope and provenance

- Audit date: ${inline(inventory.audit.date)}
- Source version: ${inline(inventory.audit.sourceVersion)}
- Lockfile SHA-256: ${inline(inventory.audit.inputs.lockfileSha256)}
- Browser license JSON SHA-256: ${inline(inventory.audit.inputs.browserLicenseJsonSha256)}
- Canonical component-version inventory: **${inventory.counts.canonicalComponentVersions}** (${inventory.counts.browser} browser, including ${inventory.counts.browserServerOverlap} server overlaps + ${inventory.counts.serverOnly} server-only + ${inventory.counts.curatedCss} curated CSS inputs)
- Browser source: Vite \`build.license\` output at \`${BROWSER_LICENSE_PATH}\`.
- Server source: production dependency tree; only direct package roots beneath the deploy's \`node_modules/.pnpm\` are scanned.
- Excluded from the canonical inventory: the first-party \`@splatorium/shared\` workspace package, fixtures, shadcn/ui copied source, model files, Node.js, and ComfyUI.
- Machine-readable inventory: [\`${INVENTORY_PATH}\`](${INVENTORY_PATH}).

## Browser bundle (${browser.length})

${renderPackageRows(browser)}

## Server deploy

### Server-only packages (${serverOnly.length})

${renderPackageRows(serverOnly)}

### Browser/server overlap (${overlap.length})

${renderPackageRows(overlap)}

\`expand-template@2.0.3\` declares \`(MIT OR WTFPL)\`; this distribution selects MIT from its \`LICENSE\` file. \`rc@1.2.8\` declares \`(BSD-2-Clause OR MIT OR Apache-2.0)\`; this distribution selects MIT from its exact \`LICENSE.MIT\` file.

## Copied source and curated CSS inputs

The ${css.length} curated CSS component-versions are part of the ${inventory.counts.canonicalComponentVersions} canonical inventory. The ${copied.length} shadcn/ui copied-source record is audited separately and is not counted in ${inventory.counts.canonicalComponentVersions}.

${table(cssAndCopied, [
    ["Component", (entry) => inline(packageKey(entry))],
    ["Scope", (entry) => entry.scope],
    ["Selected", (entry) => inline(entry.selectedLicense)],
    ["License SHA-256", (entry) => inline(entry.licenseTextSha256)],
    ["Source", (entry) => entry.source
      ? `[immutable upstream](${entry.source}) (${inline(entry.sourceCommit)}, retrieved ${inline(entry.retrievedAt)})`
      : "npm package"],
    ["Reason", (entry) => entry.reason],
  ])}

## Model files

Splatorium does not bundle these weights. Users download or copy them, and the model setup verifies each file against \`comfy/models.json\`.

${table(modelRows, [
    ["Role", (entry) => entry.role],
    ["Source file", (entry) => inline(entry.sourceFile)],
    ["Target", (entry) => inline(entry.targetPath)],
    ["SHA-256", (entry) => inline(entry.sha256)],
    ["License note", (entry) => entry.licenseNote],
  ])}

## Runtime placeholders

${inventory.runtimePlaceholders.map((entry) => `- **${entry.name}:** ${entry.condition}`).join("\n")}

## DINOv3

Built with DINOv3.

The DINOv3-derived vision encoder is subject to the authoritative Meta DINOv3 Agreement at <${inventory.dino.authoritativeSource}>. The exact audited copy is [\`${inventory.dino.licensePath}\`](${inventory.dino.licensePath}) with SHA-256 ${inline(inventory.dino.licenseTextSha256)}.

<details>
<summary>Complete DINOv3 Agreement</summary>

\`\`\`text
${dinoText}
\`\`\`

</details>

## Complete software license and copyright notices

Entries are grouped only when their source license-text bytes are identical (the SHA-256 is therefore identical).

${renderFullNotices(completeRecords)}
`;
}

export function describeInventoryDrift(expectedText, actualText) {
  let expected;
  let actual;
  try {
    expected = JSON.parse(expectedText);
    actual = JSON.parse(actualText);
  } catch {
    return "generated bytes differ";
  }
  const describe = (inventory) => new Set([
    ...(inventory.packages ?? []).map((entry) => `${packageKey(entry)} [${entry.scopes.join("+")}]`),
    ...(inventory.curatedCss ?? []).map((entry) => `${packageKey(entry)} [css-input]`),
    ...(inventory.copiedSources ?? []).map((entry) => `${packageKey(entry)} [copied-source]`),
  ]);
  const before = describe(expected);
  const after = describe(actual);
  const added = [...after].filter((entry) => !before.has(entry)).sort();
  const removed = [...before].filter((entry) => !after.has(entry)).sort();
  const lines = [];
  if (added.length) lines.push(...added.map((entry) => `+ ${entry}`));
  if (removed.length) lines.push(...removed.map((entry) => `- ${entry}`));
  if (!lines.length) lines.push("metadata or generated bytes changed");
  return lines.join("\n");
}

export function assertInventoryBytesMatch(expectedText, actualText, path = INVENTORY_PATH) {
  if (expectedText === actualText) return;
  fail(
    `License inventory drift detected in ${path}.\n${describeInventoryDrift(expectedText, actualText)}\n` +
      "Run the explicit audited --write command to regenerate.",
  );
}

function parseArguments(argv) {
  const options = { write: false, root: DEFAULT_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") options.write = true;
    else if (argument === "--check") options.check = true;
    else if (argument === "--audit-date") options.date = argv[++index];
    else if (argument === "--audit-version") options.version = argv[++index];
    else if (argument === "--root") options.root = resolve(argv[++index]);
    else fail(`Unknown argument: ${argument}`);
  }
  if (options.write) {
    if (options.check) fail("--write and --check are mutually exclusive");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date ?? "")) {
      fail("--write requires --audit-date in YYYY-MM-DD format");
    }
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.version ?? "")) {
      fail("--write requires --audit-version as a semantic version");
    }
  } else if (options.date || options.version) {
    fail("--audit-date and --audit-version are valid only with --write");
  }
  return options;
}

function checkFile(root, path, generated, inventoryMode = false) {
  const current = readBytes(root, path).toString("utf8");
  if (current === generated) return;
  if (inventoryMode) assertInventoryBytesMatch(current, generated, path);
  let firstDifference = 0;
  while (
    firstDifference < current.length &&
    firstDifference < generated.length &&
    current[firstDifference] === generated[firstDifference]
  ) {
    firstDifference += 1;
  }
  const start = Math.max(0, firstDifference - 80);
  const end = firstDifference + 160;
  fail(
    `License inventory drift detected in ${path} at character ${firstDifference} ` +
      `(committed length ${current.length}, generated length ${generated.length}).\n` +
      `Committed: ${JSON.stringify(current.slice(start, end))}\n` +
      `Generated: ${JSON.stringify(generated.slice(start, end))}\n` +
      "Run the explicit audited --write command to regenerate.",
  );
}

export function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  let audit;
  if (options.write) {
    audit = { date: options.date, version: options.version };
  } else {
    const committed = readJson(options.root, INVENTORY_PATH);
    if (!committed.audit?.date || !committed.audit?.sourceVersion) {
      fail(`${INVENTORY_PATH} is missing machine-readable audit date/source version`);
    }
    audit = { date: committed.audit.date, version: committed.audit.sourceVersion };
  }
  const result = buildInventory(options.root, audit);
  const inventoryText = `${JSON.stringify(result.inventory, null, 2)}\n`;
  const markdownText = renderMarkdown(result);
  if (options.write) {
    mkdirSync(join(options.root, dirname(INVENTORY_PATH)), { recursive: true });
    writeFileSync(join(options.root, INVENTORY_PATH), inventoryText, "utf8");
    writeFileSync(join(options.root, NOTICE_PATH), markdownText, "utf8");
    process.stdout.write(`Wrote ${INVENTORY_PATH} and ${NOTICE_PATH}\n`);
  } else {
    checkFile(options.root, INVENTORY_PATH, inventoryText, true);
    checkFile(options.root, NOTICE_PATH, markdownText);
    process.stdout.write(`License inventory is current (${result.inventory.counts.canonicalComponentVersions} component-version records).\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
