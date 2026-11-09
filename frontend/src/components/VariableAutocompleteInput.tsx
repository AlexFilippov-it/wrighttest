import { Button, Input, Space, Typography } from 'antd';
import type { InputProps } from 'antd';
import type { InputRef } from 'antd';
import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

type VariableAutocompleteInputProps = Omit<InputProps, 'value' | 'onChange'> & {
  value?: string;
  onChange?: (value: string) => void;
  onValueChange?: (value: string) => void;
  variableNames: string[];
};

function getActiveVariableQuery(value: string) {
  const match = value.match(/\{\{([A-Za-z0-9_]*)$/);
  return match ? match[1] : null;
}

export default function VariableAutocompleteInput({
  value = '',
  onChange,
  onValueChange,
  variableNames,
  placeholder,
  suffix,
  style,
  size,
  disabled,
  ...inputProps
}: VariableAutocompleteInputProps) {
  const inputRef = useRef<InputRef>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  const options = useMemo(() => {
    const query = getActiveVariableQuery(value);
    if (query === null) return [];

    const normalized = query.toLowerCase();
    return variableNames
      .filter((name) => name.toLowerCase().includes(normalized))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 10)
      .map((name) => ({ value: name }));
  }, [value, variableNames]);

  const emitChange = (nextValue: string) => {
    onChange?.(nextValue);
    onValueChange?.(nextValue);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    emitChange(event.currentTarget.value);
    setCursor(event.currentTarget.selectionStart);
  };

  const insertVariable = (name: string) => {
    const input = inputRef.current?.input;
    const caret = cursor ?? input?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const match = before.match(/\{\{([A-Za-z0-9_]*)$/);
    if (!match) return;
    const start = caret - match[0].length;
    const next = `${value.slice(0, start)}{{${name}}}${value.slice(caret)}`;
    emitChange(next);
    setCursor(start + name.length + 4);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(start + name.length + 4, start + name.length + 4);
    });
  };

  return (
    <div style={{ position: 'relative', width: style?.width ?? '100%' }}>
      <Input
        ref={inputRef}
        value={value}
        onChange={handleInputChange}
        onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
        onKeyDown={(event) => { if (event.key === 'Escape') setCursor(null); }}
        placeholder={placeholder}
        suffix={suffix}
        size={size}
        disabled={disabled}
        autoComplete="off"
        style={style}
        {...inputProps}
      />
      {options.length > 0 && !disabled && getActiveVariableQuery(value) !== null ? <div
        role="listbox"
        style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, maxHeight: 220, overflowY: 'auto', padding: 6, background: '#fff', border: '1px solid #d9dfe8', borderRadius: 8, boxShadow: '0 6px 18px rgba(15, 23, 42, .12)' }}
      >
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          {options.map((option) => <Button key={option.value} role="option" aria-selected="false" type="text" size="small" block style={{ textAlign: 'left' }} onMouseDown={(event) => event.preventDefault()} onClick={() => insertVariable(option.value)}>
            <Typography.Text code>{'{{' + option.value + '}}'}</Typography.Text>
          </Button>)}
        </Space>
      </div> : null}
    </div>
  );
}
