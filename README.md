# Postman to Swagger Converter

A Node.js tool to convert a Postman collection (v2.1) into a production-ready OpenAPI 3.0 (Swagger) specification and serve it using Swagger UI.

## Features

- Converts Postman collections to OpenAPI 3.0.3 specification.
- Extracts endpoint paths, methods, query/path parameters, and bodies.
- Supports `raw` JSON and `multipart/form-data` bodies.
- Infers JSON schemas based on sample requests.
- Maps Postman authentication (Bearer/Basic) to OpenAPI security schemes.
- Built-in Express server to view the generated documentation via Swagger UI.

## Getting Started

### Prerequisites

- Node.js installed on your machine.
- A Postman collection exported in v2.1 format.

### Installation

1. Clone or download this repository.
2. Install the dependencies:
   ```bash
   npm install
   ```
3. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
4. Place your Postman collection file in the root directory and name it `postman.json`.

### Usage

**1. Generate `swagger.json`**

```bash
npm run convert
```

**2. Start the Swagger UI server**

```bash
npm start
```

The documentation will be available at [http://localhost:3000/api-docs](http://localhost:3000/api-docs).

**3. Do both at once (Convert & Start)**

```bash
npm run dev
```

**4. Validate the generated spec**

```bash
npm run validate
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
Created by [Aziz Sobirov](https://azizdev.uz)
