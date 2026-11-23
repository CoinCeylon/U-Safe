export const clientIp = (request: {
  raw?: { socket?: { remoteAddress?: string | null } | null } | null;
}): string => {
  const address = request.raw?.socket?.remoteAddress;
  return typeof address === 'string' && address.length > 0 ? address : 'unknown';
};
