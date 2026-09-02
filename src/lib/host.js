// ---------------------------------------------------------------------------
// Getting a WebMCP host to exist.
//
// The spec API is document.modelContext, which ships behind a flag and is not
// in any stable browser yet. Waiting for it would mean the tool surface here
// is never actually driven over WebMCP by anything, so when the browser has
// no host, @mcp-b/global installs the polyfill instead: the same
// document.modelContext API, with a transport that a connected MCP client can
// reach. Either way the page registers once, through one API, and does not
// know which of the two answered.
// ---------------------------------------------------------------------------

/** True when the browser itself provides the API, flag or origin trial. */
export function nativeHost() {
  return typeof globalThis.document?.modelContext?.registerTool === 'function'
    || typeof globalThis.navigator?.modelContext?.registerTool === 'function';
}

/**
 * Installs the polyfill when, and only when, the browser has no host of its
 * own. Returns which host is in play, so the page can say so rather than
 * implying a native one.
 *
 * The transport is told its allowed origins explicitly. @mcp-b/transports
 * takes ['*'] to mean "do not validate", and a board carrying somebody's
 * unreleased plans is not a thing to hand to any origin that asks.
 */
export async function ensureHost() {
  if (nativeHost()) return 'native';
  try {
    const { initializeWebModelContext } = await import('@mcp-b/global');
    initializeWebModelContext({
      transport: {
        tabServer: { allowedOrigins: [globalThis.location.origin] },
      },
    });
    return nativeHost() ? 'polyfill' : 'none';
  } catch (err) {
    console.warn('could not install the WebMCP polyfill:', err?.message || err);
    return 'none';
  }
}
