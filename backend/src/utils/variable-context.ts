export type VariableValue =
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>
  | unknown[];

export type VariableSource = 'project' | 'environment' | 'testData' | 'runInput' | 'generated' | 'captured';
export type VariableType = 'string' | 'number' | 'boolean' | 'json' | 'null';
export type VariableEngineErrorCode =
  | 'VARIABLE_NOT_FOUND'
  | 'VARIABLE_TYPE_MISMATCH'
  | 'VARIABLE_COLLISION'
  | 'VARIABLE_INVALID_NAME'
  | 'VARIABLE_VALUE_TOO_LARGE'
  | 'VARIABLE_INTERPOLATION_ERROR';

export type VariableEntry = {
  name: string;
  value: VariableValue;
  type: VariableType;
  secret: boolean;
  source: VariableSource;
  createdByStep?: number;
};

export type VariableMetadata = Omit<VariableEntry, 'value'>;

export type VariableEngineErrorOptions = {
  variableName?: string;
  stepIndex?: number;
  expectedType?: string;
  message: string;
};

const VARIABLE_NAME = /^\w{1,100}$/;
const TEMPLATE = /(\\)?\{\{(\w+)\}\}/g;
const EXACT_TEMPLATE = /^\{\{(\w+)\}\}$/;
const SECRET_NAME = /(pass(word)?|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i;
const MAX_VALUE_LENGTH = 10_000;
const RESERVED_RUNTIME_NAMES = new Set(['RUN_ID', 'SUITE_RUN_ID', 'CURRENT_DATE']);

export class VariableEngineError extends Error {
  readonly code: VariableEngineErrorCode;
  readonly variableName?: string;
  readonly stepIndex?: number;
  readonly expectedType?: string;

  constructor(code: VariableEngineErrorCode, options: VariableEngineErrorOptions) {
    super(options.message);
    this.name = 'VariableEngineError';
    this.code = code;
    this.variableName = options.variableName;
    this.stepIndex = options.stepIndex;
    this.expectedType = options.expectedType;
  }
}

function variableType(value: VariableValue): VariableType {
  if (value === null) return 'null';
  if (Array.isArray(value) || typeof value === 'object') return 'json';
  return typeof value as 'string' | 'number' | 'boolean';
}

function cloneAndValidateValue(value: unknown, name: string): VariableValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) {
      throw new VariableEngineError('VARIABLE_VALUE_TOO_LARGE', {
        variableName: name,
        message: `Variable "${name}" exceeds the ${MAX_VALUE_LENGTH}-character limit.`
      });
    }
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object') {
    try {
      const serialized = JSON.stringify(value);
      if (serialized === undefined || serialized.length > MAX_VALUE_LENGTH) {
        throw new VariableEngineError('VARIABLE_VALUE_TOO_LARGE', {
          variableName: name,
          message: `Variable "${name}" exceeds the ${MAX_VALUE_LENGTH}-character limit.`
        });
      }
      return JSON.parse(serialized) as Record<string, unknown> | unknown[];
    } catch (error) {
      if (error instanceof VariableEngineError) throw error;
      throw new VariableEngineError('VARIABLE_TYPE_MISMATCH', {
        variableName: name,
        expectedType: 'JSON-compatible value',
        message: `Variable "${name}" is not a supported JSON value.`
      });
    }
  }
  throw new VariableEngineError('VARIABLE_TYPE_MISMATCH', {
    variableName: name,
    expectedType: 'string, number, boolean, null, or JSON',
    message: `Variable "${name}" has an unsupported value type.`
  });
}

function scalarToString(value: VariableValue, name: string): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new VariableEngineError('VARIABLE_TYPE_MISMATCH', {
    variableName: name,
    expectedType: 'scalar string value',
    message: `Variable "${name}" contains JSON data and cannot be interpolated into a text field.`
  });
}

export class VariableContext {
  private readonly sources: Record<'project' | 'environment' | 'testData' | 'runInput', Map<string, VariableEntry>>;
  private readonly runtime = new Map<string, VariableEntry>();
  private readonly resolver: VariableResolver;

