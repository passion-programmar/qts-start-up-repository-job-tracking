export declare const config: {
    port: number;
    host: string;
    jwtSecret: string;
    jwtExpiry: string;
    adminUsername: string;
    adminPassword: string;
    managerUsername: string;
    managerPassword: string;
    bidderUsername: string;
    bidderPassword: string;
    callerUsername: string;
    callerPassword: string;
    useEmbeddedPg: boolean;
    pgliteDataPath: string;
    databaseUrl: string;
    databaseSsl: boolean;
    databasePoolMax: number;
    backupsPath: string;
    nodeEnv: string;
    autoOpenBrowser: boolean;
    adminWebUrl: string;
    /** Static Bearer secret for Custom GPT Actions (not OpenAI key, not JWT). */
    gptActionApiKey: string;
    /** When false, application sessions/fields live in server memory only (cleared after TTL). */
    applicationSessionPersistDb: boolean;
};
//# sourceMappingURL=env.d.ts.map