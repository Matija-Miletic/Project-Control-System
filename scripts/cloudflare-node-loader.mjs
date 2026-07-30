/**
 * Artifact validation imports the Worker in plain Node, where the Cloudflare
 * runtime-only module does not exist. The validator never handles a request,
 * so an empty binding object is sufficient to verify the ESM export shape.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      url: "data:text/javascript,export const env = Object.freeze({});",
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
