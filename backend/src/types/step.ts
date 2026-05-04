export interface Step {
  action:
    | 'goto'
    | 'click'
    | 'fill'
    | 'press'
    | 'selectOption'
    | 'assertVisible'
    | 'assertHidden'
    | 'assertText'
    | 'assertValue'
    | 'assertURL'
    | 'assertTitle'
    | 'assertChecked'
    | 'assertCount'
    | 'waitForSelector';
  selector?: string;
  selectorCandidates?: string[];
  elementText?: string;
  elementTag?: string;
  value?: string;
  expected?: string;
  options?: {
    exact?: boolean;
    timeout?: number;
    nth?: number;
  };
}
