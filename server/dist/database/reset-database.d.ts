/** Remove all bidder orgs, candidates, and bidder/caller login accounts. Keeps admin, managers, jobs, interviews. */
export declare function clearBiddersAndCandidates(): Promise<void>;
/** Remove ephemeral apply-flow rows (sessions, fields, saved answers). Jobs/candidates are kept. */
export declare function clearApplicationSessionRecords(): Promise<{
    sessions: number;
    fields: number;
    savedAnswers: number;
}>;
export declare function resetDatabaseKeepingAdminOnly(): Promise<void>;
//# sourceMappingURL=reset-database.d.ts.map