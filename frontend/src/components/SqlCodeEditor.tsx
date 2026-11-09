import CodeMirror from '@uiw/react-codemirror';
import { indentWithTab } from '@codemirror/commands';
import { sql } from '@codemirror/lang-sql';
import { keymap } from '@codemirror/view';
import { EditorView } from '@codemirror/view';

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
};

export default function SqlCodeEditor({ value, onChange, disabled = false, placeholder, ariaLabel }: Props) {
  return (
    <div className="wt-sql-editor">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={[sql(), keymap.of([indentWithTab]), EditorView.lineWrapping]}
        editable={!disabled}
        basicSetup={{ foldGutter: false, highlightActiveLine: false, autocompletion: false }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        minHeight="104px"
        maxHeight="280px"
        style={{ fontSize: 13 }}
      />
    </div>
  );
}
