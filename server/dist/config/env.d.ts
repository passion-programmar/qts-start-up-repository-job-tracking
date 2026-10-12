export declare const config: {
    port: number;
    host: string;
    jwtSecret: string;
    jwtExpiry: string;
    adminUsername: string;
    adminPassword: string;
    managerUsername: string;
    managerPassword: string;
    accountUsername: string;
    accountPassword: string;
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
    /** Persist application sessions/fields in PostgreSQL for serverless deployments. */
    applicationSessionPersistDb: boolean;
};
//# sourceMappingURL=env.d.ts.map