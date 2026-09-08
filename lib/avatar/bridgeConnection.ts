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
    } catch {
      // Bridge.js remains a valid fallback when the native probe is unavailable.
    }
  }

  try {
    const connected = await getBridgeClient().status();
    return {
      connected,
      source: connected ? "bridge-js" : "none",
    };
  } catch {
    return {
      connected: false,
      source: "none",
    };
  }
}

export async function checkLookingGlassBridgeConnection(options: BridgeConnectionOptions = {}): Promise<boolean> {
  return (await getLookingGlassBridgeConnection(options)).connected;
}
