import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

class ResizeObserverMock implements ResizeObserver {
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
}

Object.defineProperty(window, "ResizeObserver", {
  configurable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(Element.prototype, "scrollTo", {
  configurable: true,
  value: vi.fn(),
});
