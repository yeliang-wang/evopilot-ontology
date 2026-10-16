export interface ArchiveFile {
    path: string;
    bytes: Buffer;
    mode: number;
}
export interface ArchiveLink {
    path: string;
    target: string;
}
export interface ArchiveContents {
    files: ArchiveFile[];
    links: ArchiveLink[];
}
export declare function archivePath(value: string): string;
/** Parse only the pinned distribution formats. No archive member executes. */
export declare function readTarGz(compressed: Buffer): ArchiveContents;
/** Wheels in the fixed lock are ordinary pure-Python ZIPs, never executable installers. */
export declare function readWheel(bytes: Buffer): ArchiveFile[];
