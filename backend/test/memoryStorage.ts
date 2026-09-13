import type { Condition, Item, Key, PageResult, Storage, Transaction } from '../src/storage.js';

const id = (key: Key) => `${key.PK}\n${key.SK}`;

export class MemoryStorage implements Storage {
  readonly items = new Map<string, Item>();
  readonly transactions: Transaction[] = [];

  seed(...items: Item[]) {
    for (const item of items) this.items.set(id(item), structuredClone(item));
  }

  async get(key: Key): Promise<Item | undefined> {
    const item = this.items.get(id(key));
    return item && structuredClone(item);
  }

  async query(pk: string, options: { prefix?: string; from?: string; to?: string; limit: number; cursor?: string }): Promise<PageResult> {
    const after = options.cursor ? (JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')) as Key).SK : undefined;
    const matches = [...this.items.values()]
      .filter(item => item.PK === pk)
      .filter(item => !options.prefix || item.SK.startsWith(options.prefix))
      .filter(item => !options.from || item.SK >= options.from)
      .filter(item => !options.to || item.SK <= options.to)
      .filter(item => !after || item.SK > after)
      .sort((a, b) => a.SK.localeCompare(b.SK));
    const page = matches.slice(0, options.limit);
    return { items: structuredClone(page), cursor: matches.length > page.length ? Buffer.from(JSON.stringify({ PK: pk, SK: page.at(-1)!.SK })).toString('base64url') : undefined };
  }

  async transact(transaction: Transaction): Promise<void> {
    const before = new Map(this.items);
    const valid = (condition: Condition): boolean => {
      const item = before.get(id(condition.key));
      if (condition.kind === 'exists') return Boolean(item);
      if (condition.kind === 'notExists') return !item;
      if (condition.kind === 'version') return item?.version === condition.version;
      return item?.[condition.field] === condition.value;
    };
    const conditions = [
      ...(transaction.checks ?? []),
      ...(transaction.puts ?? []).flatMap(write => write.condition ? [write.condition] : []),
      ...(transaction.deletes ?? []).flatMap(write => write.condition ? [write.condition] : []),
    ];
    if (!conditions.every(valid)) {
      const error = new Error('Transaction cancelled');
      error.name = 'TransactionCanceledException';
      throw error;
    }
    this.transactions.push(structuredClone(transaction));
    for (const write of transaction.puts ?? []) this.items.set(id(write.item), structuredClone(write.item));
    for (const write of transaction.deletes ?? []) this.items.delete(id(write.key));
  }
}
