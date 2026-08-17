import { chromium, firefox } from 'playwright-core';
import type { Browser } from 'playwright-core';
import logger from '../logger';
import { isLowMemoryMode } from '../utils/memoryMode';

export type BrowserType = 'playwright' | 'camoufox';

export interface BrowserLaunchProfile {
    headless?: boolean;
    proxy?: {
        server: string;
        username?: string;
        password?: string;
    } | null;
    useStealth?: boolean;
    browserType?: BrowserType;
    /**
     * Force Chromium onto HTTP/1.1 (`--disable-http2`).
     * Used for hosts where Chromium HTTP/2 consistently fails (e.g. Persistent).
     */
    disableHttp2?: boolean;
}

/**
 * Get the configured default browser type from environment
 */
export function getDefaultBrowserType(): BrowserType {
    const envType = process.env.DEFAULT_BROWSER_TYPE?.toLowerCase();
    if (envType === 'camoufox') return 'camoufox';
    return 'playwright';
}

/**
 * CI or minimal images often skip downloading Chromium; local launch() will always fail.
 * In that case we must use the remote Playwright browser service even if the profile
 * asks for stealth (playwright-extra only applies to local launch).
 */
function mustUseRemoteBrowserOnly(): boolean {
    return (
        process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1' ||
        process.env.CONTAINER === 'true'
    );
}

const requiresCustomLocalLaunch = (profile?: BrowserLaunchProfile): boolean => {
    if (mustUseRemoteBrowserOnly()) {
        return false;
    }

    const browserType = profile?.browserType || getDefaultBrowserType();

    // Camoufox is inherently anti-detect — stealth does not require a local launch.
    // Only force local launch for proxy or non-headless mode when not using Camoufox.
    if (browserType === 'camoufox') {
        return profile?.headless === false;
    }

    // `--disable-http2` only applies to local Chromium launches; force local when set.
    return (
        !!profile?.proxy ||
        profile?.useStealth === true ||
        profile?.headless === false ||
        !!profile?.disableHttp2
    );
};

/**
 * Configuration for connection retry logic
 */
const CONNECTION_CONFIG = {
    maxRetries: 3,
    retryDelay: 2000,
    connectionTimeout: 30000,
};

// ─── Playwright (Chromium) Connection ─────────────────────────────────────────

/**
 * Health JSON may contain ws://127.0.0.1:… — rewrite for Docker so workers reach the browser service.
 */
function rewritePlaywrightWsEndpoint(raw: string): string {
    const targetHost = process.env.BROWSER_WS_HOST || 'localhost';
    if (!raw) return raw;
    try {
        const u = new URL(raw);
        if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]') {
            u.hostname = targetHost;
        }
        return u.toString().replace(/\/$/, '');
    } catch {
        return raw;
    }
}

/**
 * Get the WebSocket endpoint from the Playwright browser service health check
 */
async function getBrowserServiceEndpoint(): Promise<string> {
    const healthPort = process.env.BROWSER_HEALTH_PORT || '3002';
    const healthHost = process.env.BROWSER_WS_HOST || 'localhost';
    const healthEndpoint = `http://${healthHost}:${healthPort}/health`;

    try {
        logger.debug(`Fetching WebSocket endpoint from: ${healthEndpoint}`);
        const response = await fetch(healthEndpoint);
        const data = await response.json();

        if (data.status === 'healthy' && data.wsEndpoint) {
            const wsEndpoint = rewritePlaywrightWsEndpoint(data.wsEndpoint);
            logger.debug(`Got WebSocket endpoint: ${wsEndpoint}`);
            return wsEndpoint;
        }

        throw new Error('Health check did not return a valid wsEndpoint');
    } catch (error: any) {
        logger.error(`Failed to fetch endpoint from health check: ${error.message}`);
        throw new Error(
            `Browser service is not accessible at ${healthEndpoint}. ` +
            `Start the remote browser service: npm run browser:service (or npm run browser:service:dev) — see docs/native-browser-setup.md`
        );
    }
}

/**
 * Launch a local browser as fallback when browser service is unavailable
 */
function buildChromiumLaunchArgs(profile?: BrowserLaunchProfile): string[] {
    const lowMemory = isLowMemoryMode();
    // Scale factor 2 doubles compositor/raster memory — never do that on 512MB hosts.
    const scaleFactor = lowMemory ? '1' : (process.env.CHROMIUM_DEVICE_SCALE_FACTOR || '1');
    const rendererJsHeap = lowMemory ? '96' : (process.env.CHROMIUM_JS_HEAP_MB || '192');

    const args = [
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process,TranslateUI,BlinkGenPropertyTrees',
        '--disable-site-isolation-trials',
        '--disable-extensions',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--force-color-profile=srgb',
        `--force-device-scale-factor=${scaleFactor}`,
        '--ignore-certificate-errors',
        '--mute-audio',
        `--js-flags=--max-old-space-size=${rendererJsHeap}`,
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-component-extensions-with-background-pages',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-ipc-flooding-protection',
        '--disable-renderer-backgrounding',
        '--no-first-run',
        '--no-default-browser-check',
        '--font-render-hinting=none',
    ];

    // Host-scoped / env-gated only — do not disable HTTP/2 globally by default.
    if (profile?.disableHttp2) {
        args.push('--disable-http2');
    }

    if (lowMemory) {
        // Keep Chromium to one renderer on tiny instances. Avoid --single-process
        // (unstable with Playwright); renderer limit + no-zygote is the safer cut.
        args.push(
            '--renderer-process-limit=1',
            '--no-zygote',
            '--disable-hang-monitor',
            '--disable-sync',
            '--metrics-recording-only',
            '--disable-domain-reliability'
        );
    }

    return args;
}

