export type OpsDigestConfigStatus = {
  enabled: boolean;
  zeptoConfigured: boolean;
  recipients: string[];
  canSend: boolean;
  reason?: string;
};

export type OpsDigestSendResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  requestId?: string;
  error?: string;
  payload?: {
    generatedAt: string;
    windows: {
      last6h: { total: number; passed: number; failed: number };
    };
  };
};

export function opsDigestStatusBody(status: OpsDigestConfigStatus) {
  return {
    ...status,
    interval: '6 hours',
  };
}

export function mapOpsDigestSendResult(result: OpsDigestSendResult): {
  httpStatus: number;
  body: Record<string, unknown>;
} {
  if (result.skipped) {
    return {
      httpStatus: 400,
      body: {
        success: false,
        skipped: true,
        reason: result.reason,
      },
    };
  }
  if (!result.ok) {
    return {
      httpStatus: 502,
      body: {
        success: false,
        error: result.error || 'Failed to send digest',
      },
    };
  }
  return {
    httpStatus: 200,
    body: {
      success: true,
      requestId: result.requestId || null,
      summary: result.payload
        ? {
            generatedAt: result.payload.generatedAt,
            last6h: {
              total: result.payload.windows.last6h.total,
              passed: result.payload.windows.last6h.passed,
              failed: result.payload.windows.last6h.failed,
            },
          }
        : null,
    },
  };
}
