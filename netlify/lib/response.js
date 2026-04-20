// netlify/lib/response.js

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

export const ok = (data) => ({
  statusCode: 200,
  headers,
  body: JSON.stringify(data),
});

export const created = (data) => ({
  statusCode: 201,
  headers,
  body: JSON.stringify(data),
});

export const badRequest = (message) => ({
  statusCode: 400,
  headers,
  body: JSON.stringify({ error: message }),
});

export const unauthorized = () => ({
  statusCode: 401,
  headers,
  body: JSON.stringify({ error: 'Unauthorized' }),
});

export const notFound = (message = 'Not found') => ({
  statusCode: 404,
  headers,
  body: JSON.stringify({ error: message }),
});

export const serverError = (err) => ({
  statusCode: 500,
  headers,
  body: JSON.stringify({ error: err?.message || 'Server error' }),
});

export const cors = () => ({
  statusCode: 204,
  headers,
  body: '',
});
