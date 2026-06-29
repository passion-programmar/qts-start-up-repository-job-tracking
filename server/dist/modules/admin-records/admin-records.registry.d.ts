export type RecordCategoryId = 'accounts' | 'bidders' | 'candidates' | 'jobs' | 'candidate_jobs' | 'interviews' | 'application_sessions' | 'application_session_fields' | 'candidate_saved_answers' | 'settings';
export type ColumnType = 'text' | 'number' | 'boolean' | 'json' | 'readonly';
export interface RecordColumnDef {
    key: string;
    label: string;
    type: ColumnType;
    editable?: boolean;
    list?: boolean;
}
export interface RecordCategoryDef {
    id: RecordCategoryId;
    label: string;
    description: string;
    table: string;
    primaryKey: string;
    orderBy: string;
    searchColumns: string[];
    columns: RecordColumnDef[];
}
export declare const RECORD_CATEGORIES: RecordCategoryDef[];
export declare function getRecordCategory(id: string): RecordCategoryDef | null;
export declare function listRecordCategoryIds(): RecordCategoryId[];
//# sourceMappingURL=admin-records.registry.d.ts.map