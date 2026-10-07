export const APP_NAME = 'QTS_Startup';
export const LOGO_URL = '/logo.png';
export const ACCOUNT_LOGO_URL = '/account-logo.png';
export const TOKEN_STORAGE_KEY = 'qts_startup_token';
export const LEGACY_TOKEN_STORAGE_KEY = 'jc_token';
export const REDIRECT_GUARD_KEY = 'qts_startup_redirect_guard';

export function panelLogoUrl(mode: string): string {
  return mode === 'account' ? ACCOUNT_LOGO_URL : LOGO_URL;
}
