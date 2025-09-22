// global.d.ts
import { Simnet } from "@hirosystems/clarinet-sdk";
import "vitest/globals";
// Removed problematic import for Vi type

declare global {
  const simnet: Simnet;
  const accounts: Map<string, string>;

  namespace NodeJS {
    interface Global {
      Buffer: typeof Buffer;
    }
  }

  // Removed Vi namespace and Assertion interface due to missing type
}
