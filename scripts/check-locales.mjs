import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const localeDir = path.join(root, 'shared/locales');
const sourceDir = path.join(root, 'frontend/src');
const source = JSON.parse(fs.readFileSync(path.join(localeDir, 'en.json'), 'utf8'));
const russian = JSON.parse(fs.readFileSync(path.join(localeDir, 'ru-RU.json'), 'utf8'));
const exceptions = JSON.parse(fs.readFileSync(path.join(root, 'scripts/i18n-ui-exceptions.json'), 'utf8'));
const errors = [];
const pluralBases = new Set(Object.keys(source).map((key) => key.replace(/_(zero|one|two|few|many|other)$/, '')));

function variables(value) {
  return [...value.matchAll(/{{\s*([\w.-]+)\s*}}/g)].map((match) => match[1]).sort();
}

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(filePath) : /\.tsx?$/.test(entry.name) ? [filePath] : [];
  });
}

for (const [key, value] of Object.entries(source)) {
  if (typeof value !== 'string' || !value.trim()) errors.push(`English source is empty or invalid: ${key}`);
  if (!(key in russian)) errors.push(`Russian translation is missing: ${key}`);
  else if (typeof russian[key] !== 'string' || !russian[key].trim()) errors.push(`Russian translation is empty or invalid: ${key}`);
  else if (JSON.stringify(variables(value)) !== JSON.stringify(variables(russian[key]))) {
    errors.push(`Interpolation variables differ: ${key}`);
  }
}
for (const key of Object.keys(russian)) {
  const pluralBase = key.replace(/_(zero|one|two|few|many|other)$/, '');
  if (!(key in source) && !pluralBases.has(pluralBase)) errors.push(`Russian catalog has an unknown key: ${key}`);
  if (!(key in source) && pluralBases.has(pluralBase)) {
    const sourceVariant = Object.keys(source).find((sourceKey) => sourceKey.replace(/_(zero|one|two|few|many|other)$/, '') === pluralBase);
    if (sourceVariant && JSON.stringify(variables(source[sourceVariant])) !== JSON.stringify(variables(russian[key]))) {
      errors.push(`Interpolation variables differ: ${key}`);
    }
  }
}

const used = new Set();
const missingSourceKeys = new Set();
const untranslatedUi = new Set();
const ignoredFiles = new Set(Object.keys(exceptions.files));
const ignoredLiterals = new Set(Object.keys(exceptions.literals));
const uiAttributes = new Set([
  'placeholder', 'title', 'aria-label', 'label', 'message', 'description',
  'okText', 'cancelText', 'confirmText', 'emptyText', 'extra', 'retryLabel'
]);
const userMessageMethods = new Set(['success', 'error', 'info', 'warning', 'loading']);

function isUiText(value) {
  const text = value.trim();
  return /[A-Za-z]{2}/.test(text) && !/^(?:https?:\/\/|data:|[A-Z_][A-Z0-9_]*=|[\w.-]+\.[\w.-]+)$/.test(text);
}

function addUiString(filePath, node, value) {
  const relativePath = path.relative(sourceDir, filePath).replaceAll(path.sep, '/');
  if (!isUiText(value) || ignoredLiterals.has(value.trim())) return;
  const { line } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
  untranslatedUi.add(`${relativePath}:${line + 1}: ${JSON.stringify(value.trim())}`);
}

for (const filePath of collectFiles(sourceDir)) {
  const relativePath = path.relative(sourceDir, filePath).replaceAll(path.sep, '/');
  if (ignoredFiles.has(relativePath)) continue;
  const contents = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, contents, ts.ScriptTarget.Latest, true, filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      const arg = node.arguments[0];
      const keyCandidates = new Set();
      if (arg) {
        function collectKeys(current) {
          if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) keyCandidates.add(current.text);
          if (ts.isTemplateExpression(current)) {
            const prefix = current.head.text;
            for (const key of Object.keys(source)) if (key.startsWith(prefix)) keyCandidates.add(key);
          }
          ts.forEachChild(current, collectKeys);
        }
        collectKeys(arg);
      }
      for (const candidate of keyCandidates) {
        if (/^[A-Za-z][\w-]*\.[\w.-]+$/.test(candidate) && !(candidate in source) && !pluralBases.has(candidate)) {
          missingSourceKeys.add(`${relativePath}: ${candidate}`);
        }
        if (candidate in source || pluralBases.has(candidate.replace(/_(zero|one|two|few|many|other)$/, ''))) used.add(candidate);
      }
    }

    if (ts.isJsxText(node)) addUiString(filePath, node, node.text);

    if (ts.isJsxAttribute(node) && node.name && ts.isIdentifier(node.name) && uiAttributes.has(node.name.text)) {
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer)) addUiString(filePath, initializer, initializer.text);
      if (initializer && ts.isJsxExpression(initializer) && initializer.expression && ts.isStringLiteral(initializer.expression)) {
        addUiString(filePath, initializer.expression, initializer.expression.text);
      }
      if (initializer && ts.isJsxExpression(initializer) && initializer.expression && ts.isTemplateExpression(initializer.expression)) {
        addUiString(filePath, initializer.expression, initializer.expression.head.text);
      }
    }

    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && uiAttributes.has(node.name.text) &&
      (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
      addUiString(filePath, node.initializer, node.initializer.text);
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.expression.getText(sourceFile) === 'message' || node.expression.expression.getText(sourceFile) === 'notification') &&
      userMessageMethods.has(node.expression.name.text)) {
      const arg = node.arguments[0];
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) addUiString(filePath, arg, arg.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}
if (missingSourceKeys.size) {
  errors.push(`Translation keys are missing from the English source: ${[...missingSourceKeys].join(', ')}`);
}
if (untranslatedUi.size) {
  errors.push(`Likely hardcoded user-facing strings remain in active UI (${untranslatedUi.size}): ${[...untranslatedUi].join(', ')}`);
}

const unused = Object.keys(source).filter((key) => {
  if (used.has(key) || key.startsWith('project.') || key.startsWith('role.')) return false;
  const pluralBase = key.replace(/_(zero|one|two|few|many|other)$/, '');
  return !used.has(pluralBase);
});
if (unused.length) errors.push(`Unused catalog keys: ${unused.join(', ')}`);

if (errors.length) {
  console.error(`Locale check failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Locale check passed: ${Object.keys(source).length} English/Russian messages, interpolation, usage, and UI literal scan are consistent.`);
}
