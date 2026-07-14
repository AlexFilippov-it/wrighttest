export function mergeRuntimeVariables(
  environmentVariables: Record<string, string> = {},
  dataCaseVariables: Record<string, string> = {}
) {
  return {
    ...environmentVariables,
    ...dataCaseVariables
  };
}
