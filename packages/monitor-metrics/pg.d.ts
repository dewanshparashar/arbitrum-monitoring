declare module 'pg' {
  export class Pool {
    constructor(config: { connectionString: string; max?: number })
    query<T = Record<string, unknown>>(
      text: string,
      values?: unknown[]
    ): Promise<{ rows: T[] }>
    end(): Promise<void>
  }
}
