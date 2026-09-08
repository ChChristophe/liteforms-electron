type LookingGlassConnectionState = {
  calibration?: {
    serial?: string;
  };
};

export type NativeLookingGlassDisplayConnection = "unavailable" | "pending" | "connected";

export type ScreenLike = {
  left: number;
  top: number;
  width: number;
  height: number;
  isPrimary?: boolean;
};

export type WindowPositionLike = {
  screenLeft?: number;
  screenTop?: number;
  screenX?: number;
  screenY?: number;
};

export function isLookingGlassDeviceConnected(config: LookingGlassConnectionState): boolean {
  return Boolean(config.calibration?.serial?.trim());
}

export function shouldEnterHldFallback(
  config: LookingGlassConnectionState,
  nativeConnection: NativeLookingGlassDisplayConnection = "unavailable"
): boolean {
  if (isLookingGlassDeviceConnected(config)) return false;

  return nativeConnection === "unavailable";
}

export function shouldHideHologramButtonForScreen(screen: unknown): boolean {
  if (!screen || typeof screen !== "object" || !("isExtended" in screen)) return false;
  return (screen as { isExtended?: unknown }).isExtended === false;
}

export async function detectSingleScreen(win: unknown): Promise<boolean | undefined> {
  if (!win || typeof win !== "object") return undefined;

  const screen = (win as { screen?: unknown }).screen;
  if (screen && typeof screen === "object" && "isExtended" in screen) {
    return (screen as { isExtended?: unknown }).isExtended === false;
  }

  const screenDetailsWindow = win as {
    getScreenDetails?: () => Promise<{ screens?: ScreenLike[] }>;
  };
  if (typeof screenDetailsWindow.getScreenDetails !== "function") return undefined;

  try {
    const screenDetails = await screenDetailsWindow.getScreenDetails();
    if (!Array.isArray(screenDetails.screens)) return undefined;
    return screenDetails.screens.length <= 1;
  } catch {
    return undefined;
  }
}

export function findSecondaryScreen(
  screens: ScreenLike[],
  currentWindow: WindowPositionLike = {}
): ScreenLike | undefined {
  const nonPrimary = screens.find((screen) => screen.isPrimary === false);
  if (nonPrimary) return nonPrimary;

  // With a single screen there is no secondary display: returning a screen here
  // would target the main display (and the window position is not a reliable
  // screen identity — a window parked at x=128 on the primary would match).
  if (screens.length <= 1) return undefined;

  const currentLeft = currentWindow.screenLeft ?? currentWindow.screenX ?? 0;
  const currentTop = currentWindow.screenTop ?? currentWindow.screenY ?? 0;
  return screens.find((screen) => screen.left !== currentLeft || screen.top !== currentTop);
}

export function buildPopupFeatureString(screen?: ScreenLike): string {
  const bounds = screen ?? { left: 0, top: 0, width: 640, height: 960 };
  return [
    `left=${bounds.left}`,
    `top=${bounds.top}`,
    `width=${bounds.width}`,
    `height=${bounds.height}`,
    "menubar=no",
    "toolbar=no",
    "location=no",
    "status=no",
    "resizable=yes",
    "scrollbars=no",
    "fullscreenEnabled=true",
  ].join(",");
}

export async function openHldHologramWindow(
  win: Window,
  routeUrl?: string,
  targetScreen?: ScreenLike,
): Promise<Window | null> {
  let resolvedScreen = targetScreen;

  if (!resolvedScreen && "getScreenDetails" in win) {
    try {
      const screenDetails = await (win as Window & {
        getScreenDetails: () => Promise<{ screens: ScreenLike[] }>;
      }).getScreenDetails();
      resolvedScreen = findSecondaryScreen(screenDetails.screens, win);
    } catch {
      resolvedScreen = undefined;
    }
  }

  const url = routeUrl ?? "";
  return win.open(url, "liteforms-hld-hologram", buildPopupFeatureString(resolvedScreen));
}

type LookingGlassPopupWindowLike = {
  document: {
    title: string;
    body: {
      style: { background: string; transform?: string };
      appendChild(node: unknown): unknown;
    };
    addEventListener?: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void;
    removeEventListener?: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => void;
  };
  close(): void;
  closed: boolean;
  onbeforeunload?: (() => void) | null;
};

function isLookingGlassPolyfillPopup(url: unknown, target?: string, features?: string): boolean {
  if (url !== "" && url !== undefined) return false;

  // Le polyfill LKG ouvre SA popup (url vide) pour héberger le canvas quilt.
  // Ne jamais intercepter l'ouverture de la vraie fenêtre /hologram.
  if (target === "liteforms-hld-hologram") return false;

  return target === "new"
    || Boolean(features?.startsWith("width="))
    || Boolean(features?.includes("fullscreenEnabled"));
}

export function installLookingGlassPopupShim(container: HTMLElement): () => void {
  const originalOpen = window.open;
  if (!originalOpen) return () => {};

  const fakeBody: LookingGlassPopupWindowLike["document"]["body"] = {
    style: { background: "black", transform: "1.0" },
    appendChild(node: unknown) {
      if (node instanceof HTMLCanvasElement) {
        try {
          if (typeof console !== "undefined") {
            console.log("[liteforms-diag] polyfill-shim intercepted canvas → stage");
          }
        } catch {
          /* ignore */
        }
        node.style.position = "fixed";
        node.style.left = "0";
        node.style.top = "0";
        node.style.width = "100%";
        node.style.height = "100%";
        node.style.objectFit = "cover";
        node.style.zIndex = "10";
        node.style.backgroundColor = "#000";
        container.appendChild(node);
        return node;
      }
      if (node instanceof Node) {
        container.appendChild(node);
        return node;
      }
      return node;
    },
  };

  const fakeWindow: LookingGlassPopupWindowLike = {
    document: {
      title: "Liteforms Looking Glass Display",
      body: fakeBody,
      addEventListener() {},
      removeEventListener() {},
    },
    close() {},
    closed: false,
    onbeforeunload: null,
  };

  window.open = ((url?: string | URL, target?: string, features?: string) => {
    if (isLookingGlassPolyfillPopup(url, target, features)) {
      return fakeWindow as unknown as Window;
    }
    return originalOpen.call(window, url, target, features);
  }) as typeof window.open;

  return () => {
    window.open = originalOpen;
  };
}
