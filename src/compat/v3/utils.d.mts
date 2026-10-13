import type { PathOrFileDescriptor } from "node:fs";

/** Declarations for the frozen historical utility implementation. */
export function readYaml(file: PathOrFileDescriptor): unknown;
export function persistedJson(value: unknown): unknown;
export function canonicalJson(value: unknown): string | undefined;
export function digest(value: unknown): `sha256:${string}`;
export function safeId(value: unknown, fallback?: string): string;
export function walkFiles(root: string, predicate?: (file: string) => boolean): string[];
export function redact(text: unknown): string;
export function bumpPatch(version: unknown): string;
export function usage(message: string): never;
export function ensureRelative(root: string, target: string): string;
export function unique(values: readonly unknown[]): string[];
