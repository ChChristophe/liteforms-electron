import { BridgeClient } from "@lookingglass/bridge";
import {
  getNativeLookingGlassBridgeState,
  hasNativeLookingGlassBridgeApi,
  isNativeLookingGlassBridgeDisplayConnected,
} from "./nativeLookingGlassBridge";

export type LookingGlassDisplayBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type LookingGlassBridgeConnection = {
  connected: boolean;
  source: "native" | "bridge-js" | "none";
  display?: LookingGlassDisplayBounds;
  /** Failure reason from the native probe (or Bridge.js when native is absent). */
  error?: string;
};

type BridgeConnectionOptions = {
  getBridgeClient?: () => Pick<BridgeClient, "status">;
  getNativeBridgeState?: typeof getNativeLookingGlassBridgeState;
  hasNativeBridgeApi?: typeof hasNativeLookingGlassBridgeApi;
};

export async function getLookingGlassBridgeConnection({
  getBridgeClient = () => BridgeClient.getInstance(),
  getNativeBridgeState = getNativeLookingGlassBridgeState,
  hasNativeBridgeApi = hasNativeLookingGlassBridgeApi,
}: BridgeConnectionOptions = {}): Promise<LookingGlassBridgeConnection> {
  let nativeError: string | undefined;

  if (hasNativeBridgeApi()) {
    try {
      const state = await getNativeBridgeState();
      if (state.available && isNativeLookingGlassBridgeDisplayConnected(state)) {
        return {
          connected: true,
          source: "native",
          display: {
            left: state.display.x ?? 0,
            top: state.display.y ?? 0,
            width: state.display.width,
            height: state.display.height,
          },
        };
      }
      if (!state.available) {
        // Keep the reason visible: without it a failed native probe looks
        // identical to "no Looking Glass Bridge app installed".
        nativeError = state.error;
      }
    } catch (error) {
      // Bridge.js remains a valid fallback when the native probe is unavailable.
      nativeError = error instanceof Error ? error.message : String(error);
    }
  }

  try {
    const connected = await getBridgeClient().status();
    if (connected) {
      return {
        connected: true,
        source: "bridge-js",
      };
    }
    return {
      connected: false,
      source: "none",
      ...(nativeError ? { error: nativeError } : {}),
    };
  } catch (error) {
    return {
      connected: false,
      source: "none",
      ...(nativeError
        ? { error: nativeError }
        : { error: error instanceof Error ? error.message : String(error) }),
    };
  }
}

export async function checkLookingGlassBridgeConnection(options: BridgeConnectionOptions = {}): Promise<boolean> {
  return (await getLookingGlassBridgeConnection(options)).connected;
}
