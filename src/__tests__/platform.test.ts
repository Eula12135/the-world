import { describe, expect, it, vi } from 'vitest';

// Capacitor 的原生判定需要在 node 环境里可控，否则这条分支永远走不到
const { runtime } = vi.hoisted(() => ({ runtime: { native: true } }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => runtime.native,
    getPlatform: () => (runtime.native ? 'android' : 'web'),
  },
  CapacitorHttp: {},
}));

import { detectUnreachableLocalhost } from '../utils/platform';

describe('detectUnreachableLocalhost', () => {
  it('flags loopback base URLs on Android with an actionable hint', () => {
    runtime.native = true;

    const localhost = detectUnreachableLocalhost('http://localhost:11434/v1');
    expect(localhost).toContain('192.168.1.10');
    expect(localhost).toContain('同一个 Wi-Fi');

    expect(detectUnreachableLocalhost('http://127.0.0.1:11434/v1')).not.toBeNull();
    expect(detectUnreachableLocalhost('http://[::1]:11434/v1')).not.toBeNull();
  });

  it('allows LAN IPs and stays silent off Android (desktop localhost is valid)', () => {
    runtime.native = true;
    expect(detectUnreachableLocalhost('http://192.168.1.10:11434/v1')).toBeNull();
    expect(detectUnreachableLocalhost('https://api.deepseek.com/v1')).toBeNull();

    runtime.native = false;
    expect(detectUnreachableLocalhost('http://localhost:11434/v1')).toBeNull();
  });
});
