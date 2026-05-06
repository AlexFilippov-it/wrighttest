import type { Step } from '../types/step';

export type StepRequirementIssue = {
  message: string;
  fields: Partial<Record<'selector' | 'value' | 'expected', string>>;
};

function required(field: string) {
  return `${field} is required.`;
}

function buildIssue(fields: StepRequirementIssue['fields']): StepRequirementIssue | null {
  const message = fields.selector ?? fields.value ?? fields.expected;
  return message ? { message, fields } : null;
}

export function validateStepRequirements(step: Step): StepRequirementIssue | null {
  switch (step.action) {
    case 'goto':
      if (!step.value?.trim()) {
        return { message: required('URL'), fields: { value: required('URL') } };
      }
      return null;
    case 'click':
    case 'waitForSelector':
    case 'assertVisible':
    case 'assertHidden':
    case 'assertChecked':
      if (!step.selector?.trim()) {
        return { message: required('Target'), fields: { selector: required('Target') } };
      }
      return null;
    case 'fill':
      return buildIssue({
        ...(step.selector?.trim() ? {} : { selector: required('Target') }),
        ...(step.value?.trim() ? {} : { value: required('Value') })
      });
    case 'press':
      return buildIssue({
        ...(step.selector?.trim() ? {} : { selector: required('Target') }),
        ...(step.value?.trim() ? {} : { value: required('Key') })
      });
    case 'selectOption':
      return buildIssue({
        ...(step.selector?.trim() ? {} : { selector: required('Target') }),
        ...(step.value?.trim() ? {} : { value: required('Option value') })
      });
    case 'assertText':
      return buildIssue({
        ...(step.selector?.trim() ? {} : { selector: required('Target') }),
        ...(step.expected?.trim() ? {} : { expected: required('Expected text') })
      });
    case 'assertValue':
      return buildIssue({
        ...(step.selector?.trim() ? {} : { selector: required('Target') }),
        ...(step.expected?.trim() ? {} : { expected: required('Expected value') })
      });
    case 'assertTitle':
      if (!step.expected?.trim()) {
        return { message: required('Expected title'), fields: { expected: required('Expected title') } };
      }
      return null;
    case 'assertURL':
      if (!step.expected?.trim()) {
        return { message: required('Expected URL/pattern'), fields: { expected: required('Expected URL/pattern') } };
      }
      return null;
    case 'assertCount':
      return buildIssue({
        ...(step.selector?.trim() ? {} : { selector: required('Target') }),
        ...(step.expected?.trim() ? {} : { expected: required('Expected count') })
      });
    default:
      return null;
  }
}
