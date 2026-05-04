function escapeQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function quote(value: string): string {
  return `'${escapeQuoted(value)}'`;
}

function extractQuotedArgument(source: string, key: string): string | null {
  const match = source.match(new RegExp(`${key}\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`));
  return match?.[2] ?? null;
}

function extractFirstQuoted(source: string): string | null {
  const match = source.match(/(['"`])([\s\S]*?)\1/);
  return match?.[2] ?? null;
}

function extractRoleName(selector: string): { role: string; name: string } | null {
  const match = selector.match(
    /^page\.getByRole\(\s*(['"`])([^'"`]+)\1\s*,\s*\{[\s\S]*?name\s*:\s*(['"`])([\s\S]*?)\3/
  );
  if (!match) return null;
  return {
    role: match[2],
    name: match[4]
  };
}

function extractGetByText(selector: string): string | null {
  const match = selector.match(/^page\.getByText\(\s*(['"`])([\s\S]*?)\1/);
  return match?.[2] ?? null;
}

export function deriveSelectorCandidates(selector: string): string[] {
  const normalized = selector.trim();
  const candidates: string[] = [];

  const role = extractRoleName(normalized);
  if (role?.name) {
    candidates.push(`page.getByText(${quote(role.name)})`);

    if (role.role === 'link') {
      candidates.push(`page.locator('a', { hasText: ${quote(role.name)} })`);
    }

    if (role.role === 'button') {
      candidates.push(`page.locator('button', { hasText: ${quote(role.name)} })`);
    }

    if (role.role === 'option') {
      candidates.push(`page.locator('option', { hasText: ${quote(role.name)} })`);
    }
  }

  const text = extractGetByText(normalized);
  if (text) {
    candidates.push(`page.locator('text=${text.replace(/'/g, "\\'")}')`);
    candidates.push(`page.getByText(${quote(text)})`);
  }

  const labelText = extractQuotedArgument(normalized, 'name');
  if (!role && labelText) {
    candidates.push(`page.getByText(${quote(labelText)})`);
  }

  return [...new Set(candidates.filter(Boolean))];
}
