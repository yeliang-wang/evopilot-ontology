import type { ReadSnapshot, ReadRow, JSONValue } from './readability.mjs';
export type PresentationSection = 'concepts' | 'properties' | 'relations' | 'constraints' | 'instances' | 'rules' | 'results' | 'planning' | 'milestones' | 'sources';
export interface RowPresentation {
    section: PresentationSection;
    cells: Record<string, string>;
}
export interface ReportTable {
    id: string;
    title: string;
    columns: string[];
    rows: string[][];
}
export interface ReadDocument {
    title: string;
    summary: string;
    tables: ReportTable[];
    limitations: string[];
}
export declare function statusText(value: string): string;
export declare function originText(value: string): string;
export declare function valueText(value: JSONValue): string;
export declare function resultPresentation(row: ReadRow): RowPresentation;
export declare function buildReadDocument(snapshot: ReadSnapshot): ReadDocument;
export declare const markdownText: (value: string) => string;
export declare function renderReadDocument(doc: ReadDocument, format: 'markdown' | 'html'): string;
