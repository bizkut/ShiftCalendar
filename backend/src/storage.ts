import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';

export interface Key { PK: string; SK: string }
export type Item = Key & Record<string, unknown>;
export interface PageResult { items: Item[]; cursor?: string }

export type Condition =
  | { kind: 'exists'; key: Key }
  | { kind: 'notExists'; key: Key }
  | { kind: 'version'; key: Key; version: number }
  | { kind: 'equals'; key: Key; field: string; value: string | number | boolean };

export interface Transaction {
  checks?: Condition[];
  puts?: Array<{ item: Item; condition?: Condition }>;
  deletes?: Array<{ key: Key; condition?: Condition }>;
}

export interface Storage {
  get(key: Key, consistent?: boolean): Promise<Item | undefined>;
  query(pk: string, options: { prefix?: string; from?: string; to?: string; limit: number; cursor?: string }): Promise<PageResult>;
  transact(transaction: Transaction): Promise<void>;
}

export const encodeStorageCursor = (key: Record<string, unknown>) => Buffer.from(JSON.stringify(key)).toString('base64url');
const decodeCursor = (cursor?: string) => cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) : undefined;

function expression(condition: Condition): { expression: string; names?: Record<string, string>; values?: Record<string, unknown> } {
  if (condition.kind === 'exists') return { expression: 'attribute_exists(PK)' };
  if (condition.kind === 'notExists') return { expression: 'attribute_not_exists(PK)' };
  if (condition.kind === 'version') return { expression: '#version = :version', names: { '#version': 'version' }, values: { ':version': condition.version } };
  return { expression: '#field = :value', names: { '#field': condition.field }, values: { ':value': condition.value } };
}

export class DynamoStorage implements Storage {
  private readonly client: DynamoDBDocumentClient;

  constructor(private readonly tableName: string, client?: DynamoDBDocumentClient) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async get(key: Key, consistent = false): Promise<Item | undefined> {
    const result = await this.client.send(new GetCommand({ TableName: this.tableName, Key: key, ConsistentRead: consistent }));
    return result.Item as Item | undefined;
  }

  async query(pk: string, options: { prefix?: string; from?: string; to?: string; limit: number; cursor?: string }): Promise<PageResult> {
    const values: Record<string, unknown> = { ':pk': pk };
    let condition = 'PK = :pk';
    if (options.prefix) { condition += ' AND begins_with(SK, :prefix)'; values[':prefix'] = options.prefix; }
    if (options.from && options.to) { condition += ' AND SK BETWEEN :from AND :to'; values[':from'] = options.from; values[':to'] = options.to; }
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: condition,
      ExpressionAttributeValues: values,
      Limit: options.limit,
      ExclusiveStartKey: decodeCursor(options.cursor),
      ConsistentRead: true,
    }));
    return { items: (result.Items ?? []) as Item[], cursor: result.LastEvaluatedKey ? encodeStorageCursor(result.LastEvaluatedKey) : undefined };
  }

  async transact(transaction: Transaction): Promise<void> {
    const items: NonNullable<TransactWriteCommandInput['TransactItems']> = [];
    const conditionCheck = (condition: Condition) => {
      const e = expression(condition);
      return { TableName: this.tableName, Key: condition.key, ConditionExpression: e.expression, ExpressionAttributeNames: e.names, ExpressionAttributeValues: e.values };
    };
    for (const check of transaction.checks ?? []) items.push({ ConditionCheck: conditionCheck(check) });
    for (const put of transaction.puts ?? []) {
      const e = put.condition && expression(put.condition);
      items.push({ Put: { TableName: this.tableName, Item: put.item, ConditionExpression: e?.expression, ExpressionAttributeNames: e?.names, ExpressionAttributeValues: e?.values } });
    }
    for (const del of transaction.deletes ?? []) {
      const e = del.condition && expression(del.condition);
      items.push({ Delete: { TableName: this.tableName, Key: del.key, ConditionExpression: e?.expression, ExpressionAttributeNames: e?.names, ExpressionAttributeValues: e?.values } });
    }
    await this.client.send(new TransactWriteCommand({ TransactItems: items, ClientRequestToken: undefined }));
  }
}
