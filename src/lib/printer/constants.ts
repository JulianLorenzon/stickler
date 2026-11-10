export { D11S_PRINTHEAD_PX as PRINTHEAD_PX } from "./drivers/d11s";

export const CLIENT_DEFAULTS = {
  /** Pause between chunks of print data */
  packetIntervalMs: 20,
} as const;
