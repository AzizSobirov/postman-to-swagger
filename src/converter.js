#!/usr/bin/env node

/**
 * Postman Collection v2.1 → OpenAPI 3.0.3 Converter
 *
 * Reads public/postman.json and outputs swagger.json at the project root.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ─── Configuration ──────────────────────────────────────────────────────────────

const INPUT = path.join(__dirname, '..', 'postman.json');
const OUTPUT = path.join(__dirname, '..', 'swagger.json');

// Postman variable patterns to strip from URLs
const HOST_VAR_RE = /^\{\{[^}]+\}\}/;

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Infer a JSON Schema from a JavaScript value.
 */
function inferSchema(value) {
  if (value === null || value === undefined) {
    return { type: 'string', nullable: true };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { type: 'array', items: {} };
    return { type: 'array', items: inferSchema(value[0]) };
  }
  switch (typeof value) {
    case 'number':
      return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'string':
      return { type: 'string' };
    case 'object': {
      const properties = {};
      for (const [k, v] of Object.entries(value)) {
        properties[k] = inferSchema(v);
      }
      return { type: 'object', properties };
    }
    default:
      return { type: 'string' };
  }
}

/**
 * Build an OpenAPI path string from Postman URL path segments.
 * - Strips host variables
 * - Detects numeric-only segments as {id} path parameters
 */
function buildPath(urlObj) {
  if (!urlObj || !urlObj.path) return '/';
  const segments = urlObj.path.map((seg) => {
    // Already a Postman variable like :id
    if (seg.startsWith(':')) return `{${seg.slice(1)}}`;
    // Pure numeric → treat as {id}
    if (/^\d+$/.test(seg)) return '{id}';
    return seg;
  });
  return '/' + segments.join('/');
}

/**
 * Sanitise a tag name: lowercase, replace spaces/underscores with readable form.
 */
