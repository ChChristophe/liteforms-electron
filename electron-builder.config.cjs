/** @type {import("electron-builder").Configuration} */
const { cpSync, existsSync } = module.require("node:fs");
const { join } = module.require("node:path");

const hasAzureTrustedSigningEnv = Boolean(
  process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET
);

const windowsSigningConfig = hasAzureTrustedSigningEnv
  ? {
      azureSignOptions: {
        endpoint: "https://eus.codesigning.azure.net/",
        certificateProfileName: "lkg-app",
        codeSigningAccountName: "lookingglassfactory",
        publisherName: "Looking Glass Factory Inc."
      }
    }
  : {
      signAndEditExecutable: false
    };

const electronBuilderPlatform = process.env.LITEFORMS_ELECTRON_BUILDER_PLATFORM ?? process.platform;
const nativeBridgePlatformPrefix =
  electronBuilderPlatform === "darwin" ? "darwin-" : electronBuilderPlatform === "win32" ? "win32-" : "linux-";

// Package only the native Bridge assets matching the build platform: the full
// linux-x64 set is ~250MB and must not leak into Windows/macOS installers.
const nativeBridgeResources = [
  { from: "native/bridge/win32-x64", to: "bridge/win32-x64", filter: ["**/*"] },
  { from: "native/bridge/darwin-x64", to: "bridge/darwin-x64", filter: ["**/*"] },
  { from: "native/bridge/darwin-arm64", to: "bridge/darwin-arm64", filter: ["**/*"] },
  { from: "native/bridge/linux-x64", to: "bridge/linux-x64", filter: ["**/*"] }
].filter(({ from }) => existsSync(from) && from.includes(`/${nativeBridgePlatformPrefix}`));

// Do not package cross-platform native addons; Windows signing rejects non-PE .node files.
const windowsNativeBinaryExcludes = [
  "!**/node_modules/**/prebuilds/darwin*/**",
  "!**/node_modules/**/prebuilds/linux*/**",
  "!**/node_modules/**/prebuilds/win32-ia32/**",
  "!**/node_modules/**/prebuilds/win32-arm64/**",
  "!**/node_modules/**/bin/napi-*/darwin/**",
  "!**/node_modules/**/bin/napi-*/linux/**",
  "!**/node_modules/**/bin/napi-*/win32/ia32/**",
  "!**/node_modules/**/bin/napi-*/win32/arm64/**"
];

const macNativeBinaryExcludes = [
  "!**/node_modules/**/prebuilds/linux*/**",
  "!**/node_modules/**/prebuilds/win32*/**",
  "!**/node_modules/**/bin/napi-*/linux/**",
  "!**/node_modules/**/bin/napi-*/win32/**"
];

const platformNativeBinaryExcludes =
  electronBuilderPlatform === "darwin"
    ? macNativeBinaryExcludes
    : electronBuilderPlatform === "win32"
      ? windowsNativeBinaryExcludes
      : [];

async function afterPack(context) {
  const { appOutDir } = context;
  const resourcesDir = join(appOutDir, "resources");
  const from = join(process.cwd(), ".next", "standalone");
  const to = join(resourcesDir, "next", "standalone");

  // Fail loudly instead of producing an installer that cannot start: the
  // packaged app throws at launch when resources/next/standalone/server.js is
  // missing (see electron/main.ts startPackagedNextServer).
  if (!existsSync(from)) {
    throw new Error("Missing .next/standalone build. Run `npm run build:electron` before packaging.");
  }
  if (!existsSync(join(from, "server.js"))) {
    throw new Error(".next/standalone/server.js is missing; rebuild with `npm run build:electron`.");
  }

  console.log(`[electron] Copying Next standalone to ${to}`);
  cpSync(from, to, { recursive: true });
}

module.exports = {
  appId: "org.liteforms.web",
  afterPack,
  productName: "Liteforms",
  asar: true,
  compression: "maximum",
  npmRebuild: false,
  removePackageScripts: true,
  directories: {
    output: "release"
  },
  files: [
    "dist-electron/**",
    "node_modules/@koromix/koffi-*/**",
    "node_modules/koffi/**",
    "public/**",
    "resources/**",
    "native/bridge/*.md",
    "native/bridge/*.txt",
    "package.json",
    "!**/.env",
    "!**/.env.*",
    "!**/.env*.local",
    "!**/*.map",
    "!**/node_modules/.cache/**",
    "!**/__tests__/**",
    "!**/*.test.*",
    "!**/*.smoke.test.*",
    // Keep these in the top-level allowlist. Platform-specific exclude-only `files`
    // entries make electron-builder start from its default `**/*` include set.
    ...platformNativeBinaryExcludes
  ],
  asarUnpack: [
    "node_modules/@koromix/koffi-*/**",
    "node_modules/koffi/**"
  ],
  // The Next.js standalone output is copied in `afterPack` (see below) rather than
  // via `extraResources`. electron-builder strips nested `node_modules` from
  // `extraResources`, which would break the standalone's `require("next")`.
  extraResources: nativeBridgeResources,
    win: {
      ...windowsSigningConfig,
      icon: "resources/icon-256.png",
      signExts: [".dll", ".node"],
      target: ["nsis"]
    },
    nsis: {
      // Inbound firewall rules (provisioning 8080 + device API 43178):
      // created at install (elevated), removed at uninstall. The app itself
      // never elevates — win-unpacked logs the manual netsh instruction.
      include: "resources/installer.nsh"
    },
  mac: {
    target: ["dmg"],
    category: "public.app-category.entertainment",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    notarize: false
  },
  linux: {
    target: ["AppImage"],
    category: "AudioVideo",
    icon: "resources/icon-256.png"
  }
};