async function launchLocalBrowser(profile?: BrowserLaunchProfile): Promise<Browser> {
    logger.warn('Attempting to launch local browser');
    logger.warn('Note: This requires Chromium binaries to be installed (npx playwright install chromium)');

    try {
        const lowMemory = isLowMemoryMode();
        const launchOptions = {
            headless: profile?.headless ?? true,
            proxy: profile?.proxy || undefined,
            args: buildChromiumLaunchArgs(profile),
        };

        // playwright-extra + stealth plugin adds noticeable RSS; on low-memory hosts
        // rely on context-level stealth overrides instead.
        const allowStealthPlugin =
            !!profile?.useStealth &&
            !lowMemory &&
            process.env.DISABLE_STEALTH_PLUGIN !== 'true';

        try {
            if (allowStealthPlugin) {
                const { chromium: chromiumExtra } = require('playwright-extra');
                const stealthPlugin = require('puppeteer-extra-plugin-stealth');
                chromiumExtra.use(stealthPlugin());
                const stealthBrowser = await chromiumExtra.launch(launchOptions);
                logger.info('Successfully launched local browser with stealth plugin');
                return stealthBrowser;
            }
        } catch (stealthError: any) {
            logger.warn(`Failed to enable playwright-extra stealth plugin: ${stealthError.message}`);
        }

        const browser = await chromium.launch(launchOptions);

        logger.info(
            lowMemory
                ? 'Successfully launched local browser (low-memory Chromium flags)'
                : 'Successfully launched local browser'
        );
        return browser;
    } catch (error: any) {
        logger.error(`Failed to launch local browser: ${error.message}`);
        throw new Error(
            `Could not launch local browser. ` +
            `Please either:\n` +
            `  1. Start the remote browser service: npm run browser:service (see docs/native-browser-setup.md)\n` +
            `  2. Install Chromium binaries: npx playwright@1.58.0 install chromium`
        );
    }
}

/**
 * Connect to the Playwright (Chromium) remote browser service
 */
