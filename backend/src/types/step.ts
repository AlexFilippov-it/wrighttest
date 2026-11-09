export interface Step {
  action:
    | 'goto'
    | 'click'
    | 'fill'
    | 'press'
    | 'keyboardPress'
    | 'selectOption'
    | 'assertVisible'
    | 'assertHidden'
    | 'assertText'
    | 'assertValue'
    | 'assertURL'
    | 'assertTitle'
    | 'assertChecked'
    | 'assertCount'
    | 'waitForSelector'
    | 'executeSql'
    | 'assertDatabaseResult'
    | 'generateData'
    | 'captureValue'
    | 'httpRequest';
  http?: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
    url: string;
    headers?: Array<{ key: string; value: string; enabled: boolean; secret?: boolean }>;
    queryParams?: Array<{ key: string; value: string; enabled: boolean }>;
    body?: { type: 'none' | 'json' | 'text' | 'form-urlencoded'; value?: string; fields?: Array<{ key: string; value: string; enabled: boolean }> };
    timeoutMs?: number;
    followRedirects?: boolean;
    auth?: { type: 'none' | 'bearer' | 'basic' | 'apiKey'; token?: string; username?: string; password?: string; apiKeyName?: string; apiKeyValue?: string; apiKeyLocation?: 'header' };
    assertions?: Array<
      | { type: 'statusEquals'; expected: number }
      | { type: 'statusIn'; expected: number[] }
      | { type: 'responseTimeLessThan'; expected: number }
      | { type: 'headerExists'; name: string }
      | { type: 'headerEquals' | 'headerContains'; name: string; expected: string }
      | { type: 'jsonPathExists'; path: string }
      | { type: 'jsonPathEquals' | 'jsonPathContains'; path: string; expected: string | number | boolean }
      | { type: 'jsonPathType'; path: string; expectedType: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' }
      | { type: 'jsonArrayLength'; path: string; expected: number }
      | { type: 'textContains' | 'textEquals'; expected: string }
    >;
    capture?: Array<{
      source: 'jsonPath' | 'responseHeader' | 'status' | 'responseTime' | 'textBody';
      path?: string;
      headerName?: string;
      saveAs: string;
      secret?: boolean;
      replace?: boolean;
    }>;
  };
  generator?: 'username' | 'email' | 'password' | 'uuid' | 'string' | 'number' | 'boolean' | 'date' | 'timestamp' | 'pattern';
  generatorOptions?: Record<string, string | number | boolean>;
  saveAs?: string;
  captureSource?: 'text' | 'input' | 'attribute' | 'url' | 'count';
  attributeName?: string;
  secret?: boolean;
  replace?: boolean;
  selector?: string;
  selectorCandidates?: string[];
  elementText?: string;
  elementTag?: string;
  value?: string;
  expected?: string;
  databaseConnectionId?: string;
  sql?: string;
  parameters?: Record<string, string | number | boolean | null>;
  assertion?: {
    type: 'rowCountEquals' | 'rowCountGreaterThan' | 'empty' | 'notEmpty' | 'columnEquals' | 'columnContains' | 'columnNotNull' | 'affectedRowsEquals';
    expected?: string;
    column?: string;
    rowIndex?: number;
  };
  waitForResult?: {
    timeoutMs: number;
    pollIntervalMs: number;
  };
  saveResultAs?: string;
  saveResultType?: 'column' | 'rowCount' | 'affectedRows';
  saveRowIndex?: number;
  saveColumn?: string;
  captureRows?: boolean;
  options?: {
    exact?: boolean;
    timeout?: number;
    nth?: number;
  };
}
