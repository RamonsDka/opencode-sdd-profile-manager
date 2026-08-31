declare module "js-yaml" {
  export function load(str: string, opts?: unknown): unknown;
  export function dump(obj: unknown, opts?: unknown): string;
}
