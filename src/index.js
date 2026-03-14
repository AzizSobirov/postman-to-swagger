require('dotenv').config();
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const path = require('path');
const fs = require('fs');

const SWAGGER_PATH = path.join(__dirname, '..', 'swagger.json');

// Ensure swagger.json exists
if (!fs.existsSync(SWAGGER_PATH)) {
    console.error('❌ swagger.json not found. Run "npm run convert" first.');
    process.exit(1);
}

const swaggerDocument = require(SWAGGER_PATH);

const app = express();
const PORT = process.env.PORT || 3000;

// Swagger UI
app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerDocument, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: `${swaggerDocument.info?.title || 'API'} — Docs`,
        explorer: true,
    })
);

// Redirect root to docs
app.get('/', (_req, res) => res.redirect('/api-docs'));

// Serve raw spec
app.get('/swagger.json', (_req, res) => res.json(swaggerDocument));

app.listen(PORT, () => {
    console.log(`🚀 Swagger UI → http://localhost:${PORT}/api-docs`);
    console.log(`📄 Raw spec   → http://localhost:${PORT}/swagger.json`);
});
