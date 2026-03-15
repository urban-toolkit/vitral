export function getRequestOrigin(request: any) {
  return `${request.protocol}://${request.host}`;
}

export function getFrontendUrl(request: any, path = "/") {
  const basePath = process.env.FRONTEND_BASE_PATH || "/";
  const base = new URL(basePath, `${getRequestOrigin(request)}/`);
  return new URL(path.replace(/^\//, ""), base).toString();
}