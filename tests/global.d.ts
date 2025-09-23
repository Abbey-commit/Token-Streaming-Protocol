// global.d.ts
import { Simnet } from "@hirosystems/clarinet-sdk";
import "vitest/globals";
/// <reference types="vitest" />

declare global {
  namespace NodeJS {
    interface Global {
      Buffer: typeof Buffer;
    }
  }
}

export {};