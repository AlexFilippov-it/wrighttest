import type { Step } from '../types/step';
import { VariableContext } from './variable-context';

const HAS_TEMPLATE_PATTERN = /\{\{\w+\}\}/;

export function interpolate(value: string, variables: Record<string, string>): string {
  return new VariableContext({ runInputs: variables }).interpolate(value, { allowMissing: true });
}

export function hasUnresolvedVariables(value: string): boolean {
  return HAS_TEMPLATE_PATTERN.test(value);
}

export function interpolateStep(step: Step, variables: Record<string, string>): Step {
  const context = new VariableContext({ runInputs: variables });
  const allowMissing = (value: string | undefined) =>
    value === undefined ? undefined : context.interpolate(value, { allowMissing: true });
  return {
    ...step,
    ...(step.value === undefined ? {} : { value: allowMissing(step.value) }),
    ...(step.expected === undefined ? {} : { expected: allowMissing(step.expected) }),
    ...(step.selector === undefined ? {} : { selector: allowMissing(step.selector) })
  };
}
