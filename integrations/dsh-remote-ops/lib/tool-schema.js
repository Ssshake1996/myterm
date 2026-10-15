// Convert the plugin's field definitions to the JSON Schema expected by DSH.
const compile = node => {
  const { required, ...schema } = node;
  if (Array.isArray(required)) schema.required = [...required];
  if (node.properties) {
    const object = toolParameters(node.properties);
    schema.properties = object.properties;
    const keys = [...new Set([...(schema.required ?? []), ...(object.required ?? [])])];
    if (keys.length) schema.required = keys;
  }
  if (node.items) schema.items = compile(node.items);
  if (node.oneOf) schema.oneOf = node.oneOf.map(compile);
  return schema;
};

export function toolParameters(fields) {
  const properties = Object.fromEntries(Object.entries(fields).map(([key, node]) => [key, compile(node)]));
  const required = Object.entries(fields).filter(([, node]) => node.required === true).map(([key]) => key);
  return { type: "object", properties, additionalProperties: true, ...(required.length ? { required } : {}) };
}