function tagName(folderName) {
  return folderName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Create a unique operationId from tag + request name.
 */
function operationId(tag, name) {
  const base = `${tag}_${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return base;
}

/**
 * Sanitize a schema name for use as a component key.
 */
function schemaKey(name) {
  return name
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// ─── Reusable Schema Registry ──────────────────────────────────────────────────

const componentSchemas = {};
const schemaCounter = {};

function registerSchema(name, schema) {
  const key = schemaKey(name);
  if (!componentSchemas[key]) {
    componentSchemas[key] = schema;
  }
  return key;
}

// ─── Main Conversion ────────────────────────────────────────────────────────────

function convert() {
  const collection = JSON.parse(fs.readFileSync(INPUT, 'utf-8'));

  const openapi = {
    openapi: '3.0.3',
    info: {
      title: collection.info?.name || 'API',
      description: `Auto-generated from Postman collection "${collection.info?.name || ''}"`,
      version: '1.0.0',
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:3000',
        description: 'Target API server',
      },
    ],
    tags: [],
    paths: {},
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        BasicAuth: {
          type: 'http',
          scheme: 'basic',
        },
      },
      schemas: componentSchemas,
    },
  };

  // Track tags we've seen
  const seenTags = new Set();

  /**
   * Recursively process Postman items.
   * @param {Array} items - Postman item array
   * @param {string} parentTag - Inherited tag from parent folder
   */
  function processItems(items, parentTag = '') {
    for (const item of items) {
      // Folder → recurse
      if (item.item && Array.isArray(item.item)) {
        const tag = tagName(item.name);
        if (!seenTags.has(tag)) {
          seenTags.add(tag);
          openapi.tags.push({
            name: tag,
            description: `Operations related to ${item.name}`,
          });
        }
        processItems(item.item, tag);
        continue;
      }

      // Leaf item → endpoint
      if (!item.request) continue;

      const req = item.request;
      const method = (req.method || 'GET').toLowerCase();
      const urlObj = typeof req.url === 'string' ? { raw: req.url, path: req.url.split('/') } : req.url || {};
      const apiPath = buildPath(urlObj);

      // Skip root path or malformed
      if (apiPath === '/') continue;

      const tag = parentTag || 'Default';
      const opId = operationId(tag, item.name);
      const summary = item.name || '';

      // Build the operation object
      const operation = {
        tags: [tag],
        summary: summary,
        operationId: opId,
        parameters: [],
        responses: {
          200: {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
          401: { description: 'Unauthorized' },
          404: { description: 'Not found' },
          500: { description: 'Internal server error' },
        },
      };

      // ── Security ────────────────────────────────────────────────────────
      if (req.auth) {
        if (req.auth.type === 'bearer') {
          operation.security = [{ BearerAuth: [] }];
        } else if (req.auth.type === 'basic') {
          operation.security = [{ BasicAuth: [] }];
        }
      }

      // ── Path Parameters ─────────────────────────────────────────────────
      if (urlObj.path) {
        for (const seg of urlObj.path) {
          if (seg.startsWith(':')) {
            operation.parameters.push({
              name: seg.slice(1),
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: `${seg.slice(1)} parameter`,
            });
          }
        }
        // Detect numeric segments converted to {id}
        const hasNumericId = urlObj.path.some((seg) => /^\d+$/.test(seg));
        const hasColonId = urlObj.path.some((seg) => seg === ':id');
        if (hasNumericId && !hasColonId) {
          operation.parameters.push({
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer' },
            description: 'Resource ID',
          });
        }
      }

      // ── Query Parameters ────────────────────────────────────────────────
      if (urlObj.query && Array.isArray(urlObj.query)) {
        for (const q of urlObj.query) {
          if (q.disabled) continue; // Skip disabled params
          operation.parameters.push({
            name: q.key,
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: q.description || `Query parameter: ${q.key}`,
            example: q.value || undefined,
          });
        }
      }

      // Remove empty parameters array
      if (operation.parameters.length === 0) {
        delete operation.parameters;
      }

      // ── Request Body ────────────────────────────────────────────────────
      const body = req.body;
      if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
        if (body.mode === 'raw' && body.raw && body.raw.trim()) {
          try {
            const parsed = JSON.parse(body.raw);
            const schema = inferSchema(parsed);

            // Register as a reusable schema
            const sKey = registerSchema(`${opId}_Body`, schema);

            operation.requestBody = {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: `#/components/schemas/${sKey}` },
                  example: parsed,
                },
              },
            };
          } catch {
            // Non-JSON raw body → treat as string
            operation.requestBody = {
              required: true,
              content: {
                'text/plain': {
                  schema: { type: 'string' },
                  example: body.raw,
                },
              },
            };
          }
        } else if (body.mode === 'formdata' && Array.isArray(body.formdata)) {
          const properties = {};
          const required = [];
          for (const field of body.formdata) {
            if (field.disabled) continue;
            if (field.type === 'file') {
              properties[field.key] = {
                type: 'string',
                format: 'binary',
                description: field.description || `File upload: ${field.key}`,
              };
            } else {
              properties[field.key] = {
                type: 'string',
                description: field.description || undefined,
                example: field.value || undefined,
              };
            }
            required.push(field.key);
          }
          const formSchema = { type: 'object', properties };
          if (required.length > 0) formSchema.required = required;

          const sKey = registerSchema(`${opId}_FormData`, formSchema);

          operation.requestBody = {
            required: true,
            content: {
              'multipart/form-data': {
                schema: { $ref: `#/components/schemas/${sKey}` },
              },
            },
          };
        }
      }

      // ── Postman Saved Responses → Response Examples ─────────────────────
      if (item.response && Array.isArray(item.response) && item.response.length > 0) {
        for (const resp of item.response) {
          const code = String(resp.code || 200);
          let respBody;
          try {
            respBody = JSON.parse(resp.body || '{}');
          } catch {
            respBody = resp.body;
          }
          operation.responses[code] = {
            description: resp.name || resp.status || `Response ${code}`,
            content: {
              'application/json': {
                schema: { type: 'object' },
                example: respBody,
              },
            },
          };
        }
      }

      // ── Add to paths ───────────────────────────────────────────────────
      if (!openapi.paths[apiPath]) {
        openapi.paths[apiPath] = {};
      }

      // Handle duplicate method on same path by appending info to summary
      if (openapi.paths[apiPath][method]) {
        // Make a slightly different path to avoid collision
        const altPath = apiPath.endsWith('/') ? apiPath + '_' + opId : apiPath + '/' + opId.split('_').pop();
        if (!openapi.paths[altPath]) openapi.paths[altPath] = {};
        openapi.paths[altPath][method] = operation;
      } else {
        openapi.paths[apiPath][method] = operation;
      }
    }
  }

  processItems(collection.item || []);

  // ── Sort tags alphabetically ──────────────────────────────────────────────
  openapi.tags.sort((a, b) => a.name.localeCompare(b.name));

  // ── Write output ──────────────────────────────────────────────────────────
  const output = JSON.stringify(openapi, null, 2);
  fs.writeFileSync(OUTPUT, output, 'utf-8');

  const pathCount = Object.keys(openapi.paths).length;
  const schemaCount = Object.keys(componentSchemas).length;
  console.log(`✅ Converted successfully!`);
  console.log(`   Paths:   ${pathCount}`);
  console.log(`   Schemas: ${schemaCount}`);
  console.log(`   Tags:    ${openapi.tags.length}`);
  console.log(`   Output:  ${OUTPUT}`);
}

convert();
