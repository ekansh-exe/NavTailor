// Models sometimes wrap JSON in a ```json fence even when told not to. Strip it, then parse.
// Throws SyntaxError if the text still is not JSON (the router turns that into a fallback).
export function parseModelJson(text) {
  let s = String(text).trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) s = fenced[1];
  return JSON.parse(s);
}
