// Global Error Handler for Invalid JSON & Payload Size Limits
app.use((err, req, res, next) => {
  // 1. Handle Payload > 1 MiB (HTTP 413)
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return sendError(res, 413, 'payload_too_large', 'Payload exceeds maximum allowed size of 1 MiB');
  }

  // 2. Handle Invalid JSON Body (HTTP 400)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return sendError(res, 400, 'invalid_json', 'Invalid JSON payload');
  }

  return sendError(res, 500, 'internal', err.message || 'Internal server error');
});
