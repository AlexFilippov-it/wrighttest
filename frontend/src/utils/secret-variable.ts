const SECRET_VARIABLE_NAME = /(pass(word)?|secret|token|api[_-]?key|authorization|auth[_-]?code|verification[_-]?code|otp|cookie|credential|private[_-]?key)/i;

export function isSecretVariableName(name: string) {
  return SECRET_VARIABLE_NAME.test(name);
}