  constructor(input: {
    projectVariables?: Record<string, unknown>;
    environmentVariables?: Record<string, unknown>;
    testDataVariables?: Record<string, unknown>;
    runInputs?: Record<string, unknown>;
  } = {}) {
    this.sources = {
      project: this.makeSource('project', input.projectVariables),
      environment: this.makeSource('environment', input.environmentVariables),
      testData: this.makeSource('testData', input.testDataVariables),
      runInput: this.makeSource('runInput', input.runInputs)
    };
    this.resolver = new VariableResolver(this);
  }

  private makeSource(source: VariableSource, values: Record<string, unknown> = {}) {
    const result = new Map<string, VariableEntry>();
    for (const [name, rawValue] of Object.entries(values)) {
      if (!VARIABLE_NAME.test(name)) {
        throw new VariableEngineError('VARIABLE_INVALID_NAME', {
          variableName: name,
          message: `Variable name "${name}" is invalid.`
        });
      }
      const value = cloneAndValidateValue(rawValue, name);
      result.set(name, {
        name,
        value,
        type: variableType(value),
        secret: SECRET_NAME.test(name),
        source
      });
    }
    return result;
  }

  resolve(name: string): VariableEntry | undefined {
    if (!VARIABLE_NAME.test(name)) {
      throw new VariableEngineError('VARIABLE_INVALID_NAME', {
        variableName: name,
        message: 'Variable reference has an invalid name.'
      });
    }
    const entry = this.runtime.get(name)
      ?? this.sources.runInput.get(name)
      ?? this.sources.testData.get(name)
      ?? this.sources.environment.get(name)
      ?? this.sources.project.get(name);
    return entry ? { ...entry, value: cloneAndValidateValue(entry.value, entry.name) } : undefined;
  }

  has(name: string) {
    return this.resolve(name) !== undefined;
  }

  interpolate(text: string, options: { allowMissing?: boolean; stepIndex?: number } = {}) {
    return this.resolver.interpolate(text, options);
  }

  resolveTyped(value: VariableValue, options: { stepIndex?: number } = {}): VariableValue {
    return this.resolver.resolveTyped(value, options);
  }

  resolveSqlParameter(value: string | number | boolean | null, options: { stepIndex?: number } = {}) {
    return this.resolver.resolveSqlParameter(value, options);
  }

  resolveStep<T extends {
    value?: string;
    expected?: string;
    selector?: string;
    parameters?: Record<string, string | number | boolean | null>;
    assertion?: { expected?: string };
  }>(step: T, stepIndex?: number): T {
    return this.resolver.resolveStep(step, stepIndex);
  }

  setRuntime(name: string, value: unknown, metadata: {
    source: 'generated' | 'captured';
    secret?: boolean;
    createdByStep?: number;
    replace?: boolean;
  }) {
    this.assertRuntimeWritable(name, metadata.replace, metadata.createdByStep);
    const clonedValue = cloneAndValidateValue(value, name);
    this.runtime.set(name, {
      name,
      value: clonedValue,
      type: variableType(clonedValue),
      secret: metadata.secret ?? SECRET_NAME.test(name),
      source: metadata.source,
      ...(metadata.createdByStep === undefined ? {} : { createdByStep: metadata.createdByStep })
    });
  }

  assertRuntimeWritable(name: string, replace = false, stepIndex?: number) {
    if (!VARIABLE_NAME.test(name) || RESERVED_RUNTIME_NAMES.has(name)) {
      throw new VariableEngineError('VARIABLE_INVALID_NAME', {
        variableName: name,
        message: `Runtime variable name "${name}" is invalid or reserved.`
      });
    }
    if (this.runtime.has(name) && !replace) {
      throw new VariableEngineError('VARIABLE_COLLISION', {
        variableName: name,
        stepIndex,
        message: `Runtime variable "${name}" was already written in this run. Explicit replacement is required.`
      });
    }
  }

  getMetadata(): VariableMetadata[] {
    const names = new Set<string>();
    const result: VariableMetadata[] = [];
    for (const source of [this.runtime, this.sources.runInput, this.sources.testData, this.sources.environment, this.sources.project]) {
      for (const [name, entry] of source) {
        if (names.has(name)) continue;
        names.add(name);
        result.push({
          name: entry.name,
          type: entry.type,
          secret: entry.secret,
          source: entry.source,
          ...(entry.createdByStep === undefined ? {} : { createdByStep: entry.createdByStep })
        });
      }
    }
    return result.sort((left, right) => left.name.localeCompare(right.name));
  }

