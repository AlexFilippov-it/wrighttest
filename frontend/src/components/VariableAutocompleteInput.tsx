import { Input } from 'antd';
import type { InputProps } from 'antd';
import { useId, useMemo } from 'react';
import type { FormEvent } from 'react';

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
  const listId = useId();

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

  const handleInputChange = (event: FormEvent<HTMLInputElement>) => {
    emitChange(event.currentTarget.value);
  };

  return (
    <>
      <Input
        value={value}
        onChange={handleInputChange}
        onInput={handleInputChange}
        placeholder={placeholder}
        suffix={suffix}
        size={size}
        disabled={disabled}
        autoComplete="off"
        list={options.length > 0 ? listId : undefined}
        style={style}
        {...inputProps}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.value} value={`{{${option.value}}}`} />
        ))}
      </datalist>
    </>
  );
}
