export declare const DEFAULT_CUSTOM_GPT_URL = "https://chatgpt.com/g/g-6a3dc5525fac819198dccf1c216e3fc0-qts-job-tracking";
export declare const DEFAULT_CUSTOM_GPT_ID = "g-6a3dc5525fac819198dccf1c216e3fc0";
export interface ResolvedCustomGpt {
    url: string;
    id: string;
    source: 'bidder' | 'default';
}
export declare function parseCustomGptId(url: string): string | null;
export declare function normalizeCustomGptUrl(url: string): string;
export declare function validateCustomGptUrl(raw: string): {
    ok: true;
    url: string;
    id: string;
} | {
    ok: false;
    message: string;
};
export declare function resolveCustomGptConfig(bidderUrl?: string | null): ResolvedCustomGpt;
//# sourceMappingURL=custom-gpt-url.d.ts.map