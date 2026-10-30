import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PWAInstallPrompt } from '../PWAInstallPrompt';

const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    androidFirefox: 'Mozilla/5.0 (Android 15; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
    androidChrome: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
    desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
};

/** Chromium exposes `onbeforeinstallprompt`; Firefox and Safari do not. */
function asBrowser(userAgent: string, supportsInstallEvent: boolean) {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    if (supportsInstallEvent) {
        Object.defineProperty(window, 'onbeforeinstallprompt', { value: null, configurable: true, writable: true });
    }
}

afterEach(() => {
    vi.restoreAllMocks();
    delete (window as { onbeforeinstallprompt?: unknown }).onbeforeinstallprompt;
    localStorage.clear();
});

describe('PWAInstallPrompt', () => {
    it('shows the Share steps on an iPhone, which has no install event', () => {
        asBrowser(UA.iphone, false);
        render(<PWAInstallPrompt />);

        expect(screen.getByRole('dialog', { name: 'Add Shiftopia to your Home Screen' })).toBeTruthy();
        expect(screen.getByText('Add to Home Screen')).toBeTruthy();
    });

    it('shows the browser-menu steps on Android Firefox', () => {
        asBrowser(UA.androidFirefox, false);
        render(<PWAInstallPrompt />);

        expect(screen.getByRole('dialog', { name: 'Add Shiftopia to your Home screen' })).toBeTruthy();
        expect(screen.getByText('Install app')).toBeTruthy();
    });

    it('waits for the install event on Android Chrome, then offers one-tap install', () => {
        asBrowser(UA.androidChrome, true);
        render(<PWAInstallPrompt />);
        expect(screen.queryByRole('dialog')).toBeNull();

        const event = Object.assign(new Event('beforeinstallprompt'), {
            prompt: vi.fn(async () => {}),
            userChoice: Promise.resolve({ outcome: 'accepted' as const }),
        });
        act(() => { window.dispatchEvent(event); });

        expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy();
    });

    it('stays quiet on desktop without an install event', () => {
        asBrowser(UA.desktopChrome, true);
        render(<PWAInstallPrompt />);

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('stays dismissed for the week after the user closes it', async () => {
        const user = userEvent.setup();
        asBrowser(UA.iphone, false);
        const { unmount } = render(<PWAInstallPrompt />);
        await user.click(screen.getByRole('button', { name: 'Dismiss install prompt' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        unmount();

        render(<PWAInstallPrompt />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
