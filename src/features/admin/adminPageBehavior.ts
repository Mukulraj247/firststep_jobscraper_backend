export function webhookFieldCopy(automation: { webhookConfigured?: boolean } | null) {
  const configured = !!automation?.webhookConfigured;
  return {
    placeholder: configured ? 'Leave blank to keep existing webhook' : 'https://',
    helperText: configured
      ? 'A webhook is already configured. Leave blank to keep it, or enter a new URL.'
      : 'Optional. Enter a URL to enable a webhook.',
  };
}
