import { AutoComplete, Input } from 'antd';
import type { InputProps } from 'antd';
import { useMemo } from 'react';

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

function insertVariablePlaceholder(value: string, variableName: string) {
  const lastOpen = value.lastIndexOf('{{');
  if (lastOpen < 0) {
    return `${value}{{${variableName}}}`;
  }

  return `${value.slice(0, lastOpen)}{{${variableName}}}`;
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
  disabled
}: VariableAutocompleteInputProps) {
  const options = useMemo(() => {
    const query = getActiveVariableQuery(value);
    if (query === null) return [];

    const normalized = query.toLowerCase();
    return variableNames
      .filter((name) => name.toLowerCase().includes(normalized))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 10)
      .map((name) => ({
        value: name,
        label: <span>{`{{${name}}}`}</span>
      }));
  }, [value, variableNames]);

  const emitChange = (nextValue: string) => {
    onChange?.(nextValue);
    onValueChange?.(nextValue);
  };

  return (
    <AutoComplete
      value={value}
      options={options}
      filterOption={false}
      onSelect={(selected) => emitChange(insertVariablePlaceholder(value, selected))}
      style={style}
    >
      <Input
        value={value}
        onChange={(event) => emitChange(event.target.value)}
        placeholder={placeholder}
        suffix={suffix}
        size={size}
        disabled={disabled}
        autoComplete="off"
      />
    </AutoComplete>
  );
}
