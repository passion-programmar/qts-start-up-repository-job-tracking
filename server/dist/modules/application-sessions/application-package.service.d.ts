import type { GptApplicationPackage } from './application-gpt.service';
export interface ApplyPackageResult {
    applicationId: number;
    answersStored: number;
    resumePath: string | null;
    coverLetterPath: string | null;
    status: string;
}
export declare function applyGptPackage(sessionId: number, pkg: GptApplicationPackage, existingGeneratedAnswers?: Record<string, string>): Promise<ApplyPackageResult>;
export declare function loadSessionFields(sessionId: number): Promise<Record<string, unknown>[]>;
//# sourceMappingURL=application-package.service.d.ts.map