async function connectToPlaywrightBrowser(maxRetries: number): Promise<Browser> {
    const wsEndpoint = await getBrowserServiceEndpoint();
    logger.info(`Connecting to Playwright browser service at ${wsEndpoint}...`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger.debug(`Playwright connection attempt ${attempt}/${maxRetries}`);

            const browser = await chromium.connect(wsEndpoint, {
                timeout: CONNECTION_CONFIG.connectionTimeout,
            });

            logger.info('Successfully connected to Playwright browser service');
            return browser;
        } catch (error: any) {
            logger.warn(
                `Playwright connection attempt ${attempt}/${maxRetries} failed: ${error.message}`
            );

            if (attempt === maxRetries) {
                throw new Error(`Playwright remote connection failed: ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, CONNECTION_CONFIG.retryDelay));
        }
    }

    throw new Error('Failed to connect to Playwright browser service');
}

// ─── Camoufox (Firefox) Connection ────────────────────────────────────────────

/**
 * Get the WebSocket endpoint from the Camoufox service health check
 */
async function getCamoufoxEndpoint(): Promise<string> {
    const healthPort = process.env.CAMOUFOX_HEALTH_PORT || '3004';
    const healthHost = process.env.CAMOUFOX_WS_HOST || 'localhost';
    const healthEndpoint = `http://${healthHost}:${healthPort}/health`;

    try {
        logger.debug(`Fetching Camoufox endpoint from: ${healthEndpoint}`);
        const response = await fetch(healthEndpoint);
        const data = await response.json();

        if (data.status === 'healthy' && data.wsEndpoint) {
            // The health endpoint may return ws://localhost:PORT/...; rewrite host from CAMOUFOX_WS_HOST
            // so workers reach the Camoufox process when it runs on another host.
            const wsUrl = new URL(data.wsEndpoint);
            wsUrl.hostname = healthHost;
            const resolvedEndpoint = wsUrl.toString().replace(/\/$/, '');
            logger.debug(`Got Camoufox WebSocket endpoint: ${resolvedEndpoint}`);
            return resolvedEndpoint;
        }

        throw new Error('Camoufox health check did not return a valid wsEndpoint');
    } catch (error: any) {
        logger.error(`Failed to fetch Camoufox endpoint: ${error.message}`);
        throw new Error(
            `Camoufox service is not accessible at ${healthEndpoint}. ` +
            `Start it on the host: npm run camoufox:server — see docs/native-browser-setup.md`
        );
    }
}

/**
 * Connect to the Camoufox remote browser service (Firefox-based)
 */
async function connectToCamoufoxBrowser(maxRetries: number): Promise<Browser> {
    const wsEndpoint = await getCamoufoxEndpoint();
    logger.info(`Connecting to Camoufox browser at ${wsEndpoint}...`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger.debug(`Camoufox connection attempt ${attempt}/${maxRetries}`);

            // Camoufox is Firefox-based, so use firefox.connect()
            const browser = await firefox.connect(wsEndpoint, {
                timeout: CONNECTION_CONFIG.connectionTimeout,
            });

            logger.info('Successfully connected to Camoufox browser');
            return browser;
        } catch (error: any) {
            logger.warn(
                `Camoufox connection attempt ${attempt}/${maxRetries} failed: ${error.message}`
            );

            if (attempt === maxRetries) {
                throw new Error(`Camoufox connection failed: ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, CONNECTION_CONFIG.retryDelay));
        }
    }

    throw new Error('Failed to connect to Camoufox browser');
}

/**
 * Check if Camoufox service is healthy
 */
export async function checkCamoufoxHealth(): Promise<boolean> {
    try {
        const healthPort = process.env.CAMOUFOX_HEALTH_PORT || '3004';
        const healthHost = process.env.CAMOUFOX_WS_HOST || 'localhost';
        const healthEndpoint = `http://${healthHost}:${healthPort}/health`;

        const response = await fetch(healthEndpoint);
        const data = await response.json();

        return data.status === 'healthy';
    } catch {
        return false;
    }
}

// ─── Unified Connection Entrypoint ────────────────────────────────────────────

/**
 * Connect to the remote browser service with retry logic and fallback.
 * Supports both Playwright (Chromium) and Camoufox (Firefox) browser types.
 *
 * @param retries - Number of connection attempts (default: 3)
 * @param profile - Launch profile with optional browserType
 * @returns Promise<Browser> - Connected browser instance
 */
export async function connectToRemoteBrowser(retries?: number, profile?: BrowserLaunchProfile): Promise<Browser> {
    const maxRetries = retries ?? CONNECTION_CONFIG.maxRetries;
    const browserType = profile?.browserType || getDefaultBrowserType();

    if (requiresCustomLocalLaunch(profile)) {
        logger.info('Using local browser launch because the run requires custom anti-bot launch settings');
        return launchLocalBrowser(profile);
    }

    // ── Camoufox path ──
    if (browserType === 'camoufox') {
        logger.info('Browser type is Camoufox — attempting anti-detect Firefox connection');

        try {
            return await connectToCamoufoxBrowser(maxRetries);
        } catch (camoufoxError: any) {
            logger.warn(`Camoufox connection failed: ${camoufoxError.message}`);
            logger.warn('Falling back to Playwright (Chromium)...');

            // Fallback: try Playwright remote, then local
            try {
                return await connectToPlaywrightBrowser(maxRetries);
            } catch (playwrightError: any) {
                logger.warn(`Playwright fallback also failed: ${playwrightError.message}`);
                if (mustUseRemoteBrowserOnly()) {
                    throw new Error(
                        `Camoufox and Playwright remote both failed. Camoufox: ${camoufoxError.message}; Playwright: ${playwrightError.message}`
                    );
                }
                logger.warn('Final fallback: launching local browser...');
                return await launchLocalBrowser(profile);
            }
        }
    }

    // ── Playwright (Chromium) path ──
    try {
        return await connectToPlaywrightBrowser(maxRetries);
    } catch (error: any) {
        logger.warn(`Browser service connection failed: ${error.message}`);
        if (mustUseRemoteBrowserOnly()) {
            throw new Error(
                `Remote Playwright browser is required in this environment but connection failed: ${error.message}. ` +
                    `Check BROWSER_WS_HOST / BROWSER_HEALTH_PORT and that the browser service is running.`
            );
        }
        logger.warn('Falling back to local browser launch...');
        return await launchLocalBrowser(profile);
    }
}

/**
 * Check if browser service is healthy
 * @returns Promise<boolean> - true if service is healthy
 */
export async function checkBrowserServiceHealth(): Promise<boolean> {
    try {
        const healthPort = process.env.BROWSER_HEALTH_PORT || '3002';
        const healthHost = process.env.BROWSER_WS_HOST || 'localhost';
        const healthEndpoint = `http://${healthHost}:${healthPort}/health`;

        const response = await fetch(healthEndpoint);
        const data = await response.json();

        if (data.status === 'healthy') {
            logger.info('Browser service health check passed');
            return true;
        }

        logger.warn('Browser service health check failed:', data);
        return false;
    } catch (error: any) {
        logger.error('Browser service health check error:', error.message);
        return false;
    }
}
