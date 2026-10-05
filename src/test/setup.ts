/**
 * Vitest global test setup.
 * Referenced by vitest.config.ts → test.setupFiles.
 */

import '@testing-library/jest-dom';
import { beforeAll, afterAll } from 'vitest';

/**
 * jsdom implements neither `ResizeObserver` nor `matchMedia`, and the Radix
 * primitives this app builds every dropdown, popover and sheet on construct a
 * ResizeObserver on open. Without these, any test that OPENS a menu dies with
 * `ReferenceError: ResizeObserver is not defined` — a failure about the
 * environment that reads like a failure about the component.
 *
 * Stubbed globally rather than per file: the gap belongs to jsdom, not to any
 * one test, and a component test should not have to know which primitive its
 * subject happens to use.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// The rest of the same family. Radix menus scroll the active item into view
// and use the Pointer Capture API for drag-select; jsdom implements neither, so
// each one surfaces as a TypeError deep inside a vendored component.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = function hasPointerCapture() { return false; };
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = function setPointerCapture() {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  }
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Silence console.error in tests unless explicitly needed
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    // Re-throw assertion-level errors so they surface
    if (typeof args[0] === 'string' && args[0].includes('Warning:')) return;
    originalError(...args);
  };
});
afterAll(() => {
  console.error = originalError;
});
