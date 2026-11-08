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
    | 'captureValue';
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
