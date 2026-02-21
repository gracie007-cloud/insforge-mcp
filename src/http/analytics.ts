import Mixpanel from 'mixpanel';
import { ANALYTICS_CONFIG, isAnalyticsConfigured } from './config.js';

// ============================================================================
// Client Type Detection
// ============================================================================

export type ClientType =
  | 'claude_code'
  | 'claude_desktop'
  | 'cursor'
  | 'cline'
  | 'windsurf'
  | 'vscode'
  | 'codex'
  | 'roocode'
  | 'opencode'
  | 'trae'
  | 'gemini_cli'
  | 'google_antigravity'
  | 'kiro'
  | 'github_copilot'
  | 'qoder'
  | 'goose'
  | 'unknown';

/**
 * Extract clientInfo from an MCP initialize request body.
 * Returns { name, version } or null if not found.
 */
export function extractClientInfo(body: unknown): { name: string; version: string } | null {
  if (!body || typeof body !== 'object') return null;

  // Single request: { method: "initialize", params: { clientInfo: { name, version } } }
  const single = body as { method?: string; params?: { clientInfo?: { name?: string; version?: string } } };
  if (single.method === 'initialize' && single.params?.clientInfo?.name) {
    return {
      name: single.params.clientInfo.name,
      version: single.params.clientInfo.version || 'unknown',
    };
  }

  // Batched request: array containing an initialize request
  if (Array.isArray(body)) {
    for (const req of body) {
      const result = extractClientInfo(req);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Client name matching rules: [pattern, ClientType]
 * Order matters — more specific patterns first to avoid false matches.
 * Patterns are matched with word boundaries to prevent false positives
 * (e.g., 'goose' should not match 'mongoose').
 */
const CLIENT_PATTERNS: Array<[string[], ClientType]> = [
  // Anthropic
  [['claude-code', 'claudecode', 'claude code'], 'claude_code'],
  [['claude-desktop', 'claudedesktop', 'claude desktop'], 'claude_desktop'],
  // Editors / IDEs
  [['cursor'], 'cursor'],
  [['cline'], 'cline'],
  [['windsurf'], 'windsurf'],
  [['roocode', 'roo-code', 'roo code'], 'roocode'],
  [['trae'], 'trae'],
  [['kiro'], 'kiro'],
  [['github copilot', 'github-copilot'], 'github_copilot'],
  [['vscode', 'visual studio code'], 'vscode'],
  // CLI agents
  [['codex'], 'codex'],
  [['opencode', 'open-code'], 'opencode'],
  [['gemini-cli', 'gemini cli', 'gemini_cli'], 'gemini_cli'],
  [['antigravity', 'google-antigravity'], 'google_antigravity'],
  [['qoder'], 'qoder'],
  [['goose'], 'goose'],
];

/**
 * Check if pattern appears at a word boundary in the input.
 * A word boundary means the character before/after the match is not a letter.
 */
function wordBoundaryMatch(input: string, pattern: string): boolean {
  const idx = input.indexOf(pattern);
  if (idx === -1) return false;
  const before = idx === 0 || !/[a-z]/.test(input[idx - 1]);
  const after = idx + pattern.length >= input.length || !/[a-z]/.test(input[idx + pattern.length]);
  return before && after;
}

function matchClientType(input: string): ClientType {
  const lower = input.toLowerCase();
  for (const [patterns, clientType] of CLIENT_PATTERNS) {
    if (patterns.some(p => wordBoundaryMatch(lower, p))) return clientType;
  }
  return 'unknown';
}

/**
 * Normalize a client name (from MCP clientInfo.name) to a known client type.
 */
function normalizeClientName(name: string): ClientType {
  return matchClientType(name);
}

/**
 * Parse User-Agent header as fallback for client type detection.
 */
function parseUserAgent(userAgent: string | undefined): ClientType {
  if (!userAgent) return 'unknown';
  return matchClientType(userAgent);
}

// ============================================================================
// Analytics Service
// ============================================================================

export class AnalyticsService {
  private mixpanel: Mixpanel.Mixpanel | null = null;
  private readonly enabled: boolean;

  constructor() {
    const mixpanelToken = ANALYTICS_CONFIG.mixpanelToken;
    this.enabled = isAnalyticsConfigured();

    if (this.enabled && mixpanelToken) {
      this.mixpanel = Mixpanel.init(mixpanelToken, {
        protocol: 'https',
        keepAlive: false,
      });
      console.log('[Analytics] Mixpanel initialized');
    } else {
      console.log('[Analytics] Disabled (no MIXPANEL_TOKEN or ENABLE_ANALYTICS=false)');
    }
  }

  /**
   * Track when a new MCP session is created.
   * Uses clientInfo (from MCP initialize) as primary source, User-Agent as fallback.
   */
  trackSessionCreated(params: {
    clientName: string | undefined;
    clientVersion: string | undefined;
    userAgent: string | undefined;
    transportType: 'streamable_http' | 'sse';
    projectId: string;
    userId: string;
    organizationId: string;
  }): void {
    if (!this.enabled || !this.mixpanel) return;

    // Prefer MCP clientInfo.name, fall back to User-Agent parsing
    const clientType = params.clientName
      ? normalizeClientName(params.clientName)
      : parseUserAgent(params.userAgent);
    const distinctId = params.userId !== 'legacy' && params.userId !== 'unknown'
      ? params.userId
      : `anon_${params.projectId}`;

    try {
      this.mixpanel.track('mcp_session_created', {
        distinct_id: distinctId,
        client_type: clientType,
        client_name: params.clientName || 'not_provided',
        client_version: params.clientVersion || 'not_provided',
        user_agent: params.userAgent || 'not_provided',
        transport_type: params.transportType,
        project_id: params.projectId,
        user_id: params.userId,
        organization_id: params.organizationId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.warn('[Analytics] Failed to track mcp_session_created:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * Track a successful OAuth token exchange.
   */
  trackOAuthSuccess(params: {
    clientId: string;
    scope: string;
  }): void {
    if (!this.enabled || !this.mixpanel) return;

    try {
      this.mixpanel.track('mcp_oauth_success', {
        distinct_id: params.clientId,
        client_id: params.clientId,
        scope: params.scope,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.warn('[Analytics] Failed to track mcp_oauth_success:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * Track an OAuth failure.
   */
  trackOAuthFailure(params: {
    errorType: string;
    errorDescription: string;
    endpoint: string;
  }): void {
    if (!this.enabled || !this.mixpanel) return;

    try {
      this.mixpanel.track('mcp_oauth_failure', {
        distinct_id: 'system',
        error_type: params.errorType,
        error_description: params.errorDescription,
        endpoint: params.endpoint,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.warn('[Analytics] Failed to track mcp_oauth_failure:', error instanceof Error ? error.message : error);
    }
  }
}

let _instance: AnalyticsService | null = null;

export function getAnalyticsService(): AnalyticsService {
  if (!_instance) _instance = new AnalyticsService();
  return _instance;
}
