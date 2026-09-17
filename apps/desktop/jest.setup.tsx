import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

global.TextEncoder = TextEncoder as unknown as typeof global.TextEncoder;
global.TextDecoder = TextDecoder as unknown as typeof global.TextDecoder;

// jsdom does not implement `structuredClone`, but it is part of the platform in
// every real browser and webview. `fake-indexeddb` uses it to serialise values,
// so without this every IndexedDB write fails with "structuredClone is not
// defined" — which surfaces as a storage failure rather than an obvious error.
// Node provides an equivalent implementation via v8 serialisation.
if (typeof (globalThis as any).structuredClone !== 'function') {
  const v8 = require('node:v8') as typeof import('node:v8');
  (globalThis as any).structuredClone = (value: unknown) =>
    v8.deserialize(v8.serialize(value));
}

// jsdom does not implement AbortSignal.timeout; ollama.ts relies on it.
if (typeof (AbortSignal as any).timeout !== 'function') {
  (AbortSignal as any).timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
}

// Everything below patches browser globals. Guarded so this shared setup file
// also works for the few suites that opt into `@jest-environment node` (the
// live LM Studio integration test, which needs a real `fetch`). Without the
// guard those suites die with "ReferenceError: window is not defined" before
// running a single test.
//
// `configurable: true` on every stub is deliberate: without it the property is
// permanently locked, and a suite that needs different behaviour fails with
// "Cannot redefine property" instead of being able to override it.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn()
    }))
  });

  Object.defineProperty(window, 'localStorage', {
    writable: true,
    configurable: true,
    value: {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn()
    }
  });

  Object.defineProperty(window, 'speechSynthesis', {
    writable: true,
    configurable: true,
    value: {
      speak: jest.fn(),
      cancel: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      getVoices: jest.fn().mockReturnValue([
        { name: 'Test Voice 1', lang: 'en-US' },
        { name: 'Test Voice 2', lang: 'en-GB' }
      ]),
      onvoiceschanged: null
    }
  });
}

jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn()
    };
  },
  useSearchParams() {
    return new URLSearchParams();
  },
  usePathname() {
    return '/';
  }
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt, ...rest }: { src: string; alt: string; [key: string]: any }) => (
    <img src={src} alt={alt} {...rest} />
  )
}));

const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: ReactDOM.render is no longer supported')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});