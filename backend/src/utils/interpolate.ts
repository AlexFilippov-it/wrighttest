import type { Step } from '../types/step';

const TEMPLATE_PATTERN = /\{\{(\w+)\}\}/g;
const HAS_TEMPLATE_PATTERN = /\{\{\w+\}\}/;

export function interpolate(value: string, variables: Record<string, string>): string {
  return value.replace(TEMPLATE_PATTERN, (match, key) => {
    if (key in variables) return variables[key];
    console.warn(`[interpolate] Variable {{${key}}} not found`);
    return match;
  });
}

export function hasUnresolvedVariables(value: string): boolean {
  return HAS_TEMPLATE_PATTERN.test(value);
}

export function interpolateStep(step: Step, variables: Record<string, string>): Step {
  return {
    ...step,
    value: step.value ? interpolate(step.value, variables) : step.value,
    expected: step.expected ? interpolate(step.expected, variables) : step.expected,
    selector: step.selector ? interpolate(step.selector, variables) : step.selector
  };
}
