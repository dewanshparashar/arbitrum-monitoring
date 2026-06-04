declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: unknown[]): void
    get(...params: unknown[]): Record<string, unknown> | undefined
    all(...params: unknown[]): Record<string, unknown>[]
  }

  export class DatabaseSync {
    constructor(location: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}