  redact(text: string) {
    let result = text;
    const secrets = this.getAllEntries()
      .filter((entry) => entry.secret && entry.value !== null)
      .map((entry) => {
        if (entry.value === null) return '';
        return typeof entry.value === 'object' ? JSON.stringify(entry.value) : String(entry.value);
      })
      .filter((value) => value.length > 0)
      .sort((left, right) => right.length - left.length);
    for (const secret of secrets) result = result.split(secret).join('••••••');
    return result;
  }

  private getAllEntries() {
    return [this.sources.project, this.sources.environment, this.sources.testData, this.sources.runInput, this.runtime]
      .flatMap((source) => [...source.values()]);
  }

  static readonly valueLimit = MAX_VALUE_LENGTH;
}

export class VariableResolver {
  constructor(private readonly context: VariableContext) {}

  interpolate(text: string, options: { allowMissing?: boolean; stepIndex?: number } = {}) {
    return text.replace(TEMPLATE, (match, escaped: string | undefined, name: string) => {
      if (escaped) return match.slice(1);
      const entry = this.context.resolve(name);
      if (!entry) {
        if (options.allowMissing) return match;
        throw new VariableEngineError('VARIABLE_NOT_FOUND', {
          variableName: name,
          stepIndex: options.stepIndex,
          message: `Variable "${name}" is not available${options.stepIndex === undefined ? '' : ` at step ${options.stepIndex + 1}`}.`
        });
      }
      try {
        return scalarToString(entry.value, name);
      } catch (error) {
        if (error instanceof VariableEngineError) {
          throw new VariableEngineError(error.code, {
            variableName: name,
            stepIndex: options.stepIndex,
            expectedType: error.expectedType,
            message: error.message
          });
        }
        throw error;
      }
    });
  }

  resolveTyped(value: VariableValue, options: { stepIndex?: number } = {}): VariableValue {
    if (typeof value !== 'string') return cloneAndValidateValue(value, '<inline>');
    const exactMatch = value.match(EXACT_TEMPLATE);
    if (exactMatch) {
      const entry = this.context.resolve(exactMatch[1]);
      if (!entry) {
        throw new VariableEngineError('VARIABLE_NOT_FOUND', {
          variableName: exactMatch[1],
          stepIndex: options.stepIndex,
          message: `Variable "${exactMatch[1]}" is not available${options.stepIndex === undefined ? '' : ` at step ${options.stepIndex + 1}`}.`
        });
      }
      return entry.value;
    }
    return this.interpolate(value, options);
  }

  resolveSqlParameter(value: string | number | boolean | null, options: { stepIndex?: number } = {}) {
    const resolved = this.resolveTyped(value, options);
    if (resolved === null || typeof resolved === 'string' || typeof resolved === 'number' || typeof resolved === 'boolean') return resolved;
    throw new VariableEngineError('VARIABLE_TYPE_MISMATCH', {
      variableName: typeof value === 'string' ? value.match(EXACT_TEMPLATE)?.[1] : undefined,
      stepIndex: options.stepIndex,
      expectedType: 'SQL scalar parameter',
      message: 'SQL parameters must resolve to a string, number, boolean, or null.'
    });
  }

  resolveStep<T extends {
    value?: string;
    expected?: string;
    selector?: string;
    parameters?: Record<string, string | number | boolean | null>;
    assertion?: { expected?: string };
  }>(step: T, stepIndex?: number): T {
    return {
      ...step,
      ...(step.value === undefined ? {} : { value: this.interpolate(step.value, { stepIndex }) }),
      ...(step.expected === undefined ? {} : { expected: this.interpolate(step.expected, { stepIndex }) }),
      ...(step.selector === undefined ? {} : { selector: this.interpolate(step.selector, { stepIndex }) }),
      ...(step.parameters === undefined ? {} : {
        parameters: Object.fromEntries(Object.entries(step.parameters).map(([key, value]) => [
          key,
          this.resolveSqlParameter(value, { stepIndex })
        ]))
      }),
      ...(step.assertion === undefined ? {} : {
        assertion: {
          ...step.assertion,
          ...(step.assertion.expected === undefined ? {} : { expected: this.interpolate(step.assertion.expected, { stepIndex }) })
        }
      })
    };
  }
}